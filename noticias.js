/* ==========================================================
   NOTÍCIAS — o jornal do dia, em seções
   ----------------------------------------------------------
   Um robô (GitHub Actions, .github/workflows/noticias.yml) lê os
   feeds dos jornais de hora em hora e publica noticias.json no
   ramo "noticias" do repositório. Aqui só se lê esse arquivo e
   se desenha a seção escolhida. Sem IA, sem servidor, sem custo.

   - Seções em pílulas: Geral, Economia, Negócios, Tecnologia,
     Geopolítica, Fórmula 1, Esportes, Holanda, Brasil, EUA, Política.
   - Cada história: título (abre o jornal), jornal, "há 2 h", uma
     linha de resumo; a primeira da seção com foto.
   - A mesma história em vários jornais vem agrupada pelo robô:
     mostramos os outros jornais embaixo, cada um clicável.
   - Botão "Fontes": liga/desliga jornais. A lista de desligados
     fica em eseNoticiasFontes (vai para o Drive, como o resto).

   Lógica pura no topo (testada em Node), desenho embaixo.
   ========================================================== */

window.Noticias = (() => {

    const KEY_FONTES = 'eseNoticiasFontes';   // { desligadas: ['g1', ...] }
    const KEY_SECAO = 'eseNoticiasSecao';     // última seção aberta (só neste aparelho)
    const KEY_CACHE = 'eseNoticiasCache';     // última cópia do noticias.json (só neste aparelho)
    const MAX_GERAL = 30;

    const temNavegador = typeof document !== 'undefined';
    const temStorage = typeof localStorage !== 'undefined';
    const esc = (v) => window.escapeHtml ? window.escapeHtml(v) : String(v);
    const $ = (id) => document.getElementById(id);

    /* Onde o robô publica. No PC, se existir um noticias.json ao lado
       do index.html (gerado com "py noticias/coletar.py"), ele ganha. */
    const urlPublicada = () => {
        const cfg = (window.ESE_CONFIG && window.ESE_CONFIG.NOTICIAS_URL) || '';
        if (cfg) return cfg;
        const m = /^([^.]+)\.github\.io$/.exec(typeof location !== 'undefined' ? location.hostname : '');
        const repo = typeof location !== 'undefined' ? location.pathname.split('/').filter(Boolean)[0] : '';
        return m && repo ? `https://raw.githubusercontent.com/${m[1]}/${repo}/noticias/noticias.json` : '';
    };

    /* ==================== LÓGICA PURA ==================== */

    const lerDesligadas = () => {
        if (!temStorage) return [];
        try {
            const d = JSON.parse(localStorage.getItem(KEY_FONTES) || 'null');
            return d && Array.isArray(d.desligadas) ? d.desligadas.map(String) : [];
        } catch { return []; }
    };
    const gravarDesligadas = (lista) => {
        if (!temStorage) return;
        try { localStorage.setItem(KEY_FONTES, JSON.stringify({ desligadas: [...new Set(lista)].sort() })); } catch { /* ignora */ }
    };

    /* Aplica as fontes desligadas a uma lista de itens: tira os que só
       têm fontes desligadas; se a principal está desligada mas alguma
       "outra" não, a primeira "outra" ligada vira principal. */
    const filtrarPorFontes = (itens, desligadas) => {
        const off = new Set(desligadas || []);
        const saida = [];
        for (const it of itens || []) {
            const outras = (it.outras || []).filter((o) => !off.has(o.fonte));
            if (!off.has(it.fonte)) {
                saida.push({ ...it, outras });
            } else if (outras.length) {
                const [nova, ...resto] = outras;
                saida.push({ ...it, fonte: nova.fonte, link: nova.link, outras: resto });
            }
        }
        return saida;
    };

    /* Sem data (alguns feeds não mandam) fica no fim. */
    const hora = (i) => (i.quando ? String(i.quando) : '');
    const ordenarPorHora = (itens) => [...itens].sort((a, b) => hora(b).localeCompare(hora(a)));

    /* Geral = as histórias com mais jornais, de todas as seções; empate: mais recente. */
    const montarGeral = (itens, max = MAX_GERAL) => [...itens]
        .sort((a, b) => ((b.outras || []).length - (a.outras || []).length) || hora(b).localeCompare(hora(a)))
        .slice(0, max);

    const itensDaSecao = (dados, secao, desligadas) => {
        const todos = filtrarPorFontes(dados && dados.itens, desligadas);
        if (secao === 'geral') return montarGeral(todos);
        return ordenarPorHora(todos.filter((i) => i.secao === secao));
    };

    /* Busca em todas as seções: cada palavra digitada tem de aparecer no
       título, no resumo ou no nome do jornal (sem acento, sem maiúscula). */
    const chave = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const buscar = (dados, termo, desligadas) => {
        const palavras = chave(termo).split(/\s+/).filter(Boolean);
        if (!palavras.length) return [];
        const todos = filtrarPorFontes(dados && dados.itens, desligadas);
        const nomes = {};
        (dados && dados.fontes || []).forEach((f) => { nomes[f.id] = f.nome; });
        return ordenarPorHora(todos.filter((i) => {
            const texto = chave(`${i.titulo} ${i.resumo || ''} ${nomes[i.fonte] || ''} ${(i.outras || []).map((o) => nomes[o.fonte] || '').join(' ')}`);
            return palavras.every((p) => texto.includes(p));
        }));
    };

    /* "há 5 min", "há 3 h", "ontem", "há 2 dias" */
    const tempoRelativo = (iso, agora = new Date()) => {
        const t = iso ? new Date(iso).getTime() : NaN;
        if (!isFinite(t)) return '';
        const min = Math.max(0, Math.round((agora.getTime() - t) / 60000));
        if (min < 1) return 'agora';
        if (min < 60) return `há ${min} min`;
        const h = Math.round(min / 60);
        if (h < 24) return `há ${h} h`;
        const d = Math.round(h / 24);
        return d === 1 ? 'ontem' : `há ${d} dias`;
    };

    const nomeDaFonte = (dados, id) => {
        const f = (dados && dados.fontes || []).find((x) => x.id === id);
        return f ? f.nome : id;
    };

    /* ==================== DADOS ==================== */

    let dados = null;
    let carregando = false;
    let erro = '';
    const estado = { secao: 'geral', fontesAbertas: false, busca: '' };

    const lerCache = () => {
        if (!temStorage) return null;
        try { return JSON.parse(localStorage.getItem(KEY_CACHE) || 'null'); } catch { return null; }
    };
    const gravarCache = (d) => {
        if (!temStorage) return;
        try { localStorage.setItem(KEY_CACHE, JSON.stringify(d)); } catch { /* pode não caber; sem drama */ }
    };

    const buscarJson = async (url) => {
        const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Math.floor(Date.now() / 60000), { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json();
        if (!d || !Array.isArray(d.itens)) throw new Error('arquivo inesperado');
        return d;
    };

    const carregar = async (forcar) => {
        if (carregando) return;
        if (!forcar && dados && Date.now() - new Date(dados.geradoEm).getTime() < 20 * 60000) return;
        carregando = true;
        erro = '';
        render();
        const candidatos = [];
        const local = typeof location !== 'undefined' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
        if (local) candidatos.push('noticias.json');
        const pub = urlPublicada();
        if (pub) candidatos.push(pub);
        if (!local) candidatos.push('noticias.json');
        let ok = null;
        for (const url of candidatos) {
            try { ok = await buscarJson(url); break; } catch (e) { erro = e.message; }
        }
        if (ok) {
            dados = ok;
            gravarCache(ok);
            erro = '';
        }
        carregando = false;
        render();
    };

    /* ==================== DESENHO ==================== */

    const icone = (nome) => ({
        atualizar: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5a7 7 0 0 1 6.3 4H16v2h6V5h-2v2.2A9 9 0 1 0 21 13h-2a7 7 0 1 1-7-8z"/></svg>',
        fontes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v2H3zm0 6h12v2H3zm0 6h18v2H3z"/></svg>',
        externo: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14zM5 5h6v2H7v10h10v-4h2v6H5z"/></svg>'
    })[nome] || '';

    const linhaFontes = (it) => {
        const partes = [`<span class="not-fonte">${esc(nomeDaFonte(dados, it.fonte))}</span>`];
        for (const o of it.outras || []) {
            partes.push(`<a class="not-fonte not-fonte-outra" href="${esc(o.link)}" target="_blank" rel="noopener">${esc(nomeDaFonte(dados, o.fonte))}</a>`);
        }
        return partes.join('<span class="not-sep">·</span>');
    };

    const nomeDaSecao = (id) => ((dados && dados.secoes || []).find((s) => s.id === id) || {}).nome || '';

    const historia = (it, destaque, comSecao) => `
        <article class="not-item ${destaque && it.imagem ? 'not-destaque' : ''}">
            ${destaque && it.imagem ? `<a class="not-foto" href="${esc(it.link)}" target="_blank" rel="noopener"><img src="${esc(it.imagem)}" alt="" loading="lazy" onerror="this.parentNode.remove()"></a>` : ''}
            <div class="not-corpo">
                <a class="not-titulo" href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.titulo)}</a>
                <div class="not-meta">${comSecao ? `<span class="not-tag">${esc(nomeDaSecao(it.secao))}</span>` : ''}${linhaFontes(it)}${it.quando ? `<span class="not-sep">·</span><span class="not-hora">${tempoRelativo(it.quando)}</span>` : ''}${(it.outras || []).length ? `<span class="not-cobertura">${(it.outras || []).length + 1} jornais</span>` : ''}</div>
                ${it.resumo ? `<p class="not-resumo">${esc(it.resumo)}</p>` : ''}
            </div>
        </article>`;

    const painelFontes = () => {
        const off = new Set(lerDesligadas());
        const secoes = (dados.secoes || []).filter((s) => s.id !== 'geral');
        return `
        <div class="not-fontes-painel">
            <div class="not-fontes-topo">
                <strong>Fontes</strong>
                <span class="not-dica">Desligue o que não quiser ver. Vale no PC e no celular.</span>
                <button type="button" class="not-fechar" data-acao="fechar-fontes" aria-label="Fechar">×</button>
            </div>
            <div class="not-fontes-grade">
                ${secoes.map((s) => `
                <div class="not-fontes-secao">
                    <h4>${esc(s.nome)}</h4>
                    ${(dados.fontes || []).filter((f) => f.secao === s.id).map((f) => `
                    <label class="not-fonte-linha ${off.has(f.id) ? 'off' : ''}">
                        <input type="checkbox" data-fonte="${esc(f.id)}" ${off.has(f.id) ? '' : 'checked'}>
                        <span>${esc(f.nome)}</span>
                    </label>`).join('')}
                </div>`).join('')}
            </div>
        </div>`;
    };

    const render = () => {
        if (!temNavegador) return;
        const box = $('noticias-view');
        if (!box) return;

        const secoes = (dados && dados.secoes) || [{ id: 'geral', nome: 'Geral' }];
        const desligadas = lerDesligadas();
        const buscando = estado.busca.trim().length > 0;
        const itens = !dados ? [] : (buscando ? buscar(dados, estado.busca, desligadas) : itensDaSecao(dados, estado.secao, desligadas));
        const geradoHa = dados ? tempoRelativo(dados.geradoEm) : '';

        let miolo;
        if (!dados && carregando) miolo = '<div class="not-vazio">Buscando o jornal de hoje…</div>';
        else if (!dados) miolo = `<div class="not-vazio">Sem notícias agora — tente mais tarde.${erro ? `<br><small>${esc(erro)}</small>` : ''}</div>`;
        else if (!itens.length) miolo = `<div class="not-vazio">${buscando ? `Nada com "${esc(estado.busca.trim())}" nas últimas horas.` : 'Nada nesta seção nas últimas horas (ou todas as fontes dela estão desligadas).'}</div>`;
        else miolo = `<div class="not-lista">${itens.map((it, i) => historia(it, i === 0 && !buscando, buscando)).join('')}</div>`;

        box.innerHTML = `
            <div class="not-topo">
                <h2>Notícias</h2>
                <div class="not-acoes">
                    <span class="not-status">${carregando ? 'atualizando…' : (geradoHa ? `atualizado ${geradoHa}` : '')}</span>
                    <button type="button" class="not-btn" data-acao="atualizar" title="Buscar de novo" aria-label="Buscar de novo">${icone('atualizar')}</button>
                    <button type="button" class="not-btn ${estado.fontesAbertas ? 'active' : ''}" data-acao="fontes">${icone('fontes')}<span>Fontes</span></button>
                </div>
            </div>
            <div class="not-busca-caixa">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 2a8 8 0 0 1 6.3 12.9l5.4 5.4-1.4 1.4-5.4-5.4A8 8 0 1 1 10 2zm0 2a6 6 0 1 0 0 12 6 6 0 0 0 0-12z"/></svg>
                <input type="search" id="not-busca" placeholder="Buscar em todas as seções… (ex.: Petrobras, Verstappen, juros)" autocomplete="off" value="${esc(estado.busca)}">
                ${buscando ? `<button type="button" class="not-limpar" data-acao="limpar-busca" aria-label="Limpar busca">×</button><span class="not-busca-n">${itens.length}</span>` : ''}
            </div>
            <div class="not-secoes ${buscando ? 'apagada' : ''}" role="tablist">
                ${secoes.map((s) => `<button type="button" class="not-secao ${s.id === estado.secao && !buscando ? 'active' : ''}" data-secao="${esc(s.id)}" role="tab">${esc(s.nome)}</button>`).join('')}
            </div>
            ${estado.fontesAbertas && dados ? painelFontes() : ''}
            ${miolo}`;
    };

    const ligarEventos = () => {
        const box = $('noticias-view');
        if (!box) return;
        box.addEventListener('click', (e) => {
            const alvo = e.target.closest('[data-acao], [data-secao]');
            if (!alvo) return;
            if (alvo.dataset.secao) {
                estado.secao = alvo.dataset.secao;
                estado.busca = '';
                try { localStorage.setItem(KEY_SECAO, estado.secao); } catch { /* ignora */ }
                render();
                return;
            }
            const acao = alvo.dataset.acao;
            if (acao === 'atualizar') carregar(true);
            else if (acao === 'fontes') { estado.fontesAbertas = !estado.fontesAbertas; render(); }
            else if (acao === 'fechar-fontes') { estado.fontesAbertas = false; render(); }
            else if (acao === 'limpar-busca') { estado.busca = ''; render(); }
        });
        box.addEventListener('input', (e) => {
            if (e.target.id !== 'not-busca') return;
            estado.busca = e.target.value;
            const pos = e.target.selectionStart;
            render();
            const el = $('not-busca');
            if (el) { el.focus(); try { el.setSelectionRange(pos, pos); } catch { /* type=search em alguns navegadores */ } }
        });
        box.addEventListener('change', (e) => {
            const cb = e.target.closest('input[data-fonte]');
            if (!cb) return;
            const off = new Set(lerDesligadas());
            if (cb.checked) off.delete(cb.dataset.fonte); else off.add(cb.dataset.fonte);
            gravarDesligadas([...off]);
            render();
        });
    };

    const iniciar = () => {
        if (!temNavegador) return;
        try { estado.secao = localStorage.getItem(KEY_SECAO) || 'geral'; } catch { /* ignora */ }
        dados = lerCache();
        ligarEventos();
        render();
    };

    /* Ao abrir a aba: mostra o cache na hora e busca uma versão nova. */
    const aoAbrir = () => { render(); carregar(false); };

    if (temNavegador) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar);
        else iniciar();
    }

    return {
        filtrarPorFontes, montarGeral, itensDaSecao, buscar, tempoRelativo, ordenarPorHora,
        lerDesligadas, gravarDesligadas, urlPublicada,
        aoAbrir, render, carregar
    };
})();
