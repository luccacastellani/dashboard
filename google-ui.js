/* ==========================================================
   INTERFACE DAS ÁREAS DO GOOGLE
   ----------------------------------------------------------
   Desenha a Visão Geral, a aba Google Tasks e a faixa semanal
   do Calendário. Regra central: se o Google falhar, o resto do
   dashboard continua funcionando normalmente.
   ========================================================== */

document.addEventListener('DOMContentLoaded', () => {

    const D = window.ESEDates;
    const Auth = window.GoogleAuth;
    const API = window.GoogleAPI;
    const Tasks = window.GoogleTasks;
    const Cal = window.GoogleCalendar;
    const Gmail = window.GoogleGmail;

    const $ = (id) => document.getElementById(id);

    /* Nunca injetamos texto vindo do Google direto no HTML. */
    const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
    const esc = (value) => String(value === null || value === undefined ? '' : value)
        .replace(/[&<>"']/g, (c) => ESCAPES[c]);

    let weekAnchor = D.today();
    let showDoneGTasks = false;
    let isRefreshing = false;

    /* ---------- Estado da conexão ---------- */

    const renderStatus = (message, tone) => {
        const state = Auth.getState();
        const text = $('google-status-text');
        const connectBtn = $('google-connect-btn');
        const refreshBtn = $('google-refresh-btn');
        const bar = $('google-status-bar');
        if (!text || !bar) return;

        bar.classList.remove('status-ok', 'status-warn', 'status-error');

        if (message) {
            text.textContent = message;
            bar.classList.add(tone === 'error' ? 'status-error' : 'status-warn');
        } else if (!state.configured) {
            text.textContent = 'Conta do Google não configurada. Abra o menu e clique em "Configurar".';
            bar.classList.add('status-warn');
        } else if (!state.connected) {
            text.textContent = 'Desconectado do Google.';
            bar.classList.add('status-warn');
        } else {
            text.textContent = 'Conectado ao Google · ' + API.describeAge(API.readCache().fetchedAt);
            bar.classList.add('status-ok');
        }

        if (connectBtn) {
            connectBtn.style.display = state.connected ? 'none' : 'inline-flex';
            connectBtn.textContent = state.configured ? 'Conectar ao Google' : 'Configurar Google';
        }
        if (refreshBtn) {
            refreshBtn.style.display = state.connected ? 'inline-flex' : 'none';
            refreshBtn.disabled = isRefreshing;
            refreshBtn.textContent = isRefreshing ? 'Atualizando…' : 'Atualizar';
        }

        const age = API.describeAge(API.readCache().fetchedAt);
        [$('gtasks-age'), $('week-age')].forEach((el) => { if (el) el.textContent = age; });

        renderSidebarAccount();
    };

    /* ---------- Conta Google, no menu lateral ---------- */

    const renderSidebarAccount = () => {
        const status = $('sidebar-account-status');
        const connect = $('sidebar-connect');
        const settings = $('google-settings-btn');
        if (!status) return;

        const state = Auth.getState();
        const conta = Auth.readLoginHint ? Auth.readLoginHint() : '';

        status.classList.remove('is-on', 'is-off');

        if (state.connected) {
            status.textContent = conta || 'Conta do Google conectada';
            status.classList.add('is-on');
        } else if (state.configured) {
            status.textContent = 'Conta do Google desconectada';
            status.classList.add('is-off');
        } else {
            status.textContent = 'Nenhuma conta do Google';
            status.classList.add('is-off');
        }

        if (connect) {
            connect.style.display = state.connected ? 'none' : 'block';
            connect.textContent = state.configured ? 'Conectar ao Google' : 'Adicionar conta Google';
        }
        if (settings) settings.style.display = 'block';
    };

    /* ---------- Atalhos (Gemini, Canvas, Gmail) ---------- */

    /* Só aceitamos http(s): um link colado por engano não vira problema. */
    const setLink = (id, url, padrao) => {
        const el = $(id);
        if (!el) return;
        const limpo = String(url || '').trim();
        el.href = /^https?:\/\//i.test(limpo) ? limpo : padrao;
    };

    const renderAtalhos = () => {
        const cfg = window.ESE_CONFIG || {};
        setLink('gemini-link', Auth.readSettings().geminiUrl, 'https://gemini.google.com/app');
        setLink('canvas-link', cfg.CANVAS_URL, 'https://canvas.eur.nl');
        setLink('claude-link', cfg.CLAUDE_URL, 'https://claude.ai/new');
        setLink('linkedin-link', cfg.LINKEDIN_URL, 'https://www.linkedin.com/feed/');
        setLink('gmail-card', cfg.GMAIL_URL, 'https://mail.google.com/mail/u/0/#inbox');
        setLink('outlook-card', cfg.OUTLOOK_URL, 'https://outlook.office.com/mail/');
    };

    /* ---------- Gmail: só o número de não lidas ---------- */

    const renderGmail = () => {
        const card = $('gmail-card');
        const count = $('gmail-count');
        if (!card || !count) return;

        const naoLidas = Gmail.cachedUnread();
        count.textContent = Gmail.describeUnread(naoLidas);

        const rotulo = document.querySelector('#gmail-card .gmail-label');
        if (rotulo) rotulo.textContent = Gmail.describeSource();

        const detalhe = $('gmail-detail');
        if (detalhe) {
            const texto = Gmail.describeDetail();
            detalhe.textContent = texto;
            detalhe.style.display = texto ? 'block' : 'none';
        }

        card.classList.toggle('has-unread', Number.isFinite(naoLidas) && naoLidas > 0);
    };

    /* ---------- Faixa semanal ---------- */

    const readLocalArray = (key) => {
        try {
            const raw = JSON.parse(localStorage.getItem(key) || '[]');
            return Array.isArray(raw) ? raw : [];
        } catch {
            return [];
        }
    };

    /* "Polak Building, Room 2-07, Burgemeester Oudlaan 50, Rotterdam" -> "Polak Building, Room 2-07".
       O Google costuma mandar o endereço inteiro; a primeira parte é o que interessa. */
    const lugarCurto = (loc) => {
        const partes = String(loc || '').split(',').map((p) => p.trim()).filter(Boolean);
        if (!partes.length) return '';
        const util = partes.filter((p) => !/\d{4}\s?[A-Z]{2}|rotterdam|netherlands|nederland|oudlaan/i.test(p));
        return (util.length ? util : partes).slice(0, 2).join(', ');
    };

    window.lugarCurto = lugarCurto;

    const renderWeekStrip = (container, options) => {
        if (!container) return;
        const compact = Boolean(options && options.compact);

        const week = Cal.eventsForWeek(weekAnchor);
        const assessments = readLocalArray('eseAssessments');
        const todayStr = D.todayString();
        const connected = Auth.isConnected();
        const hasCache = API.readCache().fetchedAt > 0;

        container.innerHTML = week.map((day) => {
            const dayAssessments = assessments.filter((a) => a.date === day.dateStr);

            const eventHtml = day.events.map((e) => {
                const time = e.allDay ? 'dia todo' : e.startLabel;
                const title = esc(e.title) + (e.location ? ' · ' + esc(e.location) : '');
                return '<div class="week-event" style="border-left-color:' + esc(e.color) + '" title="' + title + '">'
                    + '<span class="week-event-time">' + esc(time) + '</span>'
                    + '<span class="week-event-title">' + esc(e.title) + '</span>'
                    + (e.location ? '<span class="week-event-place">📍 ' + esc(lugarCurto(e.location)) + '</span>' : '')
                    + '</div>';
            }).join('');

            const assessmentHtml = dayAssessments.map((a) =>
                '<div class="week-event week-event-assessment" title="Avaliação">'
                + '<span class="week-event-time">📝</span>'
                + '<span class="week-event-title">' + esc(a.name) + ' · ' + esc(a.subject) + '</span>'
                + '</div>'
            ).join('');

            let empty = '';
            if (!eventHtml && !assessmentHtml) {
                empty = (connected || hasCache)
                    ? '<div class="week-empty">livre</div>'
                    : '<div class="week-empty">—</div>';
            }

            return '<div class="week-day' + (day.dateStr === todayStr ? ' is-today' : '') + '">'
                + '<div class="week-day-head">'
                + '<span class="week-day-name">' + esc(D.shortWeekdayName(day.date)) + '</span>'
                + '<span class="week-day-date">' + esc(D.dayMonth(day.date)) + '</span>'
                + '</div>'
                + '<div class="week-day-events">' + assessmentHtml + eventHtml + empty + '</div>'
                + '</div>';
        }).join('');

        const range = $('week-range');
        if (range && !compact) {
            const days = D.weekDays(weekAnchor);
            range.textContent = D.dayMonth(days[0]) + ' a ' + D.dayMonth(days[6]);
        }
    };

    const renderAllWeekStrips = () => {
        renderWeekStrip($('week-strip'));
        renderWeekStrip($('overview-week'), { compact: true });
    };

    /* ---------- Aba Google Tasks ---------- */

    const renderTaskListPicker = () => {
        const select = $('gtasks-list');
        if (!select) return;
        const lists = Tasks.cached().lists;
        const previous = select.value;
        select.innerHTML = lists
            .map((l) => '<option value="' + esc(l.id) + '">' + esc(l.title) + '</option>')
            .join('');
        if (previous && lists.some((l) => l.id === previous)) select.value = previous;
        select.disabled = lists.length === 0;
    };

    const sortTasksForDisplay = (list) => list.slice().sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (!a.due && !b.due) return a.title.localeCompare(b.title, 'pt-BR');
        if (!a.due) return 1;
        if (!b.due) return -1;
        return a.due.localeCompare(b.due);
    });

    const renderGoogleTasks = () => {
        const box = $('gtasks-body');
        if (!box) return;

        const cache = Tasks.cached();
        const form = $('gtasks-form');
        const state = Auth.getState();

        if (form) form.style.display = state.configured ? 'grid' : 'none';

        if (!state.configured) {
            box.innerHTML = '<p class="empty-note">Abra o menu e clique em <strong>Adicionar conta Google</strong> para ver suas tarefas aqui.</p>';
            return;
        }

        if (cache.tasks.length === 0) {
            box.innerHTML = state.connected
                ? '<p class="empty-note">Nenhuma tarefa no Google Tasks.</p>'
                : '<p class="empty-note">Abra o menu e clique em <strong>Conectar ao Google</strong> para carregar suas tarefas.</p>';
            return;
        }

        const visible = cache.tasks.filter((t) => showDoneGTasks || !t.done);

        if (visible.length === 0) {
            box.innerHTML = '<p class="empty-note">Tudo concluído por aqui.</p>';
            return;
        }

        const groups = cache.lists
            .map((list) => ({
                list,
                items: sortTasksForDisplay(visible.filter((t) => t.listId === list.id))
            }))
            .filter((g) => g.items.length > 0);

        box.innerHTML = groups.map((group) => {
            const items = group.items.map((t) => {
                const diff = t.due ? D.daysFromToday(t.due) : null;
                let urgency = '';
                if (!t.done && diff !== null) {
                    urgency = diff < 0 ? 'is-late' : diff <= 1 ? 'is-urgent' : diff <= 3 ? 'is-soon' : '';
                }
                return '<li class="gtask-item ' + (t.done ? 'is-done ' : '') + urgency + '">'
                    + '<input type="checkbox" class="task-checkbox gtask-check"'
                    + ' data-list="' + esc(t.listId) + '" data-task="' + esc(t.id) + '"'
                    + (t.done ? ' checked' : '') + '>'
                    + '<div class="gtask-info">'
                    + '<span class="gtask-title">' + esc(t.title) + '</span>'
                    + (t.notes ? '<span class="gtask-notes">' + esc(t.notes) + '</span>' : '')
                    + '</div>'
                    + '<span class="gtask-due">' + (t.due ? esc(D.relativeLabel(t.due)) : 'sem prazo') + '</span>'
                    + '</li>';
            }).join('');

            return '<div class="gtasks-group">'
                + '<h4 class="gtasks-group-title">' + esc(group.list.title) + '</h4>'
                + '<ul class="gtasks-list">' + items + '</ul>'
                + '</div>';
        }).join('');
    };

    /* ---------- Redesenho geral ---------- */

    const renderAll = () => {
        renderStatus();
        renderAtalhos();
        renderGmail();
        renderAllWeekStrips();
        renderTaskListPicker();
        renderGoogleTasks();
    };

    /* ---------- Buscar dados ---------- */

    const refresh = async (options) => {
        const silent = Boolean(options && options.silent);
        if (isRefreshing) return;
        if (!Auth.isConfigured()) { renderAll(); return; }

        isRefreshing = true;
        renderStatus();

        /* Um lado falhar não pode impedir o outro de atualizar. */
        const results = await Promise.allSettled([
            Tasks.fetchAll(),
            Cal.fetchRange(weekAnchor),
            Gmail.fetchUnread()
        ]);

        isRefreshing = false;
        renderAll();

        const failures = results.filter((r) => r.status === 'rejected');
        if (failures.length > 0) {
            const err = failures[0].reason;
            const message = (err && err.message) || 'Não foi possível falar com o Google.';
            if (!silent || failures.length === results.length) renderStatus(message, 'error');
            console.warn('Falha ao atualizar dados do Google:', err);
        }
    };

    /* ---------- Modal de configuração ---------- */

    const modal = $('google-settings-modal');

    const openSettings = () => {
        if (!modal) return;
        const settings = Auth.readSettings();
        if ($('google-client-id')) $('google-client-id').value = settings.clientId;
        if ($('gemini-url')) $('gemini-url').value = settings.geminiUrl;
        modal.style.display = 'flex';
    };

    const closeSettings = () => { if (modal) modal.style.display = 'none'; };

    if ($('google-settings-btn')) $('google-settings-btn').addEventListener('click', openSettings);
    if ($('google-settings-close')) $('google-settings-close').addEventListener('click', closeSettings);
    if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeSettings(); });

    if ($('google-disconnect')) {
        $('google-disconnect').addEventListener('click', () => {
            Auth.disconnect();
            API.clearCache();
            closeSettings();
            renderAll();
        });
    }

    const settingsForm = $('google-settings-form');
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const clientId = $('google-client-id') ? $('google-client-id').value.trim() : '';
            const geminiUrl = $('gemini-url') ? $('gemini-url').value.trim() : '';

            if (clientId && !/\.apps\.googleusercontent\.com$/.test(clientId)) {
                renderStatus('O Client ID deve terminar em .apps.googleusercontent.com', 'error');
                return;
            }

            Auth.saveSettings({
                clientId,
                geminiUrl: geminiUrl || 'https://gemini.google.com/app'
            });

            closeSettings();
            renderAll();

            if (clientId) {
                try {
                    await Auth.connect();
                    await refresh();
                } catch {
                    renderStatus('Configuração salva. Agora clique em "Conectar ao Google".', 'warn');
                }
            }
        });
    }

    /* ---------- Importar dados da versão antiga ----------
       O navegador guarda dados por endereço. Como a versão antiga
       abria como arquivo (file://) e esta roda em localhost, os
       dados não passam sozinhos — este bloco faz a ponte.        */

    const CHAVES_VALIDAS = /^ese[A-Za-z0-9_]*$/;

    const setImportStatus = (message, tone) => {
        const el = $('import-status');
        if (!el) return;
        el.textContent = message;
        el.className = 'import-status' + (tone ? ' is-' + tone : '');
    };

    const importarPacote = (texto) => {
        let pacote;
        try {
            pacote = JSON.parse(texto);
        } catch {
            setImportStatus('Arquivo inválido: não consegui ler o conteúdo.', 'error');
            return;
        }

        const dados = pacote && pacote.dados;
        if (!dados || typeof dados !== 'object' || Array.isArray(dados)) {
            setImportStatus('Arquivo inválido: não parece um backup do dashboard.', 'error');
            return;
        }

        const chaves = Object.keys(dados).filter((k) => CHAVES_VALIDAS.test(k));
        if (chaves.length === 0) {
            setImportStatus('Não encontrei dados do dashboard nesse arquivo.', 'error');
            return;
        }

        const existentes = chaves.filter((k) => localStorage.getItem(k) !== null);
        if (existentes.length > 0) {
            const ok = confirm(
                'Isto vai substituir ' + existentes.length + ' conjunto(s) de dados que já existem aqui.\n\n' +
                'Deseja continuar?'
            );
            if (!ok) {
                setImportStatus('Importação cancelada.', 'warn');
                return;
            }
        }

        let gravadas = 0;
        try {
            chaves.forEach((chave) => {
                const valor = dados[chave];
                if (typeof valor === 'string') {
                    localStorage.setItem(chave, valor);
                    gravadas += 1;
                }
            });
        } catch (err) {
            setImportStatus('Não consegui gravar tudo: ' + ((err && err.message) || 'erro desconhecido'), 'error');
            return;
        }

        setImportStatus(gravadas + ' conjunto(s) importado(s). Recarregando…', 'ok');
        setTimeout(() => window.location.reload(), 900);
    };

    const importFile = $('import-file');
    const importText = $('import-text');
    const importRun = $('import-run');

    if (importRun) {
        importRun.addEventListener('click', () => {
            const arquivo = importFile && importFile.files && importFile.files[0];

            if (arquivo) {
                const reader = new FileReader();
                reader.onload = () => importarPacote(String(reader.result || ''));
                reader.onerror = () => setImportStatus('Não consegui abrir o arquivo.', 'error');
                reader.readAsText(arquivo);
                return;
            }

            const colado = importText ? importText.value.trim() : '';
            if (colado) {
                importarPacote(colado);
                return;
            }

            setImportStatus('Escolha um arquivo ou cole o texto antes de importar.', 'warn');
        });
    }

    /* ---------- Eventos ---------- */

    const connectBtn = $('google-connect-btn');
    if (connectBtn) {
        connectBtn.addEventListener('click', async () => {
            if (!Auth.isConfigured()) { openSettings(); return; }
            connectBtn.disabled = true;
            renderStatus('Levando você ao Google…', 'warn');
            try {
                /* Se a renovação silenciosa funcionar, isto resolve.
                   Se não, a página é redirecionada para o Google e
                   nada mais aqui chega a rodar. */
                await Auth.connect();
                await refresh();
            } catch {
                renderStatus('Não foi possível conectar. Confira o Client ID em "Configurar Google".', 'error');
            } finally {
                connectBtn.disabled = false;
            }
        });
    }

    /* Mesmo comportamento do botão do Início, agora no menu lateral. */
    const sidebarConnect = $('sidebar-connect');
    if (sidebarConnect) {
        sidebarConnect.addEventListener('click', async () => {
            if (!Auth.isConfigured()) { openSettings(); return; }
            sidebarConnect.disabled = true;
            try {
                await Auth.connect();
                await refresh();
            } catch {
                renderStatus('Não foi possível conectar. Confira o Client ID em "Configurar".', 'error');
            } finally {
                sidebarConnect.disabled = false;
            }
        });
    }

    [$('google-refresh-btn'), $('gtasks-refresh'), $('week-refresh')].forEach((btn) => {
        if (btn) btn.addEventListener('click', () => refresh());
    });

    const moveWeek = async (deltaDays) => {
        weekAnchor = D.addDays(weekAnchor, deltaDays);
        renderAllWeekStrips();
        if (Auth.isConnected()) await refresh({ silent: true });
    };

    if ($('week-prev')) $('week-prev').addEventListener('click', () => moveWeek(-7));
    if ($('week-next')) $('week-next').addEventListener('click', () => moveWeek(7));
    if ($('week-today')) {
        $('week-today').addEventListener('click', () => {
            weekAnchor = D.today();
            renderAllWeekStrips();
        });
    }

    /* Marcar tarefa do Google como feita */
    const gtasksBody = $('gtasks-body');
    if (gtasksBody) {
        gtasksBody.addEventListener('change', async (event) => {
            const check = event.target.closest('.gtask-check');
            if (!check) return;

            const listId = check.dataset.list;
            const taskId = check.dataset.task;
            const done = check.checked;

            check.disabled = true;
            try {
                await Tasks.setDone(listId, taskId, done);
                renderGoogleTasks();
                renderStatus();
            } catch (err) {
                check.checked = !done;   /* desfaz na tela se o Google recusou */
                renderStatus((err && err.message) || 'Não foi possível atualizar a tarefa.', 'error');
            } finally {
                check.disabled = false;
            }
        });
    }

    /* Criar tarefa no Google */
    const gtasksForm = $('gtasks-form');
    if (gtasksForm) {
        gtasksForm.addEventListener('submit', async (event) => {
            event.preventDefault();

            const titleInput = $('gtasks-title');
            const listSelect = $('gtasks-list');
            const dueInput = $('gtasks-due');

            const title = titleInput ? titleInput.value.trim() : '';
            const listId = listSelect ? listSelect.value : '';

            if (!title) return;
            if (!listId) {
                renderStatus('Nenhuma lista do Google Tasks disponível. Clique em "Atualizar".', 'error');
                return;
            }

            const submitBtn = gtasksForm.querySelector('button[type="submit"]');
            if (submitBtn) submitBtn.disabled = true;

            try {
                await Tasks.create(listId, { title, due: dueInput ? dueInput.value : '' });
                gtasksForm.reset();
                renderTaskListPicker();
                if (listSelect) listSelect.value = listId;
                renderGoogleTasks();
                renderStatus();
            } catch (err) {
                renderStatus((err && err.message) || 'Não foi possível criar a tarefa.', 'error');
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });
    }

    /* Mostrar/esconder concluídas */
    const toggleDone = $('gtasks-toggle-done');
    if (toggleDone) {
        toggleDone.addEventListener('click', () => {
            showDoneGTasks = !showDoneGTasks;
            toggleDone.classList.toggle('active', showDoneGTasks);
            toggleDone.textContent = showDoneGTasks
                ? '✓ Esconder tarefas concluídas'
                : 'Mostrar tarefas concluídas';
            renderGoogleTasks();
        });
    }

    /* ---------- Início ---------- */

    Auth.onChange(() => renderStatus());

    /* Desenha já com o cache, para a tela nunca aparecer vazia. */
    renderAll();

    /* Traduz o que o Google devolve quando a autorização não vai adiante. */
    const MENSAGENS_REDIRECT = {
        access_denied: 'Você cancelou a autorização no Google. Clique em "Conectar ao Google" para tentar de novo.',
        state_mismatch: 'A resposta do Google não conferiu. Por segurança, cancelei. Tente conectar de novo.',
        sem_token: 'O Google não devolveu um token. Tente conectar de novo.',
        redirect_uri_mismatch: 'O endereço de retorno não bate com o cadastrado no Google Cloud. Deve ser http://localhost:8000/'
    };

    /* Depois vê se estamos voltando do Google, ou renova em silêncio. */
    Auth.restore().then((connected) => {
        const erro = Auth.takeRedirectError();
        if (erro) {
            renderStatus(MENSAGENS_REDIRECT[erro] || ('O Google recusou a autorização: ' + erro), 'error');
            return;
        }
        renderStatus();
        if (connected) refresh({ silent: true });
    });

    /* Redesenha ao trocar de aba, para os dados não ficarem velhos na tela. */
    window.onTabShown = (target) => {
        if (target === 'home') {
            renderGmail();
            renderAllWeekStrips();
            renderTaskListPicker();
            renderGoogleTasks();
            renderStatus();
        }
        if (target === 'calendar-view') {
            renderAllWeekStrips();
            renderStatus();
        }
    };
});
