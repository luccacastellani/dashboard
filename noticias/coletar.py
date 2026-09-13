# -*- coding: utf-8 -*-
"""
Coletor de notícias do dashboard.

Lê a lista de jornais em fontes.json, baixa o feed (RSS ou Atom) de cada
um, junta a mesma história publicada por vários jornais e grava tudo em
noticias.json — o arquivo que a aba "Notícias" lê.

Roda de hora em hora no GitHub Actions (.github/workflows/noticias.yml)
e também no PC:  py noticias/coletar.py

Só usa a biblioteca padrão do Python: nada para instalar, nada pago.
"""
import concurrent.futures
import datetime as dt
import email.utils
import hashlib
import html
import json
import os
import re
import ssl
import sys
import urllib.request
import xml.etree.ElementTree as ET

PASTA = os.path.dirname(os.path.abspath(__file__))
ARQ_FONTES = os.path.join(PASTA, "fontes.json")
ARQ_SAIDA = os.path.join(os.path.dirname(PASTA), "noticias.json")

JANELA_HORAS = 36          # só o que saiu nas últimas 36 h
MAX_POR_SECAO = 40
MAX_POR_FONTE = 25         # feeds enormes (Economist manda 300) não dominam a seção
TIMEOUT = 20

SECOES = [
    ("geral", "Geral"),
    ("economia", "Economia"),
    ("negocios", "Negócios"),
    ("tecnologia", "Tecnologia"),
    ("geopolitica", "Geopolítica"),
    ("f1", "Fórmula 1"),
    ("esportes", "Esportes"),
    ("holanda", "Holanda"),
    ("brasil", "Brasil"),
    ("eua", "Estados Unidos"),
    ("politica", "Política"),
]

# Palavras que não dizem nada sobre a história (pt / en / nl)
VAZIAS = set("""
a o os as um uma uns umas de do da dos das em no na nos nas por para com sem sob sobre
e ou mas que se ao aos à às pelo pela pelos pelas seu sua seus suas este esta isto esse
essa isso ele ela eles elas não sim já mais menos muito como quando onde após até entre
diz dizem afirma contra ser ter foi era será tem têm vai vão está estão
the an of in on at to for from by with and or but not is are was were be been being
has have had do does did will would can could may might should this that these those it
its his her their our your as if than then so up out about into over after before
says said say new how why what who which while
de het een en van in op te voor met is zijn was dat die dit niet ook aan bij om naar
uit over als maar nog wordt worden heeft hebben er zich meer dan wat wie hoe
""".split())

TIRAR_ACENTO = str.maketrans("áàâãäéèêëíìîïóòôõöúùûüçñ", "aaaaaeeeeiiiiooooouuuucn")
MRSS = "{http://search.yahoo.com/mrss/}"


# ---------------------------------------------------------------- texto

def sem_html(texto):
    """Tira tags e entidades; devolve texto limpo numa linha."""
    if not texto:
        return ""
    texto = re.sub(r"<script.*?</script>|<style.*?</style>", " ", texto, flags=re.S | re.I)
    texto = re.sub(r"<[^>]+>", " ", texto)
    texto = html.unescape(texto)
    return re.sub(r"\s+", " ", texto).strip()


# Resumos que não dizem nada (aviso de paywall, chamada genérica): melhor sem resumo.
RESUMO_LIXO = re.compile(r"^(matéria exclusiva para assinantes|conteúdo exclusivo|leia mais|read more|continue reading|clique aqui)", re.I)


def resumo_curto(texto, limite=220, titulo=""):
    texto = sem_html(texto)
    if RESUMO_LIXO.match(texto) or (titulo and texto.lower().startswith(titulo.lower()[:40]) and len(texto) <= len(titulo) + 20):
        return ""
    if len(texto) <= limite:
        return texto
    corte = texto[:limite].rsplit(" ", 1)[0]
    return corte.rstrip(" ,;:-") + "…"


def normalizar_titulo(titulo):
    """'Petrobras anuncia novo preço da gasolina' -> {'petrobras','anuncia','novo','preco','gasolina'}"""
    t = sem_html(titulo).lower().translate(TIRAR_ACENTO)
    palavras = re.findall(r"[a-z0-9]+", t)
    return {p for p in palavras if len(p) >= 3 and p not in VAZIAS}


def mesma_historia(a, b):
    """Dois itens falam da mesma coisa? Comparação de palavras do título."""
    if a["lingua"] != b["lingua"]:
        return False
    pa, pb = a["palavras"], b["palavras"]
    if not pa or not pb:
        return False
    comum = len(pa & pb)
    if comum < 3:
        return False
    return comum / min(len(pa), len(pb)) >= 0.6


# ---------------------------------------------------------------- datas

def _fuso_amsterda(d):
    """+2 no horário de verão (último domingo de março até o último domingo de outubro), senão +1."""
    def ultimo_domingo(mes):
        ultimo = dt.datetime(d.year, mes + 1, 1) - dt.timedelta(days=1)
        return ultimo - dt.timedelta(days=(ultimo.weekday() + 1) % 7)
    return 2 if ultimo_domingo(3).replace(hour=1) <= d < ultimo_domingo(10).replace(hour=1) else 1


def interpretar_data(texto):
    """Aceita RFC 822 (RSS) e ISO 8601 (Atom). Devolve datetime em UTC ou None."""
    if not texto:
        return None
    texto = texto.strip()
    try:
        d = email.utils.parsedate_to_datetime(texto)
        if d is not None:
            if d.tzinfo is None:
                d = d.replace(tzinfo=dt.timezone.utc)
            return d.astimezone(dt.timezone.utc).replace(microsecond=0)
    except (TypeError, ValueError, IndexError):
        pass
    # NL Times: "13 September 2026 - 15:35" (hora de Amsterdã)
    m = re.match(r"^(\d{1,2}) (\w+) (\d{4}) - (\d{1,2}):(\d{2})$", texto)
    if m:
        try:
            d = dt.datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)} {m.group(4)}:{m.group(5)}", "%d %B %Y %H:%M")
            return (d - dt.timedelta(hours=_fuso_amsterda(d))).replace(tzinfo=dt.timezone.utc)
        except ValueError:
            return None
    iso = texto.replace("Z", "+00:00")
    iso = re.sub(r"(\.\d{3})\d+", r"\1", iso)  # microssegundos longos demais
    try:
        d = dt.datetime.fromisoformat(iso)
        if d.tzinfo is None:
            d = d.replace(tzinfo=dt.timezone.utc)
        return d.astimezone(dt.timezone.utc).replace(microsecond=0)
    except ValueError:
        return None


# ---------------------------------------------------------------- feeds

def _local(tag):
    """'{http://www.w3.org/2005/Atom}entry' -> 'entry'"""
    return tag.rsplit("}", 1)[-1] if "}" in tag else tag


def _texto(el, *nomes):
    for f in el:
        if _local(f.tag) in nomes and (f.text or "").strip():
            return f.text.strip()
    return ""


def _imagem(el):
    for f in el.iter():
        nome = _local(f.tag)
        url = f.get("url")
        if not url:
            continue
        if f.tag == MRSS + "thumbnail":
            return url
        if f.tag == MRSS + "content" and ("image" in (f.get("type") or "") or f.get("medium") == "image"
                                          or re.search(r"\.(jpe?g|png|webp)", url, re.I)):
            return url
        if nome == "enclosure" and "image" in (f.get("type") or ""):
            return url
    for f in el:
        if _local(f.tag) in ("description", "encoded", "content", "summary"):
            m = re.search(r'<img[^>]+src=["\']([^"\']+)', f.text or "", re.I)
            if m:
                return html.unescape(m.group(1))
    return None


def interpretar_feed(xml_bytes):
    """Devolve uma lista de {titulo, link, quando, resumo, imagem} de um RSS 2.0 ou Atom."""
    raiz = ET.fromstring(xml_bytes)
    itens = []
    for no in [n for n in raiz.iter() if _local(n.tag) in ("item", "entry")]:
        titulo = sem_html(_texto(no, "title"))
        link = _texto(no, "link")
        if not link:  # Atom: <link href="..." rel="alternate"/>
            hrefs = [(l.get("rel"), l.get("href").strip()) for l in no if _local(l.tag) == "link" and l.get("href")]
            alternativos = [h for rel, h in hrefs if rel in (None, "alternate")]
            link = (alternativos or [h for _, h in hrefs] or [""])[0]
        if not titulo or not link:
            continue
        quando = interpretar_data(_texto(no, "pubDate", "published", "updated", "date"))
        resumo = _texto(no, "description", "summary", "content", "encoded")
        itens.append({
            "titulo": titulo,
            "link": link,
            "quando": quando,
            "resumo": resumo_curto(resumo, titulo=titulo),
            "imagem": _imagem(no),
        })
    return itens


def baixar(url):
    ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={
        "User-Agent": "Mozilla/5.0 (compatible; dashboard-noticias/1.0; leitor pessoal de RSS)",
        "Accept": "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
    })
    with urllib.request.urlopen(req, timeout=TIMEOUT, context=ctx) as r:
        return r.read(3_000_000)


def coletar_fonte(fonte):
    """Baixa e interpreta uma fonte. Nunca levanta exceção: devolve (itens, erro)."""
    try:
        return interpretar_feed(baixar(fonte["url"])), None
    except Exception as e:  # um feed quebrado não pode parar os outros
        return [], f"{type(e).__name__}: {str(e)[:120]}"


# ---------------------------------------------------------------- montagem

def _id(fonte_id, link):
    return hashlib.sha1(f"{fonte_id}|{link}".encode("utf-8")).hexdigest()[:12]


def editora(fonte_id):
    """'espn-soccer' e 'espn' são o mesmo jornal; 'bbc-f1' e 'bbc-sport' também."""
    return fonte_id.split("-")[0]


def agrupar(itens):
    """Junta itens da mesma história (dentro da mesma seção). O mais antigo vira o principal.
    Dois feeds do mesmo jornal não contam como dois jornais: a repetição some."""
    itens = sorted(itens, key=lambda i: i["ordem"])
    grupos = []
    for item in itens:
        for g in grupos:
            if g["secao"] == item["secao"] and g["fonte"] != item["fonte"] and mesma_historia(g, item):
                ja_tem = {editora(g["fonte"])} | {editora(o["fonte"]) for o in g["outras"]}
                if editora(item["fonte"]) not in ja_tem:
                    g["outras"].append({"fonte": item["fonte"], "link": item["link"]})
                    if not g["imagem"] and item["imagem"]:
                        g["imagem"] = item["imagem"]
                    if not g["resumo"] and item["resumo"]:
                        g["resumo"] = item["resumo"]
                    g["ordem"] = max(g["ordem"], item["ordem"])  # a história "continua viva"
                    if g["quando"] and item["quando"]:
                        g["quando"] = max(g["quando"], item["quando"])
                break
        else:
            novo = dict(item)
            novo["outras"] = []
            grupos.append(novo)
    return grupos


def montar(fontes, itens_por_fonte, agora):
    """Recebe {fonte_id: [itens]} e devolve o dicionário final de noticias.json."""
    limite = agora - dt.timedelta(hours=JANELA_HORAS)
    por_fonte = {f["id"]: f for f in fontes}
    brutos = []
    for fid, itens in itens_por_fonte.items():
        fonte = por_fonte[fid]
        vistos = set()
        aceitos = []
        for it in itens:
            quando = it["quando"]
            if quando and (quando < limite or quando > agora + dt.timedelta(hours=2)):
                continue
            if it["link"] in vistos:
                continue
            vistos.add(it["link"])
            aceitos.append({
                "id": _id(fid, it["link"]),
                "secao": fonte["secao"],
                "titulo": it["titulo"],
                "link": it["link"],
                "fonte": fid,
                "lingua": fonte.get("lingua", "en"),
                "quando": quando,
                # Sem data (Formula1.com não manda): entra como "de uma hora atrás" só
                # para ordenar, e a página mostra sem hora.
                "ordem": quando or (agora - dt.timedelta(hours=1)),
                "resumo": it["resumo"],
                "imagem": it["imagem"],
                "palavras": normalizar_titulo(it["titulo"]),
            })
        aceitos.sort(key=lambda i: i["ordem"], reverse=True)
        brutos.extend(aceitos[:MAX_POR_FONTE])

    grupos = agrupar(brutos)
    saida = []
    for chave, _nome in SECOES:
        da_secao = [g for g in grupos if g["secao"] == chave]
        da_secao.sort(key=lambda g: g["ordem"], reverse=True)
        saida.extend(da_secao[:MAX_POR_SECAO])

    return {
        "geradoEm": agora.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "secoes": [{"id": k, "nome": n} for k, n in SECOES],
        "fontes": [{"id": f["id"], "nome": f["nome"], "secao": f["secao"]} for f in fontes],
        "itens": [{
            "id": g["id"],
            "secao": g["secao"],
            "titulo": g["titulo"],
            "link": g["link"],
            "fonte": g["fonte"],
            "quando": g["quando"].strftime("%Y-%m-%dT%H:%M:%SZ") if g["quando"] else None,
            "resumo": g["resumo"],
            "imagem": g["imagem"],
            "outras": g["outras"],
        } for g in saida],
    }


# ---------------------------------------------------------------- principal

def main():
    with open(ARQ_FONTES, encoding="utf-8") as f:
        fontes = json.load(f)
    agora = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    itens_por_fonte = {}
    erros = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as ex:
        for fonte, (itens, erro) in zip(fontes, ex.map(coletar_fonte, fontes)):
            itens_por_fonte[fonte["id"]] = itens
            if erro:
                erros.append(f"  {fonte['id']}: {erro}")
            print(f"{fonte['id']:16} {len(itens):4} itens" + (f"  ERRO {erro}" if erro else ""))
    dados = montar(fontes, itens_por_fonte, agora)
    if not any(itens_por_fonte.values()):
        print("Nenhuma fonte respondeu — não vou gravar um arquivo vazio.")
        sys.exit(1)
    with open(ARQ_SAIDA, "w", encoding="utf-8") as f:
        json.dump(dados, f, ensure_ascii=False, separators=(",", ":"))
    print(f"\n{len(dados['itens'])} histórias gravadas em {ARQ_SAIDA}")
    if erros:
        print(f"{len(erros)} fonte(s) com problema:\n" + "\n".join(erros))


if __name__ == "__main__":
    main()
