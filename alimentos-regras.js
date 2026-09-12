/* ==========================================================
   ALIMENTOS — entender "2 ovos mexidos" sem IA
   ----------------------------------------------------------
   Pega uma frase, separa quantidade + medida + comida, acha a
   comida na tabela TACO (alimentos.js) e devolve os números da
   porção. Tudo regra, no navegador, zero custo.

   interpretarComida("150 g de frango grelhado") ->
     { qtd: 150, unidade: "g", gramas: 150, termo: "frango grelhado",
       candidatos: [ { nome, gramas, kcal, p, c, g, descricao }, ... ] }

   As porções caseiras são aproximações (1 ovo ≈ 50 g, 1 fatia de
   pão ≈ 25 g). A tabela é genérica: para produto de marca, o código
   de barras continua sendo o caminho.
   ========================================================== */

window.AlimentosRegras = (() => {

    const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const r1 = (n) => Math.round(n * 10) / 10;

    /* ---------- Números por extenso ---------- */
    const EXTENSO = { um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, meio: 0.5, meia: 0.5 };

    /* ---------- Medidas caseiras (gramas) ---------- */
    /* Peso de UMA unidade, por palavra-chave da comida. */
    const PESO_UNIDADE = [
        ['ovo', 50], ['banana', 90], ['maca', 130], ['laranja', 150], ['pera', 150], ['tangerina', 100],
        ['mexerica', 100], ['manga', 300], ['kiwi', 80], ['morango', 15], ['uva', 5], ['abacate', 400],
        ['pao de queijo', 30], ['pao frances', 50], ['pao', 50], ['biscoito', 8], ['bolacha', 8],
        ['batata', 90], ['tomate', 100], ['cenoura', 80], ['cebola', 100], ['pepino', 150],
        ['coxa', 100], ['sobrecoxa', 120], ['file', 100], ['bife', 100], ['hamburguer', 90],
        ['salsicha', 45], ['linguica', 80], ['iogurte', 170], ['queijo', 30], ['croissant', 60],
        ['castanha', 6], ['amendoim', 1], ['nozes', 5], ['tapioca', 80], ['pastel', 80], ['coxinha', 80],
        ['pizza', 100], ['sanduiche', 150], ['barra', 25], ['barrinha', 25]
    ];

    /* Peso de uma fatia / colher / etc., por palavra-chave (ou padrão). */
    const MEDIDAS = {
        fatia:   { padrao: 25, por: [['queijo', 20], ['presunto', 15], ['peru', 15], ['mortadela', 15], ['bolo', 60], ['pizza', 100], ['melancia', 200], ['abacaxi', 80], ['mamao', 100], ['tomate', 15], ['pao', 25]] },
        colher:  { padrao: 15, por: [['arroz', 25], ['feijao', 20], ['aveia', 10], ['azeite', 12], ['oleo', 12], ['acucar', 12], ['manteiga', 12], ['requeijao', 15], ['mel', 15], ['granola', 10], ['farinha', 10], ['whey', 15], ['pasta', 15], ['creme', 15], ['macarrao', 30], ['pure', 30], ['farofa', 20]] },
        cha:     { padrao: 5, por: [] },
        xicara:  { padrao: 120, por: [['arroz', 160], ['aveia', 80], ['leite', 200], ['cafe', 100], ['feijao', 170], ['macarrao', 140], ['granola', 100], ['suco', 200]] },
        copo:    { padrao: 200, por: [] },
        concha:  { padrao: 80, por: [] },
        punhado: { padrao: 30, por: [] },
        pedaco:  { padrao: 50, por: [] },
        porcao:  { padrao: 100, por: [] },
        prato:   { padrao: 300, por: [] },
        lata:    { padrao: 350, por: [] },
        garrafa: { padrao: 500, por: [] },
        pote:    { padrao: 170, por: [] },
        pacote:  { padrao: 100, por: [] },
        unidade: { padrao: 50, por: PESO_UNIDADE }
    };

    const UNIDADES = [
        [/\b(g|gr|gramas?)\b/, 'g'], [/\bkg\b/, 'kg'], [/\bml\b/, 'ml'], [/\b(l|litros?)\b/, 'l'],
        [/\bfatias?\b/, 'fatia'], [/\bcolher(?:es)?\s+de\s+cha\b/, 'cha'], [/\bcolher(?:es)?(?:\s+de\s+sopa)?\b/, 'colher'],
        [/\bxicaras?\b/, 'xicara'], [/\bcopos?\b/, 'copo'], [/\bconchas?\b/, 'concha'], [/\bpunhados?\b/, 'punhado'],
        [/\bpedacos?\b/, 'pedaco'], [/\bporc(?:ao|oes)\b/, 'porcao'], [/\bpratos?\b/, 'prato'], [/\blatas?\b/, 'lata'],
        [/\bgarrafas?\b/, 'garrafa'], [/\bpotes?\b/, 'pote'], [/\bpacotes?\b/, 'pacote'], [/\bunidades?\b/, 'unidade']
    ];

    const pesoDe = (medida, termo) => {
        const m = MEDIDAS[medida];
        if (!m) return 100;
        const t = semAcento(termo);
        for (const [chave, g] of m.por) if (t.includes(chave)) return g;
        return m.padrao;
    };

    /* ---------- Sinônimos (como a gente fala → como a TACO escreve) ---------- */
    const SINONIMOS = [
        [/\bmexid[oa]s?\b/, 'frito'], [/\bgrelhad[oa]s?\b/, 'grelhado'], [/\bcozid[oa]s?\b/, 'cozido'],
        [/\bfrit[oa]s?\b/, 'frito'], [/\bassad[oa]s?\b/, 'assado'], [/\bcr[ua]s?\b/, 'cru'],
        [/\bfrango\b/, 'frango'], [/\bpeito de frango\b/, 'frango peito'], [/\bcarne moida\b/, 'carne bovina acem moido cozido'],
        [/\bpao integral\b/, 'pao trigo forma integral'], [/\bpao de forma\b/, 'pao trigo forma'],
        [/\bpao frances\b/, 'pao trigo frances'], [/\bpaozinho\b/, 'pao trigo frances'],
        [/\bfeijao\b/, 'feijao'], [/\bbatata doce\b/, 'batata doce'], [/\bbatata inglesa\b/, 'batata inglesa'],
        [/\bwhey\b/, 'whey'], [/\biogurte natural\b/, 'iogurte natural'], [/\bleite desnatado\b/, 'leite vaca desnatado'],
        [/\bleite\b(?! de)/, 'leite vaca'], [/\bmaca\b/, 'maca'], [/\bsalmao\b/, 'salmao'], [/\batum\b/, 'atum'],
        [/\bcafe\b/, 'cafe infusao'], [/\bazeite\b/, 'azeite oliva'], [/\bqueijo branco\b/, 'queijo minas frescal'],
        [/\bmussarela\b/, 'queijo mozarela'], [/\bpresunto\b/, 'presunto'], [/\bpeito de peru\b/, 'peru peito']
    ];

    /* Comidas comuns que a TACO não tem — valores típicos de rótulo, por 100 g. */
    const EXTRAS = [
        ['Whey protein, pó', 8, 400, 80.0, 8.0, 6.0],
        ['Pasta de amendoim', 8, 600, 25.0, 20.0, 50.0],
        ['Granola', 8, 450, 10.0, 65.0, 15.0],
        ['Macarrão, trigo, cozido', 3, 158, 5.8, 30.9, 0.9],
        ['Leite, de vaca, integral', 7, 61, 3.2, 4.7, 3.3],
        ['Leite, de vaca, desnatado', 7, 35, 3.4, 5.0, 0.2],
        ['Peito de peru, fatiado', 2, 110, 19.0, 2.0, 2.5],
        ['Barrinha de cereal', 8, 380, 5.0, 70.0, 9.0],
        ['Chia, semente', 9, 486, 16.5, 42.1, 30.7],
        ['Quinoa, cozida', 3, 120, 4.4, 21.3, 1.9],
        ['Hummus', 6, 170, 8.0, 14.0, 10.0],
        ['Wrap / tortilha de trigo', 3, 310, 8.0, 52.0, 8.0],
        ['Sushi (peça)', 0, 150, 6.0, 28.0, 1.5],
        ['Açaí, polpa com guaraná', 4, 110, 1.0, 22.0, 2.0]
    ];

    /* Para palavras soltas, qual item da tabela é "o" item. */
    const PREFERIDOS = [
        ['carne', 'patinho, sem gordura, grelhado'], ['bife', 'contra-filé, sem gordura, grelhado'],
        ['leite', 'leite, de vaca, integral'], ['pao', 'pão, trigo, francês'], ['batata', 'batata, inglesa, cozida'],
        ['frango', 'frango, peito, sem pele, grelhado'], ['macarrao', 'macarrão, trigo, cozido'],
        ['ovo', 'ovo, de galinha, inteiro, cozido'], ['arroz', 'arroz, tipo 1, cozido'], ['feijao', 'feijão, carioca, cozido'],
        ['queijo', 'queijo, minas, frescal'], ['iogurte', 'iogurte, natural'], ['peixe', 'tilápia'], ['tomate', 'tomate, com semente, cru'],
        ['alface', 'alface, crespa'], ['banana', 'banana, prata'], ['maca', 'maçã, fuji'], ['laranja', 'laranja, pera'],
        ['cafe', 'café, infusão'], ['suco', 'suco de laranja'], ['aveia', 'aveia, flocos'], ['amendoim', 'amendoim, torrado']
    ];

    /* Palavras que não ajudam a achar a comida. */
    const IGNORAR = new Set(['de', 'do', 'da', 'com', 'e', 'um', 'uma', 'o', 'a', 'no', 'na', 'em', 'comi', 'comer', 'almocei', 'jantei', 'tomei', 'bebi']);

    /* singular tosco: "ovos" -> "ovo", "fatias" -> "fatia" */
    const singular = (p) => p.length > 3 && p.endsWith('s') ? p.slice(0, -1) : p;

    /* ---------- Quantidade + medida + termo ---------- */
    const separar = (frase) => {
        let t = semAcento(frase).replace(/[,;]/g, ' ').replace(/\s+/g, ' ').trim();
        let qtd = null;
        /* "2", "1,5", "meia", "duas" no começo (ou "150g")... */
        let m = t.match(/^(\d+(?:[.,]\d+)?)\s*/);
        if (m) { qtd = parseFloat(m[1].replace(',', '.')); t = t.slice(m[0].length); }
        else {
            m = t.match(/^(\w+)\s+/);
            if (m && EXTENSO[m[1]] !== undefined) { qtd = EXTENSO[m[1]]; t = t.slice(m[0].length); }
        }
        /* "1/2" */
        m = t.match(/^(\d)\/(\d)\s*/);
        if (m) { qtd = (qtd || 0) + parseInt(m[1], 10) / parseInt(m[2], 10); t = t.slice(m[0].length); }

        let unidade = '';
        for (const [re, u] of UNIDADES) {
            const mm = t.match(re);
            if (mm && t.indexOf(mm[0]) <= 1) { unidade = u; t = t.replace(mm[0], ' '); break; }
        }
        t = t.replace(/^\s*(de|da|do)\s+/, '').trim();
        return { qtd, unidade, termo: t };
    };

    /* ---------- Procurar na tabela ---------- */
    const buscar = (termo, tabela, limite) => {
        tabela = tabela.concat(EXTRAS);
        let t = semAcento(termo);
        /* A palavra que a pessoa disse, antes dos sinônimos ("leite", não "leite vaca") */
        const ditas = t.split(/[^a-z0-9]+/).map(singular).filter((p) => p.length >= 2 && !IGNORAR.has(p));
        SINONIMOS.forEach(([re, sub]) => { t = t.replace(re, sub); });
        const palavras = t.split(/[^a-z0-9]+/).map(singular).filter((p) => p.length >= 2 && !IGNORAR.has(p));
        if (!palavras.length) return [];
        const pontuados = [];
        for (const item of tabela) {
            const nome = semAcento(item[0]);
            const partes = nome.split(/[^a-z0-9]+/).map(singular).filter(Boolean);
            let pontos = 0, achou = 0;
            palavras.forEach((p, idx) => {
                let melhor = 0;
                partes.forEach((n, j) => {
                    let v = 0;
                    if (n === p) v = 10;
                    else if (n.startsWith(p) && p.length >= 3) v = 6;
                    else if (p.startsWith(n) && n.length >= 4) v = 5;
                    if (v && j === 0 && idx === 0) v += 4;      // a primeira palavra bate com o nome principal
                    if (v > melhor) melhor = v;
                });
                if (melhor) achou++;
                pontos += melhor;
            });
            if (!achou) continue;
            if (achou < palavras.length && palavras.length > 1) pontos -= 3 * (palavras.length - achou);
            const categoria = item[1];
            const naturalmenteCru = categoria === 4 || categoria === 9;   // frutas e nozes se comem cruas
            const disseComoPreparou = palavras.some((p) => ['cru', 'cozido', 'frito', 'grelhado', 'assado'].includes(p));
            if (!naturalmenteCru && !disseComoPreparou) {
                if (/\bcru/.test(nome)) pontos -= categoria === 14 ? 1 : 4;   // preferimos o preparado (verduras: só um pouco)
                if (/\bcozid/.test(nome)) pontos += 3;                        // ...e o cozido simples
            }
            /* "tomate" é o tomate, não o purê; "uva" é a uva, não o suco. */
            if (ditas.length === 1 && /\b(pure|extrato|molho|suco|doce|geleia|farinha|polpa|conserva|achocolatado)\b/.test(nome)) pontos -= 3;
            if (categoria === 0 && achou < 2) pontos -= 5;         // "arroz carreteiro" só se a pessoa disser mais que "arroz"
            if (/tipo 1|branc/.test(nome)) pontos += 1;            // o básico antes das variações
            /* "frango" -> peito grelhado; "frango grelhado" também puxa para o peito */
            const pref = PREFERIDOS.find(([chave]) => chave === ditas[0]);
            if (pref && nome.includes(semAcento(pref[1]))) pontos += ditas.length === 1 ? 8 : 4;
            if (pref && ditas.length > 1 && nome.includes(semAcento(pref[1]).split(',')[1] || '\u0000')) pontos += 2;
            pontos -= partes.length * 0.3;                          // nomes mais curtos primeiro
            pontuados.push({ item, pontos });
        }
        pontuados.sort((a, b) => b.pontos - a.pontos);
        return pontuados.slice(0, limite || 5).map((x) => x.item);
    };

    /* ---------- Tudo junto ---------- */
    const interpretarComida = (frase, tabela) => {
        const { qtd, unidade, termo } = separar(frase);
        if (!termo) return { qtd, unidade, gramas: 0, termo: '', candidatos: [] };
        const itens = buscar(termo, tabela, 5);
        const candidatos = itens.map((it) => {
            const [nome, , kcal100, p100, c100, g100] = it;
            let gramas, descricao;
            const n = qtd === null ? 1 : qtd;
            if (unidade === 'g' || unidade === 'ml') { gramas = n; descricao = `${n} ${unidade}`; }
            else if (unidade === 'kg' || unidade === 'l') { gramas = n * 1000; descricao = `${n} ${unidade}`; }
            else if (unidade) { const g = pesoDe(unidade, nome + ' ' + termo); gramas = n * g; descricao = `${n} ${unidade}${n !== 1 ? 's' : ''} (≈ ${Math.round(gramas)} g)`; }
            else if (qtd !== null && qtd >= 20) { gramas = qtd; descricao = `${qtd} g`; }
            else {
                const temUnidade = PESO_UNIDADE.some(([k]) => semAcento(nome + ' ' + termo).includes(k));
                if (temUnidade) { const g = pesoDe('unidade', nome + ' ' + termo); gramas = n * g; descricao = `${n} unidade${n !== 1 ? 's' : ''} (≈ ${Math.round(gramas)} g)`; }
                else { gramas = 100 * n; descricao = `${Math.round(gramas)} g`; }
            }
            const f = gramas / 100;
            return { nome, gramas: Math.round(gramas), descricao, kcal: Math.round(kcal100 * f), p: r1(p100 * f), c: r1(c100 * f), g: r1(g100 * f) };
        });
        return { qtd, unidade, gramas: candidatos.length ? candidatos[0].gramas : 0, termo, candidatos };
    };

    return { interpretarComida, separar, buscar, pesoDe };
})();
