# -*- coding: utf-8 -*-
"""Testes do coletor, sem internet:  py noticias/testar.py"""
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import coletar as C  # noqa: E402

falhas = 0


def t(nome, ok, extra=None):
    global falhas
    if ok:
        print("ok     " + nome)
    else:
        falhas += 1
        print("FALHA  " + nome + ("  " + repr(extra) if extra is not None else ""))


UTC = dt.timezone.utc
AGORA = dt.datetime(2026, 9, 13, 12, 0, tzinfo=UTC)

RSS = b"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:media="http://search.yahoo.com/mrss/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
<channel><title>Jornal</title>
<item>
  <title><![CDATA[Petrobras anuncia novo pre\xc3\xa7o da gasolina &amp; diesel]]></title>
  <link>https://ex.com/a</link>
  <pubDate>Sun, 13 Sep 2026 08:30:00 -0300</pubDate>
  <description><![CDATA[<p>A estatal <b>reduziu</b> o pre\xc3\xa7o em 5%.</p><img src="https://ex.com/foto.jpg">]]></description>
  <media:content url="https://ex.com/grande.jpg" type="image/jpeg"/>
</item>
<item>
  <title>Sem data</title>
  <link>https://ex.com/b</link>
  <enclosure url="https://ex.com/enc.png" type="image/png" length="1"/>
</item>
<item><title>Sem link</title></item>
</channel></rss>"""

ATOM = b"""<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<title>The Verge</title>
<entry>
  <title>Apple unveils new iPhone with satellite calls</title>
  <link rel="alternate" href="https://verge.com/x"/>
  <link rel="enclosure" href="https://verge.com/x.mp3"/>
  <published>2026-09-13T10:15:00.123456Z</published>
  <updated>2026-09-13T11:00:00+02:00</updated>
  <summary type="html">&lt;p&gt;It is here.&lt;/p&gt;</summary>
</entry>
</feed>"""

# ---- interpretar_feed
rss = C.interpretar_feed(RSS)
t("RSS: 2 itens (o sem link cai)", len(rss) == 2, rss)
t("RSS: título limpo (CDATA, entidades)", rss[0]["titulo"] == "Petrobras anuncia novo preço da gasolina & diesel", rss[0]["titulo"])
t("RSS: data em UTC", rss[0]["quando"] == dt.datetime(2026, 9, 13, 11, 30, tzinfo=UTC), rss[0]["quando"])
t("RSS: resumo sem HTML", rss[0]["resumo"] == "A estatal reduziu o preço em 5%.", rss[0]["resumo"])
t("RSS: imagem prefere media:content", rss[0]["imagem"] == "https://ex.com/grande.jpg", rss[0]["imagem"])
t("RSS: sem data -> None", rss[1]["quando"] is None)
t("RSS: enclosure de imagem", rss[1]["imagem"] == "https://ex.com/enc.png", rss[1]["imagem"])

atom = C.interpretar_feed(ATOM)
t("Atom: 1 item", len(atom) == 1)
t("Atom: link alternate (não o enclosure)", atom[0]["link"] == "https://verge.com/x", atom[0]["link"])
t("Atom: published com microssegundos", atom[0]["quando"] == dt.datetime(2026, 9, 13, 10, 15, tzinfo=UTC), atom[0]["quando"])
t("Atom: summary sem HTML", atom[0]["resumo"] == "It is here.", atom[0]["resumo"])

# ---- datas
t("data RFC 822 GMT", C.interpretar_data("Sat, 12 Sep 2026 23:59:00 GMT") == dt.datetime(2026, 9, 12, 23, 59, tzinfo=UTC))
t("data ISO sem fuso -> UTC", C.interpretar_data("2026-09-13T09:00:00") == dt.datetime(2026, 9, 13, 9, 0, tzinfo=UTC))
t("data lixo -> None", C.interpretar_data("ontem") is None)
t("data NL Times (verão, +2)", C.interpretar_data("13 September 2026 - 15:35") == dt.datetime(2026, 9, 13, 13, 35, tzinfo=UTC), C.interpretar_data("13 September 2026 - 15:35"))
t("data NL Times (inverno, +1)", C.interpretar_data("5 January 2026 - 09:00") == dt.datetime(2026, 1, 5, 8, 0, tzinfo=UTC))

# ---- resumo
t("resumo corta em palavra e põe reticências", C.resumo_curto("palavra " * 60).endswith("…") and len(C.resumo_curto("palavra " * 60)) <= 221)

t("resumo de paywall vira vazio", C.resumo_curto("Matéria exclusiva para assinantes. Para ter acesso...") == "")
t("resumo igual ao título vira vazio", C.resumo_curto("Norris takes pole", titulo="Norris takes pole") == "")
t("resumo normal fica", C.resumo_curto("Texto bom.", titulo="Outro título") == "Texto bom.")

# ---- normalizar / mesma história
p = C.normalizar_titulo("Petrobras anuncia novo preço da gasolina")
t("normalizar tira acento e palavras vazias", p == {"petrobras", "anuncia", "novo", "preco", "gasolina"}, p)


def item(titulo, fonte="a", lingua="pt", secao="brasil", horas=0, link=None):
    return {
        "id": "x", "secao": secao, "titulo": titulo, "link": link or f"https://{fonte}/{abs(hash(titulo))}",
        "fonte": fonte, "lingua": lingua, "quando": AGORA - dt.timedelta(hours=horas),
        "ordem": AGORA - dt.timedelta(hours=horas),
        "resumo": "", "imagem": None, "palavras": C.normalizar_titulo(titulo), "outras": [],
    }


t("mesma história: títulos parecidos", C.mesma_historia(item("Petrobras anuncia novo preço da gasolina"), item("Petrobras anuncia preço novo da gasolina e do diesel", "b")))
t("mesma história: só 2 palavras em comum -> não", not C.mesma_historia(item("Lula viaja para a China na terça"), item("Lula recebe ministro na quarta", "b")))
t("mesma história: línguas diferentes -> não", not C.mesma_historia(item("Apple lança iPhone novo hoje"), item("Apple lança iPhone novo hoje", "b", lingua="en")))

# ---- agrupar
g = C.agrupar([
    item("Petrobras anuncia novo preço da gasolina", "g1", horas=3),
    item("Petrobras anuncia novo preço da gasolina e diesel", "cnn", horas=1),
    item("Petrobras anuncia novo preço da gasolina hoje", "jp", horas=2),
    item("Petrobras anuncia novo preço da gasolina", "g1", horas=0, link="https://g1/outra"),  # mesma fonte não agrupa
    item("Seleção vence a Argentina", "g1", secao="esportes"),
    item("Petrobras anuncia novo preço da gasolina agora", "cnn-dinheiro", horas=0),  # mesmo jornal que "cnn"
])
t("agrupar: 3 grupos", len(g) == 3, [x["titulo"] for x in g])
t("editora: espn-soccer é espn", C.editora("espn-soccer") == "espn" and C.editora("g1") == "g1")
principal = next(x for x in g if x["fonte"] == "g1" and x["outras"])
t("agrupar: o mais antigo é o principal", principal["quando"] == AGORA - dt.timedelta(hours=1) and principal["link"].endswith(str(abs(hash("Petrobras anuncia novo preço da gasolina")))))
t("agrupar: outras = cnn e jp", sorted(o["fonte"] for o in principal["outras"]) == ["cnn", "jp"], principal["outras"])

# ---- montar
fontes = [
    {"id": "g1", "nome": "G1", "secao": "brasil", "lingua": "pt"},
    {"id": "cnn", "nome": "CNN Brasil", "secao": "brasil", "lingua": "pt"},
    {"id": "verge", "nome": "The Verge", "secao": "tecnologia", "lingua": "en"},
]
por_fonte = {
    "g1": [
        {"titulo": "Petrobras anuncia novo preço da gasolina", "link": "https://g1/1", "quando": AGORA - dt.timedelta(hours=2), "resumo": "r", "imagem": None},
        {"titulo": "Velha demais", "link": "https://g1/2", "quando": AGORA - dt.timedelta(hours=40), "resumo": "", "imagem": None},
        {"titulo": "Repetida", "link": "https://g1/3", "quando": AGORA, "resumo": "", "imagem": None},
        {"titulo": "Repetida", "link": "https://g1/3", "quando": AGORA, "resumo": "", "imagem": None},
        {"titulo": "Sem data fica com agora", "link": "https://g1/4", "quando": None, "resumo": "", "imagem": None},
    ],
    "cnn": [{"titulo": "Petrobras anuncia novo preço da gasolina e diesel", "link": "https://cnn/1", "quando": AGORA - dt.timedelta(hours=1), "resumo": "", "imagem": "https://cnn/f.jpg"}],
    "verge": [{"titulo": "Apple unveils new iPhone", "link": "https://v/1", "quando": AGORA - dt.timedelta(minutes=5), "resumo": "", "imagem": None}],
}
d = C.montar(fontes, por_fonte, AGORA)
t("montar: geradoEm", d["geradoEm"] == "2026-09-13T12:00:00Z")
t("montar: 11 seções com nome", len(d["secoes"]) == 11 and d["secoes"][0] == {"id": "geral", "nome": "Geral"})
t("montar: fontes sem url", d["fontes"][0] == {"id": "g1", "nome": "G1", "secao": "brasil"})
titulos = [i["titulo"] for i in d["itens"]]
t("montar: velha e repetida tratadas", titulos.count("Repetida") == 1 and "Velha demais" not in titulos, titulos)
petro = next(i for i in d["itens"] if i["titulo"].startswith("Petrobras"))
t("montar: agrupou G1 + CNN, imagem da CNN", petro["outras"] == [{"fonte": "cnn", "link": "https://cnn/1"}] and petro["imagem"] == "https://cnn/f.jpg", petro)
t("montar: quando em ISO Z", petro["quando"] == "2026-09-13T11:00:00Z", petro["quando"])
t("montar: seções na ordem, tecnologia antes de brasil", d["itens"][0]["secao"] == "tecnologia")
semdata = next(i for i in d["itens"] if i["titulo"].startswith("Sem data"))
brasil = [i["titulo"] for i in d["itens"] if i["secao"] == "brasil"]
t("montar: sem data vira null e entra como 'há 1 h'", semdata["quando"] is None and brasil[0] == "Repetida" and "Sem data fica com agora" in brasil, brasil)
t("montar: item sem campos internos", set(d["itens"][0].keys()) == {"id", "secao", "titulo", "link", "fonte", "quando", "resumo", "imagem", "outras"})

print(f"\n{falhas} FALHA(S)" if falhas else "\nTODOS OS TESTES PASSARAM")
sys.exit(1 if falhas else 0)
