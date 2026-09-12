/* ==========================================================
   CRONOGRAMA — distribuição das pendências pela semana real
   ----------------------------------------------------------
   Substitui o gerador original (window.generateStudySchedule)
   mantendo a mesma tela: as horas por dia, o botão e a área de
   resultado. O que muda:

   - "Usar minha agenda": as horas livres de cada dia vêm do Google
     Calendar (janela 9h–22h menos as aulas), com um teto por dia.
   - Blocos de no máximo 90 min (60 min para dificuldade Alta, e
     espalhados por dias diferentes quando dá).
   - Prazo mais próximo primeiro; matéria com avaliação nos próximos
     14 dias sobe.
   - Nunca agenda depois do prazo: se não cabe, avisa quanto falta.
   - O plano vira uma semana em colunas (como a Academia), com um
     check por bloco, e fica salvo em esePlano (sincroniza).
   - "Regerar" desconta os blocos já feitos.

   Tudo de regra, sem IA, sem custo. Lógica pura no topo, testada
   em Node; desenho embaixo.
   ========================================================== */

window.Cronograma = (() => {

    const D = window.ESEDates;
    const KEY = 'esePlano';
    const BLOCO_MAX = 90;
    const BLOCO_ALTA = 60;
    const DIAS_ALCANCE = 28;            // até onde o plano olha sem prazo
    const JANELA_INICIO = 9 * 60;       // 9h
    const JANELA_FIM = 22 * 60;         // 22h
    const MAX_PADRAO_H = 4;
    const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

    const temNavegador = typeof document !== 'undefined';
    const esc = (v) => window.escapeHtml ? window.escapeHtml(v) : String(v);
    const $ = (id) => document.getElementById(id);
    const lerJSON = (k, padrao) => {
        try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? padrao : v; }
        catch { return padrao; }
    };

    /* ==================== LÓGICA PURA ==================== */

    const chaveDe = (t) => `${t.name || ''}|${t.subject || ''}|${t.deadline || ''}`;

    /* Horas livres por dia da semana (0..6) a partir dos eventos com
       horário: janela 9h–22h menos o que está ocupado, com teto. */
    const livresPelaAgenda = (eventos, inicioSemana, maxHoras) => {
        const teto = Math.max(0, Number(maxHoras) || MAX_PADRAO_H);
        const aMin = (label) => { const [h, m] = String(label).split(':').map(Number); return h * 60 + (m || 0); };
        const livres = {};
        const aulas = {};
        D.weekDays(inicioSemana).forEach((dia) => {
            const iso = D.toDateString(dia);
            let ocupado = 0;
            (eventos || []).forEach((e) => {
                if (e.date !== iso || e.allDay || !e.startLabel || !e.endLabel) return;
                const ini = Math.max(JANELA_INICIO, aMin(e.startLabel));
                const fim = Math.min(JANELA_FIM, aMin(e.endLabel));
                if (fim > ini) ocupado += fim - ini;
            });
            const livre = Math.max(0, (JANELA_FIM - JANELA_INICIO - ocupado) / 60);
            livres[String(dia.getDay())] = Math.min(teto, Math.round(livre * 2) / 2);   // meia em meia hora
            aulas[String(dia.getDay())] = Math.round(ocupado / 30) / 2;
        });
        livres.aulas = aulas;
        return livres;
    };

    /* Avaliação mais próxima por matéria (só as próximas). */
    const proximaAvaliacaoPorMateria = (avaliacoes, hojeISO) => {
        const m = {};
        (avaliacoes || []).forEach((a) => {
            const data = a.date || a.data || '';
            const mat = a.subject || a.materia || '';
            if (!mat || !data || data < hojeISO) return;
            if (!m[mat] || data < m[mat]) m[mat] = data;
        });
        return m;
    };

    /*
      tarefas:     pendências (com estimate em minutos)
      horasPorDia: { "0": 0, "1": 2, ... }
      hoje:        Date
      avaliacoes:  eseAssessments
      feitos:      blocos já feitos do plano anterior (descontam da estimativa)
      Devolve { blocos, avisos, naoCoube }.
    */
    const distribuir = ({ tarefas, horasPorDia, hoje, avaliacoes, feitos }) => {
        const hojeISO = D.toDateString(hoje);
        const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
        const provas = proximaAvaliacaoPorMateria(avaliacoes, hojeISO);
        const feitosPorChave = {};
        (feitos || []).forEach((b) => { feitosPorChave[b.chave] = (feitosPorChave[b.chave] || 0) + (Number(b.minutos) || 0); });

        const peso = { 'Alta': 3, 'Média': 2, 'Media': 2, 'Baixa': 1 };
        const fila = (tarefas || [])
            .filter((t) => !t.done)
            .map((t) => {
                const chave = chaveDe(t);
                const prova = provas[t.subject];
                const prazo = t.deadline || '';
                /* prazo efetivo: o menor entre o prazo e a véspera da prova */
                let efetivo = prazo;
                if (prova) {
                    const vespera = D.toDateString(D.addDays(D.fromDateString(prova), -1));
                    if (!efetivo || vespera < efetivo) efetivo = vespera;
                }
                return {
                    chave, nome: t.name, materia: t.subject || '', dificuldade: t.difficulty || 'Média',
                    prazo, efetivo, temProva: !!prova,
                    restante: Math.max(0, (Number(t.estimate) || 0) - (feitosPorChave[chave] || 0))
                };
            })
            .filter((t) => t.restante > 0)
            .sort((a, b) => {
                const pa = a.efetivo || '9999', pb = b.efetivo || '9999';
                if (pa !== pb) return pa < pb ? -1 : 1;
                return (peso[b.dificuldade] || 0) - (peso[a.dificuldade] || 0);
            });

        /* capacidade por data */
        const capacidade = {};
        const datas = [];
        for (let i = 0; i < DIAS_ALCANCE; i++) {
            const d = D.addDays(base, i);
            const iso = D.toDateString(d);
            datas.push(iso);
            capacidade[iso] = Math.max(0, (Number(horasPorDia[String(d.getDay())]) || 0) * 60);
        }
        /* O que já foi feito hoje (ou adiante) ocupou tempo desse dia. */
        (feitos || []).forEach((b) => {
            if (capacidade[b.data] !== undefined) capacidade[b.data] = Math.max(0, capacidade[b.data] - (Number(b.minutos) || 0));
        });

        const blocos = [];
        const naoCoube = [];

        fila.forEach((t) => {
            const limite = t.efetivo && t.efetivo < datas[datas.length - 1] ? t.efetivo : datas[datas.length - 1];
            const tamanho = t.dificuldade === 'Alta' ? BLOCO_ALTA : BLOCO_MAX;
            const diasUteis = datas.filter((iso) => iso <= limite);
            let restante = t.restante;

            /* Passada 1: um bloco por dia (espalha). Passada 2: preenche o que sobrou. */
            for (let passada = 0; passada < 2 && restante > 0; passada++) {
                for (const iso of diasUteis) {
                    if (restante <= 0) break;
                    if (capacidade[iso] <= 0) continue;
                    const alvo = passada === 0 ? Math.min(tamanho, restante) : restante;
                    let colocar = Math.min(alvo, capacidade[iso]);
                    /* na segunda passada, ainda respeita o tamanho do bloco */
                    while (colocar > 0 && restante > 0) {
                        const b = Math.min(tamanho, colocar);
                        blocos.push({ data: iso, chave: t.chave, nome: t.nome, materia: t.materia, dificuldade: t.dificuldade, minutos: b, feito: false });
                        capacidade[iso] -= b;
                        restante -= b;
                        colocar -= b;
                        if (passada === 0) break;
                    }
                }
            }

            if (restante > 0) naoCoube.push({ chave: t.chave, nome: t.nome, materia: t.materia, prazo: t.efetivo, minutos: restante, temProva: t.temProva });
        });

        blocos.sort((a, b) => a.data.localeCompare(b.data));
        const avisos = naoCoube.map((n) => {
            const quando = n.prazo ? `até ${fmtData(n.prazo)}` : 'nos próximos 28 dias';
            const h = Math.round(n.minutos / 6) / 10;
            return `Não cabe: faltam ${fmtH(h)} de “${n.nome}” ${quando}${n.temProva ? ' (prova marcada)' : ''} — libere horas ou reduza a estimativa.`;
        });
        return { blocos, avisos, naoCoube };
    };

    const fmtData = (iso) => { const d = D.fromDateString(iso); return `${d.getDate()}/${MESES[d.getMonth()]}`; };
    const fmtH = (h) => {
        const min = Math.round(h * 60);
        const hh = Math.floor(min / 60), mm = min % 60;
        if (hh === 0) return `${mm} min`;
        return mm ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`;
    };

    /* ==================== ESTADO ==================== */

    const lerPlano = () => {
        const p = lerJSON(KEY, null);
        return p && typeof p === 'object' && Array.isArray(p.blocos) ? p : { geradoEm: '', horasPorDia: null, blocos: [], avisos: [] };
    };
    const gravarPlano = (p) => localStorage.setItem(KEY, JSON.stringify(p));

    const lerHorasDaTela = () => {
        const h = {};
        for (let i = 0; i <= 6; i++) h[String(i)] = parseFloat(($(`hours-${i}`) || {}).value) || 0;
        return h;
    };

    const escreverHorasNaTela = (horas) => {
        for (let i = 0; i <= 6; i++) {
            const el = $(`hours-${i}`);
            if (el && horas && horas[String(i)] !== undefined) el.value = horas[String(i)];
        }
    };

    const gerar = () => {
        const horasPorDia = lerHorasDaTela();
        if (Object.values(horasPorDia).reduce((a, b) => a + b, 0) <= 0) {
            alert('Defina um tempo de estudo em pelo menos um dia da semana.');
            return;
        }
        const tarefas = lerJSON('eseTasks', []).filter((t) => !t.done);
        if (!tarefas.length) { alert('Não há pendências para agendar.'); return; }
        if (tarefas.some((t) => !t.estimate || t.estimate <= 0)) {
            alert('Preencha os minutos estimados de todas as pendências na lista ao lado.');
            return;
        }
        const anterior = lerPlano();
        const feitos = anterior.blocos.filter((b) => b.feito);
        const r = distribuir({
            tarefas, horasPorDia, hoje: new Date(),
            avaliacoes: lerJSON('eseAssessments', []),
            feitos
        });
        /* Os blocos já feitos continuam no plano, para o histórico da semana. */
        gravarPlano({ geradoEm: new Date().toISOString(), horasPorDia, blocos: [...feitos, ...r.blocos], avisos: r.avisos });
        estado.inicio = new Date(); estado.inicio.setHours(0, 0, 0, 0);
        render();
    };

    const atualizarTotal = () => {
        const el = $('cron-total-semana');
        if (!el) return;
        const total = Object.values(lerHorasDaTela()).reduce((a, b) => a + b, 0);
        el.textContent = total ? `· ${fmtH(total)} na semana` : '';
    };

    const usarAgenda = () => {
        const cal = window.GoogleCalendar;
        const nota = $('cron-agenda-nota');
        if (!cal || !window.GoogleAuth || !window.GoogleAuth.isConnected()) {
            if (nota) nota.textContent = 'Conecte ao Google (menu ☰) para ler a sua agenda.';
            return;
        }
        const eventos = cal.cachedEvents() || [];
        const maxEl = $('cron-max-dia');
        const livres = livresPelaAgenda(eventos, D.startOfWeek(new Date()), maxEl ? maxEl.value : MAX_PADRAO_H);
        escreverHorasNaTela(livres);
        atualizarTotal();
        if (nota) {
            const ordem = ['1', '2', '3', '4', '5', '6', '0'];
            const total = ordem.reduce((a, k) => a + (livres[k] || 0), 0);
            const aulas = ordem.map((k) => `${DIAS[Number(k)]} ${fmtH(livres.aulas[k] || 0)}`).join(' · ');
            nota.textContent = `Aulas na agenda esta semana: ${aulas}. Sobram ${fmtH(total)} para estudar (das 9h às 22h, no máximo ${maxEl ? maxEl.value : MAX_PADRAO_H}h por dia). Ajuste o que quiser.`;
        }
    };

    /* ==================== DESENHO ==================== */

    const estado = { inicio: null };

    const render = () => {
        if (!temNavegador) return;
        const box = $('ai-response-container');
        if (!box) return;
        const plano = lerPlano();
        if (!plano.blocos.length && !plano.avisos.length) { box.style.display = 'none'; return; }

        if (!estado.inicio) { estado.inicio = new Date(); estado.inicio.setHours(0, 0, 0, 0); }
        const dias = Array.from({ length: 7 }, (_, i) => D.addDays(estado.inicio, i));
        const hojeISO = D.todayString();
        const porData = {};
        plano.blocos.forEach((b, i) => { (porData[b.data] = porData[b.data] || []).push({ ...b, i }); });

        const colunas = dias.map((d) => {
            const iso = D.toDateString(d);
            const lista = porData[iso] || [];
            const total = lista.reduce((s, b) => s + b.minutos, 0);
            const feitos = lista.filter((b) => b.feito).reduce((s, b) => s + b.minutos, 0);
            const itens = lista.map((b) => `
                <button type="button" class="cron-bloco ${b.feito ? 'feito' : ''} dif-${esc((b.dificuldade || '').toLowerCase().replace('é', 'e'))}"
                        data-acao="check" data-i="${b.i}" aria-pressed="${b.feito}" title="${b.feito ? 'Desmarcar' : 'Marcar como feito'}">
                    <span class="cron-check" aria-hidden="true"></span>
                    <span class="cron-bloco-texto">
                        <span class="cron-bloco-materia">${esc(b.materia || 'Sem matéria')}</span>
                        <span class="cron-bloco-nome">${esc(b.nome)}</span>
                        <span class="cron-bloco-min">${b.minutos} min</span>
                    </span>
                </button>`).join('');
            return `
                <div class="cron-col ${iso === hojeISO ? 'is-today' : ''}">
                    <div class="cron-col-cab">
                        <span class="cron-col-dia">${DIAS[d.getDay()]}</span>
                        <span class="cron-col-data">${d.getDate()}</span>
                    </div>
                    ${itens || '<div class="cron-livre">livre</div>'}
                    ${total ? `<div class="cron-col-total">${feitos ? `${fmtH(feitos / 60)} de ` : ''}${fmtH(total / 60)}</div>` : ''}
                </div>`;
        }).join('');

        const fimJanela = D.toDateString(dias[6]);
        const depois = plano.blocos.filter((b) => b.data > fimJanela && !b.feito);
        const depoisMin = depois.reduce((s, b) => s + b.minutos, 0);
        const pendentesTotal = plano.blocos.filter((b) => !b.feito).reduce((s, b) => s + b.minutos, 0);
        const feitosTotal = plano.blocos.filter((b) => b.feito).reduce((s, b) => s + b.minutos, 0);

        box.style.display = 'block';
        box.innerHTML = `
            <div class="cron-cab">
                <div class="cron-cab-esq">
                    <h3 class="overview-heading cron-h3">Seu plano</h3>
                    <div class="cron-nav">
                        <button type="button" class="acad-seta" data-acao="antes" aria-label="Semana anterior">‹</button>
                        <span class="cron-titulo">${dias[0].getDate()} ${MESES[dias[0].getMonth()]} – ${dias[6].getDate()} ${MESES[dias[6].getMonth()]}</span>
                        <button type="button" class="acad-seta" data-acao="depois" aria-label="Próxima semana">›</button>
                    </div>
                </div>
                <div class="cron-pills">
                    <span class="cron-pill cron-pill-ok">${fmtH(feitosTotal / 60)} feitas</span>
                    <span class="cron-pill">${fmtH(pendentesTotal / 60)} a fazer</span>
                </div>
            </div>
            ${plano.avisos.map((a) => `<div class="cron-aviso">${esc(a)}</div>`).join('')}
            <div class="cron-grade">${colunas}</div>
            <div class="cron-rodape">
                <span class="cron-legenda"><i class="dif-alta"></i>Alta <i class="dif-media"></i>Média <i class="dif-baixa"></i>Baixa</span>
                ${depois.length ? `<span>Depois desta semana: ${depois.length} bloco${depois.length > 1 ? 's' : ''} (${fmtH(depoisMin / 60)}) — use ›</span>` : ''}
                <span>Marque cada bloco ao terminar; <strong>Regerar</strong> desconta o feito e redistribui o resto.</span>
            </div>
        `;

        const btn = $('cron-gerar-btn');
        if (btn) btn.textContent = plano.blocos.length ? 'Regerar cronograma' : 'Gerar cronograma das minhas pendências';
    };

    const ligar = () => {
        const box = $('ai-response-container');
        if (box) {
            box.addEventListener('click', (e) => {
                const alvo = e.target.closest('[data-acao]');
                if (!alvo) return;
                const acao = alvo.dataset.acao;
                if (acao === 'antes') { estado.inicio = D.addDays(estado.inicio, -7); render(); }
                else if (acao === 'depois') { estado.inicio = D.addDays(estado.inicio, 7); render(); }
                else if (acao === 'check') {
                    const plano = lerPlano();
                    const b = plano.blocos[Number(alvo.dataset.i)];
                    if (!b) return;
                    b.feito = !b.feito;
                    gravarPlano(plano);
                    render();
                }
            });
        }
        const agendaBtn = $('cron-usar-agenda');
        if (agendaBtn) agendaBtn.addEventListener('click', usarAgenda);

        /* Total de horas da semana, ao vivo. */
        for (let i = 0; i <= 6; i++) {
            const el = $(`hours-${i}`);
            if (el) el.addEventListener('input', atualizarTotal);
        }
        atualizarTotal();

        /* Horas guardadas do último plano voltam para a tela. */
        const plano = lerPlano();
        if (plano.horasPorDia) escreverHorasNaTela(plano.horasPorDia);

        /* Substitui o gerador original: mesmo botão, mesma tela. */
        window.generateStudySchedule = gerar;
        render();
    };

    if (temNavegador) {
        /* Depois do script.js, que define o gerador antigo. */
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar);
        else ligar();
    }

    return { distribuir, livresPelaAgenda, chaveDe, proximaAvaliacaoPorMateria, gerar, render, usarAgenda, lerPlano };
})();
