/* ==========================================================
   GOOGLE — CHAMADAS DE API E CACHE
   ----------------------------------------------------------
   Camada fina sobre o fetch: coloca o token, tenta renovar uma
   vez se o Google responder 401 e traduz erros para mensagens
   em português. Também guarda a última resposta boa, para o
   dashboard continuar útil sem internet.
   ========================================================== */

window.GoogleAPI = (() => {

    const CACHE_KEY = 'eseGoogleCache';

    /* ---------- Cache ---------- */

    const readCache = () => {
        try {
            const raw = JSON.parse(localStorage.getItem(CACHE_KEY) || '{}');
            return {
                taskLists: Array.isArray(raw.taskLists) ? raw.taskLists : [],
                tasks: Array.isArray(raw.tasks) ? raw.tasks : [],
                events: Array.isArray(raw.events) ? raw.events : [],
                /* Só a contagem de não lidas — nunca conteúdo de e-mail. */
                gmailUnread: Number.isFinite(raw.gmailUnread) ? raw.gmailUnread : null,
                gmailUnreadDetail: Number.isFinite(raw.gmailUnreadDetail) ? raw.gmailUnreadDetail : null,
                fetchedAt: Number(raw.fetchedAt) || 0
            };
        } catch {
            return { taskLists: [], tasks: [], events: [], gmailUnread: null, gmailUnreadDetail: null, fetchedAt: 0 };
        }
    };

    const writeCache = (patch) => {
        const next = { ...readCache(), ...patch, fetchedAt: Date.now() };
        try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(next));
        } catch (err) {
            /* Cota estourada não pode derrubar a tela. */
            console.warn('Não foi possível salvar o cache do Google:', err);
        }
        return next;
    };

    const clearCache = () => localStorage.removeItem(CACHE_KEY);

    /* "atualizado há X" */
    const describeAge = (timestamp) => {
        if (!timestamp) return 'nunca atualizado';
        const seconds = Math.floor((Date.now() - timestamp) / 1000);
        if (seconds < 60) return 'atualizado agora';
        const minutes = Math.floor(seconds / 60);
        if (minutes < 60) return `atualizado há ${minutes} min`;
        const hours = Math.floor(minutes / 60);
        if (hours < 24) return `atualizado há ${hours}h`;
        const days = Math.floor(hours / 24);
        return `atualizado há ${days}d`;
    };

    /* ---------- Erros legíveis ---------- */

    class GoogleError extends Error {
        constructor(message, { code = '', status = 0 } = {}) {
            super(message);
            this.name = 'GoogleError';
            this.code = code;
            this.status = status;
        }
    }

    const describeHttpError = (status, body) => {
        const apiMessage = body && body.error && body.error.message;
        switch (status) {
            case 401:
                return 'Sua conexão com o Google expirou. Clique em "Reconectar".';
            case 403:
                if (apiMessage && /disabled|not been used/i.test(apiMessage)) {
                    return 'A API não está ativada no seu projeto do Google Cloud. Veja o LEIA-ME.md.';
                }
                return 'O Google recusou o acesso. Confira as permissões no LEIA-ME.md.';
            case 404:
                return 'O Google não encontrou esse item. Ele pode ter sido apagado.';
            case 429:
                return 'Muitas requisições seguidas. Espere um minuto e tente de novo.';
            default:
                if (status >= 500) return 'O Google está com problemas no momento. Tente mais tarde.';
                return apiMessage || `Erro inesperado do Google (${status}).`;
        }
    };

    /* ---------- Requisição ---------- */

    const request = async (url, options = {}, { isRetry = false } = {}) => {
        if (!window.GoogleAuth.isConfigured()) {
            throw new GoogleError('Conexão com o Google ainda não configurada.', { code: 'NOT_CONFIGURED' });
        }

        let token;
        try {
            token = await window.GoogleAuth.getAccessToken();
        } catch (err) {
            if (err && err.message === 'POPUP_BLOCKED') {
                throw new GoogleError('O navegador bloqueou a janela do Google. Libere pop-ups para localhost.', { code: 'POPUP_BLOCKED' });
            }
            throw new GoogleError('Não foi possível conectar ao Google.', { code: 'NOT_CONNECTED' });
        }

        let response;
        try {
            response = await fetch(url, {
                ...options,
                headers: {
                    Authorization: `Bearer ${token}`,
                    ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                    ...(options.headers || {})
                }
            });
        } catch {
            throw new GoogleError('Sem conexão com a internet.', { code: 'OFFLINE' });
        }

        if (response.status === 204) return null;

        let body = null;
        try {
            body = await response.json();
        } catch {
            body = null;
        }

        if (!response.ok) {
            /* Token recusado: renova uma vez e repete. */
            if (response.status === 401 && !isRetry) {
                window.GoogleAuth.disconnect();
                return request(url, options, { isRetry: true });
            }
            throw new GoogleError(describeHttpError(response.status, body), {
                code: 'HTTP_' + response.status,
                status: response.status
            });
        }

        return body;
    };

    /* Busca todas as páginas de um endpoint que devolve { items, nextPageToken }. */
    const requestAllPages = async (baseUrl, params = {}, options = {}) => {
        const items = [];
        let pageToken = '';
        let guard = 0;

        do {
            const url = new URL(baseUrl);
            Object.entries(params).forEach(([k, v]) => {
                if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
            });
            if (pageToken) url.searchParams.set('pageToken', pageToken);

            const page = await request(url.toString(), {}, options);
            if (page && Array.isArray(page.items)) items.push(...page.items);
            pageToken = (page && page.nextPageToken) || '';
            guard += 1;
        } while (pageToken && guard < 20);

        return items;
    };

    return { request, requestAllPages, readCache, writeCache, clearCache, describeAge, GoogleError };
})();
