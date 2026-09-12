/* ==========================================================
   GMAIL — SÓ A CONTAGEM
   ----------------------------------------------------------
   Este arquivo lê UM número: quantas conversas não lidas há na
   caixa de entrada.

   A permissão pedida é `gmail.labels`, que dá acesso apenas às
   etiquetas e aos contadores delas. Com esse escopo o Google
   recusaria qualquer tentativa de ler uma mensagem — nem o
   assunto, nem o remetente, nem o corpo. Não existe nenhuma
   função aqui que busque mensagens.
   ========================================================== */

window.GoogleGmail = (() => {

    const BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';

    /* Qual etiqueta o número principal conta.
       O padrão é INBOX: é o número que o Gmail mostra para você.
       Contar só a aba Principal daria um número bem menor, que não
       bate com o que você vê — e aí o cartão parece quebrado. */
    const LABEL_PADRAO = 'INBOX';

    /* Caixa mostrada como detalhe, embaixo do número principal.
       Vazio ('') esconde a segunda linha. */
    const LABEL_DETALHE = 'CATEGORY_PERSONAL';

    const limpar = (valor, padrao) => {
        const v = String(valor === undefined || valor === null ? padrao : valor);
        /* Só letras maiúsculas e underscore: o valor entra na URL. */
        return /^[A-Z_]*$/.test(v) ? v : padrao;
    };

    const labelId = () => limpar(
        window.ESE_CONFIG && window.ESE_CONFIG.GMAIL_LABEL, LABEL_PADRAO) || LABEL_PADRAO;

    const detailLabelId = () => limpar(
        window.ESE_CONFIG && window.ESE_CONFIG.GMAIL_LABEL_DETALHE, LABEL_DETALHE);

    /* O Google devolve os contadores junto com a etiqueta.
       Preferimos conversas (threads): é assim que o Gmail conta. */
    const lerContador = async (id) => {
        const label = await window.GoogleAPI.request(`${BASE}/labels/${id}`);
        const bruto = Number(
            label && (label.threadsUnread !== undefined
                ? label.threadsUnread
                : label.messagesUnread)
        );
        return Number.isFinite(bruto) && bruto >= 0 ? bruto : 0;
    };

    const fetchUnread = async () => {
        const valor = await lerContador(labelId());

        let detalhe = null;
        const idDetalhe = detailLabelId();
        if (idDetalhe && idDetalhe !== labelId()) {
            try {
                detalhe = await lerContador(idDetalhe);
            } catch {
                /* O detalhe é opcional: se falhar, some da tela e pronto. */
                detalhe = null;
            }
        }

        window.GoogleAPI.writeCache({ gmailUnread: valor, gmailUnreadDetail: detalhe });
        return valor;
    };

    /* Último valor conhecido. null = nunca conseguimos ler. */
    const cachedUnread = () => {
        const bruto = window.GoogleAPI.readCache().gmailUnread;
        return Number.isFinite(bruto) ? bruto : null;
    };

    /* "3 mensagens novas" / "1 mensagem nova" / "Nenhuma mensagem nova" */
    const describeUnread = (quantidade) => {
        if (quantidade === null || quantidade === undefined) return 'Sem informação';
        if (quantidade === 0) return 'Nenhuma mensagem nova';
        if (quantidade === 1) return '1 mensagem nova';
        return `${quantidade} mensagens novas`;
    };

    /* Nome legível da caixa que está sendo contada. */
    const NOMES = {
        CATEGORY_PERSONAL: 'Gmail · Principal',
        CATEGORY_UPDATES: 'Gmail · Atualizações',
        CATEGORY_PROMOTIONS: 'Gmail · Promoções',
        CATEGORY_SOCIAL: 'Gmail · Social',
        CATEGORY_FORUMS: 'Gmail · Fóruns',
        INBOX: 'Gmail · Caixa de entrada'
    };

    const describeSource = () => NOMES[labelId()] || 'Gmail';

    const cachedDetail = () => {
        const bruto = window.GoogleAPI.readCache().gmailUnreadDetail;
        return Number.isFinite(bruto) ? bruto : null;
    };

    /* "10 delas na Principal" — o número que realmente pede ação. */
    const describeDetail = () => {
        const n = cachedDetail();
        if (n === null) return '';
        const nome = (NOMES[detailLabelId()] || '').replace('Gmail · ', '');
        if (!nome) return '';
        if (n === 0) return `Nenhuma em ${nome}`;
        if (n === 1) return `1 delas em ${nome}`;
        return `${n} delas em ${nome}`;
    };

    return { fetchUnread, cachedUnread, cachedDetail, describeUnread, describeSource, describeDetail };
})();
