/* ==========================================================
   MACROS — calorias e macronutrientes, dentro da Academia
   ----------------------------------------------------------
   Baseado no MacroTracker da usuária, reescrito para o dashboard:
   sem servidor, sem login, sem IA. Dados no Drive (chave eseMacros).

   - Tela do dia: 4 anéis (kcal, proteína, carboidratos, gordura)
     contra a meta diária; o que foi comido, por refeição.
   - Dieta: a lista de comidas dela, com os números por porção.
     Entram na mão, por busca no Open Food Facts ou por código de
     barras (banco público, sem chave).
   - Histórico mini: 7 dias.

   Dados:
   eseMacros = {
     versao: 1,
     metas: { kcal, p, c, g },
     dieta: [ { id, nome, porcao: { qtd, unidade }, kcal, p, c, g, por100g? } ],
     dias:  { "2026-09-12": [ { id, refeicao, nome, qtd, kcal, p, c, g } ] }
   }
   Registros guardam os números na hora: mudar a Dieta depois não
   reescreve o passado.

   Lógica pura no topo (testada em Node), desenho embaixo.
   ========================================================== */

window.Macros = (() => {

    const KEY = 'eseMacros';
    const D = window.ESEDates;
    const REFEICOES = [
        ['cafe', 'Café da manhã'], ['almoco', 'Almoço'], ['jantar', 'Jantar'], ['lanche', 'Lanches']
    ];
    const METAS_PADRAO = { kcal: 2200, p: 150, c: 250, g: 70 };
    const NOME_REF = { cafe: 'Café da manhã', almoco: 'Almoço', jantar: 'Jantar', lanche: 'Lanches', qualquer: 'Qualquer refeição' };
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const DIAS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
    const OFF = 'https://world.openfoodfacts.org';

    const temNavegador = typeof document !== 'undefined';
    const temStorage = typeof localStorage !== 'undefined';
    const esc = (v) => window.escapeHtml ? window.escapeHtml(v) : String(v);
    const $ = (id) => document.getElementById(id);
    const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const num = (v, padrao = 0) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) && n >= 0 ? n : padrao; };
    const r1 = (n) => Math.round(n * 10) / 10;
    const novoId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

    /* ==================== DADOS ==================== */

    const macrosLimpos = (o) => ({ kcal: num(o && o.kcal), p: num(o && o.p), c: num(o && o.c), g: num(o && o.g) });

    const itemDietaLimpo = (i) => ({
        id: String(i && i.id || novoId()),
        nome: String(i && i.nome || '').trim(),
        porcao: { qtd: num(i && i.porcao && i.porcao.qtd, 1) || 1, unidade: String(i && i.porcao && i.porcao.unidade || 'porção').trim() || 'porção' },
        refeicao: ['cafe', 'almoco', 'jantar', 'lanche'].includes(i && i.refeicao) ? i.refeicao : 'qualquer',
        ...macrosLimpos(i),
        ...(i && i.por100g ? { por100g: macrosLimpos(i.por100g) } : {})
    });

    const migrar = (raw) => {
        const out = { versao: 1, metas: { ...METAS_PADRAO }, dieta: [], dias: {} };
        if (!raw || typeof raw !== 'object') return out;
        if (raw.metas) ['kcal', 'p', 'c', 'g'].forEach((k) => { const v = num(raw.metas[k]); if (v > 0) out.metas[k] = v; });
        (Array.isArray(raw.dieta) ? raw.dieta : []).forEach((i) => { const l = itemDietaLimpo(i); if (l.nome) out.dieta.push(l); });
        Object.entries(raw.dias || {}).forEach(([data, lista]) => {
            if (!Array.isArray(lista)) return;
            out.dias[data] = lista.map((r) => ({
                id: String(r.id || novoId()), refeicao: String(r.refeicao || 'lanche'),
                ...(r.dietaId ? { dietaId: String(r.dietaId) } : {}),
                nome: String(r.nome || '').trim(), qtd: num(r.qtd, 1) || 1, ...macrosLimpos(r)
            })).filter((r) => r.nome);
        });
        return out;
    };

    const ler = () => {
        if (!temStorage) return migrar(null);
        try { return migrar(JSON.parse(localStorage.getItem(KEY) || 'null')); } catch { return migrar(null); }
    };

    let dados = ler();
    const salvar = () => { if (temStorage) localStorage.setItem(KEY, JSON.stringify(dados)); };

    /* ==================== LÓGICA PURA ==================== */

    /* por 100 g → gramas */
    const escalar = (por100g, gramas) => {
        const f = num(gramas) / 100;
        return { kcal: Math.round(por100g.kcal * f), p: r1(por100g.p * f), c: r1(por100g.c * f), g: r1(por100g.g * f) };
    };

    const multiplicar = (m, vezes) => ({ kcal: r1(m.kcal * vezes), p: r1(m.p * vezes), c: r1(m.c * vezes), g: r1(m.g * vezes) });

    const diaDe = (data) => dados.dias[data] || [];

    const totais = (data) => diaDe(data).reduce(
        (s, r) => ({ kcal: r1(s.kcal + r.kcal), p: r1(s.p + r.p), c: r1(s.c + r.c), g: r1(s.g + r.g) }),
        { kcal: 0, p: 0, c: 0, g: 0 }
    );

    const serie7 = (ate) => {
        const fim = new Date(ate.getFullYear(), ate.getMonth(), ate.getDate());
        return Array.from({ length: 7 }, (_, i) => {
            const d = D.addDays(fim, i - 6);
            const iso = D.toDateString(d);
            return { data: iso, dia: DIAS[d.getDay()], ...totais(iso) };
        });
    };

    const filtrarDieta = (termo) => {
        const q = chave(termo);
        const lista = dados.dieta.slice().sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
        return q ? lista.filter((i) => chave(i.nome).includes(q)) : lista;
    };

    /* Lê a resposta do Open Food Facts (produto ou item de busca). */
    const lerProdutoOFF = (json) => {
        const p = json && json.status === 1 ? json.product : (json && json.product_name !== undefined ? json : null);
        if (!p) return null;
        const n = p.nutriments || {};
        const nome = String(p.product_name_pt || p.product_name || p.product_name_en || '').trim();
        if (!nome) return null;
        let kcal = n['energy-kcal_100g'];
        if (kcal == null && n['energy_100g'] != null) kcal = n['energy_100g'] / 4.184;
        if (kcal == null || !isFinite(kcal)) return null;
        return {
            nome, marca: String(p.brands || '').split(',')[0].trim(), codigo: String(p.code || ''),
            quantidade: String(p.quantity || '').trim(),
            por100g: { kcal: Math.round(kcal), p: r1(num(n['proteins_100g'])), c: r1(num(n['carbohydrates_100g'])), g: r1(num(n['fat_100g'])) }
        };
    };

    /* Só o rótulo (nome, marca, embalagem), sem exigir tabela nutricional.
       É o que a lista de Compras precisa. */
    const lerRotuloOFF = (json) => {
        const p = json && json.status === 1 ? json.product : null;
        if (!p) return null;
        const nome = String(p.product_name_pt || p.product_name || p.product_name_en || '').trim();
        if (!nome) return null;
        return { nome, marca: String(p.brands || '').split(',')[0].trim(), codigo: String(p.code || ''), quantidade: String(p.quantity || '').trim() };
    };

    /* ==================== ALTERAÇÕES ==================== */

    const definirMetas = (m) => {
        ['kcal', 'p', 'c', 'g'].forEach((k) => { const v = num(m && m[k]); if (v > 0) dados.metas[k] = v; });
        salvar();
    };

    const adicionarNaDieta = (item) => {
        const l = itemDietaLimpo({ ...item, id: novoId() });
        if (!l.nome) return '';
        dados.dieta.push(l);
        salvar();
        return l.id;
    };

    const editarNaDieta = (id, mudancas) => {
        const i = dados.dieta.findIndex((x) => x.id === id);
        if (i < 0) return;
        dados.dieta[i] = itemDietaLimpo({ ...dados.dieta[i], ...mudancas, id });
        salvar();
    };

    const apagarDaDieta = (id) => { dados.dieta = dados.dieta.filter((x) => x.id !== id); salvar(); };

    /* Registra um item da Dieta no dia, com um multiplicador da porção. */
    const registrar = (data, refeicao, dietaId, vezes) => {
        const item = dados.dieta.find((x) => x.id === dietaId);
        if (!item) return;
        const v = num(vezes, 1) || 1;
        const lista = (dados.dias[data] = dados.dias[data] || []);
        /* Tocar de novo na mesma comida, na mesma refeição, soma (×2, ×3…). */
        const existente = lista.find((r) => r.refeicao === refeicao && r.dietaId === dietaId);
        if (existente) {
            existente.qtd = r1(existente.qtd + v);
            Object.assign(existente, multiplicar(item, existente.qtd));
            salvar();
            return existente.id;
        }
        const reg = { id: novoId(), refeicao, dietaId, nome: item.nome, qtd: v, ...multiplicar(item, v) };
        lista.push(reg);
        salvar();
        return reg.id;
    };

    /* Diminui uma porção; some quando chega a zero. */
    const diminuir = (data, regId) => {
        const lista = dados.dias[data] || [];
        const r = lista.find((x) => x.id === regId);
        if (!r) return;
        const item = r.dietaId ? dados.dieta.find((x) => x.id === r.dietaId) : null;
        const passo = r.qtd >= 1 ? 1 : 0.5;
        const nova = r1(r.qtd - passo);
        if (nova <= 0 || !item) { remover(data, regId); return; }
        r.qtd = nova;
        Object.assign(r, multiplicar(item, nova));
        salvar();
    };

    /* Registra algo que não está na Dieta (números direto). */
    const registrarLivre = (data, refeicao, item) => {
        const nome = String(item && item.nome || '').trim();
        if (!nome) return '';
        const reg = { id: novoId(), refeicao, nome, qtd: 1, ...macrosLimpos(item) };
        (dados.dias[data] = dados.dias[data] || []).push(reg);
        salvar();
        return reg.id;
    };

    const remover = (data, regId) => {
        if (!dados.dias[data]) return;
        dados.dias[data] = dados.dias[data].filter((r) => r.id !== regId);
        if (!dados.dias[data].length) delete dados.dias[data];
        salvar();
    };

    /* ==================== OPEN FOOD FACTS ==================== */

    const buscarPorCodigo = async (codigo) => {
        const r = await fetch(`${OFF}/api/v0/product/${encodeURIComponent(String(codigo).trim())}.json`);
        if (!r.ok) throw new Error('Open Food Facts não respondeu.');
        const lido = lerProdutoOFF(await r.json());
        if (!lido) throw new Error('Produto não encontrado (ou sem tabela nutricional).');
        return lido;
    };

    const buscarRotulo = async (codigo) => {
        const r = await fetch(`${OFF}/api/v0/product/${encodeURIComponent(String(codigo).trim())}.json`);
        if (!r.ok) throw new Error('Open Food Facts não respondeu.');
        const lido = lerRotuloOFF(await r.json());
        if (!lido) throw new Error('Produto não encontrado no Open Food Facts.');
        return lido;
    };

    /* Busca por nome: o Open Food Facts não deixa páginas de outros
       sites chamarem a busca direto (CORS), então no PC é o servidor
       do dashboard que pergunta. No celular, só código de barras. */
    const noPC = temNavegador && ['localhost', '127.0.0.1'].includes(location.hostname);

    const buscarPorNome = async (termo) => {
        if (!noPC) throw new Error('A busca por nome só funciona no computador. Aqui, use o código de barras ou digite os números do rótulo.');
        const r = await fetch(`/api/off?q=${encodeURIComponent(termo)}`);
        if (!r.ok) throw new Error('O servidor do dashboard não respondeu.');
        const j = await r.json();
        if (j.erro) throw new Error(j.erro);
        return (j.hits || []).map(lerProdutoOFF).filter(Boolean);
    };

    /* ==================== CÂMERA (código de barras) ==================== */

    /* A biblioteca ZXing só é carregada na primeira vez que a câmera
       é aberta — quem nunca usa não baixa nada. Tudo roda no aparelho. */
    const ZXING_URL = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
    let leitor = null;

    const carregarZXing = () => new Promise((ok, falha) => {
        if (window.ZXing) { ok(); return; }
        const tag = document.createElement('script');
        tag.src = ZXING_URL;
        tag.onload = () => ok();
        tag.onerror = () => falha(new Error('Não consegui baixar o leitor de código de barras.'));
        document.head.appendChild(tag);
    });

    let cameraBoxId = 'mac-camera';

    const fecharCamera = () => {
        if (leitor) { try { leitor.reset(); } catch { /* ignora */ } leitor = null; }
        const box = $(cameraBoxId);
        if (box) box.style.display = 'none';
    };

    /* opcoes: { boxId, videoId, msgId, aoLer(codigo) } — sem opções, é o
       leitor da Dieta. A aba Compras usa a mesma função com os ids dela. */
    const abrirCamera = async (opcoes) => {
        const o = opcoes || {};
        cameraBoxId = o.boxId || 'mac-camera';
        const box = $(cameraBoxId), video = $(o.videoId || 'mac-camera-video'), msg = $(o.msgId || 'mac-camera-msg');
        if (!box || !video) return;
        box.style.display = '';
        msg.textContent = 'Carregando o leitor…';
        try {
            if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
                throw new Error('Este navegador não dá acesso à câmera (precisa ser https ou localhost).');
            }
            await carregarZXing();
            const Z = window.ZXing;
            const hints = new Map();
            hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.EAN_8, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.UPC_E]);
            leitor = new Z.BrowserMultiFormatReader(hints, 300);
            msg.textContent = 'Aponte para o código de barras';
            /* undefined = a câmera padrão; no celular o ZXing prefere a traseira. */
            await leitor.decodeFromVideoDevice(undefined, video, (resultado) => {
                if (!resultado) return;
                const codigo = resultado.getText();
                fecharCamera();
                if (o.aoLer) { o.aoLer(codigo); return; }
                const termo = $('mac-off-termo');
                if (termo) termo.value = codigo;
                const btn = document.querySelector('[data-acao="buscar-off"]');
                if (btn) btn.click();
            });
        } catch (e) {
            const nome = e && e.name;
            msg.textContent = nome === 'NotAllowedError' ? 'Você não deu permissão para a câmera.'
                : nome === 'NotFoundError' ? 'Nenhuma câmera encontrada.'
                : (e && e.message) || 'Não consegui abrir a câmera.';
        }
    };

    /* Sugestões da tabela TACO para o que foi digitado (regras, sem IA). */
    const daTabela = (frase, limite) => {
        if (!window.AlimentosRegras || !window.TabelaAlimentos) return [];
        const r = window.AlimentosRegras.interpretarComida(frase, window.TabelaAlimentos.itens);
        return r.candidatos.slice(0, limite || 3);
    };

    /* Nome curto para o registro: "Ovo, de galinha, inteiro, frito" -> "Ovo frito" */
    const nomeCurto = (nomeTaco) => {
        const partes = nomeTaco.split(',').map((p) => p.trim()).filter(Boolean);
        if (partes.length <= 2) return partes.join(' ');
        const ultimo = partes[partes.length - 1];
        return /cozid|frit|grelhad|assad|cru|integral|desnatad|natural/.test(ultimo.toLowerCase()) ? `${partes[0]} ${ultimo}` : partes[0];
    };

    /* ==================== DESENHO ==================== */

    const estado = { data: null, refeicao: 'cafe', tela: 'dia', busca: '', resultadosOFF: [], mensagem: '' };

    const fmtData = (iso) => { const d = D.fromDateString(iso); return `${DIAS[d.getDay()]} ${d.getDate()} ${MESES[d.getMonth()]}`; };
    const fmtN = (n) => String(r1(n)).replace('.', ',');

    const anel = (rotulo, valor, meta, classe, unidade) => {
        const raio = 34, circ = 2 * Math.PI * raio;
        const pct = meta > 0 ? Math.min(valor / meta, 1) : 0;
        const passou = meta > 0 && valor > meta;
        return `
            <div class="mac-anel ${classe} ${passou ? 'passou' : ''}">
                <svg viewBox="0 0 90 90" aria-hidden="true">
                    <circle class="mac-anel-fundo" cx="45" cy="45" r="${raio}"></circle>
                    <circle class="mac-anel-valor" cx="45" cy="45" r="${raio}"
                            stroke-dasharray="${circ.toFixed(1)}" stroke-dashoffset="${(circ * (1 - pct)).toFixed(1)}"></circle>
                </svg>
                <div class="mac-anel-centro">
                    <span class="mac-anel-num">${Math.round(valor)}</span>
                    <span class="mac-anel-un">${unidade}</span>
                </div>
                <div class="mac-anel-rotulo">${rotulo}<span>/ ${Math.round(meta)}${unidade}</span></div>
            </div>`;
    };

    const telaDia = () => {
        const iso = estado.data;
        const tot = totais(iso);
        const m = dados.metas;
        const lista = diaDe(iso);
        const hoje = iso === D.todayString();
        const q = chave(estado.busca);
        const sugestoes = q ? filtrarDieta(estado.busca).slice(0, 6) : [];
        const tabela = q ? daTabela(estado.busca, 3) : [];
        estado.ultimaTabela = tabela;

        const refeicoes = REFEICOES.map(([k, nome]) => {
            const comidos = lista.filter((r) => r.refeicao === k);
            const soma = comidos.reduce((s, r) => s + r.kcal, 0);
            /* Fichas: comidas da Dieta desta refeição (ou "qualquer"), filtradas pela busca */
            const fichas = filtrarDieta('').filter((i) => i.refeicao === k || i.refeicao === 'qualquer');
            return `
                <section class="mac-ref">
                    <div class="mac-ref-cab">
                        <span class="mac-ref-nome">${nome}</span>
                        <span class="mac-ref-kcal">${soma ? Math.round(soma) + ' kcal' : ''}</span>
                    </div>
                    ${comidos.map((r) => `
                    <div class="mac-item">
                        <span class="mac-item-nome">${esc(r.nome)}</span>
                        <span class="mac-item-macros">${Math.round(r.kcal)} kcal · ${fmtN(r.p)}P ${fmtN(r.c)}C ${fmtN(r.g)}G</span>
                        <span class="mac-qtd">
                            <button type="button" class="mac-qtd-btn" data-acao="menos" data-id="${r.id}" aria-label="Menos uma porção">−</button>
                            <b>×${fmtN(r.qtd)}</b>
                            ${r.dietaId ? `<button type="button" class="mac-qtd-btn" data-acao="registrar" data-id="${r.dietaId}" data-ref="${k}" aria-label="Mais uma porção">+</button>` : ''}
                        </span>
                        <button type="button" class="mac-x" data-acao="remover" data-id="${r.id}" aria-label="Remover ${esc(r.nome)}">✕</button>
                    </div>`).join('')}
                    <div class="mac-fichas">
                        ${fichas.map((i) => `
                        <button type="button" class="mac-ficha" data-acao="registrar" data-id="${i.id}" data-ref="${k}" title="${Math.round(i.kcal)} kcal · ${fmtN(i.p)}P ${fmtN(i.c)}C ${fmtN(i.g)}G">
                            <span class="mac-ficha-mais">+</span>${esc(i.nome)}<span class="mac-ficha-kcal">${Math.round(i.kcal)}</span>
                        </button>`).join('')}
                        ${!fichas.length ? `<span class="mac-fichas-vazio">${dados.dieta.length ? 'nada da Dieta para esta refeição' : 'cadastre comidas em <strong>Dieta</strong>'}</span>` : ''}
                    </div>
                </section>`;
        }).join('');

        return `
            <div class="mac-cab">
                <div class="acad-nav">
                    <button type="button" class="acad-seta" data-acao="dia-antes" aria-label="Dia anterior">‹</button>
                    <span class="acad-titulo">${hoje ? 'Hoje · ' : ''}${fmtData(iso)}</span>
                    <button type="button" class="acad-seta" data-acao="dia-depois" aria-label="Dia seguinte">›</button>
                    ${hoje ? '' : '<button type="button" class="acad-hoje-btn" data-acao="dia-hoje">Hoje</button>'}
                </div>
                <div class="mac-metas">
                    <span>meta</span>
                    <label><input type="number" data-meta="kcal" value="${m.kcal}" min="1"> kcal</label>
                    <label><input type="number" data-meta="p" value="${m.p}" min="1"> P</label>
                    <label><input type="number" data-meta="c" value="${m.c}" min="1"> C</label>
                    <label><input type="number" data-meta="g" value="${m.g}" min="1"> G</label>
                </div>
            </div>

            <div class="mac-aneis">
                ${anel('Calorias', tot.kcal, m.kcal, 'kcal', '')}
                ${anel('Proteína', tot.p, m.p, 'p', 'g')}
                ${anel('Carboidratos', tot.c, m.c, 'c', 'g')}
                ${anel('Gordura', tot.g, m.g, 'g', 'g')}
            </div>

            <div class="mac-add">
                <input type="text" id="mac-busca" class="mac-busca" placeholder="Adicionar comida da Dieta…" value="${esc(estado.busca)}" autocomplete="off">
                <div class="mac-ref-botoes" role="group" aria-label="Refeição">
                    ${REFEICOES.map(([k, n]) => `<button type="button" class="mac-ref-btn ${estado.refeicao === k ? 'ativo' : ''}" data-acao="refeicao" data-ref="${k}">${n.replace(' da manhã', '')}</button>`).join('')}
                </div>
            </div>
            ${q ? `
            <div class="mac-sugestoes mac-sug-topo">
                ${sugestoes.map((i) => `
                <button type="button" class="mac-sug" data-acao="registrar" data-id="${i.id}" data-ref="${estado.refeicao}">
                    <span class="mac-sug-nome">${esc(i.nome)} <em>da sua Dieta</em></span>
                    <span class="mac-sug-det">${fmtN(i.porcao.qtd)} ${esc(i.porcao.unidade)} · ${Math.round(i.kcal)} kcal · ${fmtN(i.p)}P ${fmtN(i.c)}C ${fmtN(i.g)}G → ${NOME_REF[estado.refeicao]}</span>
                </button>`).join('')}
                ${tabela.map((c, i) => `
                <button type="button" class="mac-sug mac-sug-tabela" data-acao="registrar-tabela" data-i="${i}">
                    <span class="mac-sug-nome">${esc(nomeCurto(c.nome))} <em>tabela · ${esc(c.nome)}</em></span>
                    <span class="mac-sug-det">${esc(c.descricao)} · ${c.kcal} kcal · ${fmtN(c.p)}P ${fmtN(c.c)}C ${fmtN(c.g)}G → ${NOME_REF[estado.refeicao]}</span>
                </button>`).join('')}
                ${!sugestoes.length && !tabela.length ? '<div class="mac-vazio">Não achei nem na Dieta nem na tabela. Cadastre em <strong>Dieta</strong>.</div>' : ''}
            </div>` : ''}

            <div class="mac-refeicoes">${refeicoes}</div>

            ${historico()}`;
    };

    const historico = () => {
        const serie = serie7(D.fromDateString(estado.data));
        const meta = dados.metas.kcal || 1;
        const maxK = Math.max(meta, ...serie.map((s) => s.kcal)) || 1;
        const W = 700, H = 150, topo = 22, base = 22, larg = (W - 24) / 7;
        const altura = (k) => Math.round((k / maxK) * (H - topo - base));
        const barras = serie.map((s, i) => {
            const h = altura(s.kcal);
            const x = 12 + i * larg + larg * 0.18;
            const y = H - base - h;
            return `
                <rect x="${x}" y="${y}" width="${larg * 0.64}" height="${h}" rx="5" class="${s.kcal > meta ? 'passou' : ''} ${s.data === estado.data ? 'atual' : ''}"></rect>
                ${s.kcal ? `<text x="${x + larg * 0.32}" y="${y - 5}" text-anchor="middle" class="mac-valor">${Math.round(s.kcal)}</text>` : ''}
                <text x="${x + larg * 0.32}" y="${H - 6}" text-anchor="middle" class="mac-dia">${s.dia}</text>`;
        }).join('');
        const yMeta = H - base - altura(meta);
        const comDados = serie.filter((s) => s.kcal > 0);
        const media = (k) => comDados.length ? Math.round(comDados.reduce((a, s) => a + s[k], 0) / comDados.length) : 0;
        return `
            <div class="mac-hist">
                <div class="mac-hist-cab"><span>Calorias · últimos 7 dias</span><span class="mac-dica">linha tracejada = meta</span></div>
                <svg viewBox="0 0 ${W} ${H}" class="mac-hist-svg" aria-hidden="true">
                    <line x1="12" x2="${W - 12}" y1="${yMeta}" y2="${yMeta}" class="mac-meta-linha"></line>
                    ${barras}
                </svg>
                <div class="mac-hist-medias">
                    Média dos dias com registro: <b>${media('kcal')} kcal</b> · <b>${media('p')}g</b> proteína · <b>${media('c')}g</b> carboidratos · <b>${media('g')}g</b> gordura
                </div>
            </div>`;
    };

    const telaDieta = () => {
        const grupos = ['cafe', 'almoco', 'jantar', 'lanche', 'qualquer'].map((k) => {
            const itens = filtrarDieta('').filter((i) => i.refeicao === k);
            if (!itens.length) return '';
            return `
                <div class="mac-dieta-grupo">
                    <div class="mac-ref-cab"><span class="mac-ref-nome">${NOME_REF[k]}</span><span class="mac-ref-kcal">${itens.length}</span></div>
                    ${itens.map((i) => `
                    <div class="mac-dieta-item">
                        <span class="mac-item-nome">${esc(i.nome)}</span>
                        <span class="mac-item-macros">${fmtN(i.porcao.qtd)} ${esc(i.porcao.unidade)} · ${Math.round(i.kcal)} kcal · ${fmtN(i.p)}P ${fmtN(i.c)}C ${fmtN(i.g)}G</span>
                        <span class="mac-dieta-acoes">
                            <button type="button" class="mac-mini" data-acao="editar-dieta" data-id="${i.id}">editar</button>
                            <button type="button" class="mac-x" data-acao="apagar-dieta" data-id="${i.id}" aria-label="Apagar ${esc(i.nome)}">✕</button>
                        </span>
                    </div>`).join('')}
                </div>`;
        }).join('');

        const off = estado.resultadosOFF.map((r, i) => `
            <button type="button" class="mac-sug" data-acao="usar-off" data-i="${i}">
                <span class="mac-sug-nome">${esc(r.nome)}${r.marca ? ` <em>${esc(r.marca)}</em>` : ''}</span>
                <span class="mac-sug-det">por 100 g · ${r.por100g.kcal} kcal · ${fmtN(r.por100g.p)}P ${fmtN(r.por100g.c)}C ${fmtN(r.por100g.g)}G</span>
            </button>`).join('');

        return `
            <div class="mac-dieta-novo">
                <div class="mac-painel">
                    <div class="mac-dieta-titulo" id="mac-form-titulo">Nova comida</div>
                    <form id="mac-form" class="mac-form" autocomplete="off">
                        <input type="hidden" id="mac-f-id">
                        <label class="mac-campo"><span>Nome</span><input type="text" id="mac-f-nome" placeholder="ex.: Ovo mexido" required></label>
                        <div class="mac-linha-2">
                            <label class="mac-campo"><span>Refeição</span>
                                <select id="mac-f-ref">
                                    <option value="qualquer">Qualquer</option>
                                    <option value="cafe">Café da manhã</option>
                                    <option value="almoco">Almoço</option>
                                    <option value="jantar">Jantar</option>
                                    <option value="lanche">Lanches</option>
                                </select></label>
                            <label class="mac-campo"><span>Porção</span>
                                <span class="mac-porcao"><input type="text" inputmode="decimal" id="mac-f-qtd" placeholder="1"><input type="text" id="mac-f-un" placeholder="unidade, g, fatia…"></span></label>
                        </div>
                        <div class="mac-form-nums">
                            <label class="mac-campo"><span>kcal</span><input type="text" inputmode="decimal" id="mac-f-kcal" placeholder="0" required></label>
                            <label class="mac-campo"><span>Proteína (g)</span><input type="text" inputmode="decimal" id="mac-f-p" placeholder="0"></label>
                            <label class="mac-campo"><span>Carbos (g)</span><input type="text" inputmode="decimal" id="mac-f-c" placeholder="0"></label>
                            <label class="mac-campo"><span>Gordura (g)</span><input type="text" inputmode="decimal" id="mac-f-g" placeholder="0"></label>
                        </div>
                        <div class="mac-form-acoes">
                            <button type="submit" class="btn btn-primary btn-sm" id="mac-f-salvar">Adicionar à Dieta</button>
                            <button type="button" class="btn btn-secondary btn-sm" data-acao="limpar-form">Limpar</button>
                        </div>
                    </form>
                </div>

                <div class="mac-painel mac-off">
                    <div class="mac-dieta-titulo">Da tabela de alimentos <span class="mac-dica">TACO, no aparelho — digite "2 ovos", "150 g de frango", "1 fatia de pão integral"</span></div>
                    <input type="text" id="mac-tab-termo" class="mac-tab-termo" placeholder="ex.: 2 ovos mexidos" autocomplete="off" value="${esc(estado.buscaTabela || '')}">
                    <div class="mac-sugestoes">
                        ${(estado.buscaTabela ? daTabela(estado.buscaTabela, 4) : []).map((c, i) => `
                        <button type="button" class="mac-sug" data-acao="usar-tabela" data-i="${i}">
                            <span class="mac-sug-nome">${esc(nomeCurto(c.nome))} <em>${esc(c.nome)}</em></span>
                            <span class="mac-sug-det">${esc(c.descricao)} · ${c.kcal} kcal · ${fmtN(c.p)}P ${fmtN(c.c)}C ${fmtN(c.g)}G</span>
                        </button>`).join('')}
                    </div>
                    <div class="mac-dieta-titulo mac-off-titulo">Ou do Open Food Facts <span class="mac-dica">produtos de marca, por código de barras${noPC ? ' ou nome' : ''}</span></div>
                    <div class="mac-off-busca">
                        <input type="text" id="mac-off-termo" placeholder="${noPC ? 'Nome do produto ou código de barras' : 'Código de barras (a busca por nome é só no PC)'}" autocomplete="off">
                        <button type="button" class="btn btn-secondary btn-sm" data-acao="buscar-off">Buscar</button>
                        <button type="button" class="btn btn-secondary btn-sm mac-cam-btn" data-acao="camera" title="Ler o código de barras com a câmera">📷 Câmera</button>
                    </div>
                    <div id="mac-camera" class="mac-camera" style="display:none">
                        <video id="mac-camera-video" playsinline muted></video>
                        <div class="mac-camera-mira" aria-hidden="true"></div>
                        <div class="mac-camera-rodape">
                            <span id="mac-camera-msg">Aponte para o código de barras</span>
                            <button type="button" class="btn btn-secondary btn-sm" data-acao="camera-fechar">Fechar</button>
                        </div>
                    </div>
                    <label class="mac-off-gramas">Porção que você come: <input type="text" inputmode="decimal" id="mac-off-gramas" value="100"> g</label>
                    ${estado.mensagem ? `<div class="mac-msg">${esc(estado.mensagem)}</div>` : ''}
                    <div class="mac-sugestoes">${off}</div>
                </div>
            </div>

            <div class="mac-dieta-titulo">Sua Dieta <span class="mac-dica">${dados.dieta.length} ${dados.dieta.length === 1 ? 'comida' : 'comidas'}</span></div>
            <div class="mac-dieta-lista">${grupos || '<div class="mac-vazio">Nenhuma comida cadastrada ainda. Use o formulário acima.</div>'}</div>`;
    };

    const render = () => {
        if (!temNavegador) return;
        const box = $('acad-macros');
        if (!box) return;
        if (leitor) fecharCamera();
        dados = ler();
        if (!estado.data) estado.data = D.todayString();
        box.innerHTML = `
            <div class="mac-telas">
                <button type="button" class="mac-tela ${estado.tela === 'dia' ? 'ativo' : ''}" data-acao="tela" data-tela="dia">Dia</button>
                <button type="button" class="mac-tela ${estado.tela === 'dieta' ? 'ativo' : ''}" data-acao="tela" data-tela="dieta">Dieta</button>
            </div>
            ${estado.tela === 'dia' ? telaDia() : telaDieta()}`;
        if (estado.tela === 'dia') {
            const b = $('mac-busca');
            if (b && estado.focarBusca) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); estado.focarBusca = false; }
        }
    };

    /* A porção e os números que estão no formulário formam a "base":
       mudar a quantidade recalcula os números na proporção. */
    let baseForm = null;
    const guardarBase = () => {
        baseForm = { qtd: num($('mac-f-qtd').value, 1) || 1, kcal: num($('mac-f-kcal').value), p: num($('mac-f-p').value), c: num($('mac-f-c').value), g: num($('mac-f-g').value) };
    };
    const reescalarForm = () => {
        if (!baseForm) return;
        const qtd = num($('mac-f-qtd').value, 0);
        if (!qtd) return;
        const f = qtd / baseForm.qtd;
        $('mac-f-kcal').value = Math.round(baseForm.kcal * f);
        $('mac-f-p').value = r1(baseForm.p * f);
        $('mac-f-c').value = r1(baseForm.c * f);
        $('mac-f-g').value = r1(baseForm.g * f);
    };

    const preencherForm = (item) => {
        $('mac-f-id').value = item.id || '';
        $('mac-f-nome').value = item.nome || '';
        $('mac-f-ref').value = item.refeicao || 'qualquer';
        $('mac-form-titulo').textContent = item.id ? 'Editando: ' + item.nome : 'Nova comida';
        $('mac-f-qtd').value = item.porcao ? item.porcao.qtd : '';
        $('mac-f-un').value = item.porcao ? item.porcao.unidade : '';
        $('mac-f-kcal').value = item.kcal ?? '';
        $('mac-f-p').value = item.p ?? '';
        $('mac-f-c').value = item.c ?? '';
        $('mac-f-g').value = item.g ?? '';
        $('mac-f-salvar').textContent = item.id ? 'Salvar alteração' : 'Adicionar à Dieta';
        guardarBase();
        $('mac-f-nome').focus();
    };

    const ligar = () => {
        const box = $('acad-macros');
        if (!box) return;

        box.addEventListener('click', async (e) => {
            const alvo = e.target.closest('[data-acao]');
            if (!alvo) return;
            const acao = alvo.dataset.acao;

            if (acao === 'tela') { estado.tela = alvo.dataset.tela; estado.mensagem = ''; render(); }
            else if (acao === 'dia-antes') { estado.data = D.toDateString(D.addDays(D.fromDateString(estado.data), -1)); render(); }
            else if (acao === 'dia-depois') { estado.data = D.toDateString(D.addDays(D.fromDateString(estado.data), 1)); render(); }
            else if (acao === 'dia-hoje') { estado.data = D.todayString(); render(); }
            else if (acao === 'refeicao') { estado.refeicao = alvo.dataset.ref; estado.focarBusca = !!estado.busca; render(); }
            else if (acao === 'registrar') {
                registrar(estado.data, alvo.dataset.ref || estado.refeicao, alvo.dataset.id, 1);
                if (alvo.classList.contains('mac-sug')) estado.busca = '';
                render();
            }
            else if (acao === 'menos') { diminuir(estado.data, alvo.dataset.id); render(); }
            else if (acao === 'registrar-tabela') {
                const c = (estado.ultimaTabela || [])[Number(alvo.dataset.i)];
                if (!c) return;
                registrarLivre(estado.data, estado.refeicao, { nome: `${nomeCurto(c.nome)} (${c.descricao.replace(/ \(≈.*\)/, '')})`, kcal: c.kcal, p: c.p, c: c.c, g: c.g });
                estado.busca = '';
                render();
            }
            else if (acao === 'remover') { remover(estado.data, alvo.dataset.id); render(); }
            else if (acao === 'apagar-dieta') {
                const item = dados.dieta.find((x) => x.id === alvo.dataset.id);
                if (item && confirm(`Apagar “${item.nome}” da Dieta? O que já foi registrado nos dias continua.`)) { apagarDaDieta(alvo.dataset.id); render(); }
            }
            else if (acao === 'editar-dieta') {
                const item = dados.dieta.find((x) => x.id === alvo.dataset.id);
                if (item) { preencherForm(item); window.scrollTo({ top: box.getBoundingClientRect().top + window.scrollY - 20, behavior: 'smooth' }); }
            }
            else if (acao === 'limpar-form') { preencherForm({}); }
            else if (acao === 'camera') { abrirCamera(); }
            else if (acao === 'camera-fechar') { fecharCamera(); }
            else if (acao === 'buscar-off') {
                const termo = ($('mac-off-termo').value || '').trim();
                if (!termo) return;
                estado.mensagem = 'Buscando…'; estado.resultadosOFF = [];
                const gramasAntes = $('mac-off-gramas').value;
                render(); $('mac-off-termo').value = termo; $('mac-off-gramas').value = gramasAntes;
                try {
                    estado.resultadosOFF = /^\d{8,14}$/.test(termo) ? [await buscarPorCodigo(termo)] : await buscarPorNome(termo);
                    estado.mensagem = estado.resultadosOFF.length ? '' : 'Nada encontrado com esse nome.';
                } catch (err) {
                    estado.mensagem = err && err.message ? err.message : 'Não consegui consultar o Open Food Facts.';
                }
                render(); $('mac-off-termo').value = termo; $('mac-off-gramas').value = gramasAntes;
            }
            else if (acao === 'usar-tabela') {
                const c = daTabela(estado.buscaTabela || '', 4)[Number(alvo.dataset.i)];
                if (!c) return;
                const sep = window.AlimentosRegras.separar(estado.buscaTabela || '');
                const unidade = sep.unidade && sep.unidade !== 'g' && sep.unidade !== 'ml' ? sep.unidade : 'g';
                const qtd = unidade === 'g' ? c.gramas : (sep.qtd === null ? 1 : sep.qtd);
                preencherForm({ nome: nomeCurto(c.nome), porcao: { qtd, unidade }, kcal: c.kcal, p: c.p, c: c.c, g: c.g });
                estado.buscaTabela = '';
            }
            else if (acao === 'usar-off') {
                const r = estado.resultadosOFF[Number(alvo.dataset.i)];
                if (!r) return;
                const gramas = num($('mac-off-gramas').value, 100) || 100;
                preencherForm({ nome: r.nome, porcao: { qtd: gramas, unidade: 'g' }, ...escalar(r.por100g, gramas) });
            }
        });

        box.addEventListener('input', (e) => {
            if (e.target.id === 'mac-busca') {
                estado.busca = e.target.value;
                estado.focarBusca = true;
                render();
            } else if (e.target.id === 'mac-f-qtd') {
                reescalarForm();
            } else if (['mac-f-kcal', 'mac-f-p', 'mac-f-c', 'mac-f-g'].includes(e.target.id)) {
                guardarBase();     // a pessoa digitou os números: a base passa a ser esta porção
            } else if (e.target.id === 'mac-tab-termo') {
                estado.buscaTabela = e.target.value;
                const pos = e.target.selectionStart;
                render();
                const el = $('mac-tab-termo');
                if (el) { el.focus(); el.setSelectionRange(pos, pos); }
            }
        });

        box.addEventListener('change', (e) => {
            if (e.target.dataset && e.target.dataset.meta) {
                definirMetas({ [e.target.dataset.meta]: e.target.value });
                render();
            }
        });

        box.addEventListener('submit', (e) => {
            if (e.target.id !== 'mac-form') return;
            e.preventDefault();
            const item = {
                nome: $('mac-f-nome').value,
                refeicao: $('mac-f-ref').value,
                porcao: { qtd: num($('mac-f-qtd').value, 1) || 1, unidade: $('mac-f-un').value || 'porção' },
                kcal: $('mac-f-kcal').value, p: $('mac-f-p').value, c: $('mac-f-c').value, g: $('mac-f-g').value
            };
            const id = $('mac-f-id').value;
            if (id) editarNaDieta(id, item); else adicionarNaDieta(item);
            estado.resultadosOFF = []; estado.mensagem = '';
            render();
        });

        box.addEventListener('keydown', (e) => {
            if (e.target.id === 'mac-off-termo' && e.key === 'Enter') { e.preventDefault(); box.querySelector('[data-acao="buscar-off"]').click(); }
        });
    };

    /* As sub-abas da Academia: Treinos | Macros. */
    const ligarAbas = () => {
        const abas = document.querySelectorAll('.acad-aba');
        if (!abas.length) return;
        const mostrar = (aba) => {
            abas.forEach((b) => b.classList.toggle('active', b.dataset.aba === aba));
            const t = $('acad-treinos'), m = $('acad-macros'), c = $('acad-compras');
            if (t) t.style.display = aba === 'treinos' ? '' : 'none';
            if (m) m.style.display = aba === 'macros' ? '' : 'none';
            if (c) c.style.display = aba === 'compras' ? '' : 'none';
            if (aba === 'macros') render();
            if (aba === 'compras' && window.Compras) window.Compras.render();
            try { localStorage.setItem('eseAcademiaAba', aba); } catch { /* ignora */ }
        };
        abas.forEach((b) => b.addEventListener('click', () => mostrar(b.dataset.aba)));
        let salva = 'treinos';
        try { salva = localStorage.getItem('eseAcademiaAba') || 'treinos'; } catch { /* ignora */ }
        mostrar(salva);
    };

    if (temNavegador) {
        const iniciar = () => { ligar(); ligarAbas(); };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
        else iniciar();
    }

    return {
        escalar, multiplicar, totais, serie7, diaDe, filtrarDieta, lerProdutoOFF,
        definirMetas, adicionarNaDieta, editarNaDieta, apagarDaDieta, registrar, registrarLivre, remover, diminuir,
        buscarPorCodigo, buscarPorNome, buscarRotulo, lerRotuloOFF, render,
        lerCodigoBarras: abrirCamera, fecharCamera,
        _dados: () => dados, _definirDados: (d) => { dados = migrar(d); }
    };
})();
