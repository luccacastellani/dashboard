/* ==========================================================
   CONFIGURAÇÃO
   ----------------------------------------------------------
   Você NÃO precisa editar este arquivo.
   Abra o dashboard, vá em "Início" e clique em "Configurar
   conexão com o Google". Os valores ficam salvos no navegador.

   Este arquivo serve apenas como valor inicial, caso você
   prefira deixar tudo pronto antes de abrir o site.
   ========================================================== */

window.ESE_CONFIG = {

    /* Client ID do Google (termina em .apps.googleusercontent.com).
       Veja o passo a passo no arquivo LEIA-ME.md */
    GOOGLE_CLIENT_ID: '478598748099-psn6s4422kf0ec48qigogkt5fch3usfd.apps.googleusercontent.com',

    /* Link do Canvas da faculdade. */
    CANVAS_URL: 'https://canvas.eur.nl',

    /* Qual caixa o contador do Gmail conta.
       CATEGORY_PERSONAL = aba Principal (o que importa de verdade)
       INBOX             = tudo, incluindo Promoções e Atualizações
       CATEGORY_UPDATES / CATEGORY_PROMOTIONS / CATEGORY_SOCIAL também valem. */
    GMAIL_LABEL: 'INBOX',

    /* Caixa mostrada como detalhe embaixo do número principal.
       Deixe '' para esconder essa segunda linha. */
    GMAIL_LABEL_DETALHE: 'CATEGORY_PERSONAL',

    /* Link do Claude (abre uma conversa nova). */
    CLAUDE_URL: 'https://claude.ai/new',

    /* Link do LinkedIn. */
    LINKEDIN_URL: 'https://www.linkedin.com/feed/',

    /* Link do Gmail. */
    GMAIL_URL: 'https://mail.google.com/mail/u/0/#inbox',
    /* Link do e-mail da faculdade (Outlook). */
    OUTLOOK_URL: 'https://outlook.office.com/mail/',

    /* Link do seu chat do Gemini.
       Deixe assim para abrir o Gemini normal, ou cole o link
       de uma conversa específica. */
    GEMINI_URL: 'https://gemini.google.com/app',

    /* Qual das suas contas Google o dashboard usa.
       Serve para ele reconectar sozinho sem te perguntar nada,
       já que você tem mais de uma conta logada no navegador.
       O dashboard atualiza isto sozinho depois da primeira conexão. */
    GOOGLE_LOGIN_HINT: '',

    /* Permissões pedidas ao Google.
       tasks           = ler e escrever suas tarefas
       calendar.readonly = APENAS LER sua agenda (nunca alterar)
       gmail.labels    = APENAS a contagem de não lidas. Com este
                         escopo o dashboard NÃO consegue ler nenhuma
                         mensagem sua, nem assunto, nem remetente.
       drive.appdata   = APENAS a pasta escondida de apps do Drive,
                         onde fica o dashboard.json que sincroniza
                         PC e celular. Nenhum arquivo seu é visível. */
    SCOPES: [
        'https://www.googleapis.com/auth/tasks',
        'https://www.googleapis.com/auth/calendar.readonly',
        'https://www.googleapis.com/auth/gmail.labels',
        'https://www.googleapis.com/auth/drive.appdata'
    ].join(' ')
};
