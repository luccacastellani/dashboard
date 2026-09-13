/* ==========================================================
   COMPRAS — a lista de compras que nasce da Dieta
   ----------------------------------------------------------
   Terceira aba da Academia (Treinos · Macros · Compras).

   - Produtos: cadastrados UMA vez (código de barras ou na mão),
     ligados a um item da Dieta, com embalagem ("500 g", "12 un")
     e loja (Albert Heijn / Lidl / outra).
   - Lista: sempre viva, por loja. "Comprei" registra a compra.
   - Em casa = compras − consumo registrado no Macros, corrigido
     pelas perguntas "tem / pouco / acabou" do botão Vou ao mercado.
   - Quanto por semana: média do que foi registrado nas últimas
     3 semanas (por dia registrado × 7); sem histórico, o padrão
     do produto.
   - Avulsos: coisas que não são comida ("papel higiênico").

   Sem IA, sem servidor. Dados em eseCompras (Drive).
   Lógica pura no topo (testada em Node), desenho embaixo.
   ========================================================== */

window.Compras = (() => {

    const KEY = 'eseCompras';
    const KEY_TELA = 'eseComprasTela';
    const LOJAS = [['ah', 'Albert Heijn'], ['lidl', 'Lidl'], ['outra', 'Outra loja']];
    const NOME_LOJA = Object.fromEntries(LOJAS);
    const UNIDADES = ['g', 'ml', 'unidade'];
    const DIAS_HISTORICO = 21;
    const DIAS_DUVIDA = 7;

    const temNavegador = typeof document !== 'undefined';
    const temStorage = typeof localStorage !== 'undefined';
    const esc = (v) => window.escapeHtml ? window.escapeHtml(v) : String(v);
    const $ = (id) => document.getElementById(id);
    const num = (v, padrao = 0) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) && n >= 0 ? n : padrao; };
    const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const hojeIso = () => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    /* Datas sempre no horário local (à meia-noite aqui já é "amanhã" em UTC). */
    const agoraLocal = () => { const d = new Date(); return `${hojeIso()}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:00`; };
    const isoDeDiasAtras = (n, hoje) => {
        const [a, m, d] = (hoje || hojeIso()).split('-').map(Number);
        const dt = new Date(a, m - 1, d - n);
        return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    };
    const diasEntre = (isoA, isoB) => Math.round((new Date(isoB.slice(0, 10)) - new Date(isoA.slice(0, 10))) / 86400000);

    /* ==================== DADOS ==================== */

    const unidadeLimpa = (u) => {
        const s = String(u || '').toLowerCase().trim();
        if (/^(g|gr|grama|gramas|kg)$/.test(s)) return 'g';
        if (/^(ml|l|litro|litros)$/.test(s)) return 'ml';
        return 'unidade';
    };

    const produtoLimpo = (p) => {
        const emb = p && p.embalagem || {};
        const unidade = UNIDADES.includes(emb.unidade) ? emb.unidade : unidadeLimpa(emb.unidade);
        const qtd = num(emb.qtd, 1) || 1;
        return {
            id: String(p && p.id || novoId()),
            nome: String(p && p.nome || '').trim(),
            dietaId: p && p.dietaId ? String(p.dietaId) : null,
            loja: NOME_LOJA[p && p.loja] ? p.loja : 'outra',
            codigo: String(p && p.codigo || '').trim(),
            embalagem: { qtd, unidade },
            fator: num(p && p.fator, 1) || 1,
            porSemana: num(p && p.porSemana, qtd) || qtd,
            /* Sem base, o produto "nasce" hoje: o que foi comido antes do cadastro não desconta. */
            base: { qtd: num(p && p.base && p.base.qtd), em: String(p && p.base && p.base.em || (hojeIso() + 'T00:00:00')) }
        };
    };

    const migrar = (bruto) => {
        const d = bruto && typeof bruto === 'object' ? bruto : {};
        return {
            versao: 1,
            produtos: (Array.isArray(d.produtos) ? d.produtos : []).map(produtoLimpo).filter((p) => p.nome),
            compras: (Array.isArray(d.compras) ? d.compras : []).map((c) => ({
                id: String(c.id || novoId()), produtoId: String(c.produtoId || ''), quando: String(c.quando || ''), pacotes: num(c.pacotes, 1) || 1
            })).filter((c) => c.produtoId && c.quando),
            avulsos: (Array.isArray(d.avulsos) ? d.avulsos : []).map((a) => ({ id: String(a.id || novoId()), nome: String(a.nome || '').trim() })).filter((a) => a.nome)
        };
    };

    let dados = migrar(null);
    const carregar = () => {
        if (!temStorage) return;
        try { dados = migrar(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { dados = migrar(null); }
    };
    const salvar = () => {
        if (!temStorage) return;
        try { localStorage.setItem(KEY, JSON.stringify(dados)); } catch { /* ignora */ }
    };

    /* O Macros é a fonte do consumo e da Dieta. */
    const macros = () => (window.Macros && window.Macros._dados ? window.Macros._dados() : { dieta: [], dias: {} });

    /* ==================== LÓGICA PURA ==================== */

    /* "500 g", "1 kg", "12 x 50 g", "1,5 L", "6 stuks" -> { qtd, unidade } (em g / ml / unidade) */
    const interpretarEmbalagem = (texto) => {
        const t = String(texto || '').toLowerCase().replace(',', '.').trim();
        if (!t) return null;
        const multi = /^(\d+)\s*[x×]\s*(\d+(?:\.\d+)?)\s*([a-z]+)?/.exec(t);
        if (multi) {
            const base = interpretarEmbalagem(`${multi[2]} ${multi[3] || 'unidade'}`);
            return base ? { qtd: Math.round(base.qtd * Number(multi[1]) * 100) / 100, unidade: base.unidade } : null;
        }
        const m = /(\d+(?:\.\d+)?)\s*([a-z]+)?/.exec(t);
        if (!m) return null;
        let qtd = Number(m[1]);
        const u = m[2] || '';
        if (/^kg$/.test(u)) return { qtd: qtd * 1000, unidade: 'g' };
        if (/^(l|lt|litro|litros)$/.test(u)) return { qtd: qtd * 1000, unidade: 'ml' };
        if (/^(g|gr|gram|grams|grama|gramas)$/.test(u)) return { qtd, unidade: 'g' };
        if (/^(ml|cl)$/.test(u)) return { qtd: u === 'cl' ? qtd * 10 : qtd, unidade: 'ml' };
        return { qtd, unidade: 'unidade' };
    };

    /* Consumo do produto registrado no Macros a partir de um dia (inclusive), na unidade da embalagem. */
    const consumoDesde = (produto, isoDesde, m) => {
        if (!produto.dietaId) return 0;
        const item = (m.dieta || []).find((i) => i.id === produto.dietaId);
        if (!item) return 0;
        const porPorcao = (item.porcao && item.porcao.qtd || 1) * produto.fator;
        let total = 0;
        for (const dia of Object.keys(m.dias || {})) {
            if (dia < isoDesde.slice(0, 10)) continue;
            for (const r of m.dias[dia]) if (r.dietaId === produto.dietaId) total += (r.qtd || 0) * porPorcao;
        }
        return total;
    };

    const comprasDesde = (produto, isoDesde, compras) => (compras || [])
        .filter((c) => c.produtoId === produto.id && c.quando.slice(0, 10) >= isoDesde.slice(0, 10))
        .reduce((s, c) => s + c.pacotes * produto.embalagem.qtd, 0);

    const emCasa = (produto, d, m) => Math.max(0, produto.base.qtd + comprasDesde(produto, produto.base.em, d.compras) - consumoDesde(produto, produto.base.em, m));

    /* Quanto costuma consumir em 7 dias. Com registros nas últimas 3 semanas,
       usa a média por dia registrado (ela não registra todo dia). */
    const porSemana = (produto, m, hoje) => {
        const desde = isoDeDiasAtras(DIAS_HISTORICO - 1, hoje);
        const diasRegistrados = Object.keys(m.dias || {}).filter((dia) => dia >= desde && dia <= (hoje || hojeIso()) && (m.dias[dia] || []).length).length;
        const consumo = consumoDesde(produto, desde, m);
        if (!produto.dietaId || !diasRegistrados || consumo <= 0) return { qtd: produto.porSemana, estimado: false };
        return { qtd: Math.round(consumo / diasRegistrados * 7), estimado: true };
    };

    const ultimaCompraOuAjuste = (produto, d) => {
        const compras = d.compras.filter((c) => c.produtoId === produto.id).map((c) => c.quando.slice(0, 10));
        return [produto.base.em.slice(0, 10), ...compras].sort().pop();
    };

    /* Vale a pena perguntar "ainda tem?" — a estimativa está velha. */
    const naDuvida = (produto, d, m, hoje) => {
        const casa = emCasa(produto, d, m);
        if (casa <= 0) return false;
        const ultimo = ultimaCompraOuAjuste(produto, d);
        return diasEntre(ultimo, hoje || hojeIso()) >= DIAS_DUVIDA;
    };

    const linhaDaLista = (produto, d, m, hoje) => {
        const casa = emCasa(produto, d, m);
        const semana = porSemana(produto, m, hoje);
        const precisa = Math.max(0, semana.qtd - casa);
        const pacotes = precisa > 0 ? Math.max(1, Math.ceil(precisa / produto.embalagem.qtd)) : 0;
        return { produto, emCasa: casa, porSemana: semana.qtd, estimado: semana.estimado, precisa, pacotes };
    };

    /* A lista: só quem precisa, agrupado por loja na ordem AH / Lidl / outra. */
    const montarLista = (d, m, hoje) => {
        const linhas = d.produtos.map((p) => linhaDaLista(p, d, m, hoje)).filter((l) => l.pacotes > 0);
        return LOJAS.map(([id, nome]) => ({ loja: id, nome, linhas: linhas.filter((l) => l.produto.loja === id) })).filter((g) => g.linhas.length);
    };

    const chave = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const palavras = (t) => chave(t).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

    /* Qual item da Dieta combina com "AH Havermout 500 g"? O que tiver mais palavras em comum. */
    const sugerirDieta = (nomeProduto, dieta) => {
        const ps = new Set(palavras(nomeProduto));
        let melhor = null, pontos = 0;
        for (const item of dieta || []) {
            const n = palavras(item.nome).filter((w) => ps.has(w) || [...ps].some((q) => q.startsWith(w) || w.startsWith(q))).length;
            if (n > pontos) { pontos = n; melhor = item; }
        }
        return melhor;
    };

    /* "Nutella" + marca "Nutella" -> "Nutella"; "Havermout" + "AH" -> "Havermout AH" */
    const nomeComMarca = (r) => (r.marca && !chave(r.nome).includes(chave(r.marca)) ? `${r.nome} ${r.marca}` : r.nome);

    const produtoPorCodigo = (codigo, produtos) => (produtos || []).find((p) => p.codigo && p.codigo === String(codigo || '').trim()) || null;

    const fmtQtd = (qtd, unidade) => {
        if (unidade === 'g' && qtd >= 1000) return `${Math.round(qtd / 100) / 10} kg`;
        if (unidade === 'ml' && qtd >= 1000) return `${Math.round(qtd / 100) / 10} L`;
        if (unidade === 'unidade') return `${Math.round(qtd)} un`;
        return `${Math.round(qtd)} ${unidade}`;
    };

    /* ==================== ALTERAÇÕES ==================== */

    const guardarProduto = (p) => {
        const limpo = produtoLimpo(p);
        if (!limpo.nome) return '';
        const i = dados.produtos.findIndex((x) => x.id === limpo.id);
        if (i >= 0) limpo.base = p.base ? limpo.base : dados.produtos[i].base;
        if (i >= 0) dados.produtos[i] = limpo; else dados.produtos.push(limpo);
        salvar();
        return limpo.id;
    };

    const apagarProduto = (id) => {
        dados.produtos = dados.produtos.filter((p) => p.id !== id);
        dados.compras = dados.compras.filter((c) => c.produtoId !== id);
        salvar();
    };

    const comprei = (produtoId, pacotes, quando) => {
        const p = dados.produtos.find((x) => x.id === produtoId);
        if (!p) return;
        dados.compras.push({ id: novoId(), produtoId, quando: quando || agoraLocal(), pacotes: Math.max(1, Math.round(num(pacotes, 1) || 1)) });
        if (dados.compras.length > 400) dados.compras = dados.compras.slice(-400);
        salvar();
    };

    const desfazerCompra = (compraId) => {
        dados.compras = dados.compras.filter((c) => c.id !== compraId);
        salvar();
    };

    /* "tem" / "pouco" / "acabou" — vira a nova base do "em casa". */
    const responder = (produtoId, resposta, m, hoje) => {
        const p = dados.produtos.find((x) => x.id === produtoId);
        if (!p) return;
        const semana = porSemana(p, m || macros(), hoje).qtd;
        const casa = emCasa(p, dados, m || macros());
        const qtd = resposta === 'acabou' ? 0 : resposta === 'pouco' ? Math.round(semana * 0.3) : Math.max(casa, semana);
        p.base = { qtd, em: (hoje || hojeIso()) + 'T00:00:00' };
        salvar();
    };

    const adicionarAvulso = (nome) => {
        const n = String(nome || '').trim();
        if (!n) return;
        dados.avulsos.push({ id: novoId(), nome: n });
        salvar();
    };
    const tirarAvulso = (id) => { dados.avulsos = dados.avulsos.filter((a) => a.id !== id); salvar(); };

    /* ==================== DESENHO ==================== */

    const estado = { tela: 'lista', perguntando: false, editando: null, pacotes: {}, mensagem: '', rotulo: null, bipe: null };
    /* bipe: null | { fase: 'lendo' | 'buscando' | 'novo' | 'feito', codigo, nome, embalagem, loja, dietaId, produto, compraId, msg } */

    const telaLista = () => {
        const m = macros();
        const grupos = montarLista(dados, m, hojeIso());
        const duvidas = dados.produtos.filter((p) => naDuvida(p, dados, m, hojeIso()));
        const totalItens = grupos.reduce((s, g) => s + g.linhas.length, 0) + dados.avulsos.length;

        const perguntas = estado.perguntando ? `
            <div class="com-perguntas">
                <div class="com-perguntas-topo">
                    <strong>Antes de ir: ainda tem em casa?</strong>
                    <button type="button" class="not-fechar" data-acao="fechar-perguntas" aria-label="Fechar">×</button>
                </div>
                ${duvidas.length ? duvidas.map((p) => `
                <div class="com-pergunta">
                    <span class="com-pergunta-nome">${esc(p.nome)} <em>acho que ~${fmtQtd(emCasa(p, dados, m), p.embalagem.unidade)}</em></span>
                    <div class="com-pergunta-btns">
                        <button type="button" class="com-resp" data-acao="responder" data-id="${p.id}" data-r="tem">Tem</button>
                        <button type="button" class="com-resp" data-acao="responder" data-id="${p.id}" data-r="pouco">Pouco</button>
                        <button type="button" class="com-resp com-resp-acabou" data-acao="responder" data-id="${p.id}" data-r="acabou">Acabou</button>
                    </div>
                </div>`).join('') : '<div class="com-vazio">Nada em dúvida — a lista já está certa. Boa compra!</div>'}
            </div>` : '';

        const linha = (l) => {
            const p = l.produto;
            const n = estado.pacotes[p.id] || l.pacotes;
            return `
            <div class="com-linha">
                <div class="com-linha-info">
                    <span class="com-linha-nome">${esc(p.nome)}</span>
                    <span class="com-linha-det">${n} × ${fmtQtd(p.embalagem.qtd, p.embalagem.unidade)} · em casa ~${fmtQtd(l.emCasa, p.embalagem.unidade)} · semana ${fmtQtd(l.porSemana, p.embalagem.unidade)}${l.estimado ? '' : ' (padrão)'}</span>
                </div>
                <div class="com-linha-acoes">
                    <button type="button" class="mac-qtd-btn" data-acao="menos" data-id="${p.id}" aria-label="Menos um pacote">−</button>
                    <span class="com-n">${n}</span>
                    <button type="button" class="mac-qtd-btn" data-acao="mais" data-id="${p.id}" aria-label="Mais um pacote">+</button>
                    <button type="button" class="com-comprei" data-acao="comprei" data-id="${p.id}">Comprei</button>
                </div>
            </div>`;
        };

        const lista = grupos.length ? grupos.map((g) => `
            <div class="com-loja">
                <h4 class="com-loja-nome ${g.loja}">${esc(g.nome)} <span>${g.linhas.length}</span></h4>
                ${g.linhas.map(linha).join('')}
            </div>`).join('') : (dados.produtos.length
            ? '<div class="com-vazio">Tudo em casa por enquanto. A lista enche sozinha conforme você registra as refeições no Macros.</div>'
            : '');

        const b = estado.bipe;
        const cameraBox = `
            <div id="com-camera" class="mac-camera" style="display:none">
                <video id="com-camera-video" playsinline muted></video>
                <div class="mac-camera-mira" aria-hidden="true"></div>
                <div class="mac-camera-rodape">
                    <span id="com-camera-msg">Aponte para o código de barras</span>
                    <button type="button" class="btn btn-secondary btn-sm" data-acao="camera-fechar">Fechar</button>
                </div>
            </div>`;
        let bipe = '';
        if (b && b.fase === 'buscando') bipe = `<div class="com-bipe"><div class="com-vazio">Código ${esc(b.codigo)} — procurando o produto…</div></div>`;
        else if (b && b.fase === 'feito') bipe = `
            <div class="com-bipe com-bipe-ok">
                <div class="com-bipe-txt"><strong>✔ ${esc(b.produto.nome)}</strong> — comprado ${b.pacotes} × ${fmtQtd(b.produto.embalagem.qtd, b.produto.embalagem.unidade)}. Em casa agora: ~${fmtQtd(emCasa(b.produto, dados, m), b.produto.embalagem.unidade)}.</div>
                <div class="com-bipe-btns">
                    <button type="button" class="btn btn-primary btn-sm" data-acao="camera">📷 Bipar o próximo</button>
                    <button type="button" class="mac-mini" data-acao="desfazer-bipe">desfazer</button>
                    <button type="button" class="mac-mini" data-acao="fechar-bipe">fechar</button>
                </div>
            </div>`;
        else if (b && b.fase === 'novo') {
            const dietaOpts = ['<option value="">— nenhum (só entra na lista) —</option>']
                .concat((m.dieta || []).map((i) => `<option value="${i.id}" ${b.dietaId === i.id ? 'selected' : ''}>${esc(i.nome)} (${i.porcao.qtd} ${esc(i.porcao.unidade)})</option>`)).join('');
            bipe = `
            <div class="com-bipe">
                <div class="com-bipe-txt"><strong>Produto novo</strong> <span class="mac-dica">${b.msg ? esc(b.msg) : 'primeira vez que aparece — confira e pronto, nunca mais pergunto'}</span></div>
                <form id="com-bipe-form" class="com-bipe-form" autocomplete="off">
                    <label class="mac-campo"><span>Nome</span><input type="text" id="com-b-nome" value="${esc(b.nome || '')}" required></label>
                    <div class="mac-linha-2">
                        <label class="mac-campo"><span>Embalagem</span>
                            <span class="mac-porcao">
                                <input type="text" inputmode="decimal" id="com-b-emb-qtd" value="${esc(b.embalagem ? b.embalagem.qtd : '')}" placeholder="500" required>
                                <select id="com-b-emb-un">${UNIDADES.map((u) => `<option value="${u}" ${(b.embalagem ? b.embalagem.unidade : 'g') === u ? 'selected' : ''}>${u === 'unidade' ? 'unidades' : u}</option>`).join('')}</select>
                            </span>
                        </label>
                        <label class="mac-campo"><span>Item da Dieta <em>para descontar o que você come</em></span><select id="com-b-dieta">${dietaOpts}</select></label>
                    </div>
                    <div class="mac-campo"><span>Onde você compra</span>
                        <div class="com-lojas">${LOJAS.map(([id, nome]) => `<button type="button" class="com-loja-btn ${(b.loja || 'lidl') === id ? 'ativo' : ''}" data-acao="bipe-loja" data-loja="${id}">${nome}</button>`).join('')}</div>
                    </div>
                    <div class="mac-form-acoes">
                        <button type="submit" class="btn btn-primary btn-sm">Cadastrar e marcar como comprado</button>
                        <button type="button" class="btn btn-secondary btn-sm" data-acao="bipe-so-cadastrar">Só cadastrar</button>
                        <button type="button" class="mac-mini" data-acao="fechar-bipe">cancelar</button>
                    </div>
                </form>
            </div>`;
        }

        const comoFunciona = !dados.produtos.length ? `
            <div class="com-passos">
                <div class="com-passo"><b>1</b><span><strong>Bipe</strong> o código de barras de cada produto quando chegar do mercado. Na primeira vez ele entra no cadastro (nome e embalagem vêm sozinhos); nas seguintes, conta como compra.</span></div>
                <div class="com-passo"><b>2</b><span><strong>Registre</strong> o que come no Macros, como já faz. Cada porção sai do "em casa".</span></div>
                <div class="com-passo"><b>3</b><span>A <strong>lista</strong> aparece aqui sozinha, por loja, quando algo está acabando. No mercado, toque em <strong>Comprei</strong>.</span></div>
                <div class="com-passo"><b>+</b><span>Sem código de barras (frango, carne)? <button type="button" class="mac-mini" data-tela="produtos">cadastre na mão</button>.</span></div>
            </div>` : '';

        return `
            <div class="com-cab">
                <div class="com-cab-txt"><strong>${totalItens ? `${totalItens} ${totalItens === 1 ? 'item' : 'itens'} para comprar` : 'Lista vazia'}</strong>
                    ${duvidas.length ? `<span class="mac-dica">${duvidas.length} em dúvida</span>` : ''}</div>
                <div class="com-cab-btns">
                    <button type="button" class="btn btn-primary btn-sm" data-acao="camera">📷 Bipar produto</button>
                    <button type="button" class="btn btn-secondary btn-sm" data-acao="perguntas">🛒 Vou ao mercado</button>
                </div>
            </div>
            ${cameraBox}
            ${bipe}
            ${comoFunciona}
            ${perguntas}
            ${lista}
            <div class="com-loja">
                <h4 class="com-loja-nome outra">Outros <span class="mac-dica">o que não é comida</span></h4>
                ${dados.avulsos.map((a) => `
                <div class="com-linha com-avulso">
                    <span class="com-linha-nome">${esc(a.nome)}</span>
                    <button type="button" class="com-comprei" data-acao="tirar-avulso" data-id="${a.id}">Comprei</button>
                </div>`).join('')}
                <form class="com-avulso-form" data-acao="avulso">
                    <input type="text" id="com-avulso-nome" placeholder="ex.: papel higiênico" autocomplete="off">
                    <button type="submit" class="btn btn-secondary btn-sm">Adicionar</button>
                </form>
            </div>`;
    };

    const telaProdutos = () => {
        const m = macros();
        const e = estado.editando || {};
        const emb = e.embalagem || { qtd: '', unidade: 'g' };
        const dietaOpts = ['<option value="">— nenhum (só lista) —</option>']
            .concat((m.dieta || []).map((i) => `<option value="${i.id}" ${e.dietaId === i.id ? 'selected' : ''}>${esc(i.nome)} (${i.porcao.qtd} ${esc(i.porcao.unidade)})</option>`)).join('');
        const itemDieta = (m.dieta || []).find((i) => i.id === e.dietaId);
        const unidadesDiferem = itemDieta && unidadeLimpa(itemDieta.porcao.unidade) !== (emb.unidade || 'g');
        const recentes = dados.compras.slice(-8).reverse();

        return `
            <div class="mac-dieta">
                <div class="mac-painel mac-form">
                    <div class="mac-dieta-titulo" id="com-form-titulo">${e.id ? 'Editar produto' : 'Novo produto'} <span class="mac-dica">cadastra uma vez, vale para sempre</span></div>
                    <form id="com-form" class="com-form" autocomplete="off">
                        <input type="hidden" id="com-f-id" value="${esc(e.id || '')}">
                        <label class="mac-campo"><span>Nome</span><input type="text" id="com-f-nome" value="${esc(e.nome || '')}" placeholder="ex.: Aveia" required></label>
                        <label class="mac-campo"><span>Item da Dieta <em>desconta o que você registra comendo</em></span><select id="com-f-dieta">${dietaOpts}</select></label>
                        <div class="mac-linha-2">
                            <label class="mac-campo"><span>Loja</span><select id="com-f-loja">${LOJAS.map(([id, nome]) => `<option value="${id}" ${(e.loja || 'lidl') === id ? 'selected' : ''}>${nome}</option>`).join('')}</select></label>
                            <label class="mac-campo"><span>Embalagem</span>
                                <span class="mac-porcao">
                                    <input type="text" inputmode="decimal" id="com-f-emb-qtd" value="${esc(emb.qtd)}" placeholder="500" required>
                                    <select id="com-f-emb-un">${UNIDADES.map((u) => `<option value="${u}" ${emb.unidade === u ? 'selected' : ''}>${u === 'unidade' ? 'unidades' : u}</option>`).join('')}</select>
                                </span>
                            </label>
                        </div>
                        ${unidadesDiferem ? `<label class="mac-campo"><span>1 ${esc(itemDieta.porcao.unidade)} da Dieta = quantos ${emb.unidade === 'unidade' ? 'unidades' : emb.unidade}?</span><input type="text" inputmode="decimal" id="com-f-fator" value="${esc(e.fator || 1)}"></label>` : '<input type="hidden" id="com-f-fator" value="1">'}
                        <div class="mac-linha-2">
                            <label class="mac-campo"><span>Por semana <em>usado enquanto não há histórico</em></span><span class="mac-porcao com-semana"><input type="text" inputmode="decimal" id="com-f-semana" value="${esc(e.porSemana || emb.qtd || '')}"><span class="com-un">${emb.unidade === 'unidade' ? 'unidades' : (emb.unidade || 'g')}</span></span></label>
                            <label class="mac-campo"><span>Código de barras <em>opcional</em></span><span class="mac-porcao com-codigo"><input type="text" inputmode="numeric" id="com-f-codigo" value="${esc(e.codigo || '')}" placeholder="ou leia com a câmera"><button type="button" class="btn btn-secondary btn-sm" data-acao="camera">📷</button></span></label>
                        </div>
                        <div id="com-camera-p" class="mac-camera" style="display:none">
                            <video id="com-camera-p-video" playsinline muted></video>
                            <div class="mac-camera-mira" aria-hidden="true"></div>
                            <div class="mac-camera-rodape">
                                <span id="com-camera-p-msg">Aponte para o código de barras</span>
                                <button type="button" class="btn btn-secondary btn-sm" data-acao="camera-fechar">Fechar</button>
                            </div>
                        </div>
                        ${estado.mensagem ? `<div class="mac-msg">${esc(estado.mensagem)}</div>` : ''}
                        <div class="mac-form-acoes">
                            <button type="submit" class="btn btn-primary btn-sm">${e.id ? 'Salvar' : 'Cadastrar'}</button>
                            ${e.id ? '<button type="button" class="btn btn-secondary btn-sm" data-acao="cancelar">Cancelar</button>' : ''}
                        </div>
                    </form>
                </div>
                <div class="mac-painel">
                    <div class="mac-dieta-titulo">Seus produtos <span class="mac-dica">${dados.produtos.length}</span></div>
                    ${dados.produtos.length ? LOJAS.map(([id, nome]) => {
                        const ps = dados.produtos.filter((p) => p.loja === id);
                        return ps.length ? `<h4 class="com-loja-nome ${id}">${nome}</h4>` + ps.map((p) => `
                        <div class="com-prod">
                            <span class="com-prod-nome">${esc(p.nome)} <em>${fmtQtd(p.embalagem.qtd, p.embalagem.unidade)}${p.dietaId ? '' : ' · sem item da Dieta'}</em></span>
                            <span class="com-prod-acoes">
                                <button type="button" class="mac-mini" data-acao="editar" data-id="${p.id}">editar</button>
                                <button type="button" class="mac-x" data-acao="apagar" data-id="${p.id}" aria-label="Apagar">✕</button>
                            </span>
                        </div>`).join('') : '';
                    }).join('') : '<div class="com-vazio">Nenhum produto ainda.</div>'}
                    ${recentes.length ? `<div class="mac-dieta-titulo com-hist-titulo">Últimas compras</div>${recentes.map((c) => {
                        const p = dados.produtos.find((x) => x.id === c.produtoId);
                        return p ? `<div class="com-hist"><span>${esc(c.quando.slice(8, 10))}/${esc(c.quando.slice(5, 7))} · ${c.pacotes} × ${esc(p.nome)}</span><button type="button" class="mac-mini" data-acao="desfazer" data-id="${c.id}">desfazer</button></div>` : '';
                    }).join('')}` : ''}
                </div>
            </div>`;
    };

    const render = () => {
        if (!temNavegador) return;
        const box = $('acad-compras');
        if (!box) return;
        box.innerHTML = `
            <div class="mac-telas">
                <button type="button" class="mac-tela ${estado.tela === 'lista' ? 'ativo' : ''}" data-tela="lista">Lista</button>
                <button type="button" class="mac-tela ${estado.tela === 'produtos' ? 'ativo' : ''}" data-tela="produtos">Produtos</button>
            </div>
            ${estado.tela === 'lista' ? telaLista() : telaProdutos()}`;
    };

    const lerForm = () => ({
        id: $('com-f-id').value || undefined,
        nome: $('com-f-nome').value,
        dietaId: $('com-f-dieta').value || null,
        loja: $('com-f-loja').value,
        embalagem: { qtd: num($('com-f-emb-qtd').value, 0), unidade: $('com-f-emb-un').value },
        fator: num($('com-f-fator').value, 1) || 1,
        porSemana: num($('com-f-semana').value, 0),
        codigo: $('com-f-codigo').value
    });

    /* ---- Bipe na lista: código conhecido = compra; desconhecido = cadastro rápido ---- */

    const lerBipeForm = () => ({
        nome: ($('com-b-nome') || {}).value || '',
        embalagem: { qtd: num(($('com-b-emb-qtd') || {}).value, 0), unidade: ($('com-b-emb-un') || {}).value || 'g' },
        dietaId: ($('com-b-dieta') || {}).value || null
    });

    const bipar = async (codigo) => {
        const conhecido = produtoPorCodigo(codigo, dados.produtos);
        if (conhecido) {
            comprei(conhecido.id, 1);
            const compra = dados.compras[dados.compras.length - 1];
            estado.bipe = { fase: 'feito', codigo, produto: conhecido, pacotes: 1, compraId: compra.id };
            render();
            return;
        }
        estado.bipe = { fase: 'buscando', codigo };
        render();
        const m = macros();
        try {
            const r = await window.Macros.buscarRotulo(codigo);
            const nome = nomeComMarca(r);
            const emb = interpretarEmbalagem(r.quantidade);
            estado.bipe = { fase: 'novo', codigo, nome, embalagem: emb, loja: 'lidl', dietaId: (sugerirDieta(nome, m.dieta) || {}).id || null,
                msg: emb ? '' : 'não veio o tamanho da embalagem — preencha' };
        } catch (err) {
            estado.bipe = { fase: 'novo', codigo, nome: '', embalagem: null, loja: 'lidl', dietaId: null, msg: `${err.message} Preencha o nome e a embalagem; o código fica guardado.` };
        }
        render();
        const campo = $('com-b-nome');
        if (campo && !campo.value) campo.focus();
    };

    const cadastrarDoBipe = (marcarComprado) => {
        const b = estado.bipe;
        if (!b) return;
        const f = lerBipeForm();
        if (!f.nome.trim() || !f.embalagem.qtd) { estado.bipe = { ...b, ...f, msg: 'Preencha o nome e a embalagem.' }; render(); return; }
        const id = guardarProduto({ nome: f.nome, dietaId: f.dietaId, loja: b.loja || 'lidl', codigo: b.codigo, embalagem: f.embalagem, porSemana: f.embalagem.qtd });
        const produto = dados.produtos.find((p) => p.id === id);
        if (marcarComprado) {
            comprei(id, 1);
            estado.bipe = { fase: 'feito', codigo: b.codigo, produto, pacotes: 1, compraId: dados.compras[dados.compras.length - 1].id };
        } else {
            estado.bipe = null;
        }
        render();
    };

    const ligar = () => {
        const box = $('acad-compras');
        if (!box) return;

        box.addEventListener('click', async (e) => {
            const alvo = e.target.closest('[data-acao], [data-tela]');
            if (!alvo) return;
            if (alvo.dataset.tela) {
                estado.tela = alvo.dataset.tela;
                try { localStorage.setItem(KEY_TELA, estado.tela); } catch { /* ignora */ }
                render();
                return;
            }
            const acao = alvo.dataset.acao, id = alvo.dataset.id;
            if (acao === 'perguntas') { estado.perguntando = !estado.perguntando; render(); }
            else if (acao === 'fechar-perguntas') { estado.perguntando = false; render(); }
            else if (acao === 'responder') { responder(id, alvo.dataset.r); render(); }
            else if (acao === 'mais' || acao === 'menos') {
                const m = macros();
                const p = dados.produtos.find((x) => x.id === id);
                const atual = estado.pacotes[id] || (p ? linhaDaLista(p, dados, m, hojeIso()).pacotes : 1);
                estado.pacotes[id] = Math.max(1, atual + (acao === 'mais' ? 1 : -1));
                render();
            }
            else if (acao === 'comprei') {
                const p = dados.produtos.find((x) => x.id === id);
                const n = estado.pacotes[id] || (p ? linhaDaLista(p, dados, macros(), hojeIso()).pacotes : 1);
                comprei(id, n);
                delete estado.pacotes[id];
                render();
            }
            else if (acao === 'tirar-avulso') { tirarAvulso(id); render(); }
            else if (acao === 'editar') { estado.editando = dados.produtos.find((x) => x.id === id) || null; estado.mensagem = ''; render(); window.scrollTo({ top: box.offsetTop - 20, behavior: 'smooth' }); }
            else if (acao === 'cancelar') { estado.editando = null; estado.mensagem = ''; render(); }
            else if (acao === 'apagar') {
                const p = dados.produtos.find((x) => x.id === id);
                if (p && confirm(`Apagar "${p.nome}" da lista de produtos?`)) { apagarProduto(id); if (estado.editando && estado.editando.id === id) estado.editando = null; render(); }
            }
            else if (acao === 'desfazer') { desfazerCompra(id); render(); }
            else if (acao === 'camera' && estado.tela === 'lista') {
                if (!window.Macros || !window.Macros.lerCodigoBarras) return;
                estado.bipe = null; estado.perguntando = false;
                render();
                window.Macros.lerCodigoBarras({ boxId: 'com-camera', videoId: 'com-camera-video', msgId: 'com-camera-msg', aoLer: bipar });
            }
            else if (acao === 'bipe-loja') { if (estado.bipe) { estado.bipe = { ...estado.bipe, ...lerBipeForm(), loja: alvo.dataset.loja }; render(); } }
            else if (acao === 'bipe-so-cadastrar') { cadastrarDoBipe(false); }
            else if (acao === 'desfazer-bipe') { if (estado.bipe && estado.bipe.compraId) desfazerCompra(estado.bipe.compraId); estado.bipe = null; render(); }
            else if (acao === 'fechar-bipe') { estado.bipe = null; render(); }
            else if (acao === 'camera') {
                if (!window.Macros || !window.Macros.lerCodigoBarras) return;
                window.Macros.lerCodigoBarras({
                    boxId: 'com-camera-p', videoId: 'com-camera-p-video', msgId: 'com-camera-p-msg',
                    aoLer: async (codigo) => {
                        const campo = $('com-f-codigo');
                        if (campo) campo.value = codigo;
                        estado.mensagem = 'Procurando o produto…';
                        const form = lerForm();
                        estado.editando = { ...form, id: form.id || undefined };
                        render();
                        try {
                            const r = await window.Macros.buscarRotulo(codigo);
                            const emb = interpretarEmbalagem(r.quantidade);
                            const f = { ...lerForm(), codigo, nome: lerForm().nome || nomeComMarca(r) };
                            if (emb) { f.embalagem = emb; if (!f.porSemana) f.porSemana = emb.qtd; }
                            estado.editando = f;
                            estado.mensagem = emb ? `Achei: ${r.nome} — embalagem ${fmtQtd(emb.qtd, emb.unidade)}. Confira e cadastre.` : `Achei: ${r.nome}. Não veio o tamanho da embalagem — preencha.`;
                        } catch (err) {
                            estado.editando = { ...lerForm(), codigo };
                            estado.mensagem = `${err.message} Preencha na mão mesmo — o código fica guardado.`;
                        }
                        render();
                    }
                });
            }
            else if (acao === 'camera-fechar') { if (window.Macros) window.Macros.fecharCamera(); }
        });

        box.addEventListener('submit', (e) => {
            const form = e.target;
            if (form.id === 'com-bipe-form') { e.preventDefault(); cadastrarDoBipe(true); return; }
            if (form.id === 'com-form') {
                e.preventDefault();
                const p = lerForm();
                if (!p.nome.trim() || !p.embalagem.qtd) { estado.mensagem = 'Preencha o nome e a embalagem.'; render(); return; }
                guardarProduto(p);
                estado.editando = null; estado.mensagem = '';
                render();
            } else if (form.dataset.acao === 'avulso') {
                e.preventDefault();
                adicionarAvulso($('com-avulso-nome').value);
                render();
                const c = $('com-avulso-nome'); if (c) c.focus();
            }
        });

        /* Mudar o item da Dieta ou a unidade redesenha o formulário (o campo "1 fatia = ? g" aparece/some) */
        box.addEventListener('change', (e) => {
            if (['com-f-dieta', 'com-f-emb-un'].includes(e.target.id)) {
                estado.editando = { ...lerForm(), id: lerForm().id };
                render();
            }
        });
    };

    const iniciar = () => {
        carregar();
        try { estado.tela = localStorage.getItem(KEY_TELA) || 'lista'; } catch { /* ignora */ }
        ligar();
        /* O Drive pode trocar os dados por baixo: relê antes de desenhar. */
        window.addEventListener('storage', (e) => { if (e.key === KEY) { carregar(); render(); } });
    };

    if (temNavegador) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
        else iniciar();
    }

    return {
        interpretarEmbalagem, consumoDesde, emCasa, porSemana, naDuvida, linhaDaLista, montarLista, fmtQtd, sugerirDieta, produtoPorCodigo,
        guardarProduto, apagarProduto, comprei, desfazerCompra, responder, adicionarAvulso, tirarAvulso, bipar,
        render: () => { carregar(); render(); },
        _dados: () => dados, _definirDados: (d) => { dados = migrar(d); }
    };
})();
