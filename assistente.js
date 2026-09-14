/* ==========================================================
   ASSISTENTE — MINI CHAT COM VOZ
   ----------------------------------------------------------
   Painel flutuante no canto. Você fala (ou digita), ele
   entende, mostra o que entendeu e só age depois que você
   confirma.

   Economia de créditos é regra do desenho:
     1. as REGRAS locais tentam primeiro, sempre — custo zero
     2. o Claude só é chamado quando as regras não entendem
     3. e só se você tiver ligado essa ajuda no botão

   A voz usa o reconhecimento embutido do Chrome: também de
   graça, e o áudio não passa por este código.
   ========================================================== */

window.Assistente = (() => {

    const R = window.AssistenteRegras;
    const D = window.ESEDates;
    const $ = (id) => document.getElementById(id);
    const esc = (v) => window.escapeHtml ? window.escapeHtml(v) : String(v);

    const PREF_KEY = 'eseAssistentePrefs';

    const lerPrefs = () => {
        try {
            const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
            return { usarClaude: p.usarClaude === true, aberto: p.aberto === true, modelo: ['haiku', 'sonnet', 'opus'].includes(p.modelo) ? p.modelo : 'sonnet' };
        } catch {
            return { usarClaude: false, aberto: false, modelo: 'sonnet' };
        }
    };

    const salvarPrefs = (patch) => {
        const p = { ...lerPrefs(), ...patch };
        try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* ignora */ }
        return p;
    };

    let pendente = null;      // comando aguardando confirmação (cartão único)
    const pendentes = new Map(); // id do cartão -> comando (vários cartões do Claude)
    let seqCartao = 0;
    const historico = [];     // últimas falas, para o Claude ter contexto
    let ouvindo = false;
    let recog = null;

    /* ---------- Contexto que o interpretador precisa ---------- */

    const materiasConhecidas = () => {
        const nomes = new Set();
        try {
            const porBimestre = JSON.parse(localStorage.getItem('eseSubjectsByBimester') || '{}');
            Object.values(porBimestre).forEach((lista) => {
                if (Array.isArray(lista)) lista.forEach((m) => nomes.add(m));
            });
        } catch { /* ignora */ }
        try {
            const tarefas = JSON.parse(localStorage.getItem('eseTasks') || '[]');
            tarefas.forEach((t) => { if (t.subject) nomes.add(t.subject); });
        } catch { /* ignora */ }
        return [...nomes];
    };

    const treinosConhecidos = () => {
        try {
            const a = JSON.parse(localStorage.getItem('eseAcademia') || '{}');
            const nomes = Object.values(a.plano || {}).map((d) => (d && d.nome) || '').filter(Boolean);
            return [...new Set(nomes)];
        } catch {
            return [];
        }
    };

    const contexto = () => ({
        hoje: new Date(),
        materias: materiasConhecidas(),
        treinos: treinosConhecidos()
    });

    const contextoLuna = () => ({
        agora: new Date(),
        dieta: window.Macros ? window.Macros._dados().dieta : [],
        tabela: window.TabelaAlimentos ? window.TabelaAlimentos.itens : []
    });

    /* Markdown mínimo do Claude -> HTML seguro (negrito, itálico, listas, links). */
    const mdParaHtml = (md) => {
        const linhas = String(md || '').split(/\r?\n/);
        let html = '', emLista = false;
        const inline = (t) => esc(t)
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
            .replace(/(https?:\/\/[^\s)]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
        for (const l of linhas) {
            const m = l.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
            if (m) { if (!emLista) { html += '<ul>'; emLista = true; } html += `<li>${inline(m[1])}</li>`; continue; }
            if (emLista) { html += '</ul>'; emLista = false; }
            if (l.trim()) html += `<p>${inline(l.replace(/^#+\s*/, ''))}</p>`;
        }
        if (emLista) html += '</ul>';
        return html;
    };

    /* ---------- Mensagens na tela ---------- */

    const addMsg = (quem, html) => {
        const lista = $('assist-mensagens');
        if (!lista) return null;
        const div = document.createElement('div');
        div.className = 'assist-msg assist-' + quem;
        div.innerHTML = html;
        lista.appendChild(div);
        lista.scrollTop = lista.scrollHeight;
        return div;
    };

    const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

    const dataBonita = (iso) => {
        if (!iso) return 'sem data';
        const d = D.fromDateString(iso);
        return `${DIAS[d.getDay()]}, ${D.dayMonth(d)}`;
    };

    /* Como cada comando é apresentado antes de salvar. */
    const descrever = (c) => {
        switch (c.tipo) {
            case 'pendencia':
                return `<strong>Pendência:</strong> ${esc(c.nome || '(sem nome)')}`
                    + `<br><span class="assist-campo">Matéria:</span> ${esc(c.materia || '—')}`
                    + `<br><span class="assist-campo">Prazo:</span> ${esc(dataBonita(c.prazo))}`
                    + `<br><span class="assist-campo">Dificuldade:</span> ${esc(c.dificuldade || 'Média')}`
                    + (c.estimativa ? `<br><span class="assist-campo">Tempo:</span> ${esc(c.estimativa)} min` : '');
            case 'avaliacao':
                return `<strong>Avaliação:</strong> ${esc(c.nome || 'Prova')}`
                    + `<br><span class="assist-campo">Matéria:</span> ${esc(c.materia || '—')}`
                    + `<br><span class="assist-campo">Data:</span> ${esc(dataBonita(c.data))}`;
            case 'treino_plano':
                return `<strong>Treino:</strong> ${esc(c.treino || '(sem nome)')}`
                    + `<br><span class="assist-campo">Dia:</span> toda ${esc(DIAS[c.dia])}`;
            case 'treino_serie':
                return `<strong>Série:</strong> ${esc(c.exercicio)}`
                    + `<br><span class="assist-campo">Séries:</span> ${esc(c.series)} × ${esc(c.reps)}`
                    + (c.kg ? ` @ ${esc(c.kg)} kg` : '');
            case 'tarefa':
                return `<strong>Google Tasks:</strong> ${esc(c.titulo || '(sem título)')}`
                    + `<br><span class="assist-campo">Prazo:</span> ${esc(dataBonita(c.prazo))}`;
            default:
                return (window.Luna && window.Luna.descrever(c)) || '<strong>Não entendi.</strong>';
        }
    };

    /* O que falta para o comando poder ser salvo. */
    const faltando = (c) => {
        const faltas = [];
        if (c.tipo === 'pendencia') {
            if (!c.nome) faltas.push('o nome da tarefa');
            if (!c.materia) faltas.push('a matéria');
        }
        if (c.tipo === 'avaliacao') {
            if (!c.materia) faltas.push('a matéria');
            if (!c.data) faltas.push('a data');
        }
        if (c.tipo === 'treino_plano' && !c.treino) faltas.push('o nome do treino');
        if (c.tipo === 'treino_serie' && !c.exercicio) faltas.push('o exercício');
        if (c.tipo === 'tarefa' && !c.titulo) faltas.push('o título');
        if (window.Luna) faltas.push(...window.Luna.faltando(c));
        return faltas;
    };

    /* ---------- Aplicar um comando ---------- */

    const aplicar = async (c) => {
        switch (c.tipo) {
            case 'pendencia': {
                const tarefas = JSON.parse(localStorage.getItem('eseTasks') || '[]');
                const bimestre = localStorage.getItem('eseGlobalBimester') || '1';
                tarefas.push({
                    name: c.nome,
                    subject: c.materia,
                    deadline: c.prazo || '',
                    difficulty: c.dificuldade || 'Média',
                    bimester: bimestre,
                    done: false,
                    ...(c.estimativa ? { estimate: c.estimativa } : {})
                });
                localStorage.setItem('eseTasks', JSON.stringify(tarefas));
                if (typeof window.renderTasks === 'function') window.renderTasks();
                return 'Pendência criada.';
            }

            case 'avaliacao': {
                const avaliacoes = JSON.parse(localStorage.getItem('eseAssessments') || '[]');
                const bimestre = localStorage.getItem('eseGlobalBimester') || '1';
                avaliacoes.push({
                    subject: c.materia,
                    name: c.nome || 'Prova',
                    date: c.data,
                    bimester: bimestre
                });
                localStorage.setItem('eseAssessments', JSON.stringify(avaliacoes));
                if (typeof window.renderCalendar === 'function') window.renderCalendar();
                return 'Avaliação marcada no calendário.';
            }

            case 'treino_plano': {
                if (!window.Academia) return 'A seção Academia não carregou.';
                window.Academia.definirTreino(c.dia, c.treino);
                window.Academia.renderTudo();
                return `Treino ${c.treino} marcado para toda ${DIAS[c.dia]}.`;
            }

            case 'treino_serie': {
                if (!window.Academia) return 'A seção Academia não carregou.';
                const hoje = new Date();
                /* Entra no plano de hoje (se já existe, só atualiza os
                   números ditos) e o dia ganha o check de feito. */
                const nome = window.Academia.adicionarExercicio(hoje.getDay(), {
                    nome: c.exercicio, series: c.series, reps: c.reps, kg: c.kg, min: 0
                });
                window.Academia.marcarFeito(D.todayString(), true);
                window.Academia.renderTudo();
                const det = [c.series && c.reps ? `${c.series}×${c.reps}` : '', c.kg ? `${c.kg} kg` : ''].filter(Boolean).join(' · ');
                return `${nome} anotado${det ? ` (${det})` : ''} e o treino de hoje marcado como feito.`;
            }

            case 'tarefa': {
                if (!window.GoogleAuth || !window.GoogleAuth.isConnected()) {
                    return 'Para criar no Google Tasks preciso estar conectada ao Google.';
                }
                const cache = window.GoogleAPI.readCache();
                const lista = (cache.taskLists || [])[0];
                if (!lista) return 'Não encontrei nenhuma lista do Google Tasks.';
                await window.GoogleTasks.create(lista.id, { title: c.titulo, due: c.prazo });
                return 'Tarefa criada no Google Tasks.';
            }

            default: {
                const r = window.Luna ? await window.Luna.aplicar(c) : null;
                return r || 'Nada a fazer.';
            }
        }
    };

    /* ---------- Confirmação ---------- */

    const pedirConfirmacao = (c, origem) => {
        const id = String(++seqCartao);
        pendentes.set(id, c);
        pendente = c;
        const faltas = faltando(c);
        const selo = origem === 'claude'
            ? '<span class="assist-selo assist-selo-claude">Claude</span>'
            : '<span class="assist-selo">local</span>';

        const corpo = `${selo}${descrever(c)}`;

        if (faltas.length) {
            addMsg('bot', `${corpo}<div class="assist-falta">Falta ${esc(faltas.join(' e '))}. Diga de novo incluindo isso.</div>`);
            pendente = null;
            pendentes.delete(id);
            return;
        }

        addMsg('bot', `${corpo}
            <div class="assist-acoes" data-cartao="${id}">
                <button type="button" class="btn btn-primary btn-sm" data-acao="confirmar">Confirmar</button>
                <button type="button" class="btn btn-secondary btn-sm" data-acao="cancelar">Cancelar</button>
            </div>`);
    };

    /* ---------- Claude, só quando as regras falham ---------- */

    const ESPERA_MAXIMA_MS = 60 * 1000;

    const perguntarALuna = async (frase) => {
        const controle = new AbortController();
        const alarme = setTimeout(() => controle.abort(), 95 * 1000);
        let resp;
        try {
            resp = await fetch('/api/luna', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controle.signal,
                body: JSON.stringify({ frase, estado: window.Luna.montarEstado(), historico: historico.slice(-6), modelo: lerPrefs().modelo })
            });
        } catch (e) {
            if (e && e.name === 'AbortError') throw new Error('O Claude não respondeu a tempo. Tente de novo.');
            throw e;
        } finally {
            clearTimeout(alarme);
        }
        if (!resp.ok) throw new Error('servidor respondeu ' + resp.status);
        const dados = await resp.json();
        if (dados.erro) throw new Error(dados.erro);
        return dados;
    };

    const perguntarAoClaude = async (frase) => {
        /* Se o servidor emperrar, o chat desiste sozinho em vez de
           ficar "pensando" para sempre. */
        const controle = new AbortController();
        const alarme = setTimeout(() => controle.abort(), ESPERA_MAXIMA_MS);
        let resp;
        try {
            resp = await fetch('/api/assistente', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                signal: controle.signal,
                body: JSON.stringify({
                    frase,
                    hoje: D.todayString(),
                    materias: materiasConhecidas(),
                    treinos: treinosConhecidos()
                })
            });
        } catch (e) {
            if (e && e.name === 'AbortError') throw new Error('O Claude não respondeu a tempo. Tente de novo.');
            throw e;
        } finally {
            clearTimeout(alarme);
        }
        if (!resp.ok) throw new Error('servidor respondeu ' + resp.status);
        const dados = await resp.json();
        if (dados.erro) throw new Error(dados.erro);
        return dados.comando;
    };

    /* ---------- Fluxo principal ---------- */

    const processar = async (frase) => {
        const texto = String(frase || '').trim();
        if (!texto) return;

        addMsg('eu', esc(texto));
        historico.push({ quem: 'Lucca', texto });

        const L = window.LunaRegras;
        const claudeLigado = lerPrefs().usarClaude && noPC;
        const conversa = L && L.pareceConversa(texto);

        /* 1. Regras novas (comida, compras, agenda, perguntas): grátis, instantâneo. */
        const novo = L && !(conversa && claudeLigado && !/^(quanto|qual|o que tenho|resumo)/i.test(texto)) ? L.interpretar(texto, contextoLuna()) : null;
        if (novo && window.Luna && window.Luna.ehPergunta(novo)) {
            const html = window.Luna.responder(novo);
            addMsg('bot', `<span class="assist-selo">local</span>${html}`);
            historico.push({ quem: 'Luna', texto: html.replace(/<[^>]+>/g, ' ').slice(0, 400) });
            return;
        }
        if (novo) { pedirConfirmacao(novo, 'local'); return; }

        /* 2. Regras antigas (pendência, avaliação, treino, tarefa). */
        const local = conversa ? { tipo: 'desconhecido' } : R.interpretar(texto, contexto());
        if (local.tipo !== 'desconhecido') {
            pedirConfirmacao(local, 'local');
            return;
        }

        /* 3. Só agora, e só se estiver ligado, o Claude entra. */
        if (!lerPrefs().usarClaude) {
            addMsg('bot', `<strong>Não entendi.</strong>
                <div class="assist-falta">Comandos que eu conheço: “comi 2 ovos e 50 g de arroz”, “quanto falta para as calorias?”, “treino de hoje?”,
                “fiz supino 3x10 com 40 kg”, “treino feito”, “prova de micro dia 25”, “pendência problem set de Stats para sexta”,
                “marca reunião amanhã às 15h”, “acabou o leite”, “lista de compras?”, “notícias de economia”, “resumo do dia”.
                ${noPC ? 'Para conversar livremente, ligue o <em>Claude</em> aqui em cima.' : 'Conversa livre com o Claude só no PC.'}</div>`);
            return;
        }
        if (!noPC) {
            addMsg('bot', '<strong>Não entendi.</strong><div class="assist-falta">No celular eu só entendo os comandos combinados; o Claude responde quando você estiver no PC.</div>');
            return;
        }

        const pensando = addMsg('bot', '<span class="assist-pensando">Perguntando ao Claude…</span>');
        try {
            const r = await perguntarALuna(texto);
            if (pensando) pensando.remove();
            if (r.resposta) {
                addMsg('bot', `<span class="assist-selo assist-selo-claude">Claude</span><div class="assist-md">${mdParaHtml(r.resposta)}</div>`);
                historico.push({ quem: 'Luna', texto: r.resposta.slice(0, 600) });
            }
            (r.acoes || []).forEach((c) => pedirConfirmacao(c, 'claude'));
            if (!r.resposta && !(r.acoes || []).length) addMsg('bot', '<strong>Não entendi.</strong><div class="assist-falta">Tente dizer de outro jeito.</div>');
        } catch (err) {
            if (pensando) pensando.remove();
            addMsg('bot', `<strong>O Claude não respondeu.</strong>
                <div class="assist-falta">${esc(err.message)}<br>
                Se for login, abra o Prompt de Comando e rode <code>claude auth login</code>.</div>`);
        }
    };

    /* ---------- Voz ---------- */

    const vozDisponivel = () => 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;

    const prepararVoz = () => {
        if (recog || !vozDisponivel()) return recog;
        const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
        recog = new Rec();
        recog.lang = 'pt-BR';
        recog.interimResults = true;
        recog.continuous = false;
        recog.maxAlternatives = 1;

        recog.onstart = () => {
            ouvindo = true;
            const b = $('assist-mic');
            if (b) { b.classList.add('ouvindo'); b.title = 'Ouvindo… clique para parar'; }
            const campo = $('assist-entrada');
            if (campo) campo.placeholder = 'Ouvindo…';
        };

        recog.onresult = (e) => {
            let texto = '';
            for (let i = e.resultIndex; i < e.results.length; i++) texto += e.results[i][0].transcript;
            const campo = $('assist-entrada');
            if (campo) campo.value = texto.trim();
            /* Resultado final: envia sozinho. */
            if (e.results[e.results.length - 1].isFinal) {
                const frase = texto.trim();
                if (campo) campo.value = '';
                processar(frase);
            }
        };

        recog.onerror = (e) => {
            ouvindo = false;
            const b = $('assist-mic');
            if (b) b.classList.remove('ouvindo');
            const campo = $('assist-entrada');
            if (campo) campo.placeholder = 'Fale ou escreva…';
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
                addMsg('bot', '<strong>Sem permissão para o microfone.</strong><div class="assist-falta">Clique no cadeado ao lado do endereço e libere o microfone para localhost.</div>');
            } else if (e.error === 'no-speech') {
                addMsg('bot', '<span class="assist-pensando">Não ouvi nada.</span>');
            }
        };

        recog.onend = () => {
            ouvindo = false;
            const b = $('assist-mic');
            if (b) { b.classList.remove('ouvindo'); b.title = 'Falar'; }
            const campo = $('assist-entrada');
            if (campo) campo.placeholder = 'Fale ou escreva…';
        };

        return recog;
    };

    const alternarVoz = () => {
        const r = prepararVoz();
        if (!r) {
            addMsg('bot', '<strong>Este navegador não tem reconhecimento de voz.</strong><div class="assist-falta">No Chrome funciona. Você pode escrever normalmente.</div>');
            return;
        }
        if (ouvindo) { r.stop(); return; }
        try { r.start(); } catch { /* já estava ouvindo */ }
    };

    /* ---------- Abrir / fechar ---------- */

    const abrir = (sim) => {
        const painel = $('assistente-painel');
        const bolha = $('assistente-bolha');
        if (!painel || !bolha) return;
        painel.style.display = sim ? 'flex' : 'none';
        bolha.style.display = sim ? 'none' : 'grid';
        salvarPrefs({ aberto: sim });
        if (sim) {
            const campo = $('assist-entrada');
            if (campo) campo.focus();
        }
    };

    /* ---------- Ligação ---------- */

    const ligar = () => {
        const painel = $('assistente-painel');
        if (!painel) return;

        const prefs = lerPrefs();

        const botaoClaude = $('assist-claude-toggle');
        const pintarClaude = () => {
            const on = lerPrefs().usarClaude;
            if (!botaoClaude) return;
            botaoClaude.classList.toggle('ativo', on);
            botaoClaude.title = on
                ? 'Claude ligado: frases livres usam sua assinatura. Clique para desligar.'
                : 'Claude desligado: só entende as frases combinadas, sem gastar nada.';
        };
        pintarClaude();

        if (botaoClaude) {
            if (!noPC) { botaoClaude.disabled = true; botaoClaude.title = 'O Claude do seu plano só roda no PC. Aqui valem os comandos.'; }
            botaoClaude.addEventListener('click', () => {
                const novo = !lerPrefs().usarClaude;
                salvarPrefs({ usarClaude: novo });
                pintarClaude();
                addMsg('bot', novo
                    ? `<span class="assist-pensando">Claude ligado (modelo ${esc(lerPrefs().modelo)}). Perguntas e conversa vão para ele com a foto do dashboard — usando a sua assinatura.
                       <button type="button" class="assist-exemplo" data-modelo="haiku">usar Haiku (mais econômico)</button>
                       <button type="button" class="assist-exemplo" data-modelo="sonnet">usar Sonnet (melhor)</button></span>`
                    : '<span class="assist-pensando">Claude desligado. Agora eu uso só as regras locais: nada é enviado, nada é gasto.</span>');
            });
        }

        $('assistente-bolha').addEventListener('click', () => abrir(true));
        $('assist-fechar').addEventListener('click', () => abrir(false));
        $('assist-mic').addEventListener('click', alternarVoz);

        $('assist-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const campo = $('assist-entrada');
            const texto = campo.value;
            campo.value = '';
            processar(texto);
        });

        /* Confirmar / cancelar (delegado: os botões nascem depois) */
        $('assist-mensagens').addEventListener('click', async (e) => {
            const btn = e.target.closest('[data-acao]');
            if (!btn) return;
            const acao = btn.dataset.acao;
            const acoes = btn.closest('.assist-acoes');
            const idCartao = acoes ? acoes.dataset.cartao : '';
            if (acoes) acoes.remove();
            const cmd = (idCartao && pendentes.get(idCartao)) || pendente;
            if (idCartao) pendentes.delete(idCartao);

            if (acao === 'cancelar') {
                pendente = null;
                addMsg('bot', '<span class="assist-pensando">Cancelado.</span>');
                return;
            }

            if (acao === 'confirmar' && cmd) {
                const c = cmd;
                pendente = null;
                try {
                    const msg = await aplicar(c);
                    addMsg('bot', `<span class="assist-ok">✓ ${esc(msg)}</span>`);
                } catch (err) {
                    addMsg('bot', `<span class="assist-erro">Não consegui salvar: ${esc(err.message)}</span>`);
                }
            }
        });

        abrir(prefs.aberto);

        addMsg('bot', `<span class="assist-pensando">Oi! Sou a Luna. Fale ou escreva. Por exemplo:</span>
            <div class="assist-exemplos">
                <button type="button" class="assist-exemplo">resumo do dia</button>
                <button type="button" class="assist-exemplo">comi 50 g de arroz, feijão e 3 ovos</button>
                <button type="button" class="assist-exemplo">quanto falta para as calorias?</button>
                <button type="button" class="assist-exemplo">treino de hoje?</button>
                <button type="button" class="assist-exemplo">fiz supino 3 por 10 com 40 quilos</button>
                <button type="button" class="assist-exemplo">marca reunião amanhã às 15h no Polak</button>
                <button type="button" class="assist-exemplo">acabou o leite</button>
                <button type="button" class="assist-exemplo">prova de micro dia 25</button>
            </div>`);

        $('assist-mensagens').addEventListener('click', (e) => {
            const ex = e.target.closest('.assist-exemplo');
            if (!ex) return;
            if (ex.dataset.modelo) {
                salvarPrefs({ modelo: ex.dataset.modelo });
                addMsg('bot', `<span class="assist-pensando">Modelo: ${esc(ex.dataset.modelo)}.</span>`);
                return;
            }
            processar(ex.textContent);
        });
    };

    /* O chat existe em todo lugar (as regras rodam no aparelho).
       O Claude do plano dela só é alcançável pelo servidor do PC (localhost). */
    const noPC = ['localhost', '127.0.0.1'].includes(location.hostname);
    document.addEventListener('DOMContentLoaded', ligar);

    return { processar, abrir, aplicar, descrever, faltando };
})();
