/* ==========================================================
   LUNA — as regras novas do assistente (grátis, no aparelho)
   ----------------------------------------------------------
   Entende comida, compras, agenda, treino feito e perguntas
   ("quanto falta para as calorias?", "resumo do dia"). O que
   não for disso vai para as regras antigas (assistente-regras.js):
   pendência, avaliação, plano de treino, série, tarefa.

   Só texto → objeto { tipo, ... }. Quem executa é assistente.js.
   ========================================================== */

window.LunaRegras = (() => {

    const semAcento = (s) => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
    const aparar = (s) => String(s || '').replace(/\s+/g, ' ').replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '').trim();
    const capitalizar = (s) => { const t = aparar(s); return t ? t[0].toUpperCase() + t.slice(1) : ''; };
    const pad = (n) => String(n).padStart(2, '0');

    const REFEICOES = [
        ['cafe', /\b(cafe da manha|cafe|no cafe|de manha|manha)\b/],
        ['almoco', /\b(almoco|no almoco|almocei)\b/],
        ['jantar', /\b(jantar|no jantar|jantei|janta|a noite|de noite)\b/],
        ['lanche', /\b(lanche|no lanche|lanchei|a tarde|de tarde)\b/]
    ];

    /* Sem refeição na frase, pela hora. */
    const refeicaoPelaHora = (agora) => {
        const h = agora.getHours();
        if (h < 10) return 'cafe';
        if (h < 15) return 'almoco';
        if (h < 18) return 'lanche';
        return 'jantar';
    };

    const acharRefeicao = (t) => {
        for (const [ref, re] of REFEICOES) { const m = t.match(re); if (m) return { refeicao: ref, trecho: m[0] }; }
        return { refeicao: '', trecho: '' };
    };

    /* ---------- horas: "às 15h", "15:30", "das 14 às 16", "de 9 as 10h30" ---------- */

    const hora = (h, m) => `${pad(parseInt(h, 10))}:${pad(m ? parseInt(m, 10) : 0)}`;
    const acharHoras = (t) => {
        let m = t.match(/\b(?:das?|de)\s+(\d{1,2})(?:[:h](\d{2}))?h?\s+(?:as|ate|a)\s+(\d{1,2})(?:[:h](\d{2}))?h?\b/);
        if (m) return { inicio: hora(m[1], m[2]), fim: hora(m[3], m[4]), trecho: m[0] };
        m = t.match(/\b(?:as|a partir das?|desde as?)\s+(\d{1,2})(?:[:h](\d{2}))?\s*h?(?:oras)?\b/);
        if (m) return { inicio: hora(m[1], m[2]), fim: '', trecho: m[0] };
        m = t.match(/\b(\d{1,2})[:h](\d{2})\b/);
        if (m) return { inicio: hora(m[1], m[2]), fim: '', trecho: m[0] };
        m = t.match(/\b(\d{1,2})\s*h(?:oras)?\b/);
        if (m) return { inicio: hora(m[1], 0), fim: '', trecho: m[0] };
        return { inicio: '', fim: '', trecho: '' };
    };

    const somarMinutos = (hhmm, min) => {
        const [h, m] = hhmm.split(':').map(Number);
        const total = h * 60 + m + min;
        return `${pad(Math.floor(total / 60) % 24)}:${pad(total % 60)}`;
    };

    /* ---------- intenções ---------- */

    const ehPergunta = (t) => /\?$/.test(t) || /^(quanto|quantos|quantas|qual|quais|o que|oque|que|como|tem|tenho|falta|faltam|me (mostra|diz|fala)|mostra|cade|onde)\b/.test(t);

    const interpretar = (fraseOriginal, ctx) => {
        const c = ctx || {};
        const agora = c.agora || new Date();
        const frase = aparar(fraseOriginal);
        const t = semAcento(frase);
        if (!t) return null;

        /* --- Resumo do dia --- */
        if (/\b(resumo|briefing|resumao)\b/.test(t) && /\b(dia|hoje|semana|geral|rapido|manha)\b/.test(t) || /^(resumo|briefing)$/.test(t)) {
            return { tipo: 'resumo', semana: /\bsemana\b/.test(t) };
        }

        /* --- Notícias --- */
        if (/\b(noticias?|manchetes?|jornal)\b/.test(t) && !/\b(fonte|desliga|liga)\b/.test(t)) {
            const secoes = { economia: 'economia', negocio: 'negocios', tecnologia: 'tecnologia', tech: 'tecnologia', geopolitica: 'geopolitica', mundo: 'geopolitica', 'formula': 'f1', f1: 'f1', esporte: 'esportes', futebol: 'esportes', holanda: 'holanda', brasil: 'brasil', eua: 'eua', 'estados unidos': 'eua', politica: 'politica' };
            let secao = 'geral';
            for (const [k, v] of Object.entries(secoes)) if (new RegExp('\\b' + k).test(t)) { secao = v; break; }
            return { tipo: 'noticias', secao };
        }

        /* --- Perguntas sobre macros --- */
        if (/\b(caloria|calorias|kcal|proteina|proteinas|carbo|carboidrato|carboidratos|gordura|macros?)\b/.test(t) && (ehPergunta(t) || /\b(falta|faltam|bater|fechar|resta|restam|como estou|como to)\b/.test(t))) {
            return { tipo: 'macros_hoje' };
        }

        /* --- Perguntas sobre lista de compras --- */
        if (/\b(lista de compras|lista do mercado|o que (preciso|tenho que|falta) comprar|compras)\b/.test(t) && (ehPergunta(t) || /\b(mostra|ver|qual|quais|o que)\b/.test(t))) {
            return { tipo: 'lista_compras' };
        }

        /* --- Perguntas sobre treino --- */
        if (/\b(treino|treinar|academia)\b/.test(t) && (ehPergunta(t) || /\b(qual|o que|de hoje|de amanha)\b/.test(t)) && !/\b(fiz|feito|marca|coloca|adiciona)\b/.test(t)) {
            return { tipo: 'treino_hoje', amanha: /\bamanha\b/.test(t) };
        }

        /* --- Perguntas sobre a agenda / o dia --- */
        if (/\b(agenda|compromissos?|aulas?|o que (tenho|tem|eu tenho)|tenho (aula|alguma coisa|algo)|programacao)\b/.test(t) && (ehPergunta(t) || /\b(hoje|amanha|semana)\b/.test(t)) && !/\b(marca|agenda[r]? (um|uma)|coloca|adiciona|cria)\b/.test(t)) {
            return { tipo: 'agenda', amanha: /\bamanha\b/.test(t), semana: /\bsemana\b/.test(t) };
        }

        /* --- Treino feito --- */
        if (/\b(treino|academia)\b/.test(t) && /\b(feito|fiz|concluido|terminei|acabei|pronto)\b/.test(t) && !/\d/.test(t)) {
            return { tipo: 'treino_feito', amanha: false };
        }

        /* --- Compras: acabou / comprei / adiciona na lista --- */
        /* semAcento não muda o tamanho do texto: dá para pegar o trecho original (com acento) pela posição. */
        const original = (trecho) => { const i = t.indexOf(trecho); return i >= 0 ? frase.substr(i, trecho.length) : trecho; };
        let m = t.match(/^(?:acabou|acabaram|nao tem mais|ta acabando|esta acabando|acabando)\s+(?:(?:o|a|os|as)\s+)?(.+)$/);
        if (m) return { tipo: 'compras_acabou', nome: capitalizar(original(m[1])) };
        m = t.match(/^comprei\s+(?:(\d+)\s+)?(?:(?:o|a|os|as|um|uma)\s+)?(.+)$/);
        if (m) return { tipo: 'compras_comprei', nome: capitalizar(original(m[2])), pacotes: m[1] ? parseInt(m[1], 10) : 1 };
        m = t.match(/^(?:adiciona|adicionar|poe|põe|bota|coloca|coloque|inclui|anota)\s+(?:(?:o|a|os|as|um|uma)\s+)?(.+?)\s+(?:na|a|para a|pra)\s+lista(?:\s+de\s+compras| do mercado)?$/) || t.match(/^lista(?:\s+de\s+compras)?:?\s+(.+)$/);
        if (m) return { tipo: 'compras_avulso', nome: capitalizar(original(m[1])) };

        /* --- Comida: "comi 50 g de arroz, feijão e 3 ovos no almoço" --- */
        m = t.match(/^(?:comi|almocei|jantei|lanchei|tomei|bebi|registra que comi|anota que comi|comer|registra)\s+(.+)$/);
        if (m && window.AlimentosRegras) {
            const ref = acharRefeicao(t);
            const refeicao = ref.refeicao || (/^almocei/.test(t) ? 'almoco' : /^jantei/.test(t) ? 'jantar' : /^lanchei/.test(t) ? 'lanche' : refeicaoPelaHora(agora));
            let corpo = aparar(fraseOriginal).replace(/^(comi|almocei|jantei|lanchei|tomei|bebi|registra que comi|anota que comi|comer|registra)\s+/i, '');
            if (ref.trecho) corpo = corpo.replace(new RegExp('\\b(?:no|na|de|a)?\\s*' + ref.trecho.replace(/[aeiou]/g, (v) => ({ a: '[aáàâã]', e: '[eéèê]', i: '[iíî]', o: '[oóòôõ]', u: '[uúû]' })[v]) + '\\b', 'i'), ' ');
            const partes = corpo.split(/\s*,\s*|\s+e\s+(?!\d+\s*(?:g|ml)\b)|\s+mais\s+/i).map(aparar).filter(Boolean);
            const itens = partes.map((parte) => {
                const daDieta = acharNaDieta(parte, c.dieta || []);
                if (daDieta) return daDieta;
                const r = window.AlimentosRegras.interpretarComida(parte, c.tabela || (window.TabelaAlimentos && window.TabelaAlimentos.itens) || []);
                const cand = r.candidatos[0];
                if (!cand) return { texto: parte, achado: false };
                return { texto: parte, achado: true, origem: 'tabela', nome: nomeCurto(cand.nome), descricao: cand.descricao, kcal: cand.kcal, p: cand.p, c: cand.c, g: cand.g };
            });
            return { tipo: 'comida', refeicao, itens };
        }

        /* --- Evento no Google Calendar: "marca reunião com o João amanhã às 15h no Polak" --- */
        if (/\b(marca|marcar|agenda|agendar|coloca|colocar|poe|põe|bota|cria|criar|adiciona)\b/.test(t) && /\b(calendario|agenda|evento|reuniao|compromisso|consulta|encontro|aula|as \d|\d{1,2}h|\d{1,2}:\d{2})\b/.test(t) && !/\b(prova|avaliacao|exame|pendencia|tarefa|treino|lista)\b/.test(t)) {
            const R = window.AssistenteRegras;
            const d = R ? R.acharData(frase, agora) : { data: '', trecho: '' };
            const hs = acharHoras(t);
            let titulo = frase;
            if (d.trecho) titulo = d.trecho instanceof RegExp ? titulo.replace(d.trecho, ' ') : titulo.replace(new RegExp(d.trecho.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
            if (hs.trecho) titulo = titulo.replace(new RegExp(hs.trecho.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/as/, '[àa]s'), 'i'), ' ');
            let lugar = '';
            const ml = titulo.match(/\b(?:no|na|em)\s+(polak|sanders|mandeville|theil|tinbergen|langeveld|hatta|van der goot|casa|campus|eur|imber|biblioteca|[A-Z][\w-]+(?:\s+[\w-]+)?)\s*$/i);
            if (ml) { lugar = ml[1]; titulo = titulo.slice(0, ml.index); }
            titulo = aparar(titulo.replace(/(?<![\p{L}\d])(marca|marcar|agenda|agendar|coloca|colocar|poe|põe|bota|cria|criar|adiciona|adicionar|no calend[aá]rio|na agenda|um evento|uma reuni[aã]o|evento|compromisso|no google|para|pra|as|às|de|do|da|em|o|a|um|uma)(?![\p{L}\d])/giu, ' ').replace(/\s+/g, ' '));
            return {
                tipo: 'evento',
                titulo: capitalizar(titulo) || 'Compromisso',
                data: d.data,
                inicio: hs.inicio,
                fim: hs.fim || (hs.inicio ? somarMinutos(hs.inicio, 60) : ''),
                lugar: capitalizar(lugar)
            };
        }

        return null;
    };

    /* ---------- comida: casar com a Dieta dela ---------- */

    /* "2 ovos" / "50 g de arroz" / "aveia" contra os itens da Dieta. Devolve
       { origem:'dieta', dietaId, nome, qtd (porções), kcal... } ou null. */
    const acharNaDieta = (parte, dieta) => {
        if (!dieta || !dieta.length || !window.AlimentosRegras) return null;
        const sep = window.AlimentosRegras.separar(parte);
        const termo = semAcento(sep.termo || parte);
        if (!termo) return null;
        const palavras = termo.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
        let melhor = null, pontos = 0;
        for (const item of dieta) {
            const nome = semAcento(item.nome);
            const np = nome.split(/[^a-z0-9]+/).filter((w) => w.length >= 3);
            let n = 0;
            for (const w of palavras) if (np.some((x) => x === w || x.startsWith(w) || w.startsWith(x) || (w.length > 4 && x.startsWith(w.slice(0, -1))))) n++;
            if (n > pontos || (n === pontos && n > 0 && nome.length < semAcento(melhor.nome).length)) { pontos = n; melhor = item; }
        }
        if (!melhor || !pontos) return null;
        /* Quantidade: em g/ml → porções = qtd / porção; em unidades → qtd porções; nada → 1 */
        const un = semAcento(melhor.porcao && melhor.porcao.unidade || 'porcao');
        let porcoes = 1;
        if (sep.qtd !== null && sep.qtd !== undefined) {
            if ((sep.unidade === 'g' || sep.unidade === 'ml') && (un === 'g' || un === 'ml')) porcoes = sep.qtd / (melhor.porcao.qtd || 1);
            else porcoes = sep.qtd;
        }
        porcoes = Math.round(porcoes * 100) / 100;
        return {
            texto: parte, achado: true, origem: 'dieta', dietaId: melhor.id, nome: melhor.nome, qtd: porcoes,
            descricao: `${porcoes} × ${melhor.porcao.qtd} ${melhor.porcao.unidade}`,
            kcal: Math.round(melhor.kcal * porcoes), p: Math.round(melhor.p * porcoes * 10) / 10, c: Math.round(melhor.c * porcoes * 10) / 10, g: Math.round(melhor.g * porcoes * 10) / 10
        };
    };

    const nomeCurto = (nomeTaco) => {
        const partes = String(nomeTaco).split(',').map((p) => p.trim()).filter(Boolean);
        if (partes.length <= 2) return partes.join(' ');
        const ultimo = partes[partes.length - 1];
        return /cozid|frit|grelhad|assad|cru|integral|desnatad|natural/.test(ultimo.toLowerCase()) ? `${partes[0]} ${ultimo}` : partes[0];
    };

    /* Frase que pede conversa/conselho, não comando: vai para o Claude se ele estiver ligado. */
    const pareceConversa = (fraseOriginal) => {
        const t = semAcento(aparar(fraseOriginal));
        return /\?$/.test(t) || /^(o que|oque|como|qual|quais|por que|porque|me ajuda|me da|sugere|sugira|reorganiza|reorganize|planeja|planeje|monta|monte|ideia|ideias|dica|dicas|opcoes|opções|explica|analisa|avalia|acha que|devo|deveria|vale a pena|e melhor|é melhor)\b/.test(t);
    };

    return { interpretar, acharHoras, acharRefeicao, acharNaDieta, pareceConversa, refeicaoPelaHora };
})();
