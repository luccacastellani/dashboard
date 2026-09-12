/* ==========================================================
   GOOGLE TASKS
   ----------------------------------------------------------
   Ler, marcar como feita e criar tarefas.
   Tudo que acontece aqui aparece no app do Google Tasks
   e no seu celular.
   ========================================================== */

window.GoogleTasks = (() => {

    const BASE = 'https://tasks.googleapis.com/tasks/v1';

    /* O Google Tasks guarda o prazo como data-hora, mas só usa a
       parte da data. Convertemos nos dois sentidos para evitar o
       clássico bug de "a tarefa aparece um dia antes".            */

    const dueToDateString = (due) => (due ? String(due).slice(0, 10) : '');
    const dateStringToDue = (dateStr) => (dateStr ? `${dateStr}T00:00:00.000Z` : null);

    const normalizeTask = (raw, list) => ({
        id: raw.id,
        listId: list.id,
        listTitle: list.title,
        title: (raw.title || '').trim() || '(sem título)',
        notes: raw.notes || '',
        due: dueToDateString(raw.due),
        done: raw.status === 'completed',
        updated: raw.updated || '',
        position: raw.position || ''
    });

    /* ---------- Leitura ---------- */

    const fetchLists = async () => {
        const items = await window.GoogleAPI.requestAllPages(
            `${BASE}/users/@me/lists`,
            { maxResults: 100 }
        );
        return items.map((l) => ({ id: l.id, title: l.title || 'Sem nome' }));
    };

    const fetchTasksForList = async (list) => {
        const items = await window.GoogleAPI.requestAllPages(
            `${BASE}/lists/${encodeURIComponent(list.id)}/tasks`,
            { maxResults: 100, showCompleted: 'true', showHidden: 'true' }
        );
        return items.map((raw) => normalizeTask(raw, list));
    };

    /* Busca listas e tarefas e atualiza o cache. */
    const fetchAll = async () => {
        const lists = await fetchLists();

        const perList = await Promise.all(
            lists.map(async (list) => {
                try {
                    return await fetchTasksForList(list);
                } catch (err) {
                    /* Uma lista com problema não derruba as outras. */
                    console.warn(`Falha ao ler a lista "${list.title}":`, err);
                    return [];
                }
            })
        );

        const tasks = perList.flat();
        window.GoogleAPI.writeCache({ taskLists: lists, tasks });
        return { lists, tasks };
    };

    /* ---------- Escrita ---------- */

    const setDone = async (listId, taskId, done) => {
        const body = done
            ? { status: 'completed' }
            : { status: 'needsAction', completed: null };

        const updated = await window.GoogleAPI.request(
            `${BASE}/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
            { method: 'PATCH', body: JSON.stringify(body) }
        );

        patchCachedTask(taskId, {
            done,
            updated: (updated && updated.updated) || new Date().toISOString()
        });

        return updated;
    };

    const create = async (listId, { title, due, notes }) => {
        const body = { title: String(title || '').trim() };
        if (!body.title) throw new Error('A tarefa precisa de um título.');
        if (due) body.due = dateStringToDue(due);
        if (notes) body.notes = notes;

        const created = await window.GoogleAPI.request(
            `${BASE}/lists/${encodeURIComponent(listId)}/tasks`,
            { method: 'POST', body: JSON.stringify(body) }
        );

        const cache = window.GoogleAPI.readCache();
        const list = cache.taskLists.find((l) => l.id === listId) || { id: listId, title: '' };
        const task = normalizeTask(created, list);
        window.GoogleAPI.writeCache({ tasks: [...cache.tasks, task] });

        return task;
    };

    /* Mantém o cache coerente sem precisar rebuscar tudo. */
    const patchCachedTask = (taskId, patch) => {
        const cache = window.GoogleAPI.readCache();
        const tasks = cache.tasks.map((t) => (t.id === taskId ? { ...t, ...patch } : t));
        window.GoogleAPI.writeCache({ tasks });
    };

    /* ---------- Consultas sobre o cache ---------- */

    const cached = () => {
        const { taskLists, tasks } = window.GoogleAPI.readCache();
        return { lists: taskLists, tasks };
    };

    /* Pendentes ordenadas por prazo; sem prazo vão para o fim. */
    const pendingSorted = () => {
        const { tasks } = cached();
        return tasks
            .filter((t) => !t.done)
            .sort((a, b) => {
                if (!a.due && !b.due) return a.title.localeCompare(b.title, 'pt-BR');
                if (!a.due) return 1;
                if (!b.due) return -1;
                return a.due.localeCompare(b.due);
            });
    };

    /* Vencendo até N dias (inclui atrasadas e sem prazo=não). */
    const dueWithin = (days) => {
        const limit = new Date();
        limit.setHours(0, 0, 0, 0);
        limit.setDate(limit.getDate() + days);
        const limitStr = window.ESEDates.toDateString(limit);
        return pendingSorted().filter((t) => t.due && t.due <= limitStr);
    };

    return { fetchAll, setDone, create, cached, pendingSorted, dueWithin };
})();
