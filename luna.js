/* ==========================================================
   LUNA — o que o assistente sabe fazer com o dashboard inteiro
   ----------------------------------------------------------
   Este arquivo é a "mão" do assistente: recebe os comandos das
   regras (luna-regras.js) ou do Claude e mexe no Macros, na
   Academia, nas Compras, nas tarefas, nas avaliações e no Google
   Calendar. Também responde perguntas na hora (calorias, treino,
   agenda, lista, notícias, resumo) e monta a "foto" do dashboard
   que vai para o Claude quando ele está ligado.

   assistente.js continua cuidando do chat (voz, cartões, botões).
   ========================================================== */

window.Luna = (() => {

    const D = window.ESEDates;
    const esc = (v) => window.escapeHtml ? window.escapeHtml(v) : String(v);
    const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const NOME_REF = { cafe: 'café da manhã', almoco: 'almoço', jantar: 'jantar', lanche: 'lanche' };
    const NOME_SECAO = { geral: 'Geral', economia: 'Economia', negocios: 'Negócios', tecnologia: 'Tecnologia', geopolitica: 'Geopolítica', f1: 'Fórmula 1', esportes: 'Esportes', holanda: 'Holanda', brasil: 'Brasil', eua: 'Estados Unidos', politica: 'Política' };

    const ler = (k, padrao) => { try { return JSON.parse(localStorage.getItem(k) || 'null') ?? padrao; } catch { return padrao; } };
    const hoje = () => D.todayString();
    const amanha = () => D.toDateString(D.addDays(D.fromDateString(hoje()), 1));
    const r0 = (n) => Math.round(n || 0);
    const dataBonita = (iso) => { if (!iso) return 'sem data'; const d = D.fromDateString(iso); return `${DIAS[d.getDay()]}, ${D.dayMonth(d)}`; };

    /* ---------- leituras ---------- */

    const macros = () => (window.Macros ? window.Macros._dados() : { metas: {}, dieta: [], dias: {} });
    const totaisHoje = () => (window.Macros ? window.Macros.totais(hoje()) : { kcal: 0, p: 0, c: 0, g: 0 });
    /* { nome, exercicios } do dia da semana daquela data, ou null. */
    const treinoDe = (iso) => {
        if (!window.Academia) return null;
        const plano = (window.Academia._dados() || {}).plano || {};
        const d = plano[String(D.fromDateString(iso).getDay())];
        return d && d.nome ? { nome: d.nome, exercicios: d.exercicios || [] } : null;
    };
    const eventosDe = (iso) => (window.GoogleCalendar ? window.GoogleCalendar.eventsOn(iso) : []);
    const tarefas = () => ler('eseTasks', []);
    const avaliacoes = () => ler('eseAssessments', []);
    const noticias = () => ler('eseNoticiasCache', null);
    const listaCompras = () => {
        if (!window.Compras) return [];
        return window.Compras.montarLista(window.Compras._dados(), macros(), hoje());
    };

    /* ---------- respostas imediatas (sem Claude) ---------- */

    const respMacros = () => {
        const m = macros();
        if (!window.Macros) return 'O Macros não está carregado.';
        const t = totaisHoje();
        const falta = (k) => Math.max(0, r0((m.metas[k] || 0) - t[k]));
        const linhas = [
            `<strong>Hoje:</strong> ${r0(t.kcal)} / ${r0(m.metas.kcal)} kcal · ${r0(t.p)} / ${r0(m.metas.p)} g proteína · ${r0(t.c)} / ${r0(m.metas.c)} g carbo · ${r0(t.g)} / ${r0(m.metas.g)} g gordura`,
            `<strong>Falta:</strong> ${falta('kcal')} kcal · ${falta('p')} g proteína · ${falta('c')} g carbo · ${falta('g')} g gordura`
        ];
        /* Sugestão de regra: itens da Dieta que cabem no que falta, os mais proteicos primeiro. */
        const cabem = (m.dieta || []).filter((i) => i.kcal <= falta('kcal') + 50 && i.kcal > 0).sort((a, b) => (b.p / Math.max(1, b.kcal)) - (a.p / Math.max(1, a.kcal))).slice(0, 4);
        if (falta('kcal') > 0 && cabem.length) linhas.push(`<strong>Da sua Dieta, cabem:</strong> ${cabem.map((i) => `${esc(i.nome)} (${r0(i.kcal)} kcal, ${r0(i.p)} g P)`).join(' · ')}`);
        if (falta('kcal') === 0) linhas.push('Meta de calorias batida por hoje.');
        return linhas.join('<br>');
    };

    const respTreino = (iso) => {
        const tr = treinoDe(iso);
        const d = D.fromDateString(iso);
        if (!tr || !tr.nome) return `Sem treino marcado para ${DIAS[d.getDay()]}.`;
        const feito = window.Academia.feito(iso) ? ' <span class="assist-ok">✓ feito</span>' : '';
        const ex = (tr.exercicios || []).map((e) => `${esc(e.nome)}${e.series ? ` ${e.series}×${e.reps || '?'}` : ''}${e.kg ? ` @ ${e.kg} kg` : ''}${e.min ? ` ${e.min} min` : ''}`).join(' · ');
        return `<strong>${esc(tr.nome)}</strong> (${DIAS[d.getDay()]})${feito}<br>${ex || 'sem exercícios cadastrados'}`;
    };

    const respAgenda = (iso, semana) => {
        const dias = semana ? Array.from({ length: 7 }, (_, i) => D.toDateString(D.addDays(D.fromDateString(iso), i))) : [iso];
        const blocos = dias.map((dia) => {
            const evs = eventosDe(dia);
            const pend = tarefas().filter((t) => t.deadline === dia && !t.done);
            const avs = avaliacoes().filter((a) => a.date === dia);
            const linhas = [
                ...avs.map((a) => `📝 <strong>${esc(a.name)}</strong> · ${esc(a.subject)}`),
                ...evs.map((e) => `${e.allDay ? 'dia todo' : esc(e.startLabel)} ${esc(e.title)}${e.location ? ` <em>📍 ${esc(window.lugarCurto ? window.lugarCurto(e.location) : e.location)}</em>` : ''}`),
                ...pend.map((t) => `⏳ ${esc(t.name)} (${esc(t.subject)})`)
            ];
            const tr = treinoDe(dia);
            if (tr && tr.nome) linhas.push(`🏋️ ${esc(tr.nome)}`);
            return `<strong>${esc(dataBonita(dia))}</strong><br>${linhas.length ? linhas.join('<br>') : '<em>livre</em>'}`;
        });
        const semGoogle = !(window.GoogleAuth && window.GoogleAuth.isConnected()) && !(window.GoogleAPI && window.GoogleAPI.readCache().fetchedAt);
        return blocos.join('<br><br>') + (semGoogle ? '<br><em>(sem a agenda do Google: não está conectado)</em>' : '');
    };

    const respLista = () => {
        const grupos = listaCompras();
        const avulsos = window.Compras ? window.Compras._dados().avulsos : [];
        if (!grupos.length && !avulsos.length) return 'Lista vazia — nada para comprar por enquanto.';
        const partes = grupos.map((g) => `<strong>${esc(g.nome)}:</strong> ${g.linhas.map((l) => `${l.pacotes} × ${esc(l.produto.nome)}`).join(', ')}`);
        if (avulsos.length) partes.push(`<strong>Outros:</strong> ${avulsos.map((a) => esc(a.nome)).join(', ')}`);
        return partes.join('<br>');
    };

    const respNoticias = (secao, max) => {
        const n = noticias();
        if (!n || !window.Noticias) return 'Ainda não tenho o jornal de hoje — abra a aba Notícias uma vez.';
        const itens = window.Noticias.itensDaSecao(n, secao || 'geral', window.Noticias.lerDesligadas()).slice(0, max || 5);
        if (!itens.length) return `Nada em ${NOME_SECAO[secao] || secao} nas últimas horas.`;
        const nome = (id) => ((n.fontes || []).find((f) => f.id === id) || {}).nome || id;
        return `<strong>${esc(NOME_SECAO[secao] || 'Notícias')}</strong><br>` + itens.map((i) => `• <a href="${esc(i.link)}" target="_blank" rel="noopener">${esc(i.titulo)}</a> <em>${esc(nome(i.fonte))}</em>`).join('<br>');
    };

    const respResumo = (semana) => {
        const h = hoje();
        const em3 = D.toDateString(D.addDays(D.fromDateString(h), 3));
        const pend = tarefas().filter((t) => !t.done && t.deadline && t.deadline <= em3).sort((a, b) => a.deadline.localeCompare(b.deadline));
        const avs = avaliacoes().filter((a) => a.date >= h).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 3);
        const partes = [
            `<strong>📅 ${semana ? 'Semana' : 'Hoje'}</strong><br>${respAgenda(h, semana)}`,
            pend.length ? `<strong>⏳ Vence até ${dataBonita(em3)}</strong><br>${pend.map((t) => `${esc(t.name)} (${esc(t.subject)}) — ${dataBonita(t.deadline)}`).join('<br>')}` : '<strong>⏳ Pendências:</strong> nada vencendo nos próximos 3 dias.',
            avs.length ? `<strong>📝 Próximas avaliações</strong><br>${avs.map((a) => `${esc(a.name)} · ${esc(a.subject)} — ${dataBonita(a.date)}`).join('<br>')}` : '',
            `<strong>🍽️ Macros</strong><br>${respMacros()}`,
            window.Compras && listaCompras().length ? `<strong>🛒 Compras</strong><br>${respLista()}` : '',
            noticias() ? respNoticias('geral', 5) : ''
        ].filter(Boolean);
        return partes.join('<br><br>');
    };

    const responder = (c) => {
        switch (c.tipo) {
            case 'macros_hoje': return respMacros();
            case 'treino_hoje': return respTreino(c.amanha ? amanha() : hoje());
            case 'agenda': return respAgenda(c.amanha ? amanha() : hoje(), c.semana);
            case 'lista_compras': return respLista();
            case 'noticias': return respNoticias(c.secao, 6);
            case 'resumo': return respResumo(c.semana);
            default: return '';
        }
    };

    const ehPergunta = (c) => ['macros_hoje', 'treino_hoje', 'agenda', 'lista_compras', 'noticias', 'resumo'].includes(c && c.tipo);

    /* ---------- descrever / faltando / aplicar (ações novas) ---------- */

    const descrever = (c) => {
        switch (c.tipo) {
            case 'comida': {
                const linhas = c.itens.map((i) => i.achado
                    ? `• ${esc(i.nome)} <em>${esc(i.descricao)}</em> — ${r0(i.kcal)} kcal · ${i.p}P ${i.c}C ${i.g}G${i.origem === 'dieta' ? ' <span class="assist-selo">Dieta</span>' : ' <span class="assist-selo">tabela</span>'}`
                    : `• <s>${esc(i.texto)}</s> <em>não achei — cadastre na Dieta</em>`);
                const total = c.itens.filter((i) => i.achado).reduce((s, i) => s + i.kcal, 0);
                return `<strong>Registrar no ${esc(NOME_REF[c.refeicao] || c.refeicao)}:</strong><br>${linhas.join('<br>')}<br><span class="assist-campo">Total:</span> ${r0(total)} kcal`;
            }
            case 'compras_avulso': return `<strong>Lista de compras:</strong> adicionar “${esc(c.nome)}” em Outros.`;
            case 'compras_acabou': return `<strong>Acabou:</strong> ${esc(c.nome)} — vai para a lista de compras.`;
            case 'compras_comprei': return `<strong>Comprei:</strong> ${c.pacotes} × ${esc(c.nome)}.`;
            case 'treino_feito': return `<strong>Treino de hoje:</strong> marcar como feito.`;
            case 'evento':
                return `<strong>Google Calendar:</strong> ${esc(c.titulo)}`
                    + `<br><span class="assist-campo">Quando:</span> ${esc(dataBonita(c.data))}${c.inicio ? `, ${esc(c.inicio)}${c.fim ? `–${esc(c.fim)}` : ''}` : ' (dia todo)'}`
                    + (c.lugar ? `<br><span class="assist-campo">Onde:</span> ${esc(c.lugar)}` : '');
            default: return null;
        }
    };

    const faltando = (c) => {
        const f = [];
        if (c.tipo === 'comida' && !c.itens.some((i) => i.achado)) f.push('uma comida que eu conheça (Dieta ou tabela)');
        if (c.tipo === 'evento') { if (!c.titulo) f.push('o título'); if (!c.data) f.push('o dia'); }
        if ((c.tipo === 'compras_avulso' || c.tipo === 'compras_acabou' || c.tipo === 'compras_comprei') && !c.nome) f.push('o nome do produto');
        return f;
    };

    const acharProduto = (nome) => {
        if (!window.Compras) return null;
        const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
        const alvo = chave(nome).replace(/s\b/g, '');
        return window.Compras._dados().produtos.find((p) => { const n = chave(p.nome).replace(/s\b/g, ''); return n.includes(alvo) || alvo.includes(n.split(' ')[0]); }) || null;
    };

    const aplicar = async (c) => {
        switch (c.tipo) {
            case 'comida': {
                const M = window.Macros;
                if (!M) throw new Error('O Macros não está carregado.');
                let n = 0;
                for (const i of c.itens) {
                    if (!i.achado) continue;
                    if (i.origem === 'dieta') M.registrar(hoje(), c.refeicao, i.dietaId, i.qtd);
                    else M.registrarLivre(hoje(), c.refeicao, { nome: `${i.nome} (${i.descricao.replace(/ \(≈.*\)/, '')})`, kcal: i.kcal, p: i.p, c: i.c, g: i.g });
                    n++;
                }
                if (M.render) M.render();
                const t = totaisHoje();
                return `${n} ${n === 1 ? 'item registrado' : 'itens registrados'} no ${NOME_REF[c.refeicao]}. Hoje: ${r0(t.kcal)} kcal · ${r0(t.p)} g proteína.`;
            }
            case 'compras_avulso': {
                if (!window.Compras) throw new Error('A aba Compras não está carregada.');
                const p = acharProduto(c.nome);
                if (p) { window.Compras.responder(p.id, 'acabou'); window.Compras.render(); return `${p.nome} entrou na lista (marquei como acabado).`; }
                window.Compras.adicionarAvulso(c.nome); window.Compras.render();
                return `“${c.nome}” adicionado em Outros.`;
            }
            case 'compras_acabou': {
                if (!window.Compras) throw new Error('A aba Compras não está carregada.');
                const p = acharProduto(c.nome);
                if (!p) { window.Compras.adicionarAvulso(c.nome); window.Compras.render(); return `Não achei “${c.nome}” nos produtos; pus em Outros na lista.`; }
                window.Compras.responder(p.id, 'acabou'); window.Compras.render();
                return `${p.nome}: marcado como acabado — está na lista.`;
            }
            case 'compras_comprei': {
                if (!window.Compras) throw new Error('A aba Compras não está carregada.');
                const p = acharProduto(c.nome);
                if (!p) throw new Error(`Não achei “${c.nome}” nos seus produtos. Cadastre em Academia → Compras → Produtos.`);
                window.Compras.comprei(p.id, c.pacotes); window.Compras.render();
                return `${c.pacotes} × ${p.nome} registrado como comprado.`;
            }
            case 'treino_feito': {
                if (!window.Academia) throw new Error('A Academia não está carregada.');
                window.Academia.marcarFeito(hoje(), true);
                window.Academia.renderTudo();
                return 'Treino de hoje marcado como feito. 💪';
            }
            case 'evento': {
                if (!window.GoogleAuth || !window.GoogleAuth.isConnected()) throw new Error('Para criar no Google Calendar preciso estar conectada ao Google.');
                if (!window.GoogleCalendar.criarEvento) throw new Error('Esta versão não cria eventos.');
                await window.GoogleCalendar.criarEvento(c);
                if (window.renderCalendar) window.renderCalendar();
                if (window.onTabShown) window.onTabShown('home');
                return `Evento “${c.titulo}” criado no Google Calendar (${dataBonita(c.data)}${c.inicio ? ', ' + c.inicio : ''}).`;
            }
            default: return null;
        }
    };

    /* ---------- a "foto" do dashboard para o Claude ---------- */

    const montarEstado = () => {
        const h = hoje(), am = amanha();
        const m = macros();
        const t = totaisHoje();
        const em7 = D.toDateString(D.addDays(D.fromDateString(h), 7));
        const n = noticias();
        const agenda = (iso) => eventosDe(iso).map((e) => `${e.allDay ? 'dia todo' : e.startLabel + (e.endLabel ? '-' + e.endLabel : '')} ${e.title}${e.location ? ' @ ' + (window.lugarCurto ? window.lugarCurto(e.location) : e.location) : ''}`);
        const treino = (iso) => { const tr = treinoDe(iso); return tr && tr.nome ? { nome: tr.nome, feito: window.Academia.feito(iso), exercicios: (tr.exercicios || []).map((e) => `${e.nome}${e.series ? ` ${e.series}x${e.reps}` : ''}${e.kg ? ` ${e.kg}kg` : ''}`) } : null; };
        return {
            agora: new Date().toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
            hoje: h,
            agenda: { hoje: agenda(h), amanha: agenda(am) },
            pendencias: tarefas().filter((x) => !x.done && (!x.deadline || x.deadline <= em7)).map((x) => `${x.name} (${x.subject}) até ${x.deadline || '—'}${x.difficulty ? ', ' + x.difficulty : ''}`).slice(0, 15),
            avaliacoes: avaliacoes().filter((a) => a.date >= h).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6).map((a) => `${a.name} · ${a.subject} em ${a.date}`),
            materias: window.Desempenho && window.Desempenho.materiasConhecidas ? window.Desempenho.materiasConhecidas() : [],
            macros: { hoje: { kcal: r0(t.kcal), p: r0(t.p), c: r0(t.c), g: r0(t.g) }, metas: m.metas, refeicoesHoje: (m.dias[h] || []).map((r) => `${r.refeicao}: ${r.nome} x${r.qtd || 1} (${r0(r.kcal)} kcal)`) },
            dieta: (m.dieta || []).map((i) => `${i.nome} (${i.porcao.qtd} ${i.porcao.unidade}: ${r0(i.kcal)} kcal, ${i.p}P ${i.c}C ${i.g}G)`),
            treino: { hoje: treino(h), amanha: treino(am) },
            compras: { lista: listaCompras().map((g) => `${g.nome}: ${g.linhas.map((l) => `${l.pacotes}x ${l.produto.nome}`).join(', ')}`), outros: window.Compras ? window.Compras._dados().avulsos.map((a) => a.nome) : [] },
            noticias: n && window.Noticias ? window.Noticias.itensDaSecao(n, 'geral', window.Noticias.lerDesligadas()).slice(0, 10).map((i) => `${i.titulo} [${i.secao}] ${i.link}`) : []
        };
    };

    return { responder, ehPergunta, descrever, faltando, aplicar, montarEstado, acharProduto };
})();
