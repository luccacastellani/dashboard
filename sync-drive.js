/* ==========================================================
   SINCRONIZAÇÃO COM O GOOGLE DRIVE
   ----------------------------------------------------------
   Guarda os dados do dashboard num arquivo escondido no Drive
   da usuária (a "pasta de apps": ela não vê, outros apps não
   veem). É o que faz PC e celular mostrarem a mesma coisa.

   Como funciona:
   - Ao conectar ao Google, compara o arquivo do Drive com o que
     está neste aparelho. O mais novo vence. Se o do Drive vencer,
     a página recarrega uma vez para redesenhar tudo.
   - Cada mudança local (qualquer localStorage.setItem numa chave
     sincronizada) espera 2 s de silêncio e envia.
   - Sem internet: fica marcado como pendente e envia depois.

   Só a pasta de apps é tocada (escopo drive.appdata). O dashboard
   continua sem acesso a nenhum arquivo de verdade do Drive.

   A lógica que decide o que fazer é pura (decidir/empacotar/
   aplicar) e é testada em Node.
   ========================================================== */

window.ESESync = (() => {

    const ARQUIVO = 'dashboard.json';
    const ESPERA_MS = 2000;
    const MARCADOR = 'eseSyncEstado';           // { atualizadoEm, fileId, pendente }
    const RECARREGOU = 'eseSyncRecarregou';     // sessionStorage: evita loop de reload

    /* O que vai para o Drive. O Timer de Foco em andamento e as
       chaves de sessão do Google são de cada aparelho. */
    const CHAVES = [
        'eseTasks', 'eseAssessments', 'eseSubjectsByBimester', 'eseGlobalBimester',
        'eseStudyHistory', 'eseAcademia', 'eseGoogleSettings', 'eseMetas', 'esePlano', 'eseMacros',
        'eseNoticiasFontes', 'eseCompras'
    ];

    const DRIVE = 'https://www.googleapis.com/drive/v3/files';
    const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';

    const temNavegador = typeof document !== 'undefined';
    const agora = () => new Date().toISOString();

    /* ==================== LÓGICA PURA ==================== */

    /* local:  { atualizadoEm, pendente }   remoto: { atualizadoEm } | null
       Devolve 'enviar' | 'baixar' | 'nada'. */
    const decidir = (local, remoto) => {
        if (!remoto) return 'enviar';
        const l = (local && local.atualizadoEm) || '';
        const r = remoto.atualizadoEm || '';
        if (!l) return 'baixar';                 // este aparelho nunca sincronizou
        if (r > l) return 'baixar';              // o Drive tem coisa mais nova
        if (l > r) return 'enviar';              // o Drive ficou para trás
        return local && local.pendente ? 'enviar' : 'nada';
    };

    const empacotar = (quando) => {
        const dados = {};
        CHAVES.forEach((k) => { dados[k] = localStorage.getItem(k); });
        return { versao: 1, atualizadoEm: quando || agora(), dados };
    };

    let aplicando = false;

    const aplicar = (pacote) => {
        if (!pacote || typeof pacote !== 'object' || !pacote.dados) return false;
        aplicando = true;
        try {
            CHAVES.forEach((k) => {
                const v = pacote.dados[k];
                if (v === null || v === undefined) localStorage.removeItem(k);
                else localStorage.setItem(k, String(v));
            });
        } finally {
            aplicando = false;
        }
        return true;
    };

    /* ==================== ESTADO LOCAL ==================== */

    const lerMarcador = () => {
        try {
            const m = JSON.parse(localStorage.getItem(MARCADOR) || 'null');
            return m && typeof m === 'object' ? m : { atualizadoEm: '', fileId: '', pendente: false };
        } catch {
            return { atualizadoEm: '', fileId: '', pendente: false };
        }
    };

    const gravarMarcador = (m) => localStorage.setItem(MARCADOR, JSON.stringify(m));

    /* ==================== TELA ==================== */

    const mostrar = (texto, classe) => {
        if (!temNavegador) return;
        const el = document.getElementById('sync-status');
        if (!el) return;
        el.textContent = texto;
        el.className = 'sync-status ' + (classe || '');
        el.style.display = texto ? '' : 'none';
    };

    const hora = (iso) => {
        const d = new Date(iso);
        return isNaN(d) ? '' : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    };

    const mostrarEstado = () => {
        const m = lerMarcador();
        if (m.pendente) mostrar('Alterações a enviar', 'pendente');
        else if (m.atualizadoEm) mostrar(`Sincronizado ${hora(m.atualizadoEm)}`, 'ok');
        else mostrar('', '');
    };

    /* ==================== DRIVE ==================== */

    const podeFalarComGoogle = () =>
        temNavegador && window.GoogleAuth && window.GoogleAuth.isConnected() && window.GoogleAPI;

    const acharArquivo = async () => {
        const url = `${DRIVE}?spaces=appDataFolder&fields=files(id,name,modifiedTime)&pageSize=20`;
        const r = await window.GoogleAPI.request(url);
        return ((r && r.files) || []).find((f) => f.name === ARQUIVO) || null;
    };

    const baixar = async (fileId) => window.GoogleAPI.request(`${DRIVE}/${fileId}?alt=media`);

    const criar = async (pacote) => {
        const limite = 'ese-' + Math.random().toString(36).slice(2);
        const corpo =
            `--${limite}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
            JSON.stringify({ name: ARQUIVO, parents: ['appDataFolder'] }) +
            `\r\n--${limite}\r\nContent-Type: application/json\r\n\r\n` +
            JSON.stringify(pacote) +
            `\r\n--${limite}--`;
        const r = await window.GoogleAPI.request(`${UPLOAD}?uploadType=multipart&fields=id`, {
            method: 'POST',
            headers: { 'Content-Type': `multipart/related; boundary=${limite}` },
            body: corpo
        });
        return r && r.id;
    };

    const atualizar = async (fileId, pacote) =>
        window.GoogleAPI.request(`${UPLOAD}/${fileId}?uploadType=media&fields=id`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(pacote)
        });

    /* ==================== FLUXOS ==================== */

    let enviando = false;
    let timer = null;

    const enviar = async () => {
        if (enviando) return;
        if (!podeFalarComGoogle()) { mostrarEstado(); return; }
        enviando = true;
        mostrar('Enviando…', 'enviando');
        try {
            const m = lerMarcador();
            const pacote = empacotar();
            let fileId = m.fileId;
            if (!fileId) {
                const existente = await acharArquivo();
                fileId = existente ? existente.id : '';
            }
            if (fileId) await atualizar(fileId, pacote);
            else fileId = await criar(pacote);
            gravarMarcador({ atualizadoEm: pacote.atualizadoEm, fileId, pendente: false });
        } catch (e) {
            console.warn('[sync] não consegui enviar:', e && e.message);
            const m = lerMarcador();
            gravarMarcador({ ...m, pendente: true });
            mostrar('Sem conexão — vai enviar depois', 'pendente');
            enviando = false;
            return;
        }
        enviando = false;
        mostrarEstado();
    };

    const agendarEnvio = () => {
        const m = lerMarcador();
        if (!m.pendente) gravarMarcador({ ...m, pendente: true });
        mostrar('Alterações a enviar', 'pendente');
        clearTimeout(timer);
        timer = setTimeout(enviar, ESPERA_MS);
    };

    let sincronizouNestaSessao = false;

    const sincronizar = async () => {
        if (!podeFalarComGoogle()) return;
        try {
            const remoto = await acharArquivo();
            const local = lerMarcador();
            const remotoInfo = remoto ? { atualizadoEm: '' } : null;
            let pacote = null;

            if (remoto) {
                pacote = await baixar(remoto.id);
                remotoInfo.atualizadoEm = (pacote && pacote.atualizadoEm) || remoto.modifiedTime || '';
                if (!local.fileId) gravarMarcador({ ...local, fileId: remoto.id });
            }

            const acao = decidir(local, remotoInfo);
            sincronizouNestaSessao = true;

            if (acao === 'enviar') { await enviar(); return; }
            if (acao === 'nada') { mostrarEstado(); return; }

            /* baixar */
            aplicar(pacote);
            gravarMarcador({ atualizadoEm: remotoInfo.atualizadoEm, fileId: remoto.id, pendente: false });

            /* Redesenha tudo do jeito mais seguro: recarregando. Uma vez só. */
            const ultima = Number(sessionStorage.getItem(RECARREGOU) || 0);
            if (Date.now() - ultima > 10000) {
                sessionStorage.setItem(RECARREGOU, String(Date.now()));
                location.reload();
            } else {
                mostrarEstado();
            }
        } catch (e) {
            console.warn('[sync] não consegui sincronizar:', e && e.message);
            mostrarEstado();
        }
    };

    /* ==================== LIGAÇÕES ==================== */

    if (typeof Storage !== 'undefined' && Storage.prototype) {
        const setOriginal = Storage.prototype.setItem;
        const removeOriginal = Storage.prototype.removeItem;
        Storage.prototype.setItem = function (k, v) {
            setOriginal.call(this, k, v);
            if (!aplicando && this === localStorage && CHAVES.includes(k)) agendarEnvio();
        };
        Storage.prototype.removeItem = function (k) {
            removeOriginal.call(this, k);
            if (!aplicando && this === localStorage && CHAVES.includes(k)) agendarEnvio();
        };
    }

    if (temNavegador) {
        const ligar = () => {
            mostrarEstado();
            if (window.GoogleAuth) {
                window.GoogleAuth.onChange((estado) => {
                    if (estado.connected && !sincronizouNestaSessao) sincronizar();
                });
                if (window.GoogleAuth.isConnected()) sincronizar();
            }
            document.addEventListener('visibilitychange', () => {
                if (!document.hidden && lerMarcador().pendente) enviar();
            });
            window.addEventListener('online', () => { if (lerMarcador().pendente) enviar(); });
        };
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ligar);
        else ligar();
    }

    return { decidir, empacotar, aplicar, agora, sincronizar, enviar, CHAVES };
})();
