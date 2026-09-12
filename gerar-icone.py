"""
Gera o icone do dashboard (dashboard.ico) sem nenhuma biblioteca extra.

Desenho: quadrado amarelo de cantos arredondados, com o simbolo de menu
(tres barras pretas) que aparece no canto do dashboard.

O formato ICO aceita um PNG dentro; o PNG e escrito na mao usando so
zlib e struct, que ja vem com o Python.
"""

import struct
import zlib

AMARELO = (250, 204, 21)
PRETO = (17, 17, 17)
TRANSPARENTE = (0, 0, 0, 0)


def dentro_do_quadrado_arredondado(x, y, tamanho, raio):
    """True se o pixel (x, y) esta dentro do quadrado de cantos redondos."""
    borda = tamanho - 1
    cx = min(max(x, raio), borda - raio)
    cy = min(max(y, raio), borda - raio)
    return (x - cx) ** 2 + (y - cy) ** 2 <= raio ** 2


def desenhar(tamanho):
    """Devolve as linhas de pixels RGBA da imagem."""
    raio = tamanho // 5

    # Tres barras horizontais, centralizadas
    espessura = max(2, tamanho // 11)
    largura_barra = int(tamanho * 0.52)
    x0 = (tamanho - largura_barra) // 2
    x1 = x0 + largura_barra
    espaco = int(tamanho * 0.18)
    y_meio = tamanho // 2
    barras = [
        (y_meio - espaco - espessura // 2, y_meio - espaco + espessura // 2),
        (y_meio - espessura // 2, y_meio + espessura // 2),
        (y_meio + espaco - espessura // 2, y_meio + espaco + espessura // 2),
    ]

    # Os cantos das barras tambem sao arredondados
    r_barra = espessura // 2

    linhas = []
    for y in range(tamanho):
        linha = bytearray()
        for x in range(tamanho):
            if not dentro_do_quadrado_arredondado(x, y, tamanho, raio):
                linha += bytes(TRANSPARENTE)
                continue

            cor = AMARELO
            for (ya, yb) in barras:
                if ya <= y < yb and x0 <= x < x1:
                    # Arredonda as pontas das barras
                    cy = (ya + yb) / 2
                    if x < x0 + r_barra:
                        if (x - (x0 + r_barra)) ** 2 + (y - cy) ** 2 > r_barra ** 2:
                            continue
                    if x >= x1 - r_barra:
                        if (x - (x1 - r_barra - 1)) ** 2 + (y - cy) ** 2 > r_barra ** 2:
                            continue
                    cor = PRETO
                    break

            linha += bytes(cor) + b"\xff"
        linhas.append(bytes(linha))
    return linhas


def png(tamanho, linhas):
    """Monta um PNG RGBA a partir das linhas de pixels."""
    def bloco(tipo, dados):
        corpo = tipo + dados
        return struct.pack(">I", len(dados)) + corpo + struct.pack(">I", zlib.crc32(corpo) & 0xFFFFFFFF)

    cabecalho = struct.pack(">IIBBBBB", tamanho, tamanho, 8, 6, 0, 0, 0)
    bruto = b"".join(b"\x00" + linha for linha in linhas)   # filtro 0 em cada linha
    return (
        b"\x89PNG\r\n\x1a\n"
        + bloco(b"IHDR", cabecalho)
        + bloco(b"IDAT", zlib.compress(bruto, 9))
        + bloco(b"IEND", b"")
    )


def ico(imagens):
    """Empacota varios PNGs num unico ICO (um por tamanho)."""
    cabecalho = struct.pack("<HHH", 0, 1, len(imagens))
    entradas = b""
    dados = b""
    deslocamento = 6 + 16 * len(imagens)
    for tamanho, png_bytes in imagens:
        # 256 e representado como 0 no cabecalho do ICO
        t = 0 if tamanho >= 256 else tamanho
        entradas += struct.pack("<BBBBHHII", t, t, 0, 0, 1, 32, len(png_bytes), deslocamento)
        dados += png_bytes
        deslocamento += len(png_bytes)
    return cabecalho + entradas + dados


if __name__ == "__main__":
    tamanhos = [16, 32, 48, 64, 128, 256]
    imagens = [(t, png(t, desenhar(t))) for t in tamanhos]
    with open("dashboard.ico", "wb") as f:
        f.write(ico(imagens))
    print(f"dashboard.ico gerado com {len(tamanhos)} tamanhos")

    # Icone da tela de inicio do iPhone ("Adicionar a Tela de Inicio").
    with open("icone-180.png", "wb") as f:
        f.write(png(180, desenhar(180)))
    print("icone-180.png gerado")
