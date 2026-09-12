/* ==========================================================
   DATAS
   ----------------------------------------------------------
   Tudo que envolve data passa por aqui.
   Regra: datas "de calendário" (prazo, dia da avaliação) são
   sempre a string 'AAAA-MM-DD' no fuso LOCAL. Nunca usamos
   new Date('2026-09-20') direto, porque o JavaScript entende
   isso como UTC e a data aparece um dia antes no Brasil.
   ========================================================== */

window.ESEDates = (() => {

    const pad = (n) => String(n).padStart(2, '0');

    /* Date -> 'AAAA-MM-DD' usando o fuso local. */
    const toDateString = (date) =>
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

    /* 'AAAA-MM-DD' -> Date à meia-noite local. */
    const fromDateString = (str) => {
        const [y, m, d] = String(str).split('-').map(Number);
        return new Date(y, (m || 1) - 1, d || 1);
    };

    const today = () => {
        const d = new Date();
        d.setHours(0, 0, 0, 0);
        return d;
    };

    const todayString = () => toDateString(new Date());

    const addDays = (date, days) => {
        const d = new Date(date.getTime());
        d.setDate(d.getDate() + days);
        return d;
    };

    /* Segunda-feira da semana da data informada. */
    const startOfWeek = (date) => {
        const d = new Date(date.getTime());
        d.setHours(0, 0, 0, 0);
        const weekday = d.getDay();            // 0=domingo
        const offset = weekday === 0 ? -6 : 1 - weekday;
        d.setDate(d.getDate() + offset);
        return d;
    };

    /* Os sete dias da semana, de segunda a domingo. */
    const weekDays = (anchor) => {
        const monday = startOfWeek(anchor);
        return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
    };

    const WEEKDAY_NAMES = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];

    const shortWeekdayName = (date) => {
        const weekday = date.getDay();
        return WEEKDAY_NAMES[weekday === 0 ? 6 : weekday - 1];
    };

    /* '20/09' */
    const dayMonth = (date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}`;

    /* 'Setembro 2026' */
    const monthYear = (date) => {
        const label = date.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        return label.charAt(0).toUpperCase() + label.slice(1);
    };

    /* '09:30' a partir de um ISO com hora. */
    const timeLabel = (isoString) => {
        const d = new Date(isoString);
        if (Number.isNaN(d.getTime())) return '';
        return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    /* Diferença em dias inteiros entre hoje e uma data 'AAAA-MM-DD'.
       Negativo = atrasado. */
    const daysFromToday = (dateStr) => {
        const target = fromDateString(dateStr);
        const base = today();
        return Math.round((target - base) / 86400000);
    };

    /* 'Atrasado', 'Hoje', 'Amanhã', 'em 3 dias' */
    const relativeLabel = (dateStr) => {
        const diff = daysFromToday(dateStr);
        if (diff < -1) return `${Math.abs(diff)} dias atrasado`;
        if (diff === -1) return 'Atrasado 1 dia';
        if (diff === 0) return 'Hoje';
        if (diff === 1) return 'Amanhã';
        return `em ${diff} dias`;
    };

    const isSameDay = (a, b) => toDateString(a) === toDateString(b);

    return {
        toDateString, fromDateString, today, todayString, addDays,
        startOfWeek, weekDays, shortWeekdayName, dayMonth, monthYear,
        timeLabel, daysFromToday, relativeLabel, isSameDay
    };
})();
