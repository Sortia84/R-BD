// test-editor.js - Gestion de l'éditeur de tests RU/MVS/CVS

let currentTest = {
    id: '',
    name: '',
    ied: '',
    ld: '',
    ln: '',
    lninst: '',
    description: '',
    preconditions: [],
    files: [],
    linked_tests_ru: [],
    linked_tests_mvs: [],
    linked_tests_cvs: [],
    steps: [],
    cde: [],
    alarmes: [],
    tcd: []
};

let stepCounter = 1;
let isEditing = false;

const TYPE_PREFIX = {
    ru: 'RU',
    mvs: 'MVS',
    cvs: 'CVS'
};

const STATE_OPTIONS = [
    { value: 'DEB', label: 'DEB' },
    { value: 'FIN', label: 'FIN' },
    { value: 'ES', label: 'ES' },
    { value: 'HS', label: 'HS' },
    { value: 'FUG', label: 'FUG' }
];

function buildStateOptions(selectedValue = '', placeholder = 'État') {
    const normalized = (selectedValue || '').toUpperCase();
    const placeholderSelected = !normalized ? 'selected' : '';
    const options = STATE_OPTIONS.map(option => {
        const isSelected = normalized === option.value ? 'selected' : '';
        return `<option value="${option.value}" ${isSelected}>${option.label}</option>`;
    }).join('');
    return `<option value="" ${placeholderSelected}>${placeholder}</option>${options}`;
}

const queryParams = new URLSearchParams(window.location.search);
let selectedType = (queryParams.get('type') || 'ru').toLowerCase();
let originalType = selectedType;

function getSavedTests(type = selectedType) {
    return JSON.parse(localStorage.getItem(`tests_${type}`) || '[]');
}

function setSavedTests(type, tests) {
    localStorage.setItem(`tests_${type}`, JSON.stringify(tests));
}

/**
 * Initialise l'éditeur
 */
function initEditor() {
    // Charger les IEDs depuis le SCD si disponible
    loadReferenceLists();

    setupTypeSelector();
    ensureRandomId();
    refreshTypeLabels();

    // Si on édite un test existant, charger ses données
    const testId = new URLSearchParams(window.location.search).get('id');
    if (testId) {
        loadTest(testId);
    }
}

function setupTypeSelector() {
    const typeSelect = document.getElementById('test-type');
    if (!typeSelect) {
        return;
    }

    typeSelect.value = selectedType;
    typeSelect.addEventListener('change', (event) => {
        const newType = (event.target.value || 'ru').toLowerCase();
        if (newType === selectedType) {
            return;
        }
        selectedType = newType;
        currentTest.type = selectedType;
        if (!isEditing) {
            currentTest.id = '';
            ensureRandomId();
        }
        refreshTypeLabels();
    });
}

function refreshTypeLabels() {
    const title = document.getElementById('editor-title');
    if (title) {
        title.textContent = 'Éditeur de test';
    }

}

/**
 * Charge les IEDs depuis l'analyse SCD
 */
async function loadReferenceLists() {
    const iedSelect = document.getElementById('test-ied');
    const ldSelect = document.getElementById('test-ld');
    const lnSelect = document.getElementById('test-ln');
    const lninstSelect = document.getElementById('test-lninst');

    await Promise.all([
        loadList('/data/ied/liste_ied.json', iedSelect),
        loadList('/data/ld/liste_ld.json', ldSelect),
        loadList('/data/ln/liste_ln.json', lnSelect),
        loadList('/data/ln/liste_ln.json', lninstSelect)
    ]);
}

async function loadList(url, selectElement) {
    if (!selectElement) {
        return;
    }

    try {
        const response = await fetch(url);
        if (!response.ok) {
            return;
        }
        const items = await response.json();
        if (!Array.isArray(items)) {
            return;
        }
        items.forEach(item => {
            const option = document.createElement('option');
            option.value = item;
            option.textContent = item;
            selectElement.appendChild(option);
        });
    } catch (error) {
        console.warn(`Impossible de charger ${url}`, error);
    }
}

/**
 * Génère un ID aléatoire pour un nouveau test
 */
function ensureRandomId() {
    if (isEditing) {
        return;
    }

    if (!currentTest.id) {
        const prefix = TYPE_PREFIX[selectedType] || 'RU';
        const uniqueId = makeUniqueId(`${prefix}-${generateRandomId()}`, selectedType);
        currentTest.id = uniqueId;
    }

    const idInput = document.getElementById('test-id');
    if (idInput) {
        idInput.value = currentTest.id;
    }
}

function generateRandomId() {
    return Math.random().toString(36).slice(2, 8).toUpperCase();
}

function makeUniqueId(baseId, type = selectedType) {
    const tests = getSavedTests(type);
    if (!tests.find(t => t.id === baseId)) {
        return baseId;
    }

    let counter = 2;
    let candidate = `${baseId}_${counter}`;
    while (tests.find(t => t.id === candidate)) {
        counter += 1;
        candidate = `${baseId}_${counter}`;
    }
    return candidate;
}

/**
 * Charge un test existant
 */
function loadTest(testId) {
    const tests = getSavedTests(selectedType);
    const test = tests.find(t => t.id === testId);
    if (!test) {
        alert('❌ Test introuvable');
        return;
    }

    isEditing = true;
    selectedType = (test.type || selectedType).toLowerCase();
    originalType = selectedType;
    const typeSelect = document.getElementById('test-type');
    if (typeSelect) {
        typeSelect.value = selectedType;
    }

    currentTest = {
        ...currentTest,
        ...test,
        type: selectedType,
        preconditions: test.preconditions || [],
        files: test.files || [],
        linked_tests_ru: test.linked_tests_ru || [],
        linked_tests_mvs: test.linked_tests_mvs || [],
        linked_tests_cvs: test.linked_tests_cvs || [],
        steps: test.steps || [],
        cde: test.cde || [],
        alarmes: test.alarmes || [],
        tcd: test.tcd || []
    };

    document.getElementById('test-id').value = currentTest.id || '';
    document.getElementById('test-name').value = currentTest.name || '';
    document.getElementById('test-ied').value = currentTest.ied || '';
    document.getElementById('test-ld').value = currentTest.ld || '';
    document.getElementById('test-ln').value = currentTest.ln || '';
    document.getElementById('test-lninst').value = currentTest.lninst || '';
    document.getElementById('test-description').value = currentTest.description || '';

    refreshTypeLabels();

    renderPreconditions();
    renderFiles();
    renderLinkedTests('ru', currentTest.linked_tests_ru);
    renderLinkedTests('mvs', currentTest.linked_tests_mvs);
    renderLinkedTests('cvs', currentTest.linked_tests_cvs);
    renderSteps();
    renderInfo('cde', currentTest.cde, 'CDE');
    renderInfo('alarmes', currentTest.alarmes, 'alarme');
    renderInfo('tcd', currentTest.tcd, 'information TCD');

    updateChronogram();
}

function renderPreconditions() {
    const container = document.getElementById('preconditions-container');
    container.innerHTML = '';

    if (!currentTest.preconditions.length) {
        container.innerHTML = '<p class="text-muted precondition-empty" id="no-preconditions">Aucune précondition</p>';
        return;
    }

    currentTest.preconditions.forEach(precon => {
        const preconditionHtml = `
            <div class="precondition-item" id="${precon.id}">
                <input type="text" class="form-input" placeholder="Nom de la précondition"
                    value="${escapeHtml(precon.name || '')}"
                    onchange="updatePrecondition('${precon.id}', 'name', this.value)">
                <select class="form-input" onchange="updatePrecondition('${precon.id}', 'state', this.value)">
                    ${buildStateOptions(precon.state, 'État')}
                </select>
                <button class="btn-remove" onclick="removePrecondition('${precon.id}')">🗑️</button>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', preconditionHtml);
    });
}

function renderFiles() {
    const listContainer = document.getElementById('files-list');
    listContainer.innerHTML = '';

    currentTest.files.forEach(file => {
        const fileHtml = `
            <div class="file-item" id="${file.id}">
                <div class="file-item-name">
                    <span>📄</span>
                    <span>${escapeHtml(file.name || '')}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="file-item-size">${formatFileSize(file.size || 0)}</span>
                    <button class="btn-icon-small" style="width: 24px; height: 24px; background: var(--danger);"
                        onclick="removeFile('${file.id}')">✕</button>
                </div>
            </div>
        `;
        listContainer.insertAdjacentHTML('beforeend', fileHtml);
    });
}

function renderLinkedTests(type, tests) {
    const containerId = type === 'ru'
        ? 'tests-ru-list'
        : type === 'mvs'
            ? 'tests-mvs-list'
            : 'tests-cvs-list';
    const container = document.getElementById(containerId);
    container.innerHTML = '';

    tests.forEach(item => {
        const linkedHtml = `
            <div class="linked-test-item" id="${item.id}">
                <span>🔗 ${escapeHtml(item.testId || '')}</span>
                <button class="btn-icon-small" style="width: 24px; height: 24px; background: var(--danger);"
                    onclick="removeLinkedTest('${item.id}', '${type}')">✕</button>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', linkedHtml);
    });
}

function renderSteps() {
    const container = document.getElementById('steps-container');
    container.innerHTML = '';
    stepCounter = 1;

    if (!currentTest.steps.length) {
        container.innerHTML = '<p class="text-muted" id="no-steps">Aucune étape. Cliquez sur "➕ Étape" pour en ajouter.</p>';
        return;
    }

    currentTest.steps.forEach(step => {
        const stepId = step.id || `step_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        step.id = stepId;
        const stepNum = step.number || stepCounter++;

        const stepHtml = `
            <div class="step-item" id="${stepId}">
                <div class="step-row">
                    <div class="step-number">${stepNum}</div>
                    <div class="step-fields">
                        <div class="form-group">
                            <label>Nom</label>
                            <input type="text" class="form-input" placeholder="Nom de l'étape"
                                value="${escapeHtml(step.name || '')}"
                                onchange="updateStep('${stepId}', 'name', this.value)">
                        </div>

                        <div class="form-group">
                            <label>Injection</label>
                            <select class="form-input" onchange="toggleInjection('${stepId}', this.value)">
                                <option value="Sans" ${step.injection === 'Sans' ? 'selected' : ''}>Sans injection</option>
                                <option value="Avec" ${step.injection === 'Avec' ? 'selected' : ''}>Avec injection</option>
                            </select>
                        </div>

                        <div class="form-group ${step.injection === 'Avec' ? '' : 'inline-hidden'}" id="${stepId}_fault">
                            <label>Type défaut</label>
                            <input type="text" class="form-input" placeholder="Type de défaut"
                                value="${escapeHtml(step.fault_type || '')}"
                                onchange="updateStep('${stepId}', 'fault_type', this.value)">
                        </div>

                        <div class="form-group">
                            <label>État</label>
                            <select class="form-input" onchange="updateStep('${stepId}', 'state', this.value)">
                                ${buildStateOptions(step.state, 'Sélectionner')}
                            </select>
                        </div>

                        <div class="form-group">
                            <label>Temporisation</label>
                            <div class="step-inline">
                                <select class="form-input" onchange="toggleTemporisation('${stepId}', this.value)">
                                    <option value="Manuel" ${step.temporisation === 'Manuel' ? 'selected' : ''}>Manuel</option>
                                    <option value="Auto" ${step.temporisation === 'Auto' ? 'selected' : ''}>Auto</option>
                                </select>
                                <div class="step-inline ${step.temporisation === 'Manuel' ? '' : 'inline-hidden'}" id="${stepId}_duration">
                                    <input type="number" class="form-input" placeholder="0" min="0"
                                        value="${step.duration || 0}"
                                        onchange="updateStep('${stepId}', 'duration', this.value)">
                                    <select class="form-input" onchange="updateStep('${stepId}', 'unit', this.value)">
                                        <option value="ms" ${step.unit === 'ms' ? 'selected' : ''}>ms</option>
                                        <option value="s" ${step.unit === 's' ? 'selected' : ''}>s</option>
                                        <option value="min" ${step.unit === 'min' ? 'selected' : ''}>min</option>
                                    </select>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div class="step-controls">
                        <button class="btn-move" onclick="moveStep('${stepId}', -1)" title="Monter">↑</button>
                        <button class="btn-move" onclick="moveStep('${stepId}', 1)" title="Descendre">↓</button>
                        <button class="btn-remove" onclick="removeStep('${stepId}')">🗑️</button>
                    </div>
                </div>
            </div>
        `;

        container.insertAdjacentHTML('beforeend', stepHtml);
        stepCounter = Math.max(stepCounter, stepNum + 1);
    });
}

function renderInfo(type, items, label) {
    const container = document.getElementById(`${type}-container`);
    container.innerHTML = '';

    if (!items.length) {
        const labels = { cde: 'CDE', alarmes: 'alarme', tcd: 'information TCD' };
        container.innerHTML = `<p class="text-muted-small">Aucun${type === 'alarmes' ? 'e' : ''} ${labels[type]} ajouté${type === 'alarmes' ? 'e' : ''}</p>`;
        return;
    }

    items.forEach(info => {
        const infoHtml = `
            <div class="info-item" id="${info.id}">
                <input type="text" placeholder="Nom ${label}" value="${escapeHtml(info.name || '')}"
                    onchange="updateInfo('${type}', '${info.id}', 'name', this.value)">
                <select onchange="updateInfo('${type}', '${info.id}', 'state', this.value)">
                    ${buildStateOptions(info.state, 'État')}
                </select>
                <button class="btn-icon-small" style="width: 24px; height: 24px; background: var(--danger);"
                    onclick="removeInfo('${type}', '${info.id}')">✕</button>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', infoHtml);
    });
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}

/**
 * Ajoute une précondition
 */
function addPrecondition() {
    const container = document.getElementById('preconditions-container');
    const noPrecon = document.getElementById('no-preconditions');

    if (noPrecon) {
        noPrecon.remove();
    }

    const preconditionId = `precon_${Date.now()}`;

    const preconditionHtml = `
        <div class="precondition-item" id="${preconditionId}">
            <input type="text" class="form-input" placeholder="Nom de la précondition"
                onchange="updatePrecondition('${preconditionId}', 'name', this.value)">
            <select class="form-input" onchange="updatePrecondition('${preconditionId}', 'state', this.value)">
                ${buildStateOptions('', 'État')}
            </select>
            <button class="btn-remove" onclick="removePrecondition('${preconditionId}')">
                🗑️
            </button>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', preconditionHtml);

    currentTest.preconditions.push({
        id: preconditionId,
        name: '',
        state: ''
    });
}

/**
 * Met à jour une précondition
 */
function updatePrecondition(id, field, value) {
    const precon = currentTest.preconditions.find(p => p.id === id);
    if (precon) {
        precon[field] = value;
    }
}

/**
 * Supprime une précondition
 */
function removePrecondition(id) {
    document.getElementById(id).remove();
    currentTest.preconditions = currentTest.preconditions.filter(p => p.id !== id);

    // Réafficher le message si plus de préconditions
    const container = document.getElementById('preconditions-container');
    if (container.children.length === 0) {
        container.innerHTML = '<p class="text-muted precondition-empty" id="no-preconditions">Aucune précondition</p>';
    }
}

/**
 * Gestion de l'upload de fichiers
 */
function handleFileUpload(event) {
    const files = Array.from(event.target.files);
    const listContainer = document.getElementById('files-list');

    files.forEach(file => {
        const fileId = `file_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        const fileHtml = `
            <div class="file-item" id="${fileId}">
                <div class="file-item-name">
                    <span>📄</span>
                    <span>${file.name}</span>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <span class="file-item-size">${formatFileSize(file.size)}</span>
                    <button class="btn-icon-small" style="width: 24px; height: 24px; background: var(--danger);"
                        onclick="removeFile('${fileId}')">✕</button>
                </div>
            </div>
        `;

        listContainer.insertAdjacentHTML('beforeend', fileHtml);

        currentTest.files.push({
            id: fileId,
            name: file.name,
            size: file.size,
            type: file.type
        });
    });
}

/**
 * Formate la taille d'un fichier
 */
function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Supprime un fichier
 */
function removeFile(fileId) {
    document.getElementById(fileId).remove();
    currentTest.files = currentTest.files.filter(f => f.id !== fileId);
}

/**
 * Lie un test RU
 */
function linkTestRU() {
    const testId = prompt('ID du test RU à lier :');
    if (testId) {
        addLinkedTest('ru', testId);
    }
}

/**
 * Lie un test MVS
 */
function linkTestMVS() {
    const testId = prompt('ID du test MVS à lier :');
    if (testId) {
        addLinkedTest('mvs', testId);
    }
}

/**
 * Lie un test CVS
 */
function linkTestCVS() {
    const testId = prompt('ID du test CVS à lier :');
    if (testId) {
        addLinkedTest('cvs', testId);
    }
}

/**
 * Ajoute un test lié
 */
function addLinkedTest(type, testId) {
    const containerId = type === 'ru'
        ? 'tests-ru-list'
        : type === 'mvs'
            ? 'tests-mvs-list'
            : 'tests-cvs-list';
    const container = document.getElementById(containerId);

    const linkedId = `linked_${type}_${Date.now()}`;

    const linkedHtml = `
        <div class="linked-test-item" id="${linkedId}">
            <span>🔗 ${testId}</span>
            <button class="btn-icon-small" style="width: 24px; height: 24px; background: var(--danger);"
                onclick="removeLinkedTest('${linkedId}', '${type}')">✕</button>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', linkedHtml);

    if (type === 'ru') {
        currentTest.linked_tests_ru.push({ id: linkedId, testId });
    } else if (type === 'mvs') {
        currentTest.linked_tests_mvs.push({ id: linkedId, testId });
    } else {
        currentTest.linked_tests_cvs.push({ id: linkedId, testId });
    }
}

/**
 * Supprime un test lié
 */
function removeLinkedTest(linkedId, type) {
    document.getElementById(linkedId).remove();

    if (type === 'ru') {
        currentTest.linked_tests_ru = currentTest.linked_tests_ru.filter(t => t.id !== linkedId);
    } else if (type === 'mvs') {
        currentTest.linked_tests_mvs = currentTest.linked_tests_mvs.filter(t => t.id !== linkedId);
    } else {
        currentTest.linked_tests_cvs = currentTest.linked_tests_cvs.filter(t => t.id !== linkedId);
    }
}

/**
 * Ajoute une étape de test
 */
function addStep() {
    const container = document.getElementById('steps-container');
    const noSteps = document.getElementById('no-steps');

    if (noSteps) {
        noSteps.remove();
    }

    const stepId = `step_${Date.now()}`;
    const stepNum = stepCounter++;

    const stepHtml = `
        <div class="step-item" id="${stepId}">
            <div class="step-row">
                <div class="step-number">${stepNum}</div>
                <div class="step-fields">
                    <div class="form-group">
                        <label>Nom</label>
                        <input type="text" class="form-input" placeholder="Nom de l'étape"
                            onchange="updateStep('${stepId}', 'name', this.value)">
                    </div>

                    <div class="form-group">
                        <label>Injection</label>
                        <select class="form-input" onchange="toggleInjection('${stepId}', this.value)">
                            <option value="Sans">Sans injection</option>
                            <option value="Avec">Avec injection</option>
                        </select>
                    </div>

                    <div class="form-group inline-hidden" id="${stepId}_fault">
                        <label>Type défaut</label>
                        <input type="text" class="form-input" placeholder="Type de défaut"
                            onchange="updateStep('${stepId}', 'fault_type', this.value)">
                    </div>

                    <div class="form-group">
                        <label>État</label>
                        <select class="form-input" onchange="updateStep('${stepId}', 'state', this.value)">
                            ${buildStateOptions('', 'Sélectionner')}
                        </select>
                    </div>

                    <div class="form-group">
                        <label>Temporisation</label>
                        <div class="step-inline">
                            <select class="form-input" onchange="toggleTemporisation('${stepId}', this.value)">
                                <option value="Manuel">Manuel</option>
                                <option value="Auto">Auto</option>
                            </select>
                            <div class="step-inline inline-hidden" id="${stepId}_duration">
                                <input type="number" class="form-input" placeholder="0" min="0"
                                    onchange="updateStep('${stepId}', 'duration', this.value)">
                                <select class="form-input" onchange="updateStep('${stepId}', 'unit', this.value)">
                                    <option value="ms">ms</option>
                                    <option value="s">s</option>
                                    <option value="min">min</option>
                                </select>
                            </div>
                        </div>
                    </div>
                </div>
                <div class="step-controls">
                    <button class="btn-move" onclick="moveStep('${stepId}', -1)" title="Monter">↑</button>
                    <button class="btn-move" onclick="moveStep('${stepId}', 1)" title="Descendre">↓</button>
                    <button class="btn-remove" onclick="removeStep('${stepId}')">🗑️</button>
                </div>
            </div>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', stepHtml);

    currentTest.steps.push({
        id: stepId,
        number: stepNum,
        name: '',
        injection: 'Sans',
        fault_type: '',
        state: '',
        temporisation: 'Manuel',
        duration: 0,
        unit: 'ms'
    });

    updateChronogram();
}

/**
 * Active/désactive l'injection
 */
function toggleInjection(stepId, value) {
    const faultField = document.getElementById(`${stepId}_fault`);
    if (faultField) {
        faultField.classList.toggle('inline-hidden', value !== 'Avec');
    }
    updateStep(stepId, 'injection', value);
    updateChronogram();
}

/**
 * Active/désactive la temporisation manuelle
 */
function toggleTemporisation(stepId, value) {
    const durationField = document.getElementById(`${stepId}_duration`);
    const isManual = value === 'Manuel';
    if (durationField) {
        durationField.classList.toggle('inline-hidden', !isManual);
    }
    updateStep(stepId, 'temporisation', value);
    updateChronogram();
}

/**
 * Met à jour une étape
 */
function updateStep(stepId, field, value) {
    const step = currentTest.steps.find(s => s.id === stepId);
    if (step) {
        if (field === 'duration') {
            const numeric = Math.max(0, Number(value) || 0);
            step[field] = numeric;
            const durationInput = document.querySelector(`#${stepId}_duration input`);
            if (durationInput && Number(durationInput.value) !== numeric) {
                durationInput.value = numeric;
            }
        } else {
            step[field] = value;
        }
        updateChronogram();
    }
}

/**
 * Déplace une étape
 */
function moveStep(stepId, direction) {
    const container = document.getElementById('steps-container');
    const stepElement = document.getElementById(stepId);
    const steps = Array.from(container.children).filter(el => el.classList.contains('step-item'));
    const currentIndex = steps.indexOf(stepElement);
    const newIndex = currentIndex + direction;

    if (newIndex >= 0 && newIndex < steps.length) {
        if (direction === -1) {
            container.insertBefore(stepElement, steps[newIndex]);
        } else {
            container.insertBefore(stepElement, steps[newIndex].nextSibling);
        }

        // Réorganiser dans le tableau
        const step = currentTest.steps[currentIndex];
        currentTest.steps.splice(currentIndex, 1);
        currentTest.steps.splice(newIndex, 0, step);

        updateChronogram();
    }
}

/**
 * Supprime une étape
 */
function removeStep(stepId) {
    document.getElementById(stepId).remove();
    currentTest.steps = currentTest.steps.filter(s => s.id !== stepId);

    const container = document.getElementById('steps-container');
    if (container.children.length === 0) {
        container.innerHTML = '<p class="text-muted" id="no-steps">Aucune étape. Cliquez sur "➕ Étape" pour en ajouter.</p>';
    }

    updateChronogram();
}

/**
 * Met à jour le chronogramme
 */
function updateChronogram() {
    const container = document.getElementById('chronogram-container');

    if (currentTest.steps.length === 0) {
        container.innerHTML = '<p style="margin: 0;">Le chronogramme sera généré automatiquement dès que vous ajouterez des étapes</p>';
        return;
    }

    const durations = currentTest.steps.map(step => getStepDurationMs(step));
    const total = durations.reduce((sum, value) => sum + value, 0) || 1;

    const segments = currentTest.steps.map((step, index) => {
        const state = (step.state || '').toUpperCase();
        const level = ['FIN', 'HS'].includes(state) ? 0 : 1;
        const width = (durations[index] / total) * 100;
        return {
            index: index + 1,
            level,
            width: Math.max(width, 4)
        };
    });

    let cumulative = 0;
    const separators = currentTest.steps.slice(0, -1).map((_, index) => {
        cumulative += durations[index];
        const left = (cumulative / total) * 100;
        return `<div class="chrono-separator" style="left: ${left}%;"></div>`;
    }).join('');

    const totalLabel = formatDuration(total);

    const trackSegments = segments.map(seg => `
        <div class="chrono-segment" style="width: ${seg.width}%;">
            <div class="chrono-line ${seg.level === 1 ? 'top' : 'bottom'}"></div>
        </div>
    `).join('');

    const axisSegments = segments.map(seg => `
        <div class="chrono-label" style="width: ${seg.width}%;">${seg.index}</div>
    `).join('');

    container.innerHTML = `
        <div class="chronogram">
            <div class="chrono-body">
                <div class="chrono-yaxis">
                    <span>1</span>
                    <span>0</span>
                </div>
                <div class="chrono-content">
                    <div class="chrono-track">
                        ${separators}
                        ${trackSegments}
                    </div>
                    <div class="chrono-xaxis">${axisSegments}</div>
                </div>
                <div class="chrono-total">${totalLabel}</div>
            </div>
        </div>
    `;
}

function formatDuration(ms) {
    if (ms < 1000) {
        return `${Math.round(ms)}ms`;
    }
    const seconds = ms / 1000;
    if (seconds < 60) {
        return `${seconds.toFixed(1)}s`;
    }
    const minutes = seconds / 60;
    return `${minutes.toFixed(1)}min`;
}

function getStepDurationMs(step) {
    if (step.temporisation !== 'Manuel') {
        return 1000;
    }

    const value = Number(step.duration) || 0;
    const unit = step.unit || 'ms';

    switch (unit) {
        case 's':
            return value * 1000;
        case 'min':
            return value * 60000;
        default:
            return value;
    }
}

/**
 * Ajoute une information CDE
 */
function addCDE() {
    addInfo('cde', 'CDE');
}

/**
 * Ajoute une alarme
 */
function addAlarme() {
    addInfo('alarmes', 'Alarme');
}

/**
 * Ajoute une information TCD
 */
function addTCD() {
    addInfo('tcd', 'TCD');
}

/**
 * Ajoute une information (CDE/Alarme/TCD)
 */
function addInfo(type, label) {
    const containerId = `${type}-container`;
    const container = document.getElementById(containerId);

    // Supprimer le message "aucun"
    const placeholder = container.querySelector('.text-muted-small');
    if (placeholder) {
        placeholder.remove();
    }

    const infoId = `${type}_${Date.now()}`;

    const infoHtml = `
        <div class="info-item" id="${infoId}">
            <input type="text" placeholder="Nom ${label}" onchange="updateInfo('${type}', '${infoId}', 'name', this.value)">
            <select onchange="updateInfo('${type}', '${infoId}', 'state', this.value)">
                ${buildStateOptions('', 'État')}
            </select>
            <button class="btn-icon-small" style="width: 24px; height: 24px; background: var(--danger);"
                onclick="removeInfo('${type}', '${infoId}')">✕</button>
        </div>
    `;

    container.insertAdjacentHTML('beforeend', infoHtml);

    currentTest[type].push({
        id: infoId,
        name: '',
        state: ''
    });
}

/**
 * Met à jour une information
 */
function updateInfo(type, infoId, field, value) {
    const info = currentTest[type].find(i => i.id === infoId);
    if (info) {
        info[field] = value;
    }
}

/**
 * Supprime une information
 */
function removeInfo(type, infoId) {
    document.getElementById(infoId).remove();
    currentTest[type] = currentTest[type].filter(i => i.id !== infoId);

    const container = document.getElementById(`${type}-container`);
    if (container.children.length === 0) {
        const labels = { cde: 'CDE', alarmes: 'alarme', tcd: 'information TCD' };
        container.innerHTML = `<p class="text-muted-small">Aucun${type === 'alarmes' ? 'e' : ''} ${labels[type]} ajouté${type === 'alarmes' ? 'e' : ''}</p>`;
    }
}

/**
 * Prévisualise le test
 */
function previewTest() {
    collectFormData();
    console.log('Aperçu du test:', currentTest);
    alert('Prévisualisation du test (voir console pour le JSON complet)');
}

/**
 * Collecte les données du formulaire
 */
function collectFormData() {
    currentTest.id = document.getElementById('test-id').value;
    currentTest.type = (document.getElementById('test-type')?.value || selectedType).toLowerCase();
    currentTest.name = document.getElementById('test-name').value;
    currentTest.ied = document.getElementById('test-ied').value;
    currentTest.ld = document.getElementById('test-ld').value;
    currentTest.ln = document.getElementById('test-ln').value;
    currentTest.lninst = document.getElementById('test-lninst').value;
    currentTest.description = document.getElementById('test-description').value;
}

/**
 * Sauvegarde le test
 */
function saveTest() {
    const selectedValue = (document.getElementById('test-type')?.value || selectedType).toLowerCase();
    selectedType = selectedValue;

    if (!currentTest.id) {
        const prefix = TYPE_PREFIX[selectedType] || 'RU';
        const uniqueId = makeUniqueId(`${prefix}-${generateRandomId()}`, selectedType);
        currentTest.id = uniqueId;
        const idInput = document.getElementById('test-id');
        if (idInput) {
            idInput.value = uniqueId;
        }
    }

    collectFormData();
    currentTest.type = selectedType;

    // Validation
    if (!currentTest.id || !currentTest.name) {
        alert('❌ Veuillez remplir au minimum l\'ID et le nom du test');
        return;
    }

    // Sauvegarder dans localStorage
    const tests = getSavedTests(selectedType);
    const existingIndex = tests.findIndex(t => t.id === currentTest.id);

    if (existingIndex >= 0) {
        tests[existingIndex] = currentTest;
    } else {
        tests.push(currentTest);
    }

    setSavedTests(selectedType, tests);

    if (originalType && originalType !== selectedType) {
        const previousTests = getSavedTests(originalType);
        const updatedPrevious = previousTests.filter(t => t.id !== currentTest.id);
        setSavedTests(originalType, updatedPrevious);
        originalType = selectedType;
    }

    alert('✅ Test sauvegardé avec succès !');
    const targetPage = './templates-essais.html';
    window.location.href = targetPage;
}
