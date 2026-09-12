/* ==========================================================
   DESEMPENHO — o que os números dizem
   ----------------------------------------------------------
   Complementa o gráfico de horas por semana com:
     - meta da semana (editável) e comparação com a anterior
     - horas por matéria (o Timer passa a saber o que você estuda)
     - sequência de dias estudando
     - pendências da semana: no prazo × atrasadas × abertas

   Tudo de regra, no navegador, sem custo.

   Dados que usa:
     eseStudyHistory[dia] = { study, pause, porMateria: { "Micro": seg } }
     eseMetas             = { horasSemana: 15 }
     eseTasks             = [{ name, subject, deadline, done, doneAt }]

   A lógica é pura (calcular) e o desenho fica separado (render),
   para a lógica ser testada em Node.
   ========================================================== */

window.Desempenho = (() => {

    const D = window.ESEDates;
    const MIN_DIA_CONTA = 25 * 60;     // 25 min = "estudei hoje"
    const META_PADRAO = 15;

    const temNavegador = typeof document !== 'undefined';
    const esc = (v) => window.escapeHtml ? window.escapeHtml(v) : String(v);
    const $ = (id) => document.getElementById(id);

    const lerJSON = (k, padrao) => {
        try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v === null ? padrao : v; }
        catch { return padrao; }
    };

    /* ==================== LÓGICA PURA ==================== */

    const segundosNoDia = (historico, iso) => Number((historico[iso] || {}).study) || 0;

    const somaSemana = (historico, inicio) =>
        D.weekDays(inicio).reduce((s, d) => s + segundosNoDia(historico, D.toDateString(d)), 0);

    const porMateriaSemana = (historico, inicio) => {
        const soma = {};
        D.weekDays(inicio).forEach((d) => {
            const pm = (historico[D.toDateString(d)] || {}).porMateria || {};
            Object.entries(pm).forEach(([m, seg]) => { soma[m] = (soma[m] || 0) + (Number(seg) || 0); });
        });
        return Object.entries(soma)
            .filter(([, seg]) => seg > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([materia, segundos]) => ({ materia, segundos }));
    };

    /* Dias seguidos com pelo menos 25 min, terminando hoje (ou ontem,
       se hoje ainda não estudou — a sequência não quebra antes da meia-noite). */
    const sequencia = (historico, hoje) => {
        let dia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
        if (segundosNoDia(historico, D.toDateString(dia)) < MIN_DIA_CONTA) dia = D.addDays(dia, -1);
        let n = 0;
        while (n < 3660 && segundosNoDia(historico, D.toDateString(dia)) >= MIN_DIA_CONTA) {
            n++;
            dia = D.addDays(dia, -1);
        }
        return n;
    };

    /* Pendências cujo prazo cai na semana, ou concluídas nela. */
    const pendenciasDaSemana = (tarefas, inicio, hoje) => {
        const dias = D.weekDays(inicio).map(D.toDateString);
        const primeiro = dias[0], ultimo = dias[6];
        const hojeISO = D.toDateString(hoje);
        const r = { noPrazo: 0, atrasadas: 0, abertas: 0, vencidas: 0 };
        (tarefas || []).forEach((t) => {
            const prazo = t.deadline || '';
            const feitaEm = t.done ? (t.doneAt || '') : '';
            const prazoNaSemana = prazo >= primeiro && prazo <= ultimo;
            const feitaNaSemana = feitaEm >= primeiro && feitaEm <= ultimo;
            if (t.done) {
                if (!feitaEm) { if (prazoNaSemana) r.noPrazo++; return; }   // sem data: conta como no prazo
                if (!feitaNaSemana && !prazoNaSemana) return;
                if (!prazo || feitaEm <= prazo) r.noPrazo++; else r.atrasadas++;
            } else if (prazoNaSemana) {
                if (prazo < hojeISO) r.vencidas++; else r.abertas++;
            }
        });
        return r;
    };

    const calcular = ({ historico, tarefas, metaHoras, inicio, hoje }) => {
        const atual = somaSemana(historico, inicio);
        const anterior = somaSemana(historico, D.addDays(inicio, -7));
        return {
            horas: atual / 3600,
            horasAnterior: anterior / 3600,
            meta: metaHoras,
            progresso: metaHoras > 0 ? Math.min(1, atual / 3600 / metaHoras) : 0,
            porMateria: porMateriaSemana(historico, inicio),
            sequencia: sequencia(historico, hoje),
            pendencias: pendenciasDaSemana(tarefas, inicio, hoje)
        };
    };

    /* ==================== REGISTRO ==================== */

    /* Chamado pelo Timer a cada tick com estudo. Acumula em memória e
       grava de minuto em minuto: gravar a cada segundo faria a
       sincronização com o Drive ficar eternamente "a enviar". */
    const acumulado = {};
    let gravarAgendado = null;

    const gravarAcumulado = () => {
        gravarAgendado = null;
        const nomes = Object.keys(acumulado);
        if (!nomes.length) return;
        const hist = lerJSON('eseStudyHistory', {});
        const k = D.todayString();
        const dia = hist[k] && typeof hist[k] === 'object' ? hist[k] : { study: 0, pause: 0 };
        dia.porMateria = dia.porMateria || {};
        nomes.forEach((nome) => {
            dia.porMateria[nome] = (Number(dia.porMateria[nome]) || 0) + acumulado[nome];
            delete acumulado[nome];
        });
        hist[k] = dia;
        localStorage.setItem('eseStudyHistory', JSON.stringify(hist));
    };

    const registrar = (segundos, materia, agora) => {
        if (!segundos || segundos <= 0) return;
        const nome = String(materia || '').trim();
        if (!nome) return;
        acumulado[nome] = (acumulado[nome] || 0) + segundos;
        if (agora || typeof setTimeout === 'undefined') { gravarAcumulado(); return; }
        if (!gravarAgendado) gravarAgendado = setTimeout(gravarAcumulado, 60 * 1000);
    };

    const lerMeta = () => {
        const m = lerJSON('eseMetas', {});
        const h = Number(m.horasSemana);
        return h > 0 ? h : META_PADRAO;
    };

    const gravarMeta = (horas) => {
        const m = lerJSON('eseMetas', {});
        m.horasSemana = Math.max(0, Number(horas) || 0);
        localStorage.setItem('eseMetas', JSON.stringify(m));
    };

    /* ==================== MATÉRIAS ==================== */

    /* Todas as matérias que existem: as cadastradas por bimestre e as
       que aparecem em pendências e avaliações. */
    const materiasConhecidas = () => {
        const set = new Set();
        const porBim = lerJSON('eseSubjectsByBimester', {});
        Object.values(porBim).forEach((lista) => (lista || []).forEach((m) => m && set.add(String(m))));
        lerJSON('eseTasks', []).forEach((t) => t.subject && set.add(String(t.subject)));
        lerJSON('eseAssessments', []).forEach((a) => a.subject && set.add(String(a.subject)));
        return [...set].sort((a, b) => a.localeCompare(b, 'pt-BR'));
    };

    /* ==================== DESENHO ==================== */

    const fmtH = (h) => {
        const min = Math.round(h * 60);
        const hh = Math.floor(min / 60), mm = min % 60;
        if (hh === 0) return `${mm} min`;
        return mm ? `${hh}h${String(mm).padStart(2, '0')}` : `${hh}h`;
    };

    const render = (offsetSemanas) => {
        if (!temNavegador) return;
        const topo = $('desempenho-topo');
        const matBox = $('desempenho-materias');
        if (!topo || !matBox) return;
        gravarAcumulado();   // o minuto em andamento entra na conta

        const hoje = new Date();
        const inicio = D.addDays(D.startOfWeek(hoje), 7 * (offsetSemanas || 0));
        const r = calcular({
            historico: lerJSON('eseStudyHistory', {}),
            tarefas: lerJSON('eseTasks', []),
            metaHoras: lerMeta(),
            inicio, hoje
        });

        const dif = r.horas - r.horasAnterior;
        const comparacao = Math.abs(dif) < 1 / 60
            ? 'igual à semana anterior'
            : `${dif > 0 ? '+' : '−'}${fmtH(Math.abs(dif))} em relação à semana anterior`;

        const maxSeg = r.porMateria.length ? r.porMateria[0].segundos : 1;
        const barras = r.porMateria.map((m) => `
            <div class="perf-materia">
                <span class="perf-materia-nome">${esc(m.materia)}</span>
                <span class="perf-materia-barra"><span style="width:${Math.round(100 * m.segundos / maxSeg)}%"></span></span>
                <span class="perf-materia-h">${fmtH(m.segundos / 3600)}</span>
            </div>`).join('');

        const p = r.pendencias;
        const pend = [
            p.atrasadas ? `<strong class="ruim">${p.atrasadas}</strong> atrasada${p.atrasadas > 1 ? 's' : ''}` : '',
            p.vencidas ? `<strong class="ruim">${p.vencidas}</strong> vencida${p.vencidas > 1 ? 's' : ''} sem concluir` : '',
            p.abertas ? `<strong>${p.abertas}</strong> aberta${p.abertas > 1 ? 's' : ''}` : ''
        ].filter(Boolean).join(' · ') || (p.noPrazo ? 'tudo em dia' : 'nenhuma com prazo nesta semana');

        const estaSemana = (offsetSemanas || 0) === 0;
        topo.innerHTML = `
            <div class="perf-tiles">
                <div class="perf-tile perf-tile-meta">
                    <div class="perf-titulo">${estaSemana ? 'Esta semana' : 'Na semana'}
                        <label class="perf-meta-edit">meta <input type="number" id="perf-meta" min="0" max="100" step="1" value="${r.meta}"> h</label>
                    </div>
                    <div class="perf-numero">${fmtH(r.horas)} <span class="perf-de">de ${fmtH(r.meta)}</span></div>
                    <div class="perf-barra"><span style="width:${Math.round(r.progresso * 100)}%"></span></div>
                    <div class="perf-sub">${esc(comparacao)}</div>
                </div>
                <div class="perf-tile">
                    <div class="perf-titulo">Sequência</div>
                    <div class="perf-numero">${r.sequencia} <span class="perf-de">dia${r.sequencia === 1 ? '' : 's'}</span></div>
                    <div class="perf-sub">seguidos com 25 min ou mais, até hoje</div>
                </div>
                <div class="perf-tile">
                    <div class="perf-titulo">Pendências da semana</div>
                    <div class="perf-numero">${p.noPrazo} <span class="perf-de">no prazo</span></div>
                    <div class="perf-sub perf-pend">${pend}</div>
                </div>
            </div>`;

        matBox.innerHTML = `
            <div class="perf-bloco perf-materias">
                <div class="perf-titulo">Horas por matéria</div>
                ${barras || '<div class="perf-sub">Escolha a matéria em “Estudando:” no Timer de Foco e as horas aparecem aqui.</div>'}
            </div>`;

        const meta = $('perf-meta');
        if (meta) meta.addEventListener('change', () => { gravarMeta(meta.value); render(offsetSemanas); });
    };

    /* Seletor de matéria do Timer. */
    const montarSeletorTimer = () => {
        if (!temNavegador) return;
        const sel = $('timer-subject');
        if (!sel) return;
        const atual = localStorage.getItem('eseFocusTimer_subject') || '';
        const materias = materiasConhecidas();
        sel.innerHTML = `<option value="">Sem matéria</option>` +
            materias.map((m) => `<option value="${esc(m)}" ${m === atual ? 'selected' : ''}>${esc(m)}</option>`).join('');
        if (atual && !materias.includes(atual)) {
            sel.insertAdjacentHTML('beforeend', `<option value="${esc(atual)}" selected>${esc(atual)}</option>`);
        }
    };

    const materiaAtual = () => {
        if (!temNavegador) return '';
        const sel = $('timer-subject');
        return sel ? sel.value : (localStorage.getItem('eseFocusTimer_subject') || '');
    };

    if (temNavegador) {
        /* Ao sair da aba ou fechar, não perde o último minuto. */
        document.addEventListener('visibilitychange', () => { if (document.hidden) gravarAcumulado(); });
        window.addEventListener('pagehide', gravarAcumulado);

        document.addEventListener('DOMContentLoaded', () => {
            const hojeBtn = $('perf-hoje');
            if (hojeBtn) hojeBtn.addEventListener('click', () => {
                if (typeof currentWeekOffset !== 'undefined') currentWeekOffset = 0;
                if (typeof renderPerformanceChart === 'function') renderPerformanceChart();
            });
            montarSeletorTimer();
            const sel = $('timer-subject');
            if (sel) {
                sel.addEventListener('change', () => localStorage.setItem('eseFocusTimer_subject', sel.value));
                /* Matéria nova cadastrada em outra aba: atualiza ao focar. */
                sel.addEventListener('focus', montarSeletorTimer);
            }
        });
    }

    return {
        calcular, sequencia, pendenciasDaSemana, porMateriaSemana, somaSemana,
        registrar, lerMeta, gravarMeta, materiasConhecidas, materiaAtual,
        render, montarSeletorTimer
    };
})();
