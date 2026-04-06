// test-editor.js - Gestion de l'éditeur de tests RU/MVS/CVS

// ============================================================
// Données globales
// ============================================================

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
let linkedPickerState = {
    type: 'ru',
    candidates: [],
    filteredCandidates: []
};
let bidirectionalLinksChecked = false;

// Données de référence chargées depuis l'API
let editorIedPatterns = [];      // Liste des patterns IED depuis liste_ied.json
let editorIcdCatalog = [];       // Catalogue des ICD depuis index.json
let editorIcdDetailsCache = {};  // Cache des détails ICD (LDs, LNs)

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

// SPA : le type et l'ID du test sont passés par openEditor() au lieu de query params
let selectedType = 'ru';
let originalType = selectedType;
let persistedEditorType = selectedType;
let persistedEditorId = '';


// ============================================================
// RENDU DU LAYOUT — Génération HTML de l'éditeur
// ============================================================

/**
 * Générer et injecter le layout HTML complet de l'éditeur de test.
 *
 * Appelée par renderEssaisLayout() dans templates-essais.js.
 * Injecte le formulaire dans #essais-editor-view.
 *
 * Sections : identification, description/préconditions/éléments liés,
 * étapes, chronogramme, infos complémentaires (CDE/alarmes/TCD), sauvegarde.
 */
function renderEditorLayout() {
    const container = document.getElementById("essais-editor-view");
    if (!container) return;

    container.innerHTML = `
        <!-- Bandeau éditeur -->
        <section class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <h2 id="editor-title" style="margin: 0;">Éditeur de test</h2>
                        <select id="test-type" class="form-input" style="width: 90px; padding: 6px 10px;">
                            <option value="ru">RU</option>
                            <option value="cvs">CVS</option>
                            <option value="mvs">MVS</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; gap: 12px;">
                    <button class="btn btn-secondary" onclick="closeEditor()">← Retour</button>
                    <button class="btn btn-primary" onclick="saveTest()">💾 Sauvegarder</button>
                </div>
            </div>
        </section>

        <!-- Identification -->
        <section class="card">
            <div class="card-header"><h3 style="margin: 0;">Identification du test</h3></div>
            <div class="divider"></div>
            <div class="form-grid">
                <div class="form-group">
                    <label>ID (auto)</label>
                    <input type="text" id="test-id" class="form-input" placeholder="Auto: RU-XXXXXX" readonly>
                    <div class="field-hint">Généré automatiquement (ID aléatoire)</div>
                </div>
                <div class="form-group">
                    <label>Nom du test</label>
                    <input type="text" id="test-name" class="form-input" placeholder="Nom du test">
                </div>
                <div class="form-group">
                    <label>IED</label>
                    <select id="test-ied" class="form-input"><option value="">Sélectionner un IED</option></select>
                </div>
                <div class="form-group">
                    <label>Variant</label>
                    <select id="test-variant" class="form-input"><option value="">— Aucun —</option></select>
                </div>
                <div class="form-group">
                    <label>LD</label>
                    <select id="test-ld" class="form-input"><option value="">Sélectionner un LD</option></select>
                </div>
                <div class="form-group">
                    <label>LN</label>
                    <select id="test-ln" class="form-input"><option value="">Sélectionner un LN</option></select>
                </div>
                <div class="form-group">
                    <label>LNinst</label>
                    <select id="test-lninst" class="form-input"><option value="">Sélectionner LNinst</option></select>
                </div>
            </div>
        </section>

        <!-- Description / Préconditions / Éléments liés -->
        <section class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0;">Description, préconditions &amp; éléments liés</h3>
            </div>
            <div class="divider"></div>
            <div class="compact-row">
                <div class="compact-col">
                    <label class="form-label">Description</label>
                    <textarea id="test-description" class="form-input description-input" rows="6" placeholder="Description détaillée du test"></textarea>
                </div>
                <div class="compact-col">
                    <label class="form-label">Préconditions</label>
                    <div class="compact-actions">
                        <button class="btn-icon-add" onclick="addPrecondition()">➕ Précondition</button>
                    </div>
                    <div id="preconditions-container" class="compact-list">
                        <p class="text-muted precondition-empty" id="no-preconditions">Aucune précondition</p>
                    </div>
                </div>
                <div class="compact-col">
                    <label class="form-label">Éléments liés</label>
                    <div class="linked-tests-zone compact-links">
                        <div class="compact-links-row">
                            <div class="file-upload-zone compact-upload" onclick="document.getElementById('file-input').click()">
                                <div class="compact-upload-content">
                                    <span class="compact-upload-icon">📁</span>
                                    <span>Fichier</span>
                                </div>
                            </div>
                            <button class="btn-link-test" onclick="linkTestRU()">➕ RU</button>
                            <button class="btn-link-test" onclick="linkTestMVS()">➕ MVS</button>
                            <button class="btn-link-test" onclick="linkTestCVS()">➕ CVS</button>
                        </div>
                        <input type="file" id="file-input" multiple style="display: none;" onchange="handleFileUpload(event)">
                        <div id="files-list" class="compact-list"></div>
                        <div id="tests-ru-list" class="compact-list"></div>
                        <div id="tests-mvs-list" class="compact-list"></div>
                        <div id="tests-cvs-list" class="compact-list"></div>
                    </div>
                </div>
            </div>
        </section>

        <!-- Étapes -->
        <section class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0;">Étapes du test</h3>
                <button class="btn-icon-add" onclick="addStep()">➕ Étape</button>
            </div>
            <div class="divider"></div>
            <div id="steps-container">
                <p class="text-muted" id="no-steps">Aucune étape. Cliquez sur "➕ Étape" pour en ajouter.</p>
            </div>
        </section>

        <!-- Chronogramme -->
        <section class="card">
            <div class="card-header">
                <h3 style="margin: 0;">Chronogramme</h3>
                <p class="muted" style="margin: 4px 0 0 0;">Généré automatiquement à partir des étapes</p>
            </div>
            <div class="divider"></div>
            <div id="chronogram-container" style="min-height: 200px; background: #f8f9fa; border-radius: 8px; padding: 20px; text-align: center; color: var(--muted);">
                <p style="margin: 0;">Le chronogramme sera généré automatiquement dès que vous ajouterez des étapes</p>
            </div>
        </section>

        <!-- Informations complémentaires -->
        <section class="card">
            <div class="card-header"><h3 style="margin: 0;">Informations complémentaires</h3></div>
            <div class="divider"></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 16px;">
                <!-- CDE -->
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <label class="form-label">📊 Informations CDE</label>
                        <div style="display: flex; gap: 4px;">
                            <button class="btn-db-picker" onclick="openCDEPicker()" title="Sélectionner depuis la base ISA">🗄️</button>
                            <button class="btn-icon-small" onclick="addCDE()" title="Ajout manuel">➕</button>
                        </div>
                    </div>
                    <div id="cde-container"><p class="text-muted-small">Aucun CDE ajouté</p></div>
                </div>
                <!-- Alarmes -->
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <label class="form-label">⚠️ Alarmes</label>
                        <div style="display: flex; gap: 4px;">
                            <button class="btn-db-picker" onclick="openAlarmesPicker()" title="Sélectionner depuis la base ISA">🗄️</button>
                            <button class="btn-icon-small" onclick="addAlarme()" title="Ajout manuel">➕</button>
                        </div>
                    </div>
                    <div id="alarmes-container"><p class="text-muted-small">Aucune alarme ajoutée</p></div>
                </div>
                <!-- TCD -->
                <div>
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
                        <label class="form-label">ℹ️ Informations TCD</label>
                        <div style="display: flex; gap: 4px;">
                            <button class="btn-db-picker" onclick="openTCDPicker()" title="Sélectionner depuis la base ISA">🗄️</button>
                            <button class="btn-icon-small" onclick="addTCD()" title="Ajout manuel">➕</button>
                        </div>
                    </div>
                    <div id="tcd-container"><p class="text-muted-small">Aucune information TCD</p></div>
                </div>
            </div>
        </section>

        <!-- Sauvegarde éditeur -->
        <section class="card" style="display: flex; justify-content: space-between; align-items: center;">
            <button class="btn btn-secondary" onclick="closeEditor()">← Annuler</button>
            <div style="display: flex; gap: 12px;">
                <button class="btn btn-secondary" onclick="previewTest()">👁️ Prévisualiser</button>
                <button class="btn btn-primary" onclick="saveTest()">💾 Sauvegarder le test</button>
            </div>
        </section>
    `;

    console.info("[EDITOR][Init] Layout éditeur généré");
}

function getSavedTests(type = selectedType) {
    return JSON.parse(localStorage.getItem(`tests_${type}`) || '[]');
}

function setSavedTests(type, tests) {
    localStorage.setItem(`tests_${type}`, JSON.stringify(tests));
}

/**
 * Initialise l'éditeur
 */
async function initEditor() {
    if (!bidirectionalLinksChecked) {
        await repairBidirectionalLinksInStorage();
        bidirectionalLinksChecked = true;
    }

    // Charger les IEDs depuis le SCD si disponible
    // ⚠️ DOIT être await pour que les <select> soient peuplés AVANT loadTest
    await loadEditorReferenceLists();

    setupTypeSelector();
    ensureRandomId();
    refreshTypeLabels();

    // Si on édite un test existant, charger ses données
    // SPA : l'ID est passé via la variable _editorTestId définie par openEditor()
    if (typeof _editorTestId !== 'undefined' && _editorTestId) {
        await loadTest(_editorTestId);
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
        } else {
            ensureTypeCoherentIdOnTypeChange();
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

function getTypePrefix(type) {
    return TYPE_PREFIX[String(type || 'ru').toLowerCase()] || 'RU';
}

function idHasExpectedPrefix(testId, type) {
    const normalizedId = String(testId || '').trim().toUpperCase();
    const expectedPrefix = `${getTypePrefix(type)}-`;
    return normalizedId.startsWith(expectedPrefix);
}

function generateTypeCoherentId(type) {
    const prefix = getTypePrefix(type);
    return makeUniqueId(`${prefix}-${generateRandomId()}`, type);
}

function setEditorIdValue(newId) {
    currentTest.id = newId;
    const idInput = document.getElementById('test-id');
    if (idInput) {
        idInput.value = newId;
    }
}

function ensureTypeCoherentIdOnTypeChange() {
    // Cas principal: test existant RU basculé en CVS/MVS (ou inversement).
    // On force un ID cohérent avec le nouveau type.
    if (!isEditing || !currentTest.id) {
        return;
    }

    if (idHasExpectedPrefix(currentTest.id, selectedType)) {
        return;
    }

    const previousId = currentTest.id;
    const regeneratedId = generateTypeCoherentId(selectedType);
    setEditorIdValue(regeneratedId);
    console.info(`[EDITOR][TypeChange] ID régénéré ${previousId} -> ${regeneratedId} (type=${selectedType})`);
}

/**
 * Charge les IEDs depuis l'API et configure les sélecteurs liés
 */
async function loadEditorReferenceLists() {
    const iedSelect = document.getElementById('test-ied');
    const variantSelect = document.getElementById('test-variant');
    const ldSelect = document.getElementById('test-ld');
    const lnSelect = document.getElementById('test-ln');
    const lninstSelect = document.getElementById('test-lninst');

    // Charger les patterns IED et le catalogue ICD
    await Promise.all([
        loadEditorIedPatterns(),
        loadEditorIcdCatalog()
    ]);

    // Remplir la liste des IED (patterns parents uniquement)
    populateIedSelect(iedSelect);

    // Configurer les événements de changement en cascade
    iedSelect.addEventListener('change', () => onIedChange());
    variantSelect.addEventListener('change', () => onVariantChange());
    ldSelect.addEventListener('change', () => onLdChange());
    lnSelect.addEventListener('change', () => onLnChange());

    // Initialiser les listes dépendantes comme vides
    resetSelect(variantSelect, '— Aucun —');
    resetSelect(ldSelect, 'Sélectionner un LD');
    resetSelect(lnSelect, 'Sélectionner un LN');
    resetSelect(lninstSelect, 'Sélectionner LNinst');
}

/**
 * Charge les patterns IED depuis l'API backend.
 */
async function loadEditorIedPatterns() {
    try {
        const response = await fetch('/api/icd/patterns');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        editorIedPatterns = data.patterns || data.ied_patterns || [];
        console.log(`📋 ${editorIedPatterns.length} patterns IED chargés`);
    } catch (error) {
        console.warn('Impossible de charger les patterns IED', error);
        editorIedPatterns = [];
    }
}

/**
 * Charge le catalogue ICD depuis l'API backend.
 */
async function loadEditorIcdCatalog() {
    try {
        const response = await fetch('/api/icd/');
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        editorIcdCatalog = data.icds || data.icd_list || [];
        console.log(`📦 ${editorIcdCatalog.length} ICD dans le catalogue`);
    } catch (error) {
        console.warn('Impossible de charger le catalogue ICD', error);
        editorIcdCatalog = [];
    }
}

/**
 * Charge les détails d'un ICD (LDs et LNs)
 */
async function loadEditorIcdDetails(icdId) {
    // Vérifier le cache
    if (editorIcdDetailsCache[icdId]) {
        return editorIcdDetailsCache[icdId];
    }

    if (!icdId) {
        console.warn('ICD non fourni');
        return null;
    }

    try {
        const response = await fetch(`/api/icd/details/${encodeURIComponent(icdId)}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        editorIcdDetailsCache[icdId] = data;
        return data;
    } catch (error) {
        console.warn(`Impossible de charger les détails ICD: ${icdId}`, error);
        return null;
    }
}

/**
 * Remplit le sélecteur IED avec les patterns parents
 */
function populateIedSelect(selectElement) {
    if (!selectElement) return;

    // Ne garder que les patterns parents (sans parent défini)
    const parentPatterns = editorIedPatterns.filter(p => !p.parent);

    // Trier par display_name
    parentPatterns.sort((a, b) =>
        a.display_name.localeCompare(b.display_name, 'fr', { sensitivity: 'base' })
    );

    selectElement.innerHTML = '<option value="">Sélectionner un IED</option>';

    parentPatterns.forEach(pattern => {
        const hasIcd = (pattern.icd_refs || []).length > 0;
        const option = document.createElement('option');
        option.value = pattern.id;
        option.textContent = `${pattern.display_name} (${pattern.pattern})`;
        if (!hasIcd) {
            option.textContent += ' ⚠️ Sans ICD';
            option.style.color = '#f59e0b';
        }
        selectElement.appendChild(option);
    });
}

/**
 * Reset un sélecteur avec un placeholder
 */
function resetSelect(selectElement, placeholder) {
    if (!selectElement) return;
    selectElement.innerHTML = `<option value="">${placeholder}</option>`;
}

/**
 * Événement: changement d'IED sélectionné
 */
async function onIedChange() {
    const iedSelect = document.getElementById('test-ied');
    const variantSelect = document.getElementById('test-variant');
    const ldSelect = document.getElementById('test-ld');
    const lnSelect = document.getElementById('test-ln');
    const lninstSelect = document.getElementById('test-lninst');

    const patternId = iedSelect.value;

    // Reset les listes dépendantes
    resetSelect(variantSelect, '— Aucun —');
    resetSelect(ldSelect, 'Chargement...');
    resetSelect(lnSelect, 'Sélectionner un LN');
    resetSelect(lninstSelect, 'Sélectionner LNinst');

    if (!patternId) {
        resetSelect(ldSelect, 'Sélectionner un LD');
        return;
    }

    // Trouver le pattern parent
    const pattern = editorIedPatterns.find(p => p.id === patternId);
    if (!pattern) {
        resetSelect(ldSelect, 'Aucun LD disponible');
        return;
    }

    // Peupler la liste des variants (enfants de ce pattern)
    const variants = editorIedPatterns.filter(p => p.parent === patternId);
    if (variants.length > 0) {
        variants.sort((a, b) => a.display_name.localeCompare(b.display_name, 'fr'));
        for (const variant of variants) {
            const option = document.createElement('option');
            option.value = variant.id;
            option.textContent = variant.display_name;
            variantSelect.appendChild(option);
        }
    }

    // Charger les LDs depuis le pattern parent (par défaut)
    await loadLdsForPattern(pattern);
}

/**
 * Événement: changement de variant sélectionné
 */
async function onVariantChange() {
    const iedSelect = document.getElementById('test-ied');
    const variantSelect = document.getElementById('test-variant');
    const ldSelect = document.getElementById('test-ld');
    const lnSelect = document.getElementById('test-ln');
    const lninstSelect = document.getElementById('test-lninst');

    // Reset les listes dépendantes
    resetSelect(ldSelect, 'Chargement...');
    resetSelect(lnSelect, 'Sélectionner un LN');
    resetSelect(lninstSelect, 'Sélectionner LNinst');

    const variantId = variantSelect.value;
    const parentId = iedSelect.value;

    // Si pas de variant sélectionné, utiliser le parent
    const patternId = variantId || parentId;
    if (!patternId) {
        resetSelect(ldSelect, 'Sélectionner un LD');
        return;
    }

    const pattern = editorIedPatterns.find(p => p.id === patternId);
    if (!pattern) {
        resetSelect(ldSelect, 'Aucun LD disponible');
        return;
    }

    await loadLdsForPattern(pattern);
}

/**
 * Charge les LDs depuis les ICDs associés à un pattern
 */
async function loadLdsForPattern(pattern) {
    const ldSelect = document.getElementById('test-ld');

    const icdRefs = pattern.icd_refs || [];
    if (icdRefs.length === 0) {
        resetSelect(ldSelect, '⚠️ Aucun ICD associé');
        return;
    }

    // Charger les LDs depuis le(s) ICD associé(s)
    const allLds = new Map(); // nom -> { ldName, icdId, lns }

    for (const icdId of icdRefs) {
        const icdDetails = await loadEditorIcdDetails(icdId);
        if (!icdDetails || !icdDetails.ieds) continue;

        for (const ied of icdDetails.ieds) {
            for (const ld of ied.lds || []) {
                if (!allLds.has(ld.name)) {
                    allLds.set(ld.name, {
                        ldName: ld.name,
                        icdId: icdId,
                        lns: ld.lns || []
                    });
                }
            }
        }
    }

    // Remplir le sélecteur LD
    resetSelect(ldSelect, 'Sélectionner un LD');

    if (allLds.size === 0) {
        resetSelect(ldSelect, 'Aucun LD dans l\'ICD');
        return;
    }

    // Trier et ajouter les options
    const sortedLds = [...allLds.keys()].sort();
    for (const ldName of sortedLds) {
        const option = document.createElement('option');
        option.value = ldName;
        option.textContent = ldName;
        option.dataset.icdId = allLds.get(ldName).icdId;
        ldSelect.appendChild(option);
    }

    // Stocker les LDs en mémoire pour l'événement suivant
    ldSelect.dataset.ldsData = JSON.stringify(Object.fromEntries(allLds));
}

/**
 * Événement: changement de LD sélectionné
 */
function onLdChange() {
    const ldSelect = document.getElementById('test-ld');
    const lnSelect = document.getElementById('test-ln');
    const lninstSelect = document.getElementById('test-lninst');

    const ldName = ldSelect.value;

    // Reset les listes dépendantes
    resetSelect(lnSelect, 'Sélectionner un LN');
    resetSelect(lninstSelect, 'Sélectionner LNinst');

    if (!ldName) return;

    // Récupérer les données des LDs
    const ldsDataStr = ldSelect.dataset.ldsData;
    if (!ldsDataStr) return;

    const ldsData = JSON.parse(ldsDataStr);
    const ldData = ldsData[ldName];
    if (!ldData || !ldData.lns) return;

    // Extraire les classes LN uniques
    const lnClasses = [...new Set(ldData.lns.map(ln => ln.ln_class))].sort();

    // Remplir le sélecteur LN
    for (const lnClass of lnClasses) {
        const option = document.createElement('option');
        option.value = lnClass;
        option.textContent = lnClass;
        lnSelect.appendChild(option);
    }

    // Stocker les LNs pour l'événement suivant
    lnSelect.dataset.lnsData = JSON.stringify(ldData.lns);
}

/**
 * Événement: changement de LN sélectionné
 */
function onLnChange() {
    const lnSelect = document.getElementById('test-ln');
    const lninstSelect = document.getElementById('test-lninst');

    const lnClass = lnSelect.value;

    // Reset la liste LNinst
    resetSelect(lninstSelect, 'Sélectionner LNinst');

    if (!lnClass) return;

    // Récupérer les données des LNs
    const lnsDataStr = lnSelect.dataset.lnsData;
    if (!lnsDataStr) return;

    const lnsData = JSON.parse(lnsDataStr);

    // Filtrer les LNinst pour cette classe
    const instances = lnsData
        .filter(ln => ln.ln_class === lnClass)
        .map(ln => ln.lninst || '0')
        .sort((a, b) => {
            const numA = parseInt(a) || 0;
            const numB = parseInt(b) || 0;
            return numA - numB;
        });

    // Dédupliquer
    const uniqueInstances = [...new Set(instances)];

    // Remplir le sélecteur LNinst
    for (const inst of uniqueInstances) {
        const option = document.createElement('option');
        option.value = inst;
        option.textContent = inst || '(vide)';
        lninstSelect.appendChild(option);
    }

    // Si un seul choix, le sélectionner automatiquement
    if (uniqueInstances.length === 1) {
        lninstSelect.value = uniqueInstances[0];
    }
}

/**
 * Restaure les valeurs des sélecteurs liés lors du chargement d'un test existant
 * @param {string} iedValue - ID du pattern IED
 * @param {string} variantValue - ID du variant (optionnel)
 * @param {string} ldValue - Nom du LD
 * @param {string} lnValue - Classe du LN
 * @param {string} lninstValue - Instance du LN
 */
async function restoreLinkedSelectors(iedValue, variantValue, ldValue, lnValue, lninstValue) {
    const iedSelect = document.getElementById('test-ied');
    const variantSelect = document.getElementById('test-variant');
    const ldSelect = document.getElementById('test-ld');
    const lnSelect = document.getElementById('test-ln');
    const lninstSelect = document.getElementById('test-lninst');

    // Si pas d'IED, rien à restaurer
    if (!iedValue) return;

    // 1. Sélectionner l'IED et charger les variants + LDs
    iedSelect.value = iedValue;
    await onIedChange();

    // 2. Si un variant était sélectionné, le restaurer et recharger les LDs
    if (variantValue) {
        variantSelect.value = variantValue;
        await onVariantChange();
    }

    // 3. Sélectionner le LD et charger les LNs
    if (ldValue) {
        ldSelect.value = ldValue;
        onLdChange();
    }

    // 4. Sélectionner le LN et charger les LNinst
    if (lnValue) {
        lnSelect.value = lnValue;
        onLnChange();
    }

    // 5. Sélectionner le LNinst
    // Tolérance : "" et "0" sont équivalents (LLN0 a souvent lnInst vide)
    if (lninstValue !== undefined && lninstValue !== null) {
        lninstSelect.value = lninstValue;
        // Si la valeur n'a pas matché, essayer le fallback "" ↔ "0"
        if (lninstSelect.value !== lninstValue) {
            const fallback = lninstValue === "" ? "0" : (lninstValue === "0" ? "" : null);
            if (fallback !== null) {
                lninstSelect.value = fallback;
            }
        }
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

async function migrateLinkedReferencesAcrossStorage(oldId, newId, sourceSnapshot) {
    const oldNorm = normalizeValueForMatch(oldId);
    const newNorm = normalizeValueForMatch(newId);
    if (!oldNorm || !newNorm || oldNorm === newNorm) {
        return;
    }

    const types = ['ru', 'mvs', 'cvs'];
    const fields = ['linked_tests_ru', 'linked_tests_mvs', 'linked_tests_cvs'];
    const changedTypes = new Set();

    for (const type of types) {
        const tests = getSavedTests(type);
        let changed = false;

        tests.forEach(test => {
            if (!test || typeof test !== 'object') {
                return;
            }

            fields.forEach(field => {
                if (!Array.isArray(test[field])) {
                    return;
                }

                let fieldChanged = false;
                const rewritten = test[field].map(item => {
                    if (!item || typeof item !== 'object') {
                        return item;
                    }

                    if (normalizeValueForMatch(item.testId) !== oldNorm) {
                        return item;
                    }

                    fieldChanged = true;
                    return {
                        ...item,
                        testId: newId,
                        name: sourceSnapshot?.name || item.name || '',
                        ied: sourceSnapshot?.ied || item.ied || '',
                        ld: sourceSnapshot?.ld || item.ld || '',
                        ln: sourceSnapshot?.ln || item.ln || '',
                        lninst: sourceSnapshot?.lninst || item.lninst || ''
                    };
                });

                if (!fieldChanged) {
                    return;
                }

                // Déduplication au cas où la référence nouvel ID existe déjà.
                const dedup = [];
                const seen = new Set();
                rewritten.forEach(item => {
                    const key = normalizeValueForMatch(item?.testId);
                    if (!key || seen.has(key)) {
                        return;
                    }
                    seen.add(key);
                    dedup.push(item);
                });

                test[field] = dedup;
                changed = true;
            });
        });

        if (changed) {
            setSavedTests(type, tests);
            changedTypes.add(type);
        }
    }

    for (const type of changedTypes) {
        if (typeof syncTypeToServer === 'function') {
            await syncTypeToServer(type);
        }
    }
}

/**
 * Charge un test existant
 */
async function loadTest(testId) {
    const tests = getSavedTests(selectedType);
    const test = tests.find(t => t.id === testId);
    if (!test) {
        alert('❌ Test introuvable');
        return;
    }

    isEditing = true;
    selectedType = (test.type || selectedType).toLowerCase();
    originalType = selectedType;
    persistedEditorType = selectedType;
    persistedEditorId = test.id || '';
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
        linked_tests_ru: normalizeLinkedTests('ru', test.linked_tests_ru),
        linked_tests_mvs: normalizeLinkedTests('mvs', test.linked_tests_mvs),
        linked_tests_cvs: normalizeLinkedTests('cvs', test.linked_tests_cvs),
        steps: test.steps || [],
        cde: test.cde || [],
        alarmes: test.alarmes || [],
        tcd: test.tcd || []
    };

    document.getElementById('test-id').value = currentTest.id || '';
    document.getElementById('test-name').value = currentTest.name || '';
    document.getElementById('test-description').value = currentTest.description || '';

    // Restaurer les sélecteurs liés (IED → Variant → LD → LN → LNinst)
    await restoreLinkedSelectors(test.ied, test.variant, test.ld, test.ln, test.lninst);

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

function normalizeLinkedTests(type, tests) {
    if (!Array.isArray(tests)) {
        return [];
    }

    return tests
        .map((item, index) => {
            if (typeof item === 'string') {
                const normalized = normalizeValueForMatch(item).replace(/[^A-Z0-9]/g, '_').slice(0, 40);
                return {
                    id: `linked_${type}_${normalized || index}`,
                    testId: item
                };
            }

            if (!item || typeof item !== 'object') {
                return null;
            }

            const normalized = normalizeValueForMatch(item.testId || item.id || '').replace(/[^A-Z0-9]/g, '_').slice(0, 40);
            const fallbackId = `linked_${type}_${normalized || index}`;
            return {
                ...item,
                id: item.id || fallbackId,
                testId: item.testId || item.id || ''
            };
        })
        .filter(item => item && item.testId);
}

async function repairBidirectionalLinksInStorage() {
    const types = ['ru', 'mvs', 'cvs'];
    const store = {
        ru: getSavedTests('ru'),
        mvs: getSavedTests('mvs'),
        cvs: getSavedTests('cvs')
    };

    const changedTypes = new Set();

    for (const sourceType of types) {
        const sourceTests = store[sourceType];
        const sourceField = getLinkedFieldName(sourceType);

        for (const sourceTest of sourceTests) {
            if (!sourceTest || !sourceTest.id) {
                continue;
            }

            const sourceRef = {
                testId: sourceTest.id,
                name: sourceTest.name || '',
                ied: sourceTest.ied || '',
                ld: sourceTest.ld || '',
                ln: sourceTest.ln || '',
                lninst: sourceTest.lninst || ''
            };
            const sourceIdNorm = normalizeValueForMatch(sourceRef.testId);

            for (const targetType of types) {
                const targetFieldOnSource = getLinkedFieldName(targetType);
                const linkedOnSource = normalizeLinkedTests(targetType, sourceTest[targetFieldOnSource]);

                if ((sourceTest[targetFieldOnSource] || []).length !== linkedOnSource.length) {
                    sourceTest[targetFieldOnSource] = linkedOnSource;
                    changedTypes.add(sourceType);
                } else {
                    sourceTest[targetFieldOnSource] = linkedOnSource;
                }

                for (const linkedEntry of linkedOnSource) {
                    const linkedTargetId = normalizeValueForMatch(linkedEntry.testId);
                    if (!linkedTargetId) {
                        continue;
                    }

                    const targetTest = (store[targetType] || []).find(
                        candidate => normalizeValueForMatch(candidate?.id) === linkedTargetId
                    );
                    if (!targetTest) {
                        continue;
                    }

                    if (targetType === sourceType && normalizeValueForMatch(targetTest.id) === sourceIdNorm) {
                        continue;
                    }

                    targetTest[sourceField] = normalizeLinkedTests(sourceType, targetTest[sourceField]);
                    const already = targetTest[sourceField].some(
                        item => normalizeValueForMatch(item.testId) === sourceIdNorm
                    );

                    if (!already) {
                        targetTest[sourceField].push({
                            id: `linked_${sourceType}_${sourceIdNorm || Date.now()}`,
                            testId: sourceRef.testId,
                            name: sourceRef.name,
                            ied: sourceRef.ied,
                            ld: sourceRef.ld,
                            ln: sourceRef.ln,
                            lninst: sourceRef.lninst
                        });
                        changedTypes.add(targetType);
                    }
                }
            }
        }
    }

    for (const type of changedTypes) {
        setSavedTests(type, store[type]);
        if (typeof syncTypeToServer === 'function') {
            await syncTypeToServer(type);
        }
    }
}

function getLinkedTestsByType(type) {
    if (type === 'ru') {
        return currentTest.linked_tests_ru;
    }
    if (type === 'mvs') {
        return currentTest.linked_tests_mvs;
    }
    return currentTest.linked_tests_cvs;
}

function getLinkedContainerId(type) {
    if (type === 'ru') {
        return 'tests-ru-list';
    }
    if (type === 'mvs') {
        return 'tests-mvs-list';
    }
    return 'tests-cvs-list';
}

function getLinkedFieldName(type) {
    const normalized = String(type || '').toLowerCase();
    if (normalized === 'ru') return 'linked_tests_ru';
    if (normalized === 'mvs') return 'linked_tests_mvs';
    return 'linked_tests_cvs';
}

function buildCurrentTestLinkedReference() {
    return {
        testId: document.getElementById('test-id')?.value || currentTest.id || '',
        name: document.getElementById('test-name')?.value || currentTest.name || '',
        ied: document.getElementById('test-ied')?.value || currentTest.ied || '',
        ld: document.getElementById('test-ld')?.value || currentTest.ld || '',
        ln: document.getElementById('test-ln')?.value || currentTest.ln || '',
        lninst: document.getElementById('test-lninst')?.value || currentTest.lninst || ''
    };
}

async function syncBidirectionalLinksForCurrentTest() {
    const sourceType = String(currentTest.type || selectedType || 'ru').toLowerCase();
    const sourceField = getLinkedFieldName(sourceType);
    const sourceRef = buildCurrentTestLinkedReference();
    const sourceIdNorm = normalizeValueForMatch(sourceRef.testId);

    if (!sourceIdNorm) {
        return;
    }

    const targetTypes = ['ru', 'mvs', 'cvs'];

    for (const targetType of targetTypes) {
        const targetTests = getSavedTests(targetType);
        const linkedIds = new Set(
            getLinkedTestsByType(targetType).map(item => normalizeValueForMatch(item.testId))
        );

        let changed = false;

        for (const targetTest of targetTests) {
            if (!targetTest || !targetTest.id) {
                continue;
            }

            const targetIdNorm = normalizeValueForMatch(targetTest.id);

            // Ne pas créer de lien vers soi-même.
            if (targetType === sourceType && targetIdNorm === sourceIdNorm) {
                continue;
            }

            const shouldLink = linkedIds.has(targetIdNorm);
            const normalizedReverse = normalizeLinkedTests(sourceType, targetTest[sourceField]);
            targetTest[sourceField] = normalizedReverse;

            const existingIndex = targetTest[sourceField].findIndex(
                item => normalizeValueForMatch(item.testId) === sourceIdNorm
            );

            if (shouldLink && existingIndex === -1) {
                targetTest[sourceField].push({
                    id: `linked_${sourceType}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                    testId: sourceRef.testId,
                    name: sourceRef.name,
                    ied: sourceRef.ied,
                    ld: sourceRef.ld,
                    ln: sourceRef.ln,
                    lninst: sourceRef.lninst
                });
                changed = true;
            }

            if (shouldLink && existingIndex >= 0) {
                const existing = targetTest[sourceField][existingIndex] || {};
                const updated = {
                    ...existing,
                    testId: sourceRef.testId,
                    name: sourceRef.name,
                    ied: sourceRef.ied,
                    ld: sourceRef.ld,
                    ln: sourceRef.ln,
                    lninst: sourceRef.lninst
                };

                const changedSnapshot = (
                    existing.testId !== updated.testId ||
                    existing.name !== updated.name ||
                    existing.ied !== updated.ied ||
                    existing.ld !== updated.ld ||
                    existing.ln !== updated.ln ||
                    existing.lninst !== updated.lninst
                );

                if (changedSnapshot) {
                    targetTest[sourceField][existingIndex] = updated;
                    changed = true;
                }
            }

            if (!shouldLink && existingIndex >= 0) {
                targetTest[sourceField].splice(existingIndex, 1);
                changed = true;
            }
        }

        if (changed) {
            setSavedTests(targetType, targetTests);
            if (typeof syncTypeToServer === 'function') {
                await syncTypeToServer(targetType);
            }
        }
    }
}

function getCurrentSelectionForLinkedScore() {
    return {
        id: document.getElementById('test-id')?.value || currentTest.id || '',
        name: document.getElementById('test-name')?.value || currentTest.name || '',
        ied: document.getElementById('test-ied')?.value || currentTest.ied || '',
        ld: document.getElementById('test-ld')?.value || currentTest.ld || '',
        ln: document.getElementById('test-ln')?.value || currentTest.ln || '',
        lninst: document.getElementById('test-lninst')?.value || currentTest.lninst || ''
    };
}

function normalizeValueForMatch(value) {
    return String(value || '').trim().toUpperCase();
}

function computeLinkedTestScore(candidate, selection) {
    const fields = [
        { key: 'ied', weight: 30, partial: false },
        { key: 'ld', weight: 30, partial: false },
        { key: 'ln', weight: 20, partial: false },
        { key: 'lninst', weight: 20, partial: false }
    ];

    let score = 0;

    fields.forEach(field => {
        const source = normalizeValueForMatch(selection[field.key]);
        const target = normalizeValueForMatch(candidate[field.key]);

        if (!source || !target) {
            return;
        }

        if (source === target) {
            score += field.weight;
            return;
        }

        if (field.partial && (target.includes(source) || source.includes(target))) {
            score += Math.round(field.weight * 0.5);
        }
    });

    const matchKeys = ['ied', 'ld', 'ln', 'lninst'];
    const hasReference = matchKeys.some(key => normalizeValueForMatch(selection[key]));
    const exactAll = matchKeys.every(
        key => normalizeValueForMatch(candidate[key]) === normalizeValueForMatch(selection[key])
    );

    return {
        score,
        recommended: hasReference && exactAll
    };
}

function buildLinkedCandidates(type) {
    const selection = getCurrentSelectionForLinkedScore();
    const linkedIds = new Set(getLinkedTestsByType(type).map(item => normalizeValueForMatch(item.testId)));

    const candidates = getSavedTests(type)
        .filter(test => test && test.id)
        .filter(test => normalizeValueForMatch(test.id) !== normalizeValueForMatch(selection.id))
        .map(test => {
            const rank = computeLinkedTestScore(test, selection);
            const alreadyLinked = linkedIds.has(normalizeValueForMatch(test.id));

            return {
                id: test.id,
                name: test.name || '',
                ied: test.ied || '',
                ld: test.ld || '',
                ln: test.ln || '',
                lninst: test.lninst || '',
                score: rank.score,
                recommended: rank.recommended,
                alreadyLinked,
                searchText: normalizeValueForMatch([
                    test.id,
                    test.name,
                    test.ied,
                    test.ld,
                    test.ln,
                    test.lninst
                ].join(' '))
            };
        });

    candidates.sort((a, b) => {
        if (a.recommended !== b.recommended) {
            return a.recommended ? -1 : 1;
        }
        if (a.score !== b.score) {
            return b.score - a.score;
        }
        return String(a.id).localeCompare(String(b.id), 'fr', { sensitivity: 'base' });
    });

    return candidates;
}

function createLinkedTestPickerPopup() {
    if (document.getElementById('linked-test-picker-overlay')) {
        return;
    }

    const html = `
        <div id="linked-test-picker-overlay" class="isa-popup-overlay">
            <div class="isa-popup linked-test-picker-popup">
                <div class="isa-popup-header">
                    <h3 id="linked-test-picker-title">🔗 Sélectionner un test lié</h3>
                    <button class="isa-popup-close" onclick="closeLinkedTestPicker()">&times;</button>
                </div>

                <div class="isa-popup-search">
                    <input
                        type="text"
                        id="linked-test-picker-search"
                        placeholder="Rechercher par ID, nom, IED, LD, LN, LNInst..."
                        oninput="filterLinkedTestPicker(this.value)"
                    >
                </div>

                <div class="isa-popup-content" id="linked-test-picker-content"></div>

                <div class="isa-popup-footer">
                    <span class="selection-count" id="linked-test-picker-count">0 test(s)</span>
                    <div class="isa-popup-actions">
                        <button class="btn btn-secondary" onclick="closeLinkedTestPicker()">Fermer</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
}

function openLinkedTestPicker(type) {
    createLinkedTestPickerPopup();

    linkedPickerState.type = type;
    linkedPickerState.candidates = buildLinkedCandidates(type);
    linkedPickerState.filteredCandidates = [...linkedPickerState.candidates];

    const title = document.getElementById('linked-test-picker-title');
    if (title) {
        title.textContent = `🔗 Sélectionner un test ${type.toUpperCase()} à lier`;
    }

    const searchInput = document.getElementById('linked-test-picker-search');
    if (searchInput) {
        searchInput.value = '';
    }

    renderLinkedTestPicker();
    document.getElementById('linked-test-picker-overlay')?.classList.add('active');
}

function closeLinkedTestPicker() {
    document.getElementById('linked-test-picker-overlay')?.classList.remove('active');
}

function filterLinkedTestPicker(query) {
    const normalized = normalizeValueForMatch(query);
    if (!normalized) {
        linkedPickerState.filteredCandidates = [...linkedPickerState.candidates];
    } else {
        linkedPickerState.filteredCandidates = linkedPickerState.candidates.filter(candidate =>
            candidate.searchText.includes(normalized)
        );
    }

    renderLinkedTestPicker();
}

function escapeJsArg(value) {
    return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function renderLinkedTestPicker() {
    const content = document.getElementById('linked-test-picker-content');
    if (!content) {
        return;
    }

    const rows = linkedPickerState.filteredCandidates;
    const count = document.getElementById('linked-test-picker-count');
    if (count) {
        count.textContent = `${rows.length} test(s)`;
    }

    if (!rows.length) {
        content.innerHTML = `
            <div class="isa-popup-empty">
                <div class="empty-icon">📭</div>
                <p>Aucun test correspondant.</p>
            </div>
        `;
        return;
    }

    const rowsHtml = rows.map(row => {
        const badge = row.recommended
            ? '<span class="linked-picker-badge">Conseillé</span>'
            : '';
        const rowClass = row.recommended ? 'linked-picker-row linked-picker-row-recommended' : 'linked-picker-row';
        const actionLabel = row.alreadyLinked ? 'Déjà lié' : 'Lier';
        const actionDisabled = row.alreadyLinked ? 'disabled' : '';

        return `
            <div class="${rowClass}">
                <div class="linked-picker-col linked-picker-id">
                    <div class="linked-picker-id-main">${escapeHtml(row.id)}</div>
                    ${badge}
                </div>
                <div class="linked-picker-col">${escapeHtml(row.ied || '—')}</div>
                <div class="linked-picker-col">${escapeHtml(row.name || '—')}</div>
                <div class="linked-picker-col">${escapeHtml(row.ld || '—')}</div>
                <div class="linked-picker-col">${escapeHtml(row.ln || '—')}</div>
                <div class="linked-picker-col">${escapeHtml(row.lninst || '—')}</div>
                <div class="linked-picker-col linked-picker-col-score">${row.score}</div>
                <div class="linked-picker-col linked-picker-col-action">
                    <button
                        class="btn btn-secondary linked-picker-add-btn"
                        ${actionDisabled}
                        onclick="selectLinkedTestFromPicker('${linkedPickerState.type}', '${escapeJsArg(row.id)}')"
                    >${actionLabel}</button>
                </div>
            </div>
        `;
    }).join('');

    content.innerHTML = `
        <div class="linked-picker-table">
            <div class="linked-picker-head">
                <div class="linked-picker-col linked-picker-id">ID</div>
                <div class="linked-picker-col">IED</div>
                <div class="linked-picker-col">Nom</div>
                <div class="linked-picker-col">LD</div>
                <div class="linked-picker-col">LN</div>
                <div class="linked-picker-col">LNInst</div>
                <div class="linked-picker-col linked-picker-col-score">Score</div>
                <div class="linked-picker-col linked-picker-col-action">Action</div>
            </div>
            <div class="linked-picker-body">${rowsHtml}</div>
        </div>
    `;
}

function selectLinkedTestFromPicker(type, testId) {
    const test = getSavedTests(type).find(item => String(item.id) === String(testId));
    if (!test) {
        alert('❌ Test introuvable dans cette catégorie.');
        return;
    }

    const added = addLinkedTest(type, test);
    if (added) {
        closeLinkedTestPicker();
    }
}

function createLinkedReadonlyModal() {
    if (document.getElementById('linked-test-readonly-overlay')) {
        return;
    }

    const html = `
        <div id="linked-test-readonly-overlay" class="isa-popup-overlay">
            <div class="isa-popup linked-readonly-popup">
                <div class="isa-popup-header">
                    <h3 id="linked-test-readonly-title">👁️ Détail test lié</h3>
                    <button class="isa-popup-close" onclick="closeLinkedTestReadonly()">&times;</button>
                </div>
                <div class="isa-popup-content" id="linked-test-readonly-content"></div>
                <div class="isa-popup-footer">
                    <span class="selection-count">Mode visuel (lecture seule)</span>
                    <div class="isa-popup-actions">
                        <button class="btn btn-secondary" onclick="closeLinkedTestReadonly()">Fermer</button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
}

function closeLinkedTestReadonly() {
    document.getElementById('linked-test-readonly-overlay')?.classList.remove('active');
}

function renderReadonlyItems(title, items, formatter) {
    const values = Array.isArray(items) ? items : [];
    if (!values.length) {
        return `
            <section class="linked-readonly-section">
                <h4>${title}</h4>
                <p class="linked-readonly-empty">Aucune donnée.</p>
            </section>
        `;
    }

    const rows = values.map((item, index) => formatter(item, index)).join('');
    return `
        <section class="linked-readonly-section">
            <h4>${title}</h4>
            <div class="linked-readonly-list">${rows}</div>
        </section>
    `;
}

function openLinkedTestReadonly(type, testId) {
    const linkedType = String(type || '').toLowerCase();
    const normalizedId = String(testId || '').trim();
    if (!normalizedId) {
        alert('❌ Test lié introuvable (ID vide).');
        return;
    }

    const test = getSavedTests(linkedType).find(item => String(item.id) === normalizedId);
    if (!test) {
        alert(`❌ Test ${normalizedId} introuvable dans la catégorie ${linkedType.toUpperCase()}.`);
        return;
    }

    createLinkedReadonlyModal();

    const title = document.getElementById('linked-test-readonly-title');
    if (title) {
        title.textContent = `👁️ ${test.id || 'Test lié'} — ${test.name || 'Sans nom'} (${linkedType.toUpperCase()})`;
    }

    const content = document.getElementById('linked-test-readonly-content');
    if (!content) {
        return;
    }

    const preconditionsSection = renderReadonlyItems(
        'Préconditions',
        test.preconditions,
        (item) => {
            const name = escapeHtml(item?.name || 'Précondition');
            const state = escapeHtml(item?.state || '—');
            return `<div class="linked-readonly-item"><strong>${name}</strong><span>État: ${state}</span></div>`;
        }
    );

    const stepsSection = renderReadonlyItems(
        'Étapes',
        test.steps,
        (item, index) => {
            const number = item?.number || (index + 1);
            const name = escapeHtml(item?.name || `Étape ${number}`);
            const state = escapeHtml(item?.state || '—');
            const injection = escapeHtml(item?.injection || 'Sans');
            const duration = escapeHtml(
                item?.temporisation === 'Manuel'
                    ? `${item?.duration || 0} ${item?.unit || 'ms'}`
                    : 'Auto'
            );
            return `
                <div class="linked-readonly-item">
                    <strong>${number}. ${name}</strong>
                    <span>État: ${state} | Injection: ${injection} | Temporisation: ${duration}</span>
                </div>
            `;
        }
    );

    const cdeSection = renderReadonlyItems(
        'Informations CDE',
        test.cde,
        (item) => {
            const name = escapeHtml(item?.name || item?.id || String(item || ''));
            const state = escapeHtml(item?.state || '—');
            return `<div class="linked-readonly-item"><strong>${name}</strong><span>État: ${state}</span></div>`;
        }
    );

    const alarmesSection = renderReadonlyItems(
        'Alarmes',
        test.alarmes,
        (item) => {
            const name = escapeHtml(item?.name || item?.id || String(item || ''));
            const state = escapeHtml(item?.state || '—');
            return `<div class="linked-readonly-item"><strong>${name}</strong><span>État: ${state}</span></div>`;
        }
    );

    const tcdSection = renderReadonlyItems(
        'Informations TCD',
        test.tcd,
        (item) => {
            const name = escapeHtml(item?.name || item?.id || String(item || ''));
            const state = escapeHtml(item?.state || '—');
            return `<div class="linked-readonly-item"><strong>${name}</strong><span>État: ${state}</span></div>`;
        }
    );

    content.innerHTML = `
        <section class="linked-readonly-summary">
            <div><span class="label">ID</span><strong>${escapeHtml(test.id || '—')}</strong></div>
            <div><span class="label">Type</span><strong>${escapeHtml(String(test.type || linkedType).toUpperCase())}</strong></div>
            <div><span class="label">IED</span><strong>${escapeHtml(test.ied || '—')}</strong></div>
            <div><span class="label">LD</span><strong>${escapeHtml(test.ld || '—')}</strong></div>
            <div><span class="label">LN</span><strong>${escapeHtml(test.ln || '—')}</strong></div>
            <div><span class="label">LNInst</span><strong>${escapeHtml(test.lninst || '—')}</strong></div>
        </section>

        <section class="linked-readonly-section">
            <h4>Description</h4>
            <div class="linked-readonly-description">${escapeHtml(test.description || 'Aucune description.')}</div>
        </section>

        ${preconditionsSection}
        ${stepsSection}
        ${cdeSection}
        ${alarmesSection}
        ${tcdSection}
    `;

    document.getElementById('linked-test-readonly-overlay')?.classList.add('active');
}

function renderLinkedTests(type, tests) {
    const container = document.getElementById(getLinkedContainerId(type));
    if (!container) {
        return;
    }

    container.innerHTML = '';

    tests.forEach(item => {
        const linkedTest = getSavedTests(type).find(t => t.id === item.testId);
        const display = {
            testId: item.testId || '',
            name: item.name || linkedTest?.name || '',
            ied: item.ied || linkedTest?.ied || '',
            ld: item.ld || linkedTest?.ld || '',
            ln: item.ln || linkedTest?.ln || '',
            lninst: item.lninst || linkedTest?.lninst || ''
        };

        const linkedHtml = `
            <div class="linked-test-item" id="${item.id}">
                <div class="linked-test-item-content">
                    <div class="linked-test-main">🔗 ${escapeHtml(display.testId)} — ${escapeHtml(display.name || 'Sans nom')}</div>
                    <div class="linked-test-meta">IED: ${escapeHtml(display.ied || '—')} | LD: ${escapeHtml(display.ld || '—')} | LN: ${escapeHtml(display.ln || '—')} | LNInst: ${escapeHtml(display.lninst || '—')}</div>
                </div>
                <div style="display: flex; gap: 6px;">
                    <button class="btn-icon-small" style="width: 24px; height: 24px; background: var(--accent);"
                        title="Voir le test lié"
                        onclick="openLinkedTestReadonly('${type}', '${escapeJsArg(display.testId)}')">👁</button>
                    <button class="btn-icon-small" style="width: 24px; height: 24px; background: var(--danger);"
                        title="Supprimer le lien"
                        onclick="removeLinkedTest('${item.id}', '${type}')">✕</button>
                </div>
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
    openLinkedTestPicker('ru');
}

/**
 * Lie un test MVS
 */
function linkTestMVS() {
    openLinkedTestPicker('mvs');
}

/**
 * Lie un test CVS
 */
function linkTestCVS() {
    openLinkedTestPicker('cvs');
}

/**
 * Ajoute un test lié
 */
function addLinkedTest(type, testOrId) {
    const linkedArray = getLinkedTestsByType(type);
    const testId = typeof testOrId === 'string'
        ? testOrId
        : (testOrId?.id || testOrId?.testId || '');

    const normalizedId = normalizeValueForMatch(testId);
    if (!normalizedId) {
        return false;
    }

    const exists = linkedArray.some(item => normalizeValueForMatch(item.testId) === normalizedId);
    if (exists) {
        alert('⚠️ Ce test est déjà lié.');
        return false;
    }

    const linkedId = `linked_${type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    linkedArray.push({
        id: linkedId,
        testId: testId,
        name: typeof testOrId === 'string' ? '' : (testOrId?.name || ''),
        ied: typeof testOrId === 'string' ? '' : (testOrId?.ied || ''),
        ld: typeof testOrId === 'string' ? '' : (testOrId?.ld || ''),
        ln: typeof testOrId === 'string' ? '' : (testOrId?.ln || ''),
        lninst: typeof testOrId === 'string' ? '' : (testOrId?.lninst || '')
    });

    renderLinkedTests(type, linkedArray);
    return true;
}

/**
 * Supprime un test lié
 */
function removeLinkedTest(linkedId, type) {
    if (type === 'ru') {
        currentTest.linked_tests_ru = currentTest.linked_tests_ru.filter(t => t.id !== linkedId);
        renderLinkedTests('ru', currentTest.linked_tests_ru);
    } else if (type === 'mvs') {
        currentTest.linked_tests_mvs = currentTest.linked_tests_mvs.filter(t => t.id !== linkedId);
        renderLinkedTests('mvs', currentTest.linked_tests_mvs);
    } else {
        currentTest.linked_tests_cvs = currentTest.linked_tests_cvs.filter(t => t.id !== linkedId);
        renderLinkedTests('cvs', currentTest.linked_tests_cvs);
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
    currentTest.variant = document.getElementById('test-variant').value;
    currentTest.ld = document.getElementById('test-ld').value;
    currentTest.ln = document.getElementById('test-ln').value;
    currentTest.lninst = document.getElementById('test-lninst').value;
    currentTest.description = document.getElementById('test-description').value;
}

/**
 * Sauvegarde l'essai côté serveur (auto-sync)
 */
async function saveEssaiToServer(essaiData) {
    try {
        const response = await fetch('/api/essais', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(essaiData),
        });
        if (!response.ok) {
            console.warn('⚠️ Sauvegarde serveur échouée:', response.status);
            return false;
        }
        const result = await response.json();
        console.log(`✅ Essai ${result.action} côté serveur: ${result.id}`);
        return true;
    } catch (error) {
        console.warn('⚠️ Sauvegarde serveur indisponible:', error.message);
        return false;
    }
}

/**
 * Sauvegarde le test
 */
async function saveTest() {
    const selectedValue = (document.getElementById('test-type')?.value || selectedType).toLowerCase();
    selectedType = selectedValue;
    const previousPersistedType = persistedEditorType;
    const previousPersistedId = persistedEditorId;

    if (!currentTest.id) {
        setEditorIdValue(generateTypeCoherentId(selectedType));
    } else if (!idHasExpectedPrefix(currentTest.id, selectedType)) {
        // En édition, si la catégorie change, l'ID doit suivre la catégorie.
        setEditorIdValue(generateTypeCoherentId(selectedType));
    }

    collectFormData();
    currentTest.type = selectedType;
    currentTest.linked_tests_ru = normalizeLinkedTests('ru', currentTest.linked_tests_ru);
    currentTest.linked_tests_mvs = normalizeLinkedTests('mvs', currentTest.linked_tests_mvs);
    currentTest.linked_tests_cvs = normalizeLinkedTests('cvs', currentTest.linked_tests_cvs);

    // Validation
    if (!currentTest.id || !currentTest.name) {
        alert('❌ Veuillez remplir au minimum l\'ID et le nom du test');
        return;
    }

    // Sauvegarder dans localStorage
    const previousNormId = normalizeValueForMatch(previousPersistedId);
    const tests = getSavedTests(selectedType).filter(test =>
        normalizeValueForMatch(test?.id) !== previousNormId
    );
    const existingIndex = tests.findIndex(t => t.id === currentTest.id);

    if (existingIndex >= 0) {
        tests[existingIndex] = currentTest;
    } else {
        tests.push(currentTest);
    }

    setSavedTests(selectedType, tests);

    const idChanged = (
        previousNormId &&
        previousNormId !== normalizeValueForMatch(currentTest.id)
    );

    if (idChanged) {
        await migrateLinkedReferencesAcrossStorage(
            previousPersistedId,
            currentTest.id,
            buildCurrentTestLinkedReference()
        );
    }

    // Synchroniser automatiquement les liens bidirectionnels.
    // Exemple: si RU est lié à CVS, on injecte aussi RU dans linked_tests_ru du CVS.
    await syncBidirectionalLinksForCurrentTest();

    if (previousPersistedType && previousPersistedType !== selectedType) {
        const previousTests = getSavedTests(previousPersistedType);
        const updatedPrevious = previousTests.filter(test =>
            normalizeValueForMatch(test?.id) !== previousNormId
        );
        setSavedTests(previousPersistedType, updatedPrevious);
        if (typeof syncTypeToServer === 'function') {
            await syncTypeToServer(previousPersistedType);
        }
        originalType = selectedType;
    }

    // Mémoriser l'identité désormais persistée.
    persistedEditorType = selectedType;
    persistedEditorId = currentTest.id;

    // Sauvegarder côté serveur AVANT la redirection
    const serverOk = await saveEssaiToServer({ ...currentTest });
    if (!serverOk) {
        console.warn('⚠️ Essai sauvegardé en local uniquement');
    }

    alert('✅ Test sauvegardé avec succès !');
    // SPA : fermer l'éditeur et revenir à la liste des essais
    closeEditor();
}


// ============================================================================
// FONCTIONS SPA — Ouverture / fermeture de l'éditeur intégré
// ============================================================================

/**
 * Variable globale pour passer l'ID du test à éditer.
 * Définie par openEditor(), lue par initEditor().
 */
let _editorTestId = null;

/**
 * Ouvrir l'éditeur de test dans la vue essais (SPA).
 *
 * Bascule de la sous-vue "liste" vers la sous-vue "éditeur"
 * sans recharger la page.
 *
 * @param {string|null} testId - ID du test à éditer (null = nouveau test)
 * @param {string} [type="ru"] - Type d'essai (ru, cvs, mvs)
 */
async function openEditor(testId = null, type = "ru") {
    console.info(`[EDITOR] Ouverture éditeur — testId=${testId}, type=${type}`);

    // Passer les paramètres via des variables globales
    _editorTestId = testId;
    selectedType = (type || "ru").toLowerCase();
    originalType = selectedType;
    isEditing = !!testId;
    persistedEditorType = selectedType;
    persistedEditorId = testId || '';

    // Basculer les sous-vues
    const listView = document.getElementById("essais-list-view");
    const editorView = document.getElementById("essais-editor-view");
    if (listView) listView.style.display = "none";
    if (editorView) editorView.style.display = "block";

    // Réinitialiser le test courant
    currentTest = {
        id: '', name: '', ied: '', ld: '', ln: '', lninst: '',
        description: '', preconditions: [], files: [],
        linked_tests_ru: [], linked_tests_mvs: [], linked_tests_cvs: [],
        steps: [], cde: [], alarmes: [], tcd: []
    };
    stepCounter = 1;

    // Initialiser l'éditeur
    await initEditor();
}

/**
 * Fermer l'éditeur et revenir à la liste des essais.
 *
 * Recharge la liste des templates pour refléter les modifications.
 */
function closeEditor() {
    console.info("[EDITOR] Fermeture éditeur, retour à la liste");

    // Réinitialiser l'état de l'éditeur
    _editorTestId = null;

    // Basculer les sous-vues
    const listView = document.getElementById("essais-list-view");
    const editorView = document.getElementById("essais-editor-view");
    if (editorView) editorView.style.display = "none";
    if (listView) listView.style.display = "block";

    // Recharger la liste des essais
    if (typeof loadTemplatesList === "function") {
        loadTemplatesList();
    }
}
