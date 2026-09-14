/* Escapa texto do usuario antes de ir para innerHTML.
   Sem isso, uma tarefa chamada "Custos < Receita" quebra a lista. */
window.escapeHtml = (value) => String(value === null || value === undefined ? '' : value)
    .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ==========================================================
   SAUDAÇÃO DO CABEÇALHO
   ----------------------------------------------------------
   Bom dia / Boa tarde / Boa noite conforme a hora.
   Fica separado e recebe a data por parâmetro para poder
   ser testado sem depender do relógio.
   ========================================================== */

window.ESE_NOME = 'Lucca';

window.saudacaoPara = (data) => {
    const hora = data.getHours();
    if (hora >= 5 && hora < 12) return 'Bom dia';
    if (hora >= 12 && hora < 18) return 'Boa tarde';
    return 'Boa noite';
};

window.renderSaudacao = () => {
    const el = document.getElementById('greeting');
    if (!el) return;
    el.textContent = `${window.saudacaoPara(new Date())}, ${window.ESE_NOME}!`;
};

document.addEventListener('DOMContentLoaded', () => {
    window.renderSaudacao();

    /* Se o dashboard ficar aberto, a saudação vira sozinha
       quando o horário passar de uma faixa para a outra. */
    setInterval(window.renderSaudacao, 60000);
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) window.renderSaudacao();
    });

    // Configure PDF.js worker
    if (typeof pdfjsLib !== 'undefined') {
        pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    }

    // ==========================================
    // BIMESTRES E MATÉRIAS PERSONALIZADAS
    // ==========================================
    const globalBimester = document.getElementById('global-bimester');
    const NEW_SUBJECT = '__new_subject__';

    const taskSubjectSelect = document.getElementById('task-subject-select');
    const taskSubjectCustom = document.getElementById('task-subject-custom');

    const taskSubjectDropdown = document.getElementById('task-subject-dropdown');
    const taskSubjectSelected = document.getElementById('task-subject-selected');
    const taskSubjectOptions = document.getElementById('task-subject-options');
    const taskSubjectInput = document.getElementById('task-subject-select');


    const assessmentSubjectDropdown = document.getElementById('assessment-subject-dropdown');
    const assessmentSubjectSelected = document.getElementById('assessment-subject-selected');
    const assessmentSubjectOptions = document.getElementById('assessment-subject-options');
    const assessmentSubjectInput = document.getElementById('assessment-subject-select');
    const assessmentSubjectCustom = document.getElementById('assessment-subject-custom');

    const storedBimester = localStorage.getItem('eseGlobalBimester') || '1';
    const savedBimester = ['1', '2', '3', '4', '5'].includes(storedBimester) ? storedBimester : '1';
    if (globalBimester) globalBimester.value = savedBimester;
    if (storedBimester !== savedBimester) localStorage.setItem('eseGlobalBimester', savedBimester);

    const createEmptyBimesterMap = () => {
        const map = {};
        for (let i = 1; i <= 5; i++) map[String(i)] = [];
        return map;
    };

    let permanentCustomSubjects = (() => {
        try {
            const stored = JSON.parse(localStorage.getItem('eseSubjectsByBimester') || '{}');
            const map = createEmptyBimesterMap();
            for (let i = 1; i <= 5; i++) {
                const key = String(i);
                if (Array.isArray(stored[key])) map[key] = stored[key];
            }
            return map;
        } catch {
            return createEmptyBimesterMap();
        }
    })();

    const saveCustomSubjects = () => {
        localStorage.setItem('eseSubjectsByBimester', JSON.stringify(permanentCustomSubjects));
    };

    const resetSubjectSelector = (selectedEl, inputEl, customInputEl) => {
        if (selectedEl) selectedEl.textContent = 'Escolha a Matéria';
        if (inputEl) {
            inputEl.value = '';
            inputEl.dispatchEvent(new Event('change'));
        }
        if (customInputEl) {
            customInputEl.style.display = 'none';
            customInputEl.required = false;
            customInputEl.value = '';
        }
    };

    const populateSubjectOptions = (optionsEl) => {
        if (!optionsEl || !globalBimester) return;

        const bimester = globalBimester.value;
        const subjects = permanentCustomSubjects[bimester] || [];
        optionsEl.innerHTML = '';

        const placeholder = document.createElement('li');
        placeholder.className = 'custom-option disabled';
        placeholder.dataset.value = '';
        placeholder.textContent = subjects.length ? 'Escolha a Matéria' : 'Nenhuma matéria cadastrada';
        optionsEl.appendChild(placeholder);

        subjects.forEach((subject) => {
            const option = document.createElement('li');
            option.className = 'custom-option';
            option.dataset.value = subject;

            const label = document.createElement('span');
            label.textContent = subject;

            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'custom-option-delete';
            deleteBtn.title = 'Apagar matéria deste bimestre';
            deleteBtn.textContent = '×';
            deleteBtn.addEventListener('click', (event) => {
                event.stopPropagation();
                window.deleteCustomSubject(subject);
            });

            option.append(label, deleteBtn);
            optionsEl.appendChild(option);
        });

        const addOption = document.createElement('li');
        addOption.className = 'custom-option custom-option-add';
        addOption.dataset.value = NEW_SUBJECT;
        addOption.textContent = '＋ Adicionar nova matéria';
        optionsEl.appendChild(addOption);
    };

    const updateSubjectOptions = () => {
        populateSubjectOptions(taskSubjectOptions);
        populateSubjectOptions(assessmentSubjectOptions);

        resetSubjectSelector(taskSubjectSelected, taskSubjectInput, taskSubjectCustom);
        resetSubjectSelector(assessmentSubjectSelected, assessmentSubjectInput, assessmentSubjectCustom);
    };

    const handleCustomVisibility = (selectElem, customInputElem) => {
        if (!selectElem || !customInputElem) return;
        selectElem.addEventListener('change', () => {
            const isNewSubject = selectElem.value === NEW_SUBJECT;
            customInputElem.style.display = isNewSubject ? 'block' : 'none';
            customInputElem.required = isNewSubject;
            if (!isNewSubject) customInputElem.value = '';
        });
    };

    handleCustomVisibility(taskSubjectSelect, taskSubjectCustom);
    handleCustomVisibility(assessmentSubjectInput, assessmentSubjectCustom);

    const setupCustomDropdown = (dropdownEl, selectedEl, inputEl, optionsEl) => {
        if (!dropdownEl || !selectedEl || !inputEl || !optionsEl) return;

        selectedEl.addEventListener('click', () => {
            dropdownEl.classList.toggle('open');
        });

        optionsEl.addEventListener('click', (event) => {
            const option = event.target.closest('.custom-option');
            if (!option || option.classList.contains('disabled') || event.target.closest('.custom-option-delete')) return;

            const value = option.dataset.value || '';
            inputEl.value = value;
            selectedEl.textContent = value === NEW_SUBJECT ? 'Adicionar nova matéria' : value;
            dropdownEl.classList.remove('open');
            inputEl.dispatchEvent(new Event('change'));
        });
    };

    setupCustomDropdown(taskSubjectDropdown, taskSubjectSelected, taskSubjectInput, taskSubjectOptions);
    setupCustomDropdown(assessmentSubjectDropdown, assessmentSubjectSelected, assessmentSubjectInput, assessmentSubjectOptions);

    document.addEventListener('click', (event) => {
        [taskSubjectDropdown, assessmentSubjectDropdown].forEach((dropdown) => {
            if (dropdown && !dropdown.contains(event.target)) dropdown.classList.remove('open');
        });
    });

    const addPermanentSubject = (subjectName) => {
        if (!globalBimester) return '';

        const cleanName = String(subjectName || '').trim();
        if (!cleanName) return '';

        const bimester = globalBimester.value;
        if (!permanentCustomSubjects[bimester]) permanentCustomSubjects[bimester] = [];

        const existing = permanentCustomSubjects[bimester].find(
            (subject) => subject.toLocaleLowerCase('pt-BR') === cleanName.toLocaleLowerCase('pt-BR')
        );

        if (!existing) {
            permanentCustomSubjects[bimester].push(cleanName);
            permanentCustomSubjects[bimester].sort((a, b) => a.localeCompare(b, 'pt-BR'));
            saveCustomSubjects();
        }

        updateSubjectOptions();
        return existing || cleanName;
    };

    window.deleteCustomSubject = (subjectName) => {
        if (!globalBimester) return;
        const bimester = globalBimester.value;
        if (!permanentCustomSubjects[bimester]) return;

        const confirmed = confirm(`Deseja apagar a matéria "${subjectName}" do ${bimester}º bimestre?`);
        if (!confirmed) return;

        permanentCustomSubjects[bimester] = permanentCustomSubjects[bimester].filter((subject) => subject !== subjectName);
        saveCustomSubjects();
        updateSubjectOptions();
    };

    if (globalBimester) {
        globalBimester.addEventListener('change', () => {
            localStorage.setItem('eseGlobalBimester', globalBimester.value);
            updateSubjectOptions();
        });
    }

    updateSubjectOptions();

    // Sidebar & Navigation logic
    const sidebar = document.getElementById('sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const openSidebarBtn = document.getElementById('open-sidebar');
    const closeSidebarBtn = document.getElementById('close-sidebar');
    
    const toggleSidebar = () => {
        if (sidebar) sidebar.classList.toggle('open');
        if (sidebarOverlay) sidebarOverlay.classList.toggle('show');
    };
    
    if (openSidebarBtn) openSidebarBtn.addEventListener('click', toggleSidebar);
    if (closeSidebarBtn) closeSidebarBtn.addEventListener('click', toggleSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', toggleSidebar);

    /* ==========================
       NAVEGAÇÃO ENTRE ABAS
       --------------------------
       Cada aba diz quais blocos ficam visíveis. Para criar uma
       aba nova, acrescente uma linha aqui e um botão no menu.
       ========================== */

    const SECTION_DISPLAY = {
        'google-tasks': 'flex',
        'focus-timer': 'flex',
        '.right-column': 'flex'
    };

    const TABS = {
        'home':             ['home-overview', 'google-tasks', '.right-column', 'focus-timer'],
        'focus-timer':      ['.right-column', 'focus-timer'],
        'calendar-view':    ['calendar-view'],
        'ai-generator':     ['ai-generator'],
        'performance-view': ['performance-view'],
        'academia-view':    ['academia-view'],
        'noticias-view':    ['noticias-view']
    };

    /* Todos os blocos que a navegação controla. */
    const ALL_SECTIONS = [...new Set(Object.values(TABS).flat())];

    const findSection = (key) =>
        key.startsWith('.') ? document.querySelector(key) : document.getElementById(key);

    const showTab = (target) => {
        const visible = TABS[target] || TABS.home;

        const grid = document.querySelector('.grid-layout');
        if (grid) grid.style.display = target === 'home' ? 'grid' : 'block';

        ALL_SECTIONS.forEach((key) => {
            const el = findSection(key);
            if (!el) return;
            el.style.display = visible.includes(key) ? (SECTION_DISPLAY[key] || 'block') : 'none';
        });

        /* Blocos que precisam se redesenhar ao aparecer. */
        if (target === 'calendar-view' && typeof window.renderCalendar === 'function') window.renderCalendar();
        if (target === 'ai-generator' && typeof window.renderSchedulerTasks === 'function') window.renderSchedulerTasks();
        if (target === 'performance-view' && typeof renderPerformanceChart === 'function') renderPerformanceChart();
        if (target === 'academia-view' && window.Academia) window.Academia.renderTudo();
        if (target === 'noticias-view' && window.Noticias) window.Noticias.aoAbrir();
        if (typeof window.onTabShown === 'function') window.onTabShown(target);
    };

    window.showTab = showTab;

    const navBtns = document.querySelectorAll('.nav-btn');
    navBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            navBtns.forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            showTab(btn.getAttribute('data-target'));
            toggleSidebar();
        });
    });

    showTab('home');

    /* Barra de abas do celular: espelha o menu lateral. */
    const mobileTabs = document.querySelectorAll('.mobile-tab');
    const marcarAbaCelular = (target) => {
        mobileTabs.forEach((t) => t.classList.toggle('active', t.getAttribute('data-target') === target));
    };
    mobileTabs.forEach((tab) => {
        tab.addEventListener('click', () => {
            const target = tab.getAttribute('data-target');
            navBtns.forEach((b) => b.classList.toggle('active', b.getAttribute('data-target') === target));
            marcarAbaCelular(target);
            showTab(target);
            window.scrollTo({ top: 0 });
        });
    });
    navBtns.forEach((btn) => btn.addEventListener('click', () => marcarAbaCelular(btn.getAttribute('data-target'))));


    /* ==========================
       1. PENDÊNCIAS
       ========================== */
    const taskForm = document.getElementById('task-form');
    const taskList = document.getElementById('task-list');
    let tasks = JSON.parse(localStorage.getItem('eseTasks')) || [];
    let showDoneTasks = false;

    const toggleDoneBtn = document.getElementById('toggle-done-tasks');
    if (toggleDoneBtn) {
        toggleDoneBtn.addEventListener('click', () => {
            showDoneTasks = !showDoneTasks;
            toggleDoneBtn.classList.toggle('active', showDoneTasks);
            toggleDoneBtn.innerHTML = showDoneTasks ? '✓ Esconder pendências feitas' : 'Mostrar pendências feitas';
            window.renderTasks();
            const calView = document.getElementById('calendar-view');
            if (calView && calView.style.display === 'block' && typeof window.renderCalendar === 'function') {
                window.renderCalendar();
            }
        });
    }

    const saveTasks = () => localStorage.setItem('eseTasks', JSON.stringify(tasks));

    const sortTasks = () => {
        const difficultyWeight = { 'Alta': 3, 'Média': 2, 'Baixa': 1 };
        tasks.sort((a, b) => {
            if (!a.deadline && !b.deadline) {
                return (difficultyWeight[b.difficulty] || 0) - (difficultyWeight[a.difficulty] || 0);
            }
            if (!a.deadline) return 1;
            if (!b.deadline) return -1;
            
            const dateA = new Date(a.deadline);
            const dateB = new Date(b.deadline);
            if (dateA < dateB) return -1;
            if (dateA > dateB) return 1;
            
            return (difficultyWeight[b.difficulty] || 0) - (difficultyWeight[a.difficulty] || 0);
        });
    };

    window.renderTasks = () => {
        if (!taskList) return;
        sortTasks();
        taskList.innerHTML = '';
        
        let datedCount = tasks.filter(t => t.deadline && !t.done).length;

        tasks.forEach((task, index) => {
            if (task.done && !showDoneTasks) return;

            const li = document.createElement('li');
            li.className = `task-item ${task.done ? 'task-done' : ''}`;
            
            let color = '#3b82f6';
            if (task.deadline && !task.done) {
                if (datedCount <= 1) {
                    color = 'hsl(0, 100%, 50%)';
                } else {
                    const hue = (index / (datedCount - 1)) * 120;
                    color = `hsl(${hue}, 100%, 50%)`;
                }
            } else if (task.done) {
                color = '#94a3b8';
            }
            
            li.style.borderLeftColor = color;
            
            const dateText = task.deadline ? new Date(task.deadline).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : 'Sem prazo';
            
            li.innerHTML = `
                <input type="checkbox" class="task-checkbox" ${task.done ? 'checked' : ''} onchange="window.toggleTaskDone(${index})">
                <div class="task-info">
                    <h3>${window.escapeHtml(task.name)}</h3>
                    <div class="task-meta">
                        <span>📚 ${window.escapeHtml(task.subject)}</span>
                        <span>📅 ${dateText}</span>
                        <span>⚡ Dif: ${task.difficulty}</span>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 0.35rem;">
                    ${task.done ? '' : `<label class="task-estimate" title="Quanto tempo esta tarefa vai levar"><input type="number" min="1" step="5" placeholder="min" class="task-estimate-input" data-index="${index}" value="${task.estimate || ''}"><span>min</span></label>`}
                    <button class="edit-btn" onclick="window.openEditTaskModal(${index})" title="Editar Tarefa">✏️</button>
                    <button class="delete-btn" onclick="window.deleteTask(${index})" title="Apagar Tarefa">×</button>
                </div>
            `;
            taskList.appendChild(li);
        });
    };

    /* Minutos estimados, digitados direto na linha da tarefa.
       Um único ouvinte na lista atende todas as linhas, mesmo
       as que ainda vão ser desenhadas. */
    if (taskList) {
        taskList.addEventListener('change', (e) => {
            const input = e.target.closest('.task-estimate-input');
            if (!input) return;
            const idx = parseInt(input.getAttribute('data-index'), 10);
            if (!tasks[idx]) return;
            tasks[idx].estimate = parseInt(input.value, 10) || 0;
            saveTasks();
        });
    }

    window.toggleTaskDone = (index) => {
        tasks[index].done = !tasks[index].done;
        /* Data de conclusão: é o que diz se foi no prazo (Desempenho). */
        if (tasks[index].done) tasks[index].doneAt = getTodayKey();
        else delete tasks[index].doneAt;
        saveTasks();
        window.renderTasks();
        const calView = document.getElementById('calendar-view');
        if (calView && calView.style.display === 'block' && typeof window.renderCalendar === 'function') window.renderCalendar();
        const aiGen = document.getElementById('ai-generator');
        if (aiGen && aiGen.style.display === 'block' && typeof window.renderSchedulerTasks === 'function') window.renderSchedulerTasks();
    };

    window.deleteTask = (index) => {
        tasks.splice(index, 1);
        saveTasks();
        window.renderTasks();
        const calView = document.getElementById('calendar-view');
        if (calView && calView.style.display === 'block' && typeof window.renderCalendar === 'function') window.renderCalendar();
        const aiGen = document.getElementById('ai-generator');
        if (aiGen && aiGen.style.display === 'block' && typeof window.renderSchedulerTasks === 'function') window.renderSchedulerTasks();
    };

    if (taskForm) {
        taskForm.addEventListener('submit', (e) => {
            e.preventDefault();
            let subjectValue = taskSubjectSelect ? taskSubjectSelect.value : '';
            if (subjectValue === NEW_SUBJECT) {
                subjectValue = taskSubjectCustom ? taskSubjectCustom.value.trim() : '';
                if (!subjectValue) {
                    alert('Digite o nome da nova matéria.');
                    return;
                }
                subjectValue = addPermanentSubject(subjectValue);
            }
            
            if (!subjectValue) {
                alert('Escolha uma matéria ou adicione uma nova.');
                return;
            }

            const newTask = {
                name: document.getElementById('task-name').value,
                subject: subjectValue,
                deadline: document.getElementById('task-deadline').value,
                difficulty: document.getElementById('task-difficulty').value,
                bimester: globalBimester ? globalBimester.value : '1',
                done: false
            };
            tasks.push(newTask);
            saveTasks();
            window.renderTasks();
            taskForm.reset();
            updateSubjectOptions();
            const calView = document.getElementById('calendar-view');
            if (calView && calView.style.display === 'block' && typeof window.renderCalendar === 'function') window.renderCalendar();
            const aiGen = document.getElementById('ai-generator');
            if (aiGen && aiGen.style.display === 'block' && typeof window.renderSchedulerTasks === 'function') window.renderSchedulerTasks();
        });
    }

    // Modal de Edição de Tarefas
    const editModal = document.getElementById('edit-task-modal');
    const editForm = document.getElementById('edit-task-form');
    const closeEditBtn = document.getElementById('close-edit-modal');

    window.openEditTaskModal = (index) => {
        if (!editModal || !editForm) return;
        const task = tasks[index];
        document.getElementById('edit-task-index').value = index;
        document.getElementById('edit-task-name').value = task.name;
        document.getElementById('edit-task-deadline').value = task.deadline || '';
        document.getElementById('edit-task-difficulty').value = task.difficulty || 'Média';
        editModal.style.display = 'flex';
    };

    if (closeEditBtn) {
        closeEditBtn.addEventListener('click', () => {
            editModal.style.display = 'none';
        });
    }

    if (editForm) {
        editForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const index = parseInt(document.getElementById('edit-task-index').value, 10);
            if (!isNaN(index) && tasks[index]) {
                tasks[index].name = document.getElementById('edit-task-name').value;
                tasks[index].deadline = document.getElementById('edit-task-deadline').value;
                tasks[index].difficulty = document.getElementById('edit-task-difficulty').value;
                saveTasks();
                window.renderTasks();
                const calView = document.getElementById('calendar-view');
                if (calView && calView.style.display === 'block' && typeof window.renderCalendar === 'function') window.renderCalendar();
                const aiGen = document.getElementById('ai-generator');
                if (aiGen && aiGen.style.display === 'block' && typeof window.renderSchedulerTasks === 'function') window.renderSchedulerTasks();
            }
            editModal.style.display = 'none';
        });
    }

    window.renderTasks();

    /* ==========================
       3. TIMER DE FOCO
       ========================== */
// ==========================================
// // ==========================================
// 3. TIMER DE FOCO (Com Tempo de Estudo e Pausa Persistentes)
// ==========================================

let timerInterval = null;
let pauseInterval = null;
let totalPauseSeconds = 0;
let totalStudySeconds = 0;

// Web Worker para manter o timer rodando no background sem sofrer throttling
const bgWorkerCode = `
    let timerId = null;
    self.onmessage = function(e) {
        if (e.data === 'start') {
            if (!timerId) timerId = setInterval(() => self.postMessage('tick'), 1000);
        } else if (e.data === 'stop') {
            clearInterval(timerId);
            timerId = null;
        }
    };
`;
const bgWorkerBlob = new Blob([bgWorkerCode], { type: 'application/javascript' });
const timerWorker = new Worker(URL.createObjectURL(bgWorkerBlob));

timerWorker.onmessage = function(e) {
    if (e.data === 'tick') {
        const isRunning = localStorage.getItem('eseFocusTimer_running') === 'true';
        const isPaused = localStorage.getItem('eseFocusTimer_paused') === 'true';
        if (isRunning) {
            checkTimerState();
        } else if (isPaused) {
            checkPauseState();
        }
    }
};

// Elementos do DOM
const timerMinutesEl = document.getElementById('timer-minutes');
const timerSecondsEl = document.getElementById('timer-seconds');
const timerInput = document.getElementById('timer-input');
const btnStart = document.getElementById('timer-start');
const btnPause = document.getElementById('timer-pause');
const btnReset = document.getElementById('timer-reset');
const btnPip = document.getElementById('timer-pip');
const pauseTimeEl = document.getElementById('pause-time');
const studyTimeEl = document.getElementById('study-time');

// Variáveis para o Mini Player (PiP)
let pipCanvas = null;
let pipVideo = null;
let pipCtx = null;

function initPip() {
    pipCanvas = document.createElement('canvas');
    pipCanvas.width = 300;
    pipCanvas.height = 150;
    pipCtx = pipCanvas.getContext('2d');
    
    pipVideo = document.createElement('video');
    pipVideo.srcObject = pipCanvas.captureStream(30);
    pipVideo.muted = true;
    pipVideo.play().catch(e => console.error("Erro ao tocar vídeo PiP:", e));
}

function drawPip(mins, secs) {
    if (!pipCtx) return;
    // Desenha o fundo
    pipCtx.fillStyle = '#0f172a'; // Cor de fundo escuro (como o tema do site)
    pipCtx.fillRect(0, 0, pipCanvas.width, pipCanvas.height);
    
    // Desenha o tempo
    pipCtx.fillStyle = '#f8fafc'; // Cor do texto
    pipCtx.font = 'bold 72px Inter, sans-serif';
    pipCtx.textAlign = 'center';
    pipCtx.textBaseline = 'middle';
    pipCtx.fillText(`${padTime(mins)}:${padTime(secs)}`, pipCanvas.width / 2, pipCanvas.height / 2);
}

function playTimerSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);
        
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime); // Nota A5
        oscillator.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.5);
        
        gainNode.gain.setValueAtTime(1, audioCtx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 1.5);
        
        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 1.5);
    } catch(e) {
        console.error("Erro ao tocar som:", e);
    }
}

// Função utilitária para formatar números com zero à esquerda (ex: 05)
function padTime(num) {
    return String(Math.max(0, num)).padStart(2, '0');
}

// Formata segundos em HH:MM:SS
function formatHMS(totalSeconds) {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${padTime(hrs)}:${padTime(mins)}:${padTime(secs)}`;
}

// Atualiza a exibição visual do timer regressivo
function updateTimerDisplay(remainingSeconds) {
    if (!timerMinutesEl || !timerSecondsEl) return;
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    timerMinutesEl.textContent = padTime(mins);
    timerSecondsEl.textContent = padTime(secs);
    
    // Atualiza o Mini Player se estiver ativo
    if (document.pictureInPictureElement === pipVideo || (pipVideo && !pipVideo.paused)) {
        drawPip(mins, secs);
    }
}

// Atualiza o display das estatísticas (Pausa e Estudo)
function updateStatsDisplay() {
    if (pauseTimeEl) pauseTimeEl.textContent = formatHMS(totalPauseSeconds);
    if (studyTimeEl) studyTimeEl.textContent = formatHMS(totalStudySeconds);
}

// Controle do Contador de Pausa
function startPauseCounter() {
    let lastPauseTime = parseInt(localStorage.getItem('eseFocusTimer_lastPauseStart') || Date.now());
    localStorage.setItem('eseFocusTimer_lastPauseStart', lastPauseTime);
    timerWorker.postMessage('start');
}

function checkPauseState() {
    let lastPauseTime = parseInt(localStorage.getItem('eseFocusTimer_lastPauseStart'));
    if (!lastPauseTime) return;
    const now = Date.now();
    const elapsed = Math.floor((now - lastPauseTime) / 1000);
    if (elapsed > 0) {
        totalPauseSeconds += elapsed;
        localStorage.setItem('eseFocusTimer_lastPauseStart', lastPauseTime + (elapsed * 1000));
        localStorage.setItem('eseFocusTimer_totalPause', totalPauseSeconds);
        updateStatsDisplay();
    }
}

function stopPauseCounter() {
    localStorage.removeItem('eseFocusTimer_lastPauseStart');
}

// Loop Principal do Timer
function checkTimerState() {
    const isRunning = localStorage.getItem('eseFocusTimer_running') === 'true';
    const isPaused = localStorage.getItem('eseFocusTimer_paused') === 'true';
    const endTime = parseInt(localStorage.getItem('eseFocusTimer_endTime') || '0');

    if (isRunning && endTime) {
        const now = Date.now();
        const remaining = Math.round((endTime - now) / 1000);

        // Calcula o tempo de estudo decorrido desde o último tick
        // Limita o 'now' para não contabilizar estudo além do fim do timer (endTime)
        let lastStudyTick = parseInt(localStorage.getItem('eseFocusTimer_lastStudyTick') || now);
        let effectiveNow = now > endTime ? endTime : now;
        const elapsedStudy = Math.floor((effectiveNow - lastStudyTick) / 1000);

        if (elapsedStudy > 0) {
            totalStudySeconds += elapsedStudy;
            // Preserva frações de milissegundos adicionando o tempo exato decorrido
            localStorage.setItem('eseFocusTimer_lastStudyTick', lastStudyTick + (elapsedStudy * 1000));
            localStorage.setItem('eseFocusTimer_totalStudy', totalStudySeconds);
            updateStatsDisplay();
            /* Soma na matéria escolhida no Timer (Desempenho > horas por matéria). */
            if (window.Desempenho) window.Desempenho.registrar(elapsedStudy, window.Desempenho.materiaAtual());
        }

        if (remaining <= 0) {
            // Timer Finalizado!
            timerWorker.postMessage('stop');
            localStorage.setItem('eseFocusTimer_running', 'false');
            localStorage.setItem('eseFocusTimer_paused', 'false');
            localStorage.removeItem('eseFocusTimer_lastStudyTick');
            updateTimerDisplay(0);
            stopPauseCounter();
            playTimerSound(); // Toca o som de alerta
            alert('🎉 Tempo de foco finalizado! Hora de um descanso.');
        } else {
            updateTimerDisplay(remaining);
        }
    } else if (isPaused) {
        const remaining = parseInt(localStorage.getItem('eseFocusTimer_remaining') || '0');
        updateTimerDisplay(remaining);
    } else {
        // Estado parado/resetado
        const initialMins = parseInt(timerInput ? timerInput.value : 40) || 40;
        updateTimerDisplay(initialMins * 60);
    }
}

// Iniciar Timer
function startTimer() {
    const isPaused = localStorage.getItem('eseFocusTimer_paused') === 'true';
    let remainingSeconds;

    if (isPaused) {
        remainingSeconds = parseInt(localStorage.getItem('eseFocusTimer_remaining') || '0');
    } else {
        const mins = parseInt(timerInput.value) || 40;
        remainingSeconds = mins * 60;
    }

    if (remainingSeconds <= 0) return;

    const now = Date.now();
    const endTime = now + (remainingSeconds * 1000);

    localStorage.setItem('eseFocusTimer_endTime', endTime);
    localStorage.setItem('eseFocusTimer_running', 'true');
    localStorage.setItem('eseFocusTimer_paused', 'false');
    localStorage.setItem('eseFocusTimer_lastStudyTick', now);

    stopPauseCounter();

    checkTimerState();
    timerWorker.postMessage('start');
}

// Pausar Timer
function pauseTimer() {
    const isRunning = localStorage.getItem('eseFocusTimer_running') === 'true';
    if (!isRunning) return;

    const endTime = parseInt(localStorage.getItem('eseFocusTimer_endTime') || '0');
    const remainingSeconds = Math.max(0, Math.round((endTime - Date.now()) / 1000));

    localStorage.setItem('eseFocusTimer_running', 'false');
    localStorage.setItem('eseFocusTimer_paused', 'true');
    localStorage.setItem('eseFocusTimer_remaining', remainingSeconds);
    localStorage.removeItem('eseFocusTimer_lastStudyTick');

    updateTimerDisplay(remainingSeconds);
    startPauseCounter();
}

// Resetar Timer
function resetTimer() {
    timerWorker.postMessage('stop');
    stopPauseCounter();

    localStorage.removeItem('eseFocusTimer_endTime');
    localStorage.removeItem('eseFocusTimer_running');
    localStorage.removeItem('eseFocusTimer_paused');
    localStorage.removeItem('eseFocusTimer_remaining');
    localStorage.removeItem('eseFocusTimer_lastStudyTick');

    const defaultMins = parseInt(timerInput.value) || 40;
    updateTimerDisplay(defaultMins * 60);
}

// Event Listeners dos Botões
if (btnStart) btnStart.addEventListener('click', startTimer);
if (btnPause) btnPause.addEventListener('click', pauseTimer);
if (btnReset) btnReset.addEventListener('click', resetTimer);
if (btnPip) {
    btnPip.addEventListener('click', async () => {
        if (!pipVideo) initPip();
        
        try {
            if (document.pictureInPictureElement) {
                await document.exitPictureInPicture();
            } else {
                // Força um frame inicial para aparecer imediatamente
                const mins = parseInt(timerMinutesEl.textContent) || 0;
                const secs = parseInt(timerSecondsEl.textContent) || 0;
                drawPip(mins, secs);
                
                await pipVideo.play();
                await pipVideo.requestPictureInPicture();
            }
        } catch (error) {
            console.error('Erro ao iniciar o Mini Player (PiP):', error);
            alert('Seu navegador não suporta a função Mini Player ou ela foi bloqueada.');
        }
    });
}

if (timerInput) {
    timerInput.addEventListener('change', () => {
        const isRunning = localStorage.getItem('eseFocusTimer_running') === 'true';
        if (!isRunning) {
            resetTimer();
        }
    });
}

// Inicializar e Restaurar Estado do Timer
function initTimer() {
    const today = new Date().toDateString();
    const savedDate = localStorage.getItem('eseFocusTimer_date');
    
    // Reseta os contadores se for um novo dia
    if (savedDate !== today) {
        localStorage.setItem('eseFocusTimer_date', today);
        localStorage.setItem('eseFocusTimer_totalPause', '0');
        localStorage.setItem('eseFocusTimer_totalStudy', '0');
        totalPauseSeconds = 0;
        totalStudySeconds = 0;
    } else {
        totalPauseSeconds = parseInt(localStorage.getItem('eseFocusTimer_totalPause') || '0');
        totalStudySeconds = parseInt(localStorage.getItem('eseFocusTimer_totalStudy') || '0');
    }
    
    updateStatsDisplay();

    const isRunning = localStorage.getItem('eseFocusTimer_running') === 'true';
    const isPaused = localStorage.getItem('eseFocusTimer_paused') === 'true';

    if (isRunning) {
        checkTimerState();
        timerWorker.postMessage('start');
    } else if (isPaused) {
        checkTimerState();
        startPauseCounter();
    } else {
        resetTimer();
    }
}

// Executa ao carregar o script
initTimer();
   /* ==========================
   4. CALENDÁRIO
   ========================== */

let currentCalDate = new Date();

const calendarGrid = document.querySelector('.calendar-grid');
const calendarMonthYear = document.getElementById('calendar-month-year');

const assessmentForm = document.getElementById('assessment-form');
const assessmentNameInput = document.getElementById('assessment-name');
const assessmentDateInput = document.getElementById('assessment-date');

/*
    Recupera avaliações já salvas.

    Exemplo:
    [
        {
            subject: "Microeconomics",
            name: "P1",
            date: "2026-09-20"
        }
    ]
*/
let assessments = JSON.parse(
    localStorage.getItem('eseAssessments') || '[]'
);


/* Salvar avaliações */
const saveAssessments = () => {
    localStorage.setItem(
        'eseAssessments',
        JSON.stringify(assessments)
    );
};


/* ==========================
   ADICIONAR AVALIAÇÃO
   ========================== */

if (assessmentForm) {

    assessmentForm.addEventListener('submit', (e) => {

        e.preventDefault();

        let subject = assessmentSubjectInput
            ? assessmentSubjectInput.value
            : '';

        /*
            Caso seja uma matéria personalizada
        */
        if (subject === NEW_SUBJECT) {

            subject = assessmentSubjectCustom
                ? assessmentSubjectCustom.value.trim()
                : '';

            if (subject) {
                subject = addPermanentSubject(subject);
            }
        }


        const name = assessmentNameInput
            ? assessmentNameInput.value.trim()
            : '';

        const date = assessmentDateInput
            ? assessmentDateInput.value
            : '';


        /*
            Validação
        */
        if (!subject || !name || !date) {

            alert(
                'Preencha a matéria, o nome da avaliação e a data.'
            );

            return;
        }


        /*
            Salva a nova avaliação
        */
        assessments.push({
            subject: subject,
            name: name,
            date: date,
            bimester: globalBimester ? globalBimester.value : '1'
        });


        saveAssessments();


        /*
            Limpa o formulário
        */
        assessmentForm.reset();

        updateSubjectOptions();


        /*
            Atualiza imediatamente o calendário
        */
        window.renderCalendar();
    });
}


/* ==========================
   DESENHAR CALENDÁRIO
   ========================== */

window.renderCalendar = () => {

    if (!calendarGrid || !calendarMonthYear) {
        return;
    }


    const year = currentCalDate.getFullYear();
    const month = currentCalDate.getMonth();


    const monthNames = [
        "Janeiro",
        "Fevereiro",
        "Março",
        "Abril",
        "Maio",
        "Junho",
        "Julho",
        "Agosto",
        "Setembro",
        "Outubro",
        "Novembro",
        "Dezembro"
    ];


    calendarMonthYear.textContent =
        `${monthNames[month]} ${year}`;


    /*
        Remove os dias antigos,
        mas mantém Dom, Seg, Ter...
    */
    const days =
        calendarGrid.querySelectorAll('.calendar-day');

    days.forEach(day => day.remove());


    const firstDay =
        new Date(year, month, 1).getDay();

    const daysInMonth =
        new Date(year, month + 1, 0).getDate();


    const todayStr = window.ESEDates
        ? window.ESEDates.todayString()
        : new Date().toISOString().split('T')[0];


    /*
        Espaços vazios antes do primeiro dia
    */
    for (let i = 0; i < firstDay; i++) {

        const emptyDiv =
            document.createElement('div');

        emptyDiv.className =
            'calendar-day empty';

        calendarGrid.appendChild(emptyDiv);
    }


    /*
        Cria cada dia
    */
    for (let i = 1; i <= daysInMonth; i++) {

        const dayDiv =
            document.createElement('div');

        dayDiv.className =
            'calendar-day';


        const cellDateStr =
            `${year}-${String(month + 1).padStart(2, '0')}-${String(i).padStart(2, '0')}`;


        /*
            Destaca hoje
        */
        if (cellDateStr === todayStr) {
            dayDiv.classList.add('today');
        }


        dayDiv.innerHTML =
            `<div class="day-num">${i}</div>`;


        /* ==========================
           AGENDA DO GOOGLE (aulas etc.)
           ========================== */

        if (window.GoogleCalendar) {
            window.GoogleCalendar.eventsOn(cellDateStr).forEach((e) => {
                const evDiv = document.createElement('div');
                evDiv.className = 'calendar-event';
                evDiv.style.borderLeftColor = e.color || '';
                const lugar = e.location && window.lugarCurto ? window.lugarCurto(e.location) : (e.location || '');
                evDiv.title = e.title + (e.location ? ' · ' + e.location : '') + (e.calendarTitle ? ' (' + e.calendarTitle + ')' : '');
                evDiv.innerHTML =
                    `<span class="calendar-event-time">${e.allDay ? 'dia todo' : window.escapeHtml(e.startLabel)}</span>`
                    + `<span class="calendar-event-title">${window.escapeHtml(e.title)}</span>`
                    + (lugar ? `<span class="calendar-event-place">📍 ${window.escapeHtml(lugar)}</span>` : '');
                dayDiv.appendChild(evDiv);
            });
        }


        /* ==========================
           PENDÊNCIAS
           ========================== */

        const dayTasks =
            tasks.filter(
                task => task.deadline === cellDateStr
            );


        dayTasks.forEach(task => {

            /*
                Não mostra concluídas caso
                "mostrar feitas" esteja desativado
            */
            if (
                task.done &&
                !showDoneTasks
            ) {
                return;
            }


            const taskDiv =
                document.createElement('div');


            taskDiv.className =
                `calendar-task ${task.done ? 'done' : ''}`;


            taskDiv.textContent = task.name;

            taskDiv.dataset.subject = task.subject;


            taskDiv.title =
                `${task.name} - ${task.subject}`;


            dayDiv.appendChild(taskDiv);
        });


        /* ==========================
           AVALIAÇÕES
           ========================== */

        const dayAssessments =
            assessments.filter(
                assessment =>
                    assessment.date === cellDateStr
            );


        dayAssessments.forEach(assessment => {

    const assessmentDiv =
        document.createElement('div');

    assessmentDiv.className =
        'calendar-assessment';


    /*
        Nome da avaliação
    */
    const assessmentText =
        document.createElement('span');

    assessmentText.className =
        'calendar-assessment-text';

    assessmentText.textContent =
        assessment.name;

    assessmentDiv.dataset.subject =
        assessment.subject; 

    assessmentText.title =
        `${assessment.name} - ${assessment.subject}`;


    /*
        Botão de apagar
    */
    const deleteAssessmentBtn =
        document.createElement('button');

    deleteAssessmentBtn.type =
        'button';

    deleteAssessmentBtn.className =
        'calendar-assessment-delete';

    deleteAssessmentBtn.innerHTML =
        '&times;';

    deleteAssessmentBtn.title =
        'Apagar avaliação';


    /*
        Encontra a avaliação original
        dentro do array assessments
    */
    deleteAssessmentBtn.addEventListener(
        'click',
        (e) => {

            /*
                Evita qualquer outro evento
                do calendário
            */
            e.stopPropagation();


            const index =
                assessments.indexOf(assessment);


            if (index === -1) {
                return;
            }


            /*
                Pergunta antes de apagar
            */
            const confirmed =
                confirm(
                    `Deseja apagar a avaliação "${assessment.name}" de ${assessment.subject}?`
                );


            if (!confirmed) {
                return;
            }


            /*
                Remove do array
            */
            assessments.splice(
                index,
                1
            );


            /*
                Atualiza localStorage
            */
            saveAssessments();


            /*
                Atualiza calendário
            */
            window.renderCalendar();
        }
    );


    assessmentDiv.appendChild(
        assessmentText
    );

    assessmentDiv.appendChild(
        deleteAssessmentBtn
    );


    dayDiv.appendChild(
        assessmentDiv
    );
});


        calendarGrid.appendChild(dayDiv);
    }
};


/* ==========================
   MUDAR DE MÊS
   ========================== */

const prevMonthBtn =
    document.getElementById('prev-month');

const nextMonthBtn =
    document.getElementById('next-month');


if (prevMonthBtn) {

    prevMonthBtn.addEventListener(
        'click',
        () => {

            currentCalDate.setMonth(
                currentCalDate.getMonth() - 1
            );

            window.renderCalendar();
        }
    );
}


if (nextMonthBtn) {

    nextMonthBtn.addEventListener(
        'click',
        () => {

            currentCalDate.setMonth(
                currentCalDate.getMonth() + 1
            );

            window.renderCalendar();
        }
    );
}


/*
    Desenha o calendário ao abrir o site
*/
window.renderCalendar();

    /* ==========================
       5. AGENDADOR INTELIGENTE
       ========================== */
    /* As estimativas de tempo agora ficam na própria lista de pendências,
       ao lado de cada tarefa. Esta função existe só para quem ainda a chama. */
    window.renderSchedulerTasks = () => { if (typeof window.renderTasks === 'function') window.renderTasks(); };

    window.generateStudySchedule = () => {
        const dailyHours = {
            0: parseFloat(document.getElementById('hours-0')?.value) || 0,
            1: parseFloat(document.getElementById('hours-1')?.value) || 0,
            2: parseFloat(document.getElementById('hours-2')?.value) || 0,
            3: parseFloat(document.getElementById('hours-3')?.value) || 0,
            4: parseFloat(document.getElementById('hours-4')?.value) || 0,
            5: parseFloat(document.getElementById('hours-5')?.value) || 0,
            6: parseFloat(document.getElementById('hours-6')?.value) || 0
        };

        const totalWeeklyHours = Object.values(dailyHours).reduce((acc, h) => acc + h, 0);
        if (totalWeeklyHours <= 0) {
            alert("Por favor, defina um tempo de estudo válido em pelo menos um dia da semana.");
            return;
        }

        const responseContainer = document.getElementById('ai-response-container');
        let pendingTasks = tasks.filter(t => !t.done);
        
        if (pendingTasks.length === 0) {
            alert("Não há tarefas pendentes para agendar.");
            return;
        }

        let missingEstimates = pendingTasks.some(t => !t.estimate || t.estimate <= 0);
        if (missingEstimates) {
            alert("Por favor, preencha a estimativa de tempo (em minutos) para todas as tarefas na lista acima.");
            return;
        }

        const priorityWeight = { 'Alta': 3, 'Média': 2, 'Baixa': 1 };
        
        let scheduleTasks = pendingTasks.map(t => ({
            ...t,
            remainingTime: t.estimate,
            parsedDate: t.deadline ? new Date(t.deadline + 'T00:00:00').getTime() : Infinity
        }));

        scheduleTasks.sort((a, b) => {
            if (a.parsedDate !== b.parsedDate) return a.parsedDate - b.parsedDate;
            return (priorityWeight[b.difficulty] || 0) - (priorityWeight[a.difficulty] || 0);
        });

        let schedule = {}; 
        let currentDate = new Date();
        currentDate.setHours(0,0,0,0);
        
        let minutesUsedToday = 0;
        let daysSafetyCounter = 0;

        for (let task of scheduleTasks) {
            while (task.remainingTime > 0) {
                let dayOfWeek = currentDate.getDay();
                let maxMinutesToday = dailyHours[dayOfWeek] * 60;

                if (maxMinutesToday === 0 || minutesUsedToday >= maxMinutesToday) {
                    currentDate.setDate(currentDate.getDate() + 1);
                    minutesUsedToday = 0;
                    daysSafetyCounter++;

                    if (daysSafetyCounter > 365) {
                        alert("Erro ao agendar: verifique as horas disponíveis na semana.");
                        return;
                    }
                    continue;
                }

                let currentDayStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth()+1).padStart(2,'0')}-${String(currentDate.getDate()).padStart(2,'0')}`;
                let timeAvailableToday = maxMinutesToday - minutesUsedToday;
                let timeToAllocate = Math.min(task.remainingTime, timeAvailableToday);
                
                if (!schedule[currentDayStr]) schedule[currentDayStr] = [];
                
                schedule[currentDayStr].push({
                    name: task.name,
                    subject: task.subject,
                    priority: task.difficulty,
                    time: timeToAllocate
                });

                task.remainingTime -= timeToAllocate;
                minutesUsedToday += timeToAllocate;
            }
        }

        let htmlOut = `<h3>Cronograma Inteligente de Estudos</h3>
        <p style="font-size: 0.9rem; color: var(--text-muted);">Plano gerado com base na sua disponibilidade semanal.</p>
        <hr style="border-color: var(--border); margin: 1rem 0;">`;

        const formatDay = (dateStr) => {
            const [y, m, d] = dateStr.split('-');
            const dateObj = new Date(parseInt(y, 10), parseInt(m, 10) - 1, parseInt(d, 10));
            const weekDayName = dateObj.toLocaleDateString('pt-BR', { weekday: 'short' });
            return `${d}/${m}/${y} (${weekDayName})`;
        };

        for (let day in schedule) {
            htmlOut += `<div style="margin-bottom: 1.5rem;">
                <h4 style="color: var(--primary); border-bottom: 1px dashed var(--border); padding-bottom: 0.25rem; margin-bottom: 0.75rem;">📆 Dia ${formatDay(day)}</h4>
                <ul style="list-style: none; padding-left: 0;">`;
            
            schedule[day].forEach(item => {
                let pColor = item.priority === 'Alta' ? 'var(--danger)' : (item.priority === 'Média' ? 'var(--warning)' : 'var(--success)');
                htmlOut += `<li style="margin-bottom: 0.5rem; background: rgba(255,255,255,0.05); padding: 0.75rem; border-radius: 8px; border-left: 4px solid ${pColor};">
                    <strong>${window.escapeHtml(item.name)}</strong> <span style="color: var(--text-muted); font-size: 0.85rem;">(${window.escapeHtml(item.subject)})</span>
                    <br><span style="font-size: 0.9rem;">⏳ Dedicar: <strong>${item.time} min</strong> (Prioridade: ${item.priority})</span>
                </li>`;
            });
            htmlOut += `</ul></div>`;
        }

        htmlOut += `
            <hr style="border-color: var(--border); margin: 1rem 0;">
            <p><strong>Dica:</strong> Use o <a href="#" onclick="document.querySelector('[data-target=\\'focus-timer\\']').click(); return false;" style="color: var(--primary);">Timer de Foco</a> para cumprir esses blocos!</p>
        `;

        if (responseContainer) {
            responseContainer.style.display = 'block';
            responseContainer.innerHTML = htmlOut;
        }
    };

    // Renderização inicial das pendências no Agendador
    window.renderSchedulerTasks();

    // =======================================================
// ADIÇÃO AUTOMÁTICA DA ABA DESEMPENHO E GRÁFICO (CHART.JS)
// =======================================================

// O gráfico é desenhado pela navegação central (showTab), para
// funcionar independentemente de como a aba foi aberta.

// 3. Funções auxiliares de data e salvamento diário
function getTodayKey(date = new Date()) {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}

function saveTodayStats() {
    const todayKey = getTodayKey();
    const history = JSON.parse(localStorage.getItem('eseStudyHistory') || '{}');
    /* Mantém o que mais houver no dia (as horas por matéria). */
    history[todayKey] = {
        ...(history[todayKey] && typeof history[todayKey] === 'object' ? history[todayKey] : {}),
        study: typeof totalStudySeconds !== 'undefined' ? totalStudySeconds : 0,
        pause: typeof totalPauseSeconds !== 'undefined' ? totalPauseSeconds : 0
    };
    localStorage.setItem('eseStudyHistory', JSON.stringify(history));
}

// 4. Lógica do Gráfico de Desempenho
let currentWeekOffset = 0;
let perfChartInstance = null;

/* Zera o tempo de estudo e de pausa da semana que está na tela.
   Se a semana incluir hoje, também zera os contadores que estão
   rodando — senão o tempo de hoje voltaria no segundo seguinte. */
function resetWeekStats() {
    const dias = getWeekDays(currentWeekOffset);
    const chaves = dias.map((d) => getTodayKey(d));

    const history = JSON.parse(localStorage.getItem('eseStudyHistory') || '{}');
    /* Um dia zerado ainda deixa um registro com 0/0 — não conta como dado. */
    const comDados = chaves.filter((k) => {
        const d = history[k];
        return d && ((Number(d.study) || 0) > 0 || (Number(d.pause) || 0) > 0);
    });

    const primeiro = `${String(dias[0].getDate()).padStart(2, '0')}/${String(dias[0].getMonth() + 1).padStart(2, '0')}`;
    const ultimo = `${String(dias[6].getDate()).padStart(2, '0')}/${String(dias[6].getMonth() + 1).padStart(2, '0')}`;

    if (comDados.length === 0) {
        const nota = document.getElementById('perf-reset-note');
        if (nota) {
            nota.textContent = `A semana de ${primeiro} a ${ultimo} já está zerada.`;
            setTimeout(() => { nota.textContent = ''; }, 4000);
        }
        return;
    }

    const confirmado = confirm(
        `Zerar o tempo de estudo e de pausa da semana de ${primeiro} a ${ultimo}?\n\n` +
        `${comDados.length} dia(s) com registro serão apagados. Isso não pode ser desfeito.`
    );
    if (!confirmado) return;

    chaves.forEach((k) => { delete history[k]; });
    localStorage.setItem('eseStudyHistory', JSON.stringify(history));

    /* Hoje está nesta semana? Então os contadores vivos também vão a zero. */
    const hoje = getTodayKey();
    if (chaves.includes(hoje)) {
        totalStudySeconds = 0;
        totalPauseSeconds = 0;
        localStorage.setItem('eseFocusTimer_totalStudy', '0');
        localStorage.setItem('eseFocusTimer_totalPause', '0');
        if (typeof updateStatsDisplay === 'function') updateStatsDisplay();
    }

    renderPerformanceChart();

    const nota = document.getElementById('perf-reset-note');
    if (nota) {
        nota.textContent = `Semana de ${primeiro} a ${ultimo} zerada.`;
        setTimeout(() => { nota.textContent = ''; }, 4000);
    }
}

function getWeekDays(offset = 0) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const distanceToMonday = (dayOfWeek === 0 ? -6 : 1 - dayOfWeek);
    
    const monday = new Date(now);
    monday.setDate(now.getDate() + distanceToMonday + (offset * 7));

    const weekDays = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        weekDays.push(d);
    }
    return weekDays;
}

function renderPerformanceChart() {
    // Tenta salvar o tempo atual antes de renderizar
    if (typeof saveTodayStats === 'function') saveTodayStats();

    const chartCanvas = document.getElementById('performanceChart');
    if (!chartCanvas) return;

    const weekDays = getWeekDays(currentWeekOffset);
    const history = JSON.parse(localStorage.getItem('eseStudyHistory') || '{}');

    const formatD = d => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
    const rangeTextEl = document.getElementById('perf-week-range');
    if (rangeTextEl) {
        rangeTextEl.textContent = `${formatD(weekDays[0])} a ${formatD(weekDays[6])}`;
    }

    const dayLabels = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado', 'Domingo'];
    const studyHoursData = [];
    const pauseHoursData = [];

    weekDays.forEach(day => {
        const key = getTodayKey(day);
        const dayData = history[key] || { study: 0, pause: 0 };
        studyHoursData.push((dayData.study / 3600).toFixed(2));
        pauseHoursData.push((dayData.pause / 3600).toFixed(2));
    });

    if (perfChartInstance) {
        perfChartInstance.destroy();
    }

    if (window.Desempenho) window.Desempenho.render(currentWeekOffset);

    const ctx = chartCanvas.getContext('2d');
    perfChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: dayLabels,
            datasets: [
                {
                    label: 'Tempo de Estudo (horas)',
                    data: studyHoursData,
                    backgroundColor: '#111111',
                    borderColor: '#000000',
                    borderWidth: 1
                },
                {
                    label: 'Tempo em Pausa (horas)',
                    data: pauseHoursData,
                    backgroundColor: '#fff7cc',
                    borderColor: '#111111',
                    borderWidth: 1
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    stacked: true,
                    beginAtZero: true,
                    title: { display: true, text: 'Horas', color: '#111111' },
                    ticks: { color: '#111111' },
                    grid: { color: 'rgba(0, 0, 0, 0.12)' }
                },
                x: {
                    stacked: true,
                    ticks: { color: '#111111' },
                    grid: { color: 'rgba(0, 0, 0, 0.12)' }
                }
            },
            plugins: {
                legend: { labels: { color: '#111111' } }
            }
        }
    });
}

// 5. Botões de avançar e voltar semana
const btnPrevWeek = document.getElementById('perf-prev-week');
const btnNextWeek = document.getElementById('perf-next-week');

if (btnPrevWeek) {
    btnPrevWeek.addEventListener('click', () => {
        currentWeekOffset--;
        renderPerformanceChart();
    });
}

if (btnNextWeek) {
    btnNextWeek.addEventListener('click', () => {
        currentWeekOffset++;
        renderPerformanceChart();
    });
}

const btnResetWeek = document.getElementById('perf-reset-week');
if (btnResetWeek) {
    btnResetWeek.addEventListener('click', resetWeekStats);
}
// ==========================================
// CONTROLE DE TELA CHEIA DO TIMER DE FOCO
// ==========================================

function closeFocusFullscreen() {
    const timerCard = document.getElementById('focus-timer');
    const exitBtn = document.getElementById('exit-focus-btn');
    
    if (timerCard) timerCard.classList.remove('fullscreen-timer');
    if (exitBtn) exitBtn.remove(); // Remove o botão da tela ao sair
}

function openFocusFullscreen() {
    const timerCard = document.getElementById('focus-timer');
    if (!timerCard) return;

    // Entra em tela cheia
    timerCard.classList.add('fullscreen-timer');

    // Cria o botão de sair diretamente no body para garantir que ele apareça
    if (!document.getElementById('exit-focus-btn')) {
        const btn = document.createElement('button');
        btn.id = 'exit-focus-btn';
        btn.innerHTML = '✕ Sair';
        btn.onclick = closeFocusFullscreen;
        document.body.appendChild(btn);
    }
}

// Detecta os cliques nos botões da sidebar/menu
document.addEventListener('click', function (e) {
    const btn = e.target.closest('[data-target]');
    if (!btn) return;

    const target = btn.getAttribute('data-target');

    if (target === 'focus-timer') {
        openFocusFullscreen();
    } else {
        closeFocusFullscreen();
    }
});

// Permite fechar a tela cheia ao apertar ESC
document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
        closeFocusFullscreen();
    }
});





});