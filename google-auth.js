/* ==========================================================
   GOOGLE — AUTENTICAÇÃO
   ----------------------------------------------------------
   Login pelo Google Identity Services, direto no navegador.
   Não existe senha nem segredo guardado. O token fica só na
   memória da aba e some quando você fecha o navegador.
   ========================================================== */

window.GoogleAuth = (() => {

    const SETTINGS_KEY = 'eseGoogleSettings';

    let tokenClient = null;
    let accessToken = null;
    let tokenExpiresAt = 0;
    let pendingRequest = null;

    /* ---------- Configurações (localStorage sobrepõe config.js) ---------- */

    const readSettings = () => {
        let saved = {};
        try {
            saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
        } catch {
            saved = {};
        }
        const base = window.ESE_CONFIG || {};
        return {
            clientId: (saved.clientId || base.GOOGLE_CLIENT_ID || '').trim(),
            geminiUrl: (saved.geminiUrl || base.GEMINI_URL || 'https://gemini.google.com/app').trim()
        };
    };

    const saveSettings = (patch) => {
        const current = readSettings();
        const next = { ...current, ...patch };
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
        /* Um Client ID novo invalida o cliente de token atual. */
        if (patch.clientId !== undefined) {
            tokenClient = null;
            accessToken = null;
            tokenExpiresAt = 0;
        }
        notify();
        return next;
    };

    /* ---------- Estado observável ---------- */

    const listeners = new Set();
    const onChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
    const notify = () => listeners.forEach((fn) => { try { fn(getState()); } catch (e) { console.error(e); } });

    const isConfigured = () => Boolean(readSettings().clientId);
    const isConnected = () => Boolean(accessToken) && Date.now() < tokenExpiresAt;

    const getState = () => ({
        configured: isConfigured(),
        connected: isConnected(),
        settings: readSettings()
    });

    /* ---------- Biblioteca do Google ---------- */

    const gisReady = () =>
        typeof google !== 'undefined' &&
        google.accounts &&
        google.accounts.oauth2;

    const waitForGis = (timeoutMs = 10000) => new Promise((resolve, reject) => {
        if (gisReady()) return resolve();
        const started = Date.now();
        const tick = setInterval(() => {
            if (gisReady()) {
                clearInterval(tick);
                resolve();
            } else if (Date.now() - started > timeoutMs) {
                clearInterval(tick);
                reject(new Error('Não foi possível carregar a biblioteca do Google. Verifique sua internet.'));
            }
        }, 100);
    });

    const ensureTokenClient = async () => {
        const { clientId } = readSettings();
        if (!clientId) throw new Error('NOT_CONFIGURED');
        if (tokenClient) return tokenClient;

        await waitForGis();

        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: (window.ESE_CONFIG && window.ESE_CONFIG.SCOPES) || '',
            /* Preenchidos por requestToken() a cada chamada. */
            callback: () => {},
            error_callback: () => {}
        });

        return tokenClient;
    };

    /* ---------- Pedido de token ----------
       interactive=false tenta renovar em silêncio (funciona quando
       você já está logada no Google neste navegador e já autorizou
       o app antes). interactive=true abre a janela do Google.       */

    const requestToken = async ({ interactive }) => {
        const client = await ensureTokenClient();

        /* Evita abrir duas janelas se algo pedir token em paralelo. */
        if (pendingRequest) return pendingRequest;

        pendingRequest = new Promise((resolve, reject) => {
            client.callback = (response) => {
                pendingRequest = null;
                if (response && response.access_token) {
                    accessToken = response.access_token;
                    /* 60s de margem para não usar um token prestes a vencer. */
                    const lifetime = (Number(response.expires_in) || 3600) - 60;
                    tokenExpiresAt = Date.now() + lifetime * 1000;
                    notify();
                    resolve(accessToken);
                } else {
                    reject(new Error('O Google não devolveu um token de acesso.'));
                }
            };

            client.error_callback = (err) => {
                pendingRequest = null;
                const type = (err && err.type) || '';
                if (type === 'popup_closed' || type === 'popup_failed_to_open') {
                    reject(new Error('POPUP_BLOCKED'));
                } else {
                    reject(new Error('SILENT_FAILED'));
                }
            };

            try {
                client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
            } catch (err) {
                pendingRequest = null;
                reject(err);
            }
        });

        return pendingRequest;
    };

    /* Token válido para uma chamada de API.
       Só tenta a renovação silenciosa (iframe, sem pop-up). Se falhar,
       a tela mostra "Reconectar" e o redirecionamento entra em cena —
       nunca interrompemos a usuária com uma janela no meio do caminho. */
    const getAccessToken = async () => {
        if (isConnected()) return accessToken;
        return requestToken({ interactive: false });
    };

    /* ---------- Conexão por redirecionamento ----------
       Em vez de abrir uma janelinha (que o navegador bloqueia),
       levamos a própria página até o Google e voltamos com o
       token no endereço. Sem pop-up, sem bloqueador.          */

    const STATE_KEY = 'eseGoogleAuthState';
    const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';

    /* Precisa bater exatamente com o "Authorised redirect URI"
       cadastrado no Google Cloud. No PC é http://localhost:8000/;
       no site publicado é https://usuario.github.io/dashboard/
       (por isso o caminho entra, e não só a origem). */
    const redirectUri = () => {
        const caminho = window.location.pathname.replace(/index\.html$/, '');
        return window.location.origin + (caminho.endsWith('/') ? caminho : caminho + '/');
    };

    const randomState = () => {
        const bytes = new Uint8Array(16);
        (window.crypto || window.msCrypto).getRandomValues(bytes);
        return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    };

    /* Marca que você já autorizou uma vez. Com isso o Google
       consegue nos devolver um token novo sem perguntar nada. */
    const CONSENT_KEY = 'eseGoogleConsentGranted';
    const TENTOU_KEY = 'eseGoogleSilentTried';

    /* Qual conta usar na renovação silenciosa.
       Sem isto, quem tem mais de uma conta Google logada nunca
       consegue renovar sem tela: o Google não sabe qual escolher. */
    const HINT_KEY = 'eseGoogleLoginHint';

    const readLoginHint = () => {
        try {
            return localStorage.getItem(HINT_KEY)
                || (window.ESE_CONFIG && window.ESE_CONFIG.GOOGLE_LOGIN_HINT)
                || '';
        } catch {
            return (window.ESE_CONFIG && window.ESE_CONFIG.GOOGLE_LOGIN_HINT) || '';
        }
    };

    /* Descoberto sozinho: o id da agenda principal é o e-mail da conta. */
    const saveLoginHint = (email) => {
        const limpo = String(email || '').trim();
        if (!limpo || limpo.indexOf('@') === -1) return;
        try {
            if (localStorage.getItem(HINT_KEY) !== limpo) localStorage.setItem(HINT_KEY, limpo);
        } catch { /* ignora */ }
    };

    const jaAutorizou = () => {
        try { return localStorage.getItem(CONSENT_KEY) === '1'; } catch { return false; }
    };

    const marcarAutorizado = () => {
        try { localStorage.setItem(CONSENT_KEY, '1'); } catch { /* ignora */ }
    };

    const startRedirectConnect = ({ silencioso = false } = {}) => {
        const { clientId } = readSettings();
        if (!clientId) throw new Error('NOT_CONFIGURED');

        const state = randomState();
        try {
            sessionStorage.setItem(STATE_KEY, state);
        } catch {
            /* Sem sessionStorage seguimos assim mesmo; o Google ainda
               valida o redirect_uri, que é a proteção que importa. */
        }

        const url = new URL(AUTH_URL);
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirectUri());
        url.searchParams.set('response_type', 'token');
        url.searchParams.set('scope', (window.ESE_CONFIG && window.ESE_CONFIG.SCOPES) || '');
        url.searchParams.set('include_granted_scopes', 'true');
        url.searchParams.set('state', state);
        /* prompt=none: o Google devolve o token na hora, sem tela
           nenhuma, quando você já autorizou e está logada. */
        url.searchParams.set('prompt', silencioso ? 'none' : 'consent');

        /* Diz qual conta usar. Com mais de uma conta logada, sem isto
           o Google recusa a renovação silenciosa e pede uma tela. */
        const hint = readLoginHint();
        if (hint) url.searchParams.set('login_hint', hint);

        window.location.href = url.toString();
    };

    /* Lê o token que o Google devolveu no fragmento do endereço. */
    const consumeRedirectResult = () => {
        const hash = window.location.hash || '';
        if (hash.length < 2 || hash.indexOf('access_token') === -1 && hash.indexOf('error') === -1) {
            return null;
        }

        const params = new URLSearchParams(hash.slice(1));
        const limparEndereco = () => {
            const limpo = window.location.pathname + window.location.search;
            window.history.replaceState(null, '', limpo);
        };

        let esperado = null;
        try {
            esperado = sessionStorage.getItem(STATE_KEY);
            sessionStorage.removeItem(STATE_KEY);
        } catch {
            esperado = null;
        }

        const erro = params.get('error');
        if (erro) {
            limparEndereco();
            return { error: erro };
        }

        const recebido = params.get('state');
        if (esperado && recebido !== esperado) {
            limparEndereco();
            return { error: 'state_mismatch' };
        }

        const token = params.get('access_token');
        if (!token) {
            limparEndereco();
            return { error: 'sem_token' };
        }

        accessToken = token;
        const lifetime = (Number(params.get('expires_in')) || 3600) - 60;
        tokenExpiresAt = Date.now() + lifetime * 1000;

        marcarAutorizado();

        /* Deu certo: libera a trava, para que daqui a uma hora,
           quando este token vencer, a renovação possa acontecer
           de novo sozinha. */
        try { sessionStorage.removeItem(TENTOU_KEY); } catch { /* ignora */ }

        limparEndereco();
        notify();
        return { ok: true };
    };

    /* Botão "Conectar" / "Reconectar".
       Tenta renovar em silêncio (num iframe, sem pop-up);
       se não der, redireciona a página para o Google.         */
    const connect = async () => {
        try {
            return await requestToken({ interactive: false });
        } catch {
            startRedirectConnect();
            /* A página vai sair do ar; esta promessa nunca resolve. */
            return new Promise(() => {});
        }
    };

    const disconnect = () => {
        const token = accessToken;
        accessToken = null;
        tokenExpiresAt = 0;

        /* Sem isto, a página reconectaria sozinha no próximo carregamento
           e o botão "Desconectar" não teria efeito nenhum. */
        try {
            localStorage.removeItem(CONSENT_KEY);
            sessionStorage.setItem(TENTOU_KEY, '1');
        } catch { /* ignora */ }
        if (token && gisReady() && google.accounts.oauth2.revoke) {
            try { google.accounts.oauth2.revoke(token, () => {}); } catch { /* ignora */ }
        }
        notify();
    };

    /* Erros que só querem dizer "precisa da sua interação".
       Não são falhas de verdade: apenas mostramos "Conectar". */
    const ERROS_SILENCIOSOS = ['interaction_required', 'login_required', 'consent_required'];

    const marcarTentativa = () => {
        try { sessionStorage.setItem(TENTOU_KEY, '1'); } catch { /* ignora */ }
    };

    const jaTentouNestaSessao = () => {
        try { return sessionStorage.getItem(TENTOU_KEY) === '1'; } catch { return true; }
    };

    /* Ao abrir a página:
       1. Estamos voltando do Google? Pega o token.
       2. Já autorizou antes? Vai buscar um token novo sem perguntar nada.
       3. Senão, fica desconectada e mostra o botão.                      */
    const restore = async () => {
        const vindoDoGoogle = consumeRedirectResult();

        if (vindoDoGoogle && vindoDoGoogle.ok) return true;

        if (vindoDoGoogle && vindoDoGoogle.error) {
            marcarTentativa();
            /* Um prompt=none recusado é esperado: só pede um clique. */
            if (!ERROS_SILENCIOSOS.includes(vindoDoGoogle.error)) {
                lastRedirectError = vindoDoGoogle.error;
            }
            return false;
        }

        if (!isConfigured()) return false;

        /* Renovação sem nenhuma tela. A trava de sessão evita
           qualquer chance de ficar redirecionando em círculos. */
        if (jaAutorizou() && !jaTentouNestaSessao()) {
            marcarTentativa();
            try {
                startRedirectConnect({ silencioso: true });
                return new Promise(() => {});   // a página está saindo
            } catch {
                return false;
            }
        }

        try {
            await requestToken({ interactive: false });
            return true;
        } catch {
            return false;
        }
    };

    let lastRedirectError = null;
    const takeRedirectError = () => {
        const erro = lastRedirectError;
        lastRedirectError = null;
        return erro;
    };

    return {
        getState, onChange,
        readSettings, saveSettings,
        isConfigured, isConnected,
        getAccessToken, connect, disconnect, restore,
        takeRedirectError, saveLoginHint, readLoginHint
    };
})();
