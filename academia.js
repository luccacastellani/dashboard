/* ==========================================================
   ACADEMIA — a semana de treinos
   ----------------------------------------------------------
   Uma semana no formato do Google Calendar: sete colunas,
   segunda a domingo, com os exercícios de cada dia à mostra.

   No dia a dia, o único toque possível é o check de "fiz".
   O botão Editar libera tudo para mexer; Pronto volta ao normal.

   Tudo local, sem internet, sem IA, sem custo.

   Dados em localStorage, chave eseAcademia (versão 2):
   {
     versao: 2,
     plano: {                              // fixo por dia da semana
       "1": { nome: "Pernas", exercicios: [   // 0=Dom … 6=Sáb
         { nome: "Agachamento", series: 4, reps: 10, kg: 40, min: 0 }
       ] }
     },
     feitos: { "2026-09-14": true }        // treino do dia feito, por data real
   }

   A versão 1 (plano + treinos + sessoes) é convertida sozinha
   na primeira leitura — nada se perde.

   A lógica de dados é pura e fica no topo; o desenho, embaixo.
   Isso permite testar a lógica em Node, sem navegador.
   ========================================================== */

window.Academia = (() => {

    const KEY = 'eseAcademia';
    const D = window.ESEDates;
    const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    const DIAS_LONGO = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
    const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
    const TREINO_AVULSO = 'Avulso';

    const temNavegador = typeof document !== 'undefined';
    const temStorage = typeof localStorage !== 'undefined';

    const esc = (v) => window.escapeHtml ? window.escapeHtml(v) : String(v);
    const $ = (id) => document.getElementById(id);
    const chave = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    const num = (v) => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) && n > 0 ? n : 0; };

    /* ==================== DADOS ==================== */

    const exercicioLimpo = (e) => ({
        nome: String(e && e.nome || '').trim(),
        series: num(e && e.series),
        reps: num(e && e.reps),
        kg: num(e && e.kg),
        min: num(e && e.min)
    });

    const diaLimpo = (d) => ({
        nome: String(d && d.nome || '').trim(),
        exercicios: Array.isArray(d && d.exercicios) ? d.exercicios.map(exercicioLimpo).filter((e) => e.nome) : []
    });

    /* Aceita null, versão 1 ou versão 2. Devolve sempre versão 2. */
    const migrar = (raw) => {
        const out = { versao: 2, plano: {}, feitos: {} };
        if (!raw || typeof raw !== 'object') return out;

        if (raw.versao === 2) {
            Object.entries(raw.plano || {}).forEach(([dia, d]) => {
                const limpo = diaLimpo(d);
                if (limpo.nome) out.plano[dia] = limpo;
            });
            Object.entries(raw.feitos || {}).forEach(([data, marca]) => {
                /* Uma versão anterior guardava check por exercício ({nome: true});
                   qualquer exercício marcado vale como treino feito. */
                const feito = marca && typeof marca === 'object' ? Object.values(marca).some(Boolean) : !!marca;
                if (feito) out.feitos[data] = true;
            });
            return out;
        }

        /* Versão 1: plano[dia] = nomeTreino; treinos[nome] = [exercícios];
           sessoes = [{ data, treino, exercicios: [{nome, series, reps, kg}] }].
           Os números da última sessão de cada exercício viram o plano. */
        const ultimos = {};
        (Array.isArray(raw.sessoes) ? raw.sessoes : [])
            .slice().sort((a, b) => String(a.data).localeCompare(String(b.data)))
            .forEach((s) => {
                (s.exercicios || []).forEach((e) => {
                    ultimos[chave(e.nome)] = exercicioLimpo(e);
                    if (s.data) out.feitos[s.data] = true;
                });
            });

        Object.entries(raw.plano || {}).forEach(([dia, nomeTreino]) => {
            const nome = String(nomeTreino || '').trim();
            if (!nome) return;
            const lista = (raw.treinos && raw.treinos[nome]) || [];
            out.plano[dia] = {
                nome,
                exercicios: lista.map((n) => ultimos[chave(n)] || exercicioLimpo({ nome: n })).filter((e) => e.nome)
            };
        });
        return out;
    };

    const ler = () => {
        if (!temStorage) return migrar(null);
        try {
            return migrar(JSON.parse(localStorage.getItem(KEY) || 'null'));
        } catch {
            return migrar(null);
        }
    };

    let dados = ler();
    const salvar = () => { if (temStorage) localStorage.setItem(KEY, JSON.stringify(dados)); };

    /* ---------- Consultas ---------- */

    const treinoDoDia = (data = new Date()) => {
        const d = dados.plano[String(data.getDay())];
        return d ? d.nome : '';
    };

    const feito = (dataISO) => dados.feitos[dataISO] === true;

    const resumoSemana = (inicioSemana) => {
        let planejados = 0, feitos = 0;
        D.weekDays(inicioSemana).forEach((data) => {
            if (!dados.plano[String(data.getDay())]) return;
            planejados++;
            if (feito(D.toDateString(data))) feitos++;
        });
        return { planejados, feitos };
    };

    /* ---------- Alterações ---------- */

    const definirTreino = (dia, nome) => {
        const k = String(dia);
        const limpo = String(nome || '').trim();
        if (!limpo) { delete dados.plano[k]; salvar(); return; }
        dados.plano[k] = { nome: limpo, exercicios: dados.plano[k] ? dados.plano[k].exercicios : [] };
        salvar();
    };

    /* Se já existe (pelo nome), só atualiza os números informados.
       Devolve o nome como está no plano (é ele que vale para o check). */
    const adicionarExercicio = (dia, exercicio) => {
        const k = String(dia);
        const novo = exercicioLimpo(exercicio);
        if (!novo.nome) return '';
        if (!dados.plano[k]) dados.plano[k] = { nome: TREINO_AVULSO, exercicios: [] };
        const atual = dados.plano[k].exercicios.find((e) => chave(e.nome) === chave(novo.nome));
        if (atual) {
            ['series', 'reps', 'kg', 'min'].forEach((c) => { if (novo[c] > 0) atual[c] = novo[c]; });
        } else {
            dados.plano[k].exercicios.push(novo);
        }
        salvar();
        return atual ? atual.nome : novo.nome;
    };

    const alterarExercicio = (dia, indice, campo, valor) => {
        const d = dados.plano[String(dia)];
        const e = d && d.exercicios[indice];
        if (!e) return;
        if (campo === 'nome') e.nome = String(valor || '').trim();
        else if (['series', 'reps', 'kg', 'min'].includes(campo)) e[campo] = num(valor);
        salvar();
    };

    const removerExercicio = (dia, indice) => {
        const d = dados.plano[String(dia)];
        if (!d) return;
        d.exercicios.splice(indice, 1);
        salvar();
    };

    const marcarFeito = (dataISO, valor) => {
        if (valor) dados.feitos[dataISO] = true;
        else delete dados.feitos[dataISO];
        salvar();
    };

    /* ==================== DESENHO ==================== */

    const estado = { inicio: D.startOfWeek(new Date()), editando: false };

    const fmtNum = (n) => String(n).replace('.', ',');

    /* "4×10 · 40 kg", "20 min", ou "" */
    const detalheExercicio = (e) => {
        const partes = [];
        if (e.series && e.reps) partes.push(`${fmtNum(e.series)}×${fmtNum(e.reps)}`);
        else if (e.series) partes.push(`${fmtNum(e.series)} séries`);
        else if (e.reps) partes.push(`${fmtNum(e.reps)} reps`);
        if (e.kg) partes.push(`${fmtNum(e.kg)} kg`);
        if (e.min) partes.push(`${fmtNum(e.min)} min`);
        return partes.join(' · ');
    };

    const tituloSemana = (inicio) => {
        const fim = D.addDays(inicio, 6);
        if (inicio.getMonth() === fim.getMonth()) {
            return `${inicio.getDate()} – ${fim.getDate()} de ${MESES[inicio.getMonth()]}`;
        }
        return `${inicio.getDate()} ${MESES[inicio.getMonth()]} – ${fim.getDate()} ${MESES[fim.getMonth()]}`;
    };

    const colunaNormal = (data, dia) => {
        const iso = D.toDateString(data);
        if (!dia) return `<div class="acad-descanso">Descanso</div>`;
        const ok = feito(iso);
        const linhas = dia.exercicios.map((e) => {
            const det = detalheExercicio(e);
            return `
                <div class="acad-ex">
                    <span class="acad-ex-nome">${esc(e.nome)}</span>
                    ${det ? `<span class="acad-ex-det">${esc(det)}</span>` : ''}
                </div>`;
        }).join('');
        return `
            <div class="acad-treino ${ok ? 'completo' : ''}">
                <div class="acad-treino-nome">${esc(dia.nome)}</div>
                <div class="acad-exs">${linhas || '<div class="acad-vazio">Sem exercícios</div>'}</div>
            </div>`;
    };

    const colunaEditar = (data, d) => {
        const dia = d || { nome: '', exercicios: [] };
        const k = String(data.getDay());
        const campo = (i, nome, valor, ph, largura) => `
            <input type="text" inputmode="decimal" class="acad-campo acad-campo-${largura}" data-acao="campo"
                   data-dia="${k}" data-i="${i}" data-campo="${nome}" value="${esc(valor || '')}"
                   placeholder="${ph}" aria-label="${nome === 'series' ? 'Séries' : nome === 'reps' ? 'Repetições' : nome === 'kg' ? 'Quilos' : 'Minutos'}">`;
        const linhas = dia.exercicios.map((e, i) => `
            <div class="acad-ed-ex">
                <input type="text" class="acad-campo acad-campo-nome" data-acao="campo" data-dia="${k}" data-i="${i}"
                       data-campo="nome" value="${esc(e.nome)}" placeholder="Exercício" aria-label="Exercício">
                <div class="acad-ed-nums">
                    ${campo(i, 'series', e.series, 'séries', 'n')}
                    <span class="acad-x">×</span>
                    ${campo(i, 'reps', e.reps, 'reps', 'n')}
                </div>
                <div class="acad-ed-nums acad-ed-nums-2">
                    <label class="acad-unidade">${campo(i, 'kg', e.kg, '0', 'n')}<span>kg</span></label>
                    <label class="acad-unidade">${campo(i, 'min', e.min, '0', 'n')}<span>min</span></label>
                    <button type="button" class="acad-remover" data-acao="remover" data-dia="${k}" data-i="${i}"
                            title="Remover exercício" aria-label="Remover ${esc(e.nome)}">✕</button>
                </div>
            </div>`).join('');
        return `
            <div class="acad-ed">
                <input type="text" class="acad-campo acad-campo-treino" data-acao="nome-treino" data-dia="${k}"
                       value="${esc(dia.nome)}" placeholder="Descanso" aria-label="Treino de ${DIAS_LONGO[data.getDay()]}">
                ${linhas}
                <button type="button" class="acad-adicionar" data-acao="adicionar" data-dia="${k}">+ exercício</button>
            </div>`;
    };

    const renderSemana = () => {
        const box = $('acad-semana');
        if (!box) return;
        const hojeISO = D.todayString();
        const semana = D.weekDays(estado.inicio);
        const r = resumoSemana(estado.inicio);
        const estaSemana = D.isSameDay(estado.inicio, D.startOfWeek(new Date()));

        const colunas = semana.map((data) => {
            const iso = D.toDateString(data);
            const dia = dados.plano[String(data.getDay())];
            const ok = !!dia && feito(iso);
            return `
                <div class="acad-col ${iso === hojeISO ? 'is-today' : ''} ${ok ? 'is-completo' : ''}">
                    <div class="acad-col-cab">
                        <span class="acad-col-dia">
                            ${DIAS[data.getDay()]}
                            ${dia && !estado.editando ? `
                            <button type="button" class="acad-check ${ok ? 'ativo' : ''}" data-acao="check" data-data="${iso}"
                                    aria-pressed="${ok}" aria-label="${ok ? 'Treino feito — desmarcar' : 'Marcar treino como feito'}"></button>` : ''}
                        </span>
                        <span class="acad-col-data">${data.getDate()}</span>
                    </div>
                    ${estado.editando ? colunaEditar(data, dia) : colunaNormal(data, dia)}
                </div>`;
        }).join('');

        let rodape = '';
        if (r.planejados > 0) {
            rodape = `${estaSemana ? 'Esta semana' : 'Nesta semana'}: ${r.feitos} de ${r.planejados} treinos feitos`;
        } else if (!Object.keys(dados.plano).length && !estado.editando) {
            rodape = 'Nenhum treino ainda. Clique em Editar para montar sua semana.';
        }

        box.innerHTML = `
            <div class="acad-cab">
                <div class="acad-nav">
                    <button type="button" class="acad-seta" data-acao="semana-antes" aria-label="Semana anterior">‹</button>
                    <span class="acad-titulo">${tituloSemana(estado.inicio)}</span>
                    <button type="button" class="acad-seta" data-acao="semana-depois" aria-label="Próxima semana">›</button>
                    ${estaSemana ? '' : '<button type="button" class="acad-hoje-btn" data-acao="semana-hoje">Hoje</button>'}
                </div>
                <button type="button" class="btn ${estado.editando ? 'btn-primary' : 'btn-secondary'} btn-sm" data-acao="editar">
                    ${estado.editando ? 'Pronto' : 'Editar'}
                </button>
            </div>
            <div class="acad-grade ${estado.editando ? 'editando' : ''}">${colunas}</div>
            ${rodape ? `<div class="acad-rodape">${esc(rodape)}</div>` : ''}
        `;
    };

    /* Linha de cima da aba e o chip do Início. */
    const renderHoje = () => {
        const hoje = new Date();
        const treino = treinoDoDia(hoje);
        const ok = !!treino && feito(D.todayString());

        const box = $('acad-hoje');
        if (box) {
            if (!treino) box.innerHTML = `Hoje é ${DIAS_LONGO[hoje.getDay()]} — dia de descanso.`;
            else if (ok) box.innerHTML = `Treino de hoje: <strong>${esc(treino)}</strong> ✓ feito`;
            else box.innerHTML = `Treino de hoje: <strong>${esc(treino)}</strong>`;
        }

        const chip = $('overview-treino');
        if (chip) {
            if (treino) {
                chip.textContent = ok ? `Treino de hoje: ${treino} ✓` : `Treino de hoje: ${treino}`;
                chip.style.display = 'inline-flex';
            } else {
                chip.style.display = 'none';
            }
        }
    };

    const renderTudo = () => {
        if (!temNavegador) return;
        dados = ler();
        renderHoje();
        renderSemana();
    };

    /* ---------- Eventos (delegação numa raiz só) ---------- */

    const ligar = () => {
        const raiz = $('acad-semana');
        if (!raiz) return;

        raiz.addEventListener('click', (e) => {
            const alvo = e.target.closest('[data-acao]');
            if (!alvo || !raiz.contains(alvo)) return;
            const acao = alvo.dataset.acao;

            if (acao === 'semana-antes') { estado.inicio = D.addDays(estado.inicio, -7); renderSemana(); }
            else if (acao === 'semana-depois') { estado.inicio = D.addDays(estado.inicio, 7); renderSemana(); }
            else if (acao === 'semana-hoje') { estado.inicio = D.startOfWeek(new Date()); renderSemana(); }
            else if (acao === 'editar') { estado.editando = !estado.editando; renderTudo(); }
            else if (acao === 'check') { marcarFeito(alvo.dataset.data, !feito(alvo.dataset.data)); renderTudo(); }
            else if (acao === 'remover') { removerExercicio(alvo.dataset.dia, Number(alvo.dataset.i)); renderTudo(); }
            else if (acao === 'adicionar') {
                const k = alvo.dataset.dia;
                if (!dados.plano[k]) dados.plano[k] = { nome: TREINO_AVULSO, exercicios: [] };
                dados.plano[k].exercicios.push(exercicioLimpo({ nome: '' }));
                /* Linha em branco só existe na tela até ganhar nome. */
                renderSemana();
                const campo = raiz.querySelector(`.acad-campo-nome[data-dia="${k}"][data-i="${dados.plano[k].exercicios.length - 1}"]`);
                if (campo) campo.focus();
            }
        });

        raiz.addEventListener('change', (e) => {
            const alvo = e.target.closest('[data-acao]');
            if (!alvo) return;
            const acao = alvo.dataset.acao;
            if (acao === 'nome-treino') { definirTreino(alvo.dataset.dia, alvo.value); renderTudo(); }
            else if (acao === 'campo') { alterarExercicio(alvo.dataset.dia, Number(alvo.dataset.i), alvo.dataset.campo, alvo.value); }
        });

        /* Ao sair do modo editar, linhas sem nome somem. */
        const limparVazios = () => {
            let mudou = false;
            Object.keys(dados.plano).forEach((k) => {
                const antes = dados.plano[k].exercicios.length;
                dados.plano[k].exercicios = dados.plano[k].exercicios.filter((x) => x.nome);
                if (dados.plano[k].exercicios.length !== antes) mudou = true;
            });
            if (mudou) salvar();
        };
        raiz.addEventListener('click', (e) => {
            const alvo = e.target.closest('[data-acao="editar"]');
            if (alvo && estado.editando) limparVazios();
        }, true);
    };

    if (temNavegador) {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { ligar(); renderTudo(); });
        else { ligar(); renderTudo(); }
    }

    return {
        migrar, treinoDoDia, feito, resumoSemana,
        definirTreino, adicionarExercicio, alterarExercicio, removerExercicio, marcarFeito,
        renderTudo,
        _dados: () => dados,
        _definirDados: (d) => { dados = migrar(d); }
    };
})();
