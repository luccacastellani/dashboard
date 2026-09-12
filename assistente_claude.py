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


def interpretar(frase, hoje, materias, treinos):
    """Devolve (comando, erro). Um dos dois e sempre None."""
    exe = _achar_claude()
    if not exe:
        return None, "O Claude Code nao esta instalado nesta maquina."

    prompt = (
        f"{INSTRUCAO}\n\n"
        f"Hoje e {hoje}.\n"
        f"Materias existentes: {', '.join(materias) if materias else '(nenhuma)'}\n"
        f"Treinos existentes: {', '.join(treinos) if treinos else '(nenhum)'}\n\n"
        f"Frase: \"{frase}\""
    )

    argumentos = [
        exe, "-p", prompt,
        "--model", MODELO,
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
        saida, _ = proc.communicate(timeout=TIMEOUT)
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

    comando = _extrair_json(texto)
    if not comando or "tipo" not in comando:
        return None, "O Claude respondeu num formato que eu nao entendi."

    # Media sem acento vinda do modelo
    if comando.get("dificuldade") == "Media":
        comando["dificuldade"] = "Média"

    return comando, None
