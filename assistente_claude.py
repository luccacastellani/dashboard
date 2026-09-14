"""
Ponte para o Claude Code.

Recebe uma frase e devolve um comando estruturado. So e chamado
quando as regras locais do navegador NAO entenderam a frase, entao
o consumo fica no minimo.

Usa o `claude` instalado na maquina, com a assinatura da usuaria.
Nao existe chave de API aqui e nada e cobrado por uso.

Escolhas para gastar pouco:
  - modelo Haiku (o mais barato)
  - prompt curto e fechado, pedindo so JSON
  - --max-turns 1: uma ida e volta, sem o modelo ficar "pensando"
  - sem ferramentas: ele nao le nem escreve arquivos
"""

import json
import os
import shutil
import subprocess

MODELO = "haiku"
TIMEOUT = 45

INSTRUCAO = """Converta a frase em UM comando JSON para um dashboard de estudos.
Responda APENAS com o JSON, sem explicacao e sem cercas de codigo.

Formatos possiveis:
{"tipo":"pendencia","nome":"...","materia":"...","prazo":"AAAA-MM-DD","dificuldade":"Baixa|Media|Alta","estimativa":0}
{"tipo":"avaliacao","nome":"...","materia":"...","data":"AAAA-MM-DD"}
{"tipo":"treino_plano","dia":0,"treino":"..."}
{"tipo":"treino_serie","exercicio":"...","series":3,"reps":10,"kg":0}
{"tipo":"tarefa","titulo":"...","prazo":"AAAA-MM-DD"}
{"tipo":"desconhecido"}

Regras:
- "dia" e 0=domingo ... 6=sabado.
- Datas sempre AAAA-MM-DD. Se nao houver data, use "".
- "materia" deve ser EXATAMENTE um dos nomes da lista de materias, ou "".
- Se a frase nao for nenhuma dessas coisas, responda {"tipo":"desconhecido"}."""


LUNA = """Voce e a Luna, secretaria e estrategista pessoal do Lucca (estudante de Economia na Erasmus, em Roterda).
Voce vive dentro do dashboard dele e recebe uma FOTO do estado atual em JSON (agenda, pendencias, avaliacoes, macros do dia e metas, Dieta, treino, lista de compras, manchetes).

Personalidade: portugues do Brasil, informal e simpatica; extremamente direta e concisa; bullet points e negrito; nada de enrolacao.
Quando ele pede conselho ou ha uma decisao, NAO pergunte "o que voce quer fazer": apresente 3 opcoes (A: rapida e imediata; B e C: estrategicas).
Fatos fixos: 40 min de deslocamento entre Coolhaven e o campus Woudestein (EUR); nada de deep work antes das 10h; deep work noturno 20:00-22:30; treinos de 1h30 no IMBER de preferencia as 16:00; meal prep quarta e domingo.
Use os numeros da foto (ex.: quanto falta de proteina) e sugira comidas da Dieta dele quando falar de alimentacao.

Voce pode AGIR no dashboard devolvendo acoes. Cada acao e um objeto com "tipo" e os campos abaixo (use so os tipos listados):
{"tipo":"comida","refeicao":"cafe|almoco|jantar|lanche","itens":[{"nome":"...","kcal":0,"p":0,"c":0,"g":0,"descricao":"ex.: 100 g"}]}
{"tipo":"pendencia","nome":"...","materia":"...","prazo":"AAAA-MM-DD","dificuldade":"Baixa|Media|Alta","estimativa":0}
{"tipo":"avaliacao","nome":"...","materia":"...","data":"AAAA-MM-DD"}
{"tipo":"tarefa","titulo":"...","prazo":"AAAA-MM-DD"}
{"tipo":"evento","titulo":"...","data":"AAAA-MM-DD","inicio":"HH:MM","fim":"HH:MM","lugar":"..."}
{"tipo":"treino_plano","dia":0,"treino":"..."}   (0=domingo ... 6=sabado)
{"tipo":"treino_serie","exercicio":"...","series":3,"reps":10,"kg":0}
{"tipo":"treino_feito"}
{"tipo":"compras_avulso","nome":"..."}  {"tipo":"compras_acabou","nome":"..."}  {"tipo":"compras_comprei","nome":"...","pacotes":1}
"materia" deve ser EXATAMENTE um nome da lista de materias da foto, ou "".
So devolva acoes que o Lucca claramente pediu; o dashboard mostra cada uma para ele confirmar. Para perguntas e conselhos, acoes = [].

RESPONDA APENAS com um JSON, sem cercas de codigo:
{"resposta":"texto curto em markdown simples (negrito com **, listas com -)","acoes":[...]}"""


def _achar_claude():
    return shutil.which("claude")


def disponivel():
    return _achar_claude() is not None


def _extrair_json(texto):
    """Pega o primeiro objeto JSON do texto, mesmo com sujeira em volta."""
    if not texto:
        return None
    inicio = texto.find("{")
    while inicio != -1:
        profundidade = 0
        for i in range(inicio, len(texto)):
            if texto[i] == "{":
                profundidade += 1
            elif texto[i] == "}":
                profundidade -= 1
                if profundidade == 0:
                    try:
                        return json.loads(texto[inicio:i + 1])
                    except json.JSONDecodeError:
                        break
        inicio = texto.find("{", inicio + 1)
    return None


def _matar_arvore(proc):
    """
    Mata o `claude` E os processos que ele abriu.

    So matar o `claude` nao basta: os filhos dele herdam a saida e,
    enquanto um deles viver, a leitura da saida nunca termina. Foi
    exatamente isso que deixava o dashboard travado depois de um
    pedido lento.
    """
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/F", "/T", "/PID", str(proc.pid)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, timeout=10,
        )
    else:
        proc.kill()
    for canal in (proc.stdout, proc.stderr):
        try:
            canal.close()
        except OSError:
            pass


def _rodar(prompt, modelo, timeout):
    """Roda o claude com o prompt e devolve (texto_da_resposta, erro)."""
    exe = _achar_claude()
    if not exe:
        return None, "O Claude Code nao esta instalado nesta maquina."

    argumentos = [
        exe, "-p", prompt,
        "--model", modelo or MODELO,
        "--max-turns", "1",
        "--output-format", "json",
        "--allowed-tools", "",
    ]

    try:
        proc = subprocess.Popen(
            argumentos,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except OSError as erro:
        return None, f"Nao consegui executar o Claude: {erro}"

    try:
        saida, _ = proc.communicate(timeout=timeout or TIMEOUT)
    except subprocess.TimeoutExpired:
        _matar_arvore(proc)
        return None, "O Claude demorou demais para responder."

    envelope = _extrair_json(saida) or {}

    if envelope.get("is_error"):
        detalhe = envelope.get("result") or "erro desconhecido"
        if "authenticate" in detalhe.lower() or "oauth" in detalhe.lower():
            return None, ("O Claude do terminal nao esta logado. "
                          "Abra o Prompt de Comando e rode: claude auth login")
        return None, detalhe

    texto = envelope.get("result")
    if texto is None:
        texto = saida
    return texto, None


def interpretar(frase, hoje, materias, treinos):
    """Modo antigo: devolve (comando, erro). Um dos dois e sempre None."""
    prompt = (
        f"{INSTRUCAO}\n\n"
        f"Hoje e {hoje}.\n"
        f"Materias existentes: {', '.join(materias) if materias else '(nenhuma)'}\n"
        f"Treinos existentes: {', '.join(treinos) if treinos else '(nenhum)'}\n\n"
        f"Frase: \"{frase}\""
    )
    texto, erro = _rodar(prompt, MODELO, TIMEOUT)
    if erro:
        return None, erro

    comando = _extrair_json(texto)
    if not comando or "tipo" not in comando:
        return None, "O Claude respondeu num formato que eu nao entendi."

    # Media sem acento vinda do modelo
    if comando.get("dificuldade") == "Media":
        comando["dificuldade"] = "Média"

    return comando, None


def conversar(frase, estado, historico=None, modelo="sonnet"):
    """
    Modo Luna: a frase + a foto do dashboard. Devolve (resposta, erro),
    onde resposta = {"resposta": "...", "acoes": [...]}.
    """
    linhas = [LUNA, "", "FOTO DO DASHBOARD (JSON):", json.dumps(estado, ensure_ascii=False)]
    if historico:
        linhas += ["", "CONVERSA RECENTE:"] + [f"{h.get('quem')}: {h.get('texto')}" for h in historico[-6:]]
    linhas += ["", f"Lucca: {frase}"]
    texto, erro = _rodar("\n".join(linhas), modelo, 90)
    if erro:
        return None, erro
    dados = _extrair_json(texto)
    if not dados or "resposta" not in dados:
        # Veio texto solto: ainda assim e uma resposta valida.
        return {"resposta": (texto or "").strip(), "acoes": []}, None
    acoes = dados.get("acoes") or []
    if not isinstance(acoes, list):
        acoes = []
    for a in acoes:
        if isinstance(a, dict) and a.get("dificuldade") == "Media":
            a["dificuldade"] = "Média"
    return {"resposta": str(dados.get("resposta") or ""), "acoes": [a for a in acoes if isinstance(a, dict) and a.get("tipo")]}, None
