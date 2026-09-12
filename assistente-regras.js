/* ==========================================================
   ASSISTENTE — INTERPRETAÇÃO POR REGRA
   ----------------------------------------------------------
   Transforma uma frase falada em um comando estruturado, sem
   internet e sem IA. É o piso do assistente: funciona sempre,
   mesmo com o Claude fora do ar.

   Tudo aqui são funções puras (frase + contexto -> objeto),
   para poderem ser testadas sem navegador.

   Comandos devolvidos:
     { tipo: 'pendencia',    nome, materia, prazo, dificuldade, estimativa }
     { tipo: 'avaliacao',    nome, materia, data }
     { tipo: 'treino_plano', dia, treino }
     { tipo: 'treino_serie', exercicio, series, reps, kg }
     { tipo: 'tarefa',       titulo, prazo }
     { tipo: 'desconhecido', frase }
   ========================================================== */

window.AssistenteRegras = (() => {

    /* ---------- Texto ---------- */

    const semAcento = (s) => String(s || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .toLowerCase().trim();

    const limpar = (s) => String(s || '').replace(/\s+/g, ' ').trim();

    /* Tira pontuação das pontas, sem comer acento. */
    const aparar = (s) => limpar(s).replace(/^[\s,.;:!?-]+|[\s,.;:!?-]+$/g, '');

    const capitalizar = (s) => {
        const t = aparar(s);
        return t ? t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1) : '';
    };

    /* Monta um regex que casa com a palavra mesmo acentuada:
       "sabado" encontra "sábado", "dificil" encontra "difícil". */
    const MAPA_ACENTO = { a: "[aáàâã]", e: "[eéèê]", i: "[iíî]", o: "[oóòôõ]", u: "[uúû]", c: "[cç]" };

    const escaparRegex = (ch) => /[.*+?^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch;

    const reAcento = (termo, flags) => new RegExp(
        String(termo).split('').map((ch) => MAPA_ACENTO[ch] || escaparRegex(ch)).join(''),
        flags || 'i'
    );

    /* Maior pedaço de texto que duas palavras têm em comum.
       É o que deixa "estatistica" casar com "statistics". */
    const maiorTrechoComum = (a, b) => {
        let melhor = 0;
        for (let i = 0; i < a.length; i++) {
            for (let j = 0; j < b.length; j++) {
                let k = 0;
                while (i + k < a.length && j + k < b.length && a[i + k] === b[j + k]) k++;
                if (k > melhor) melhor = k;
            }
        }
        return melhor;
    };

    /* ---------- Números por extenso (os que aparecem falando) ---------- */

    const EXTENSO = {
        um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
        seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
        quinze: 15, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50,
        sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100
    };

    const numero = (txt) => {
        const t = semAcento(txt);
        if (/^\d+([.,]\d+)?$/.test(t)) return parseFloat(t.replace(',', '.'));
        return EXTENSO[t] !== undefined ? EXTENSO[t] : null;
    };

    /* ---------- Datas ---------- */

    const DIAS_SEMANA = {
        domingo: 0, segunda: 1, terca: 2, quarta: 3, quinta: 4, sexta: 5, sabado: 6
    };

    const MESES = {
        janeiro: 1, fevereiro: 2, marco: 3, abril: 4, maio: 5, junho: 6,
        julho: 7, agosto: 8, setembro: 9, outubro: 10, novembro: 11, dezembro: 12
    };

    const pad = (n) => String(n).padStart(2, '0');
    const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

    const somarDias = (base, n) => {
        const d = new Date(base.getTime());
        d.setDate(d.getDate() + n);
        return d;
    };

    /* Próxima ocorrência de um dia da semana (nunca hoje: "quarta" dita
       na quarta quer dizer a próxima). Com "semana que vem", é o dia
       dentro da próxima semana (de segunda a domingo), e não "daqui a
       pelo menos sete dias" — dita numa sexta, "semana que vem na
       quarta" é a quarta seguinte, cinco dias depois. */
    const proximoDiaSemana = (base, alvo, semanaQueVem) => {
        const hoje = base.getDay();
        if (semanaQueVem) {
            const ateSegunda = ((8 - hoje) % 7) || 7;
            return somarDias(base, ateSegunda + ((alvo + 6) % 7));
        }
        let delta = (alvo - hoje + 7) % 7;
        if (delta === 0) delta = 7;
        return somarDias(base, delta);
    };

    /* Dia N sem mês: o próximo dia N que ainda não passou. */
    const proximoDiaDoMes = (base, dia) => {
        const tentativa = new Date(base.getFullYear(), base.getMonth(), dia);
        if (tentativa >= new Date(base.getFullYear(), base.getMonth(), base.getDate())) return tentativa;
        return new Date(base.getFullYear(), base.getMonth() + 1, dia);
    };

    /* Acha uma data na frase e devolve { data, trecho } para poder
       remover o trecho do título depois. */
    const acharData = (frase, hoje) => {
        const t = semAcento(frase);
        const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());

        const achou = (data, re) => {
            /* Regex global: pode haver mais de um trecho a tirar, então
               vai o próprio regex, que o tirar() sabe aplicar. */
            if (re.global) return { data: iso(data), trecho: re };
            const m = frase.match(re);
            return { data: iso(data), trecho: m ? m[0] : '' };
        };

        if (/\bdepois de amanha\b/.test(t)) return achou(somarDias(base, 2), /depois de amanh[ãa]/i);
        if (/\bamanha\b/.test(t)) return achou(somarDias(base, 1), /amanh[ãa]/i);
        if (/\bhoje\b/.test(t)) return achou(base, /hoje/i);

        /* "em 3 dias" / "daqui a 3 dias" */
        let m = t.match(/\b(?:em|daqui a)\s+(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez)\s+dias?\b/);
        if (m) {
            const n = numero(m[1]);
            if (n) return achou(somarDias(base, n), new RegExp('(?:em|daqui a)\\s+' + m[1] + '\\s+dias?', 'i'));
        }

        /* "dia 25 de setembro" / "25 de setembro" */
        m = t.match(/\b(?:dia\s+)?(\d{1,2})\s+de\s+([a-z]+)\b/);
        if (m && MESES[m[2]]) {
            const dia = parseInt(m[1], 10);
            const mes = MESES[m[2]];
            let ano = base.getFullYear();
            let d = new Date(ano, mes - 1, dia);
            if (d < base) d = new Date(ano + 1, mes - 1, dia);
            return achou(d, new RegExp('(?:dia\\s+)?' + m[1] + '\\s+de\\s+' + m[2], 'i'));
        }

        /* "25/09" ou "25/09/2026" */
        m = t.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
        if (m) {
            const dia = parseInt(m[1], 10);
            const mes = parseInt(m[2], 10);
            let ano = m[3] ? parseInt(m[3], 10) : base.getFullYear();
            if (ano < 100) ano += 2000;
            let d = new Date(ano, mes - 1, dia);
            if (!m[3] && d < base) d = new Date(ano + 1, mes - 1, dia);
            return achou(d, new RegExp(m[1] + '\\/' + m[2] + (m[3] ? '\\/' + m[3] : '')));
        }

        /* dia da semana, com ou sem "semana que vem".
           O \b antes do artigo é essencial: sem ele, "peito segunda"
           perde o "o" de peito, porque o artigo casaria no meio da palavra. */
        const SEMANA_QUE_VEM = '(?:(?:da\\s+)?semana\\s+que\\s+vem|(?:da\\s+)?pr[oó]xima\\s+semana)';
        const semanaQueVem = /\b(?:semana que vem|proxima semana)\b/.test(t);
        for (const [nome, num] of Object.entries(DIAS_SEMANA)) {
            if (!new RegExp('\\b' + nome + '\\b').test(t)) continue;
            const d = proximoDiaSemana(base, num, semanaQueVem);
            const corpo = reAcento(nome).source;
            /* Tira o dia junto com o que o acompanha ("na próxima terça",
               "terça que vem", "quarta da semana que vem") e, à parte,
               um "semana que vem" dito em outro ponto da frase. O trecho
               vai como regex global para o tirar() remover tudo. */
            const reOriginal = new RegExp(
                '\\b(?:(?:n[ao]|[ao])\\s+)?(?:pr[oó]xim[ao]\\s+)?' + corpo +
                '(?:-feira|\\s+feira)?(?:\\s+que\\s+vem|\\s+' + SEMANA_QUE_VEM + ')?\\b' +
                '|\\b' + SEMANA_QUE_VEM + '\\b', 'gi'
            );
            return achou(d, reOriginal);
        }

        /* "dia 25" sozinho */
        m = t.match(/\bdia\s+(\d{1,2})\b/);
        if (m) {
            const dia = parseInt(m[1], 10);
            if (dia >= 1 && dia <= 31) return achou(proximoDiaDoMes(base, dia), new RegExp('dia\\s+' + m[1], 'i'));
        }

        return { data: '', trecho: '' };
    };

    /* ---------- Matérias ---------- */

    /* Casa "micro" com "Applied Microeconomics", "estat" com
       "Applied Statistics 2". Compara por pedaço de palavra. */
    const acharMateria = (frase, materias) => {
        if (!materias || !materias.length) return { materia: '', trecho: '' };
        const t = semAcento(frase);

        /* Primeiro: nome completo dito por inteiro. */
        for (const m of materias) {
            if (t.includes(semAcento(m))) return { materia: m, trecho: m };
        }

        /* Depois: cada palavra da frase contra cada palavra da matéria.
           Além do prefixo ("micro" → "microeconomics"), aceitamos um
           trecho longo em comum — é o que faz "estatística" achar
           "Statistics" e "matemática" achar "Mathematics". */
        const IGNORAR = new Set(['para', 'pra', 'com', 'dia', 'prova', 'tarefa', 'treino', 'que', 'vem', 'semana', 'feira']);
        const palavras = t.split(/[^a-z0-9]+/).filter((p) => p.length >= 3 && !IGNORAR.has(p));
        let melhor = null;

        for (const m of materias) {
            const alvo = semAcento(m).split(/[^a-z0-9]+/).filter((a) => a.length >= 3);
            for (const p of palavras) {
                for (const a of alvo) {
                    let forca = 0;
                    if (a.startsWith(p) || p.startsWith(a)) forca = Math.min(p.length, a.length);
                    else {
                        const comum = maiorTrechoComum(p, a);
                        if (comum >= 5) forca = comum;
                    }
                    if (forca && (!melhor || forca > melhor.forca)) melhor = { materia: m, trecho: p, forca };
                }
            }
        }

        return melhor ? { materia: melhor.materia, trecho: melhor.trecho } : { materia: '', trecho: '' };
    };

    /* ---------- Dificuldade ---------- */

    const acharDificuldade = (frase) => {
        const t = semAcento(frase);
        if (/\b(dificil|dificeis|pesada|pesado|alta)\b/.test(t)) return { valor: 'Alta', trecho: t.match(/dificil|dificeis|pesada|pesado|alta/)[0] };
        if (/\b(facil|faceis|leve|baixa)\b/.test(t)) return { valor: 'Baixa', trecho: t.match(/facil|faceis|leve|baixa/)[0] };
        if (/\b(media|medio|normal)\b/.test(t)) return { valor: 'Média', trecho: t.match(/media|medio|normal/)[0] };
        return { valor: '', trecho: '' };
    };

    /* ---------- Duração ---------- */

    const acharDuracao = (frase) => {
        const t = semAcento(frase);
        let m = t.match(/\b(\d+)\s*(?:h|horas?)\b/);
        if (m) return { minutos: parseInt(m[1], 10) * 60, trecho: m[0] };
        m = t.match(/\b(\d+)\s*(?:min|minutos?)\b/);
        if (m) return { minutos: parseInt(m[1], 10), trecho: m[0] };
        return { minutos: 0, trecho: '' };
    };

    /* ---------- Remoção de trechos já usados ---------- */

    /* Remove da frase os pedaços já aproveitados. Os trechos vêm em
       texto sem acento, mas a frase original é acentuada — por isso o
       regex tolerante, senão "sabado" nunca acha "sábado". */
    const tirar = (frase, ...trechos) => {
        let out = frase;
        trechos.filter(Boolean).forEach((tr) => {
            if (tr instanceof RegExp) { out = out.replace(tr, ' '); return; }
            out = out.replace(reAcento(tr), ' ');
        });
        return aparar(out.replace(/\s+/g, ' '));
    };

    /* Tira as palavras de ligação que sobram no título. */
    const PALAVRAS_SOLTAS = /\b(?:de|da|do|para|pra|pro|no|na|em|ate|at[ée]|com|a|o|e|que|tenho|preciso|adiciona(?:r)?|criar?|coloca(?:r)?|marca(?:r)?|bota(?:r)?|poe|p[õo]e|lembra(?:r)?|anota(?:r)?)\b/gi;

    const limparTitulo = (s) => aparar(aparar(s).replace(PALAVRAS_SOLTAS, ' ').replace(/\s+/g, ' '));

    /* ---------- Intenções ---------- */

    const ehPendencia = (t) => /\b(pendencia|pendencias|problem set|lista|exercicio de|trabalho|entrega|estudar|ler|resumo|relatorio|assignment)\b/.test(t);
    const ehAvaliacao = (t) => /\b(prova|provas|avaliacao|exame|teste|midterm|final)\b/.test(t);
    const ehTarefa = (t) => /\b(tarefa|lembrete|lembra de|comprar|pagar|resolver|ligar para)\b/.test(t);
    const ehTreinoPlano = (t) => /\b(treino|treinar|academia|musculacao)\b/.test(t);
    const ehSerie = (t) => /\b(fiz|registra|registrar|anota que fiz|feito)\b/.test(t) && /\d/.test(t);

    /* ---------- Interpretador ---------- */

    /*  contexto: { hoje: Date, materias: [], treinos: [], exercicios: [] } */
    const interpretar = (fraseOriginal, contexto) => {
        const ctx = contexto || {};
        const hoje = ctx.hoje || new Date();
        const materias = ctx.materias || [];
        const frase = aparar(fraseOriginal);
        const t = semAcento(frase);

        if (!frase) return { tipo: 'desconhecido', frase: '' };

        /* --- Série de academia: "fiz agachamento 3 por 10 com 40 quilos" --- */
        if (ehSerie(t)) {
            const mSerie = t.match(/(\d+)\s*(?:x|por|de)\s*(\d+)/);
            const mKg = t.match(/(?:com\s+)?(\d+(?:[.,]\d+)?)\s*(?:kg|quilos?|kilos?)/);
            let exercicio = frase;
            exercicio = exercicio.replace(/\b(fiz|registra(?:r)?|anota que fiz|feito)\b/i, ' ');
            if (mSerie) exercicio = exercicio.replace(new RegExp(mSerie[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
            if (mKg) exercicio = exercicio.replace(new RegExp(mKg[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), ' ');
            exercicio = aparar(exercicio.replace(/\b(com|de|no|na|e)\b/gi, ' ').replace(/\s+/g, ' '));

            if (exercicio) {
                return {
                    tipo: 'treino_serie',
                    exercicio: capitalizar(exercicio),
                    series: mSerie ? parseInt(mSerie[1], 10) : 3,
                    reps: mSerie ? parseInt(mSerie[2], 10) : 10,
                    kg: mKg ? parseFloat(mKg[1].replace(',', '.')) : 0
                };
            }
        }

        /* --- Plano de treino: "treino de pernas na quarta" --- */
        if (ehTreinoPlano(t) && !ehAvaliacao(t) && !ehPendencia(t)) {
            const d = acharData(frase, hoje);
            let treino = tirar(frase, d.trecho);
            treino = aparar(treino.replace(/\b(treino|treinar|academia|musculacao|de|do|da|no|na|em)\b/gi, ' ').replace(/\s+/g, ' '));

            /* Só vira comando de plano se soubermos o dia. */
            if (d.data) {
                const dia = new Date(d.data + 'T00:00:00').getDay();
                return { tipo: 'treino_plano', dia, treino: capitalizar(treino), data: d.data };
            }
        }

        /* --- Avaliação: "prova de micro dia 25" --- */
        if (ehAvaliacao(t)) {
            const d = acharData(frase, hoje);
            const mat = acharMateria(tirar(frase, d.trecho), materias);
            let nome = tirar(frase, d.trecho, mat.trecho);
            nome = aparar(nome.replace(/\b(prova|provas|avaliacao|avalia[çc][ãa]o|exame|teste)\b/gi, ' ').replace(/\s+/g, ' '));
            nome = limparTitulo(nome);

            return {
                tipo: 'avaliacao',
                nome: capitalizar(nome) || 'Prova',
                materia: mat.materia,
                data: d.data
            };
        }

        /* --- Pendência: "pendência problem set 3 de micro para sexta, difícil" --- */
        if (ehPendencia(t)) {
            const d = acharData(frase, hoje);
            const dur = acharDuracao(frase);
            const dif = acharDificuldade(tirar(frase, d.trecho, dur.trecho));
            const mat = acharMateria(tirar(frase, d.trecho, dur.trecho, dif.trecho), materias);
            let nome = tirar(frase, d.trecho, dur.trecho, dif.trecho, mat.trecho);
            nome = aparar(nome.replace(/\b(pendencia|pend[êe]ncia|pendencias)\b/gi, ' ').replace(/\s+/g, ' '));
            nome = limparTitulo(nome);

            return {
                tipo: 'pendencia',
                nome: capitalizar(nome),
                materia: mat.materia,
                prazo: d.data,
                dificuldade: dif.valor || 'Média',
                estimativa: dur.minutos
            };
        }

        /* --- Tarefa do Google: "tarefa comprar caderno amanhã" --- */
        if (ehTarefa(t)) {
            const d = acharData(frase, hoje);
            let titulo = tirar(frase, d.trecho);
            titulo = aparar(titulo.replace(/\b(tarefa|lembrete|lembra de|lembrar de)\b/gi, ' ').replace(/\s+/g, ' '));
            titulo = limparTitulo(titulo);
            return { tipo: 'tarefa', titulo: capitalizar(titulo), prazo: d.data };
        }

        return { tipo: 'desconhecido', frase };
    };

    return {
        interpretar,
        /* expostos para teste */
        acharData, acharMateria, acharDificuldade, acharDuracao,
        semAcento, numero, limparTitulo
    };
})();
