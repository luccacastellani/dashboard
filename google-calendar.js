/* ==========================================================
   GOOGLE CALENDAR
   ----------------------------------------------------------
   Lê a agenda (GET) e, desde 14/09/2026, cria eventos (POST em
   criarEvento) quando o assistente pede — escopo calendar.events.
   Nada aqui altera ou apaga eventos existentes.
   ========================================================== */

window.GoogleCalendar = (() => {

    const BASE = 'https://www.googleapis.com/calendar/v3';
    const D = window.ESEDates;

    /* Cores de apoio quando o Google não manda uma. */
    const FALLBACK_COLORS = ['#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#6366f1'];

    /* Eventos que você recusou não precisam ocupar espaço. */
    const wasDeclined = (raw) =>
        Array.isArray(raw.attendees) &&
        raw.attendees.some((a) => a.self && a.responseStatus === 'declined');

    /* Um evento pode cobrir vários dias. Devolvemos uma entrada
       por dia, para o calendário semanal montar cada coluna.     */
    const expandToDays = (raw, calendar) => {
        const base = {
            id: raw.id,
            calendarId: calendar.id,
            calendarTitle: calendar.title,
            color: calendar.color,
            title: (raw.summary || '').trim() || '(sem título)',
            location: raw.location || '',
            htmlLink: raw.htmlLink || ''
        };

        /* Evento de dia inteiro: end.date é EXCLUSIVO no Google. */
        if (raw.start && raw.start.date) {
            const startDate = D.fromDateString(raw.start.date);
            const endExclusive = raw.end && raw.end.date
                ? D.fromDateString(raw.end.date)
                : D.addDays(startDate, 1);

            const days = [];
            let cursor = startDate;
            let guard = 0;
            while (cursor < endExclusive && guard < 60) {
                days.push({
                    ...base,
                    key: `${raw.id}:${D.toDateString(cursor)}`,
                    date: D.toDateString(cursor),
                    allDay: true,
                    startLabel: '',
                    endLabel: '',
                    sortKey: '00:00'
                });
                cursor = D.addDays(cursor, 1);
                guard += 1;
            }
            return days;
        }

        /* Evento com horário. */
        const startIso = raw.start && raw.start.dateTime;
        if (!startIso) return [];

        const startDateObj = new Date(startIso);
        if (Number.isNaN(startDateObj.getTime())) return [];

        const startLabel = D.timeLabel(startIso);
        const endLabel = raw.end && raw.end.dateTime ? D.timeLabel(raw.end.dateTime) : '';

        return [{
            ...base,
            key: `${raw.id}:${D.toDateString(startDateObj)}`,
            date: D.toDateString(startDateObj),
            allDay: false,
            startLabel,
            endLabel,
            sortKey: startLabel || '00:00'
        }];
    };

    /* ---------- Requisições ---------- */

    const fetchCalendars = async () => {
        const items = await window.GoogleAPI.requestAllPages(
            `${BASE}/users/me/calendarList`,
            { maxResults: 250, minAccessRole: 'reader' }
        );

        /* O id da agenda principal é o e-mail da conta. Guardamos para
           a renovação silenciosa saber qual conta usar. */
        const principal = items.find((c) => c.primary);
        if (principal && window.GoogleAuth && window.GoogleAuth.saveLoginHint) {
            window.GoogleAuth.saveLoginHint(principal.id);
        }

        return items
            /* Respeita quais agendas você deixou marcadas no Google Calendar. */
            .filter((c) => c.selected !== false)
            .map((c, i) => ({
                id: c.id,
                title: c.summaryOverride || c.summary || c.id,
                color: c.backgroundColor || FALLBACK_COLORS[i % FALLBACK_COLORS.length]
            }));
    };

    const fetchEventsForCalendar = async (calendar, timeMin, timeMax) => {
        const items = await window.GoogleAPI.requestAllPages(
            `${BASE}/calendars/${encodeURIComponent(calendar.id)}/events`,
            {
                timeMin: timeMin.toISOString(),
                timeMax: timeMax.toISOString(),
                singleEvents: 'true',      // expande eventos que se repetem
                orderBy: 'startTime',
                maxResults: 250
            }
        );

        return items
            .filter((raw) => raw.status !== 'cancelled' && !wasDeclined(raw))
            .flatMap((raw) => expandToDays(raw, calendar));
    };

    /* Busca uma janela ampla (5 semanas para trás, 13 para a frente), para a
       faixa semanal e a grade mensal usarem o mesmo cache.               */
    const fetchRange = async (anchorDate = new Date()) => {
        const monday = D.startOfWeek(anchorDate);
        const timeMin = D.addDays(monday, -35);
        const timeMax = D.addDays(monday, 91);

        const calendars = await fetchCalendars();

        const perCalendar = await Promise.all(
            calendars.map(async (cal) => {
                try {
                    return await fetchEventsForCalendar(cal, timeMin, timeMax);
                } catch (err) {
                    console.warn(`Falha ao ler a agenda "${cal.title}":`, err);
                    return [];
                }
            })
        );

        const events = perCalendar.flat().sort((a, b) =>
            a.date === b.date ? a.sortKey.localeCompare(b.sortKey) : a.date.localeCompare(b.date)
        );

        window.GoogleAPI.writeCache({ events });
        return events;
    };

    /* ---------- Consultas sobre o cache ---------- */

    const cachedEvents = () => window.GoogleAPI.readCache().events;

    const eventsOn = (dateStr) => cachedEvents().filter((e) => e.date === dateStr);

    const eventsForWeek = (anchorDate) =>
        D.weekDays(anchorDate).map((day) => {
            const dateStr = D.toDateString(day);
            return { date: day, dateStr, events: eventsOn(dateStr) };
        });

    /* Blocos ocupados por dia, em minutos — usado pelo Cronograma. */
    const busyMinutesByDate = () => {
        const busy = {};
        cachedEvents().forEach((e) => {
            if (e.allDay || !e.startLabel || !e.endLabel) return;
            const toMinutes = (label) => {
                const [h, m] = label.split(':').map(Number);
                return h * 60 + m;
            };
            const minutes = Math.max(0, toMinutes(e.endLabel) - toMinutes(e.startLabel));
            busy[e.date] = (busy[e.date] || 0) + minutes;
        });
        return busy;
    };

    /* ---------- Criar evento (pede o escopo calendar.events) ---------- */

    /* { titulo, data: 'AAAA-MM-DD', inicio: 'HH:MM' | '', fim: 'HH:MM' | '', lugar, descricao }
       Sem hora = evento de dia inteiro. Fuso: o do navegador (Europe/Amsterdam na Holanda). */
    const criarEvento = async ({ titulo, data, inicio, fim, lugar, descricao }) => {
        if (!titulo || !data) throw new Error('O evento precisa de título e dia.');
        const fuso = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Amsterdam';
        const corpo = { summary: String(titulo).trim() };
        if (lugar) corpo.location = String(lugar).trim();
        if (descricao) corpo.description = String(descricao).trim();
        if (inicio) {
            const fimReal = fim || (() => { const [h, m] = inicio.split(':').map(Number); const t = h * 60 + m + 60; return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; })();
            corpo.start = { dateTime: `${data}T${inicio}:00`, timeZone: fuso };
            corpo.end = { dateTime: `${data}T${fimReal}:00`, timeZone: fuso };
        } else {
            corpo.start = { date: data };
            corpo.end = { date: D.toDateString(D.addDays(D.fromDateString(data), 1)) };
        }
        const criado = await window.GoogleAPI.request(`${BASE}/calendars/primary/events`, { method: 'POST', body: JSON.stringify(corpo) });
        try { await fetchRange(D.fromDateString(data)); } catch { /* o cache atualiza na próxima leitura */ }
        return criado;
    };

    return { fetchRange, cachedEvents, eventsOn, eventsForWeek, busyMinutesByDate, criarEvento };
})();
