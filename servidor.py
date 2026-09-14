"""
Servidor local do dashboard.

Igual ao `python -m http.server`, com uma diferenca importante:
manda o navegador NUNCA guardar os arquivos em cache.

Sem isso, depois de editar um arquivo o navegador continua usando a
versao antiga e a pessoa fica achando que a mudanca nao funcionou.
"""

import json
import sys
import time
import urllib.parse
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

try:
    import assistente_claude
except ImportError:
    assistente_claude = None

PORTA_PADRAO = 8000
LIMITE_CORPO = 256 * 1024    # a frase mais a "foto" do dashboard (modo Luna)


class SemCache(SimpleHTTPRequestHandler):
    """Serve os arquivos sempre frescos, e atende o assistente."""

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def _responder_json(self, dados, status=200):
        corpo = json.dumps(dados, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(corpo)))
        self.end_headers()
        self.wfile.write(corpo)

    def do_GET(self):
        # Busca por nome no Open Food Facts, feita pelo servidor porque o
        # navegador nao pode chamar esse endereco direto (CORS). So no PC.
        if self.path.startswith("/api/off"):
            self._buscar_off()
            return
        super().do_GET()

    def _buscar_off(self):
        consulta = urllib.parse.urlparse(self.path).query
        termo = urllib.parse.parse_qs(consulta).get("q", [""])[0].strip()
        if not termo or len(termo) > 80:
            self._responder_json({"erro": "Termo invalido."}, 400)
            return
        url = ("https://search.openfoodfacts.org/search?q=" + urllib.parse.quote(termo)
               + "&page_size=8&fields=code,product_name,product_name_pt,product_name_en,brands,nutriments")
        pedido = urllib.request.Request(url, headers={"User-Agent": "DashboardESE/1.0 (uso pessoal)"})
        try:
            with urllib.request.urlopen(pedido, timeout=12) as resp:
                dados = json.loads(resp.read().decode("utf-8"))
        except Exception as erro:  # rede fora, 503, JSON quebrado
            self._responder_json({"erro": f"Open Food Facts nao respondeu ({erro.__class__.__name__})."}, 200)
            return
        self._responder_json({"hits": dados.get("hits") or dados.get("products") or []}, 200)

    def do_POST(self):
        rota = self.path.rstrip("/")
        if rota not in ("/api/assistente", "/api/luna"):
            self.send_error(404, "Endereco nao encontrado")
            return

        try:
            tamanho = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            tamanho = 0

        if tamanho <= 0 or tamanho > LIMITE_CORPO:
            self._responder_json({"erro": "Pedido invalido."}, 400)
            return

        try:
            pedido = json.loads(self.rfile.read(tamanho).decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            self._responder_json({"erro": "Pedido invalido."}, 400)
            return

        frase = str(pedido.get("frase") or "").strip()
        if not frase:
            self._responder_json({"erro": "Frase vazia."}, 400)
            return

        if assistente_claude is None:
            self._responder_json({"erro": "A ponte para o Claude nao carregou."}, 500)
            return

        inicio = time.monotonic()

        if rota == "/api/luna":
            # Modo Luna: frase + foto do dashboard -> resposta + acoes
            modelo = str(pedido.get("modelo") or "sonnet")
            if modelo not in ("haiku", "sonnet", "opus"):
                modelo = "sonnet"
            resposta, erro = assistente_claude.conversar(
                frase, pedido.get("estado") or {}, pedido.get("historico") or [], modelo)
            print(f"  luna ({modelo}): {time.monotonic() - inicio:.1f}s "
                  f"{'erro: ' + erro if erro else 'ok'}", flush=True)
            self._responder_json({"erro": erro} if erro else resposta, 200)
            return

        comando, erro = assistente_claude.interpretar(
            frase,
            str(pedido.get("hoje") or ""),
            [str(m) for m in (pedido.get("materias") or [])][:40],
            [str(t) for t in (pedido.get("treinos") or [])][:20],
        )
        print(f"  assistente: {time.monotonic() - inicio:.1f}s "
              f"{'erro: ' + erro if erro else 'ok'}", flush=True)

        if erro:
            self._responder_json({"erro": erro}, 200)
        else:
            self._responder_json({"comando": comando}, 200)

    def log_message(self, formato, *args):
        # Silencia o log de cada arquivo servido; so erros aparecem.
        if not str(args[1] if len(args) > 1 else "").startswith("2"):
            super().log_message(formato, *args)


def main():
    porta = PORTA_PADRAO
    if len(sys.argv) > 1:
        try:
            porta = int(sys.argv[1])
        except ValueError:
            print(f"Porta invalida: {sys.argv[1]}. Usando {PORTA_PADRAO}.")

    handler = partial(SemCache, directory=".")

    try:
        servidor = ThreadingHTTPServer(("127.0.0.1", porta), handler)
    except OSError as erro:
        print()
        print(f"  Nao consegui usar a porta {porta}.")
        print(f"  Detalhe: {erro}")
        print()
        print("  Provavelmente ja existe outro dashboard aberto.")
        print("  Feche a outra janela preta e tente de novo.")
        print()
        input("  Pressione Enter para fechar...")
        return 1

    print(f"  Dashboard no ar em http://localhost:{porta}")
    print("  Feche esta janela para desligar.")
    print()

    try:
        servidor.serve_forever()
    except KeyboardInterrupt:
        print("\n  Desligando...")
    finally:
        servidor.server_close()

    return 0


if __name__ == "__main__":
    sys.exit(main())
