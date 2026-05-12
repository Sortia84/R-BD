// templates-essais.js - Vue unifiée des essais RU / CVS / MVS

const TYPE_LABELS = {
    ru: 'Recette Usine',
    mvs: 'MVS',
    cvs: 'CVS',
    mvc: '◇'
};

const TYPE_ICONS = {
    ru: '🏭',
    cvs: '✓',
    mvs: '⚡',
    mvc: 'MVC'
};

function getTestsByType(type) {
    return JSON.parse(localStorage.getItem(`tests_${type}`) || '[]');
}

function setTestsByType(type, tests) {
    localStorage.setItem(`tests_${type}`, JSON.stringify(tests));
}

function normaliseTestScope(value) {
    const text = String(value || 'function').trim().toLowerCase();
    return ['generic', 'generique', 'global', 'general'].includes(text) ? 'generic' : 'function';
}

function normaliseTestAttachments(test) {
    const attachments = Array.isArray(test?.attachments)
        ? test.attachments
        : (Array.isArray(test?.files) ? test.files : []);
    return attachments.filter(item => item && typeof item === 'object');
}

let draggedTestId = '';
let draggedTestType = '';

function getOrderIndex(test) {
    const numeric = Number(test?.order_index);
    return Number.isFinite(numeric) ? numeric : Number.MAX_SAFE_INTEGER;
}

function sortTestsByManualOrder(tests) {
    return [...tests].sort((a, b) => (
        getOrderIndex(a) - getOrderIndex(b)
        || String(a.name || '').localeCompare(String(b.name || ''), 'fr', { sensitivity: 'base' })
        || String(a.id || '').localeCompare(String(b.id || ''), 'fr', { sensitivity: 'base' })
    ));
}

function recalculateOrderLinks(tests) {
    // previous_test_id represente le lien visible entre deux cards successives.
    // order_index reste un rang technique espace pour faciliter les insertions.
    return tests.map((test, index) => ({
        ...test,
        previous_test_id: index === 0 ? '' : String(tests[index - 1]?.id || ''),
        order_index: (index + 1) * 10
    }));
}

function normalizeTests() {
    return ['ru', 'cvs', 'mvs', 'mvc'].flatMap(type => {
        const tests = getTestsByType(type);
        return tests.map(test => ({
            ...test,
            type: (test.type || type).toLowerCase(),
            scope: normaliseTestScope(test.scope),
            attachments: normaliseTestAttachments(test),
            files: normaliseTestAttachments(test),
            previous_test_id: test.previous_test_id || '',
            order_index: test.order_index ?? null
        }));
    });
}


// ============================================================
// RENDU DU LAYOUT — Génération HTML de la vue Essais
// ============================================================

/**
 * Générer et injecter le layout HTML complet de la vue Essais.
 *
 * Crée les deux sous-vues dans le conteneur #view-essais :
 *   1. essais-list-view  → bandeau, filtres, grille des essais
 *   2. essais-editor-view → éditeur complet de test (masqué par défaut)
 *
 * L'éditeur est généré par renderEditorLayout() (dans test-editor.js).
 */
function renderEssaisLayout() {
    const container = document.getElementById("view-essais");
    if (!container) return;

    container.innerHTML = `
        <!-- Sous-vue : Liste des essais -->
        <div id="essais-list-view">
            <!-- Bandeau d'action -->
            <section class="card">
                <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h2 id="tests-title">Template Essais</h2>
                        <p class="muted" id="tests-subtitle">Centralisez vos essais RU / CVS / MVS dans une seule vue</p>
                    </div>
                    <div style="display: flex; gap: 12px; align-items: center;">
                        <button class="btn btn-secondary" onclick="openTestParameters()">Parametre Test</button>
                        <button class="btn btn-primary" onclick="createNewTest()">➕ Nouveau test</button>
                    </div>
                </div>
            </section>

            <!-- Filtres essais -->
            <section class="card">
                <div class="card-header">
                    <h3 style="margin: 0 0 8px 0;">🔎 Filtres</h3>
                    <p class="muted" style="margin: 0;">Affinez la liste par type, IED, LD ou LN</p>
                </div>
                <div class="divider"></div>
                <div class="filters-bar">
                    <div class="filter-group">
                        <label for="filter-type">Type d'essai</label>
                        <select id="filter-type" class="filter-select">
                            <option value="all">Tous</option>
                            <option value="ru">RU</option>
                            <option value="cvs">CVS</option>
                            <option value="mvs">MVS</option>
                            <option value="mvc">MVC</option>
                        </select>
                    </div>
                    <div class="filter-group">
                        <label for="filter-ied">IED</label>
                        <select id="filter-ied" class="filter-select"><option value="">Tous</option></select>
                    </div>
                    <div class="filter-group">
                        <label for="filter-ld">LD</label>
                        <select id="filter-ld" class="filter-select"><option value="">Tous</option></select>
                    </div>
                    <div class="filter-group">
                        <label for="filter-ln">LN</label>
                        <select id="filter-ln" class="filter-select"><option value="">Tous</option></select>
                    </div>
                    <div class="filter-group">
                        <label>&nbsp;</label>
                        <button class="btn btn-secondary" onclick="resetEssaisFilters()">Réinitialiser</button>
                    </div>
                </div>
            </section>

            <!-- Liste des essais -->
            <section class="card rbd-section-shell">
                <div id="templates-list" class="templates-grid">
                    <div class="rbd-empty-state">
                        <div class="rbd-empty-state-icon">📦</div>
                        <p>Aucun essai disponible</p>
                        <p style="font-size: 14px;">Cliquez sur "Nouveau test" pour commencer</p>
                    </div>
                </div>
            </section>
        </div>

        <!-- Sous-vue : Éditeur de test (masqué par défaut, rendu par test-editor.js) -->
        <div id="essais-editor-view" style="display: none;"></div>

        <!-- Sous-vue : Parametrage des essais (rendu par test-parameters.js) -->
        <div id="essais-parameters-view" style="display: none;"></div>
    `;

    // Demander à test-editor.js de rendre son layout dans le conteneur éditeur
    if (typeof renderEditorLayout === "function") {
        renderEditorLayout();
    }

    console.info("[ESSAIS][Init] Layout essais généré");
}


// ============================================================
// Initialisation
// ============================================================

async function initTemplatesPage() {
    // Générer le layout HTML complet (liste + éditeur)
    renderEssaisLayout();
    await hydrateTestsFromServer();
    loadEssaisReferenceLists();
    bindFilters();
    loadTemplatesList();
    if (window.RbdTestParameters) {
        RbdTestParameters.load();
    }
    // Synchroniser automatiquement le localStorage vers le serveur
    syncAllToServer();
}

async function hydrateTestsFromServer() {
    const types = ['ru', 'cvs', 'mvs', 'mvc'];
    await Promise.all(types.map(async (type) => {
        try {
            const response = await fetch(`/api/essais?type=${encodeURIComponent(type)}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            const payload = await response.json();
            if (!Array.isArray(payload?.essais)) {
                return;
            }
            const tests = payload.essais.map(test => ({
                ...test,
                type,
                scope: normaliseTestScope(test.scope),
                attachments: normaliseTestAttachments(test),
                files: normaliseTestAttachments(test)
            }));
            setTestsByType(type, tests);
        } catch (error) {
            console.warn(`[UI][ESSAIS] Chargement serveur ${type} indisponible`, error);
        }
    }));
}

function bindFilters() {
    ['filter-type', 'filter-ied', 'filter-ld', 'filter-ln'].forEach(id => {
        const element = document.getElementById(id);
        if (element) {
            element.addEventListener('change', loadTemplatesList);
        }
    });
}

async function loadEssaisReferenceLists() {
    const iedSelect = document.getElementById('filter-ied');
    const ldSelect = document.getElementById('filter-ld');
    const lnSelect = document.getElementById('filter-ln');

    if (!iedSelect || !ldSelect || !lnSelect) {
        return;
    }

    const iedTypes = await loadArray('/api/icd/types');
    fillSelect(iedSelect, iedTypes);

    // Construire les listes LD/LN à partir des ICD analysés.
    const catalog = await loadJson('/api/icd/', {});
    const icdList = Array.isArray(catalog?.icds) ? catalog.icds : [];

    const ldValues = new Set();
    const lnValues = new Set();

    const detailsList = await Promise.all(icdList.map(async (entry) => {
        if (!entry?.icd_id) {
            return null;
        }
        return loadJson(`/api/icd/details/${encodeURIComponent(entry.icd_id)}`, null);
    }));

    detailsList.forEach(details => collectLdLnValues(details, ldValues, lnValues));

    // Fallback: conserver les valeurs déjà utilisées dans les essais historiques.
    normalizeTests().forEach(test => {
        if (test.ld) ldValues.add(test.ld);
        if (test.ln) lnValues.add(test.ln);
    });

    fillSelect(ldSelect, [...ldValues]);
    fillSelect(lnSelect, [...lnValues]);
}

async function loadJson(url, fallbackValue) {
    try {
        const response = await fetch(url);
        if (!response.ok) {
            return fallbackValue;
        }
        return await response.json();
    } catch (error) {
        console.warn(`Impossible de charger ${url}`, error);
        return fallbackValue;
    }
}

async function loadArray(url) {
    const data = await loadJson(url, []);
    return Array.isArray(data) ? data : [];
}

function fillSelect(selectElement, values) {
    if (!selectElement) {
        return;
    }

    const uniqueSorted = [...new Set(values.filter(Boolean))].sort((a, b) =>
        String(a).localeCompare(String(b), 'fr', { sensitivity: 'base' })
    );

    uniqueSorted.forEach(item => {
        const option = document.createElement('option');
        option.value = item;
        option.textContent = item;
        selectElement.appendChild(option);
    });
}

function collectLdLnValues(icdDetails, ldValues, lnValues) {
    if (!icdDetails || !Array.isArray(icdDetails.ieds)) {
        return;
    }

    icdDetails.ieds.forEach(ied => {
        (ied.lds || []).forEach(ld => {
            if (ld?.name) {
                ldValues.add(ld.name);
            }

            (ld.lns || []).forEach(ln => {
                if (ln?.ln_class) {
                    lnValues.add(ln.ln_class);
                }
            });
        });
    });
}

function loadList(url, selectElement) {
    // Fonction conservée pour compatibilité ascendante.
    if (!selectElement) {
        return;
    }
}

function getFilters() {
    return {
        type: (document.getElementById('filter-type')?.value || 'all').toLowerCase(),
        ied: document.getElementById('filter-ied')?.value || '',
        ld: document.getElementById('filter-ld')?.value || '',
        ln: document.getElementById('filter-ln')?.value || ''
    };
}

function resetEssaisFilters() {
    const defaults = {
        'filter-type': 'all',
        'filter-ied': '',
        'filter-ld': '',
        'filter-ln': ''
    };

    Object.entries(defaults).forEach(([id, value]) => {
        const element = document.getElementById(id);
        if (element) {
            element.value = value;
        }
    });

    loadTemplatesList();
}

function matchesValue(value, filterValue) {
    if (!filterValue) {
        return true;
    }
    return (value || '') === filterValue;
}

function matchesType(test, typeFilter) {
    if (typeFilter === 'all') {
        return true;
    }
    return (test.type || '').toLowerCase() === typeFilter;
}

function applyFilters(tests, filters) {
    return tests.filter(test => {
        if (!matchesType(test, filters.type)) {
            return false;
        }
        if (normaliseTestScope(test.scope) === 'generic') {
            return true;
        }
        return matchesValue(test.ied, filters.ied)
            && matchesValue(test.ld, filters.ld)
            && matchesValue(test.ln, filters.ln);
    });
}

function loadTemplatesList() {
    const container = document.getElementById('templates-list');
    const tests = normalizeTests();
    const filters = getFilters();
    const filtered = sortTestsByManualOrder(applyFilters(tests, filters));

    if (filtered.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--muted);">
                <p style="font-size: 48px; margin: 0;">📦</p>
                <p style="margin: 16px 0 0 0;">Aucun essai disponible</p>
                <p style="margin: 8px 0 0 0; font-size: 14px;">Cliquez sur "Nouveau test" pour commencer</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(test => renderTestCard(test)).join('');
}

function renderTestCard(test) {
    const stepCount = (test.steps || []).length;
    const preconCount = (test.preconditions || []).length;
    const isGeneric = normaliseTestScope(test.scope) === 'generic';
    const attachmentsCount = normaliseTestAttachments(test).length;
    const identifier = isGeneric ? 'Essai generique' : [test.ied, test.ld, test.ln, test.lninst].filter(Boolean).join(' / ');
    const normalizedType = (test.type || 'ru').toLowerCase();
    const typeLabel = TYPE_LABELS[normalizedType] || 'Essai';
    const typeIcon = TYPE_ICONS[normalizedType] || '•';

    return `
        <div class="template-card"
            draggable="true"
            data-test-id="${escapeHtml(test.id || '')}"
            data-test-type="${escapeHtml(test.type || 'ru')}"
            ondragstart="handleTestCardDragStart(event, '${test.id}', '${test.type || 'ru'}')"
            ondragover="handleTestCardDragOver(event)"
            ondrop="handleTestCardDrop(event, '${test.id}', '${test.type || 'ru'}')"
            ondragend="handleTestCardDragEnd(event)"
            onclick="editTest('${test.id}', '${test.type || 'ru'}')">
            <div class="template-card-header">
                <div style="display: flex; align-items: center; flex: 1;">
                    <div class="template-icon template-icon-${escapeHtml(normalizedType)}">${escapeHtml(typeIcon)}</div>
                    <div class="template-info">
                        <h3>${escapeHtml(test.name || 'Test sans nom')}</h3>
                        <p>${escapeHtml(identifier || typeLabel)}</p>
                    </div>
                </div>
                <span class="template-badge">${escapeHtml(test.id || '')}</span>
            </div>

            <p class="template-order-info">
                Ordre ${escapeHtml(test.order_index ?? '-')}
                ${test.previous_test_id ? ` apres ${escapeHtml(test.previous_test_id)}` : ' premier test'}
            </p>

            <div class="template-tags">
                <span class="template-tag">${escapeHtml(typeLabel)}</span>
                ${isGeneric ? '<span class="template-tag template-tag-generic">Generique</span>' : ''}
                ${test.ied ? `<span class="template-tag">${escapeHtml(test.ied)}</span>` : ''}
                ${test.ld ? `<span class="template-tag">${escapeHtml(test.ld)}</span>` : ''}
                ${test.ln ? `<span class="template-tag">${escapeHtml(test.ln)}</span>` : ''}
            </div>

            <div class="template-stats">
                <div class="template-stat">
                    <span class="template-stat-label">Étapes</span>
                    <span class="template-stat-value">${stepCount}</span>
                </div>
                <div class="template-stat">
                    <span class="template-stat-label">Préconditions</span>
                    <span class="template-stat-value">${preconCount}</span>
                </div>
                <div class="template-stat">
                    <span class="template-stat-label">Pieces jointes</span>
                    <span class="template-stat-value">${attachmentsCount}</span>
                </div>
            </div>

            <div class="template-actions" onclick="event.stopPropagation()">
                <button class="template-action-btn edit" onclick="editTest('${test.id}', '${test.type || 'ru'}')">
                    ✏️ Éditer
                </button>
                <button class="template-action-btn duplicate" onclick="duplicateTest('${test.id}', '${test.type || 'ru'}')">
                    📋 Dupliquer
                </button>
                <button class="template-action-btn delete" onclick="deleteTest('${test.id}', '${test.type || 'ru'}')">
                    🗑️ Supprimer
                </button>
            </div>
        </div>
    `;
}

function handleTestCardDragStart(event, testId, type) {
    draggedTestId = String(testId || '');
    draggedTestType = String(type || 'ru').toLowerCase();
    event.currentTarget.classList.add('is-dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedTestId);
}

function handleTestCardDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('is-drag-over');
}

function handleTestCardDragEnd(event) {
    event.currentTarget.classList.remove('is-dragging');
    document.querySelectorAll('.template-card.is-drag-over').forEach(card => {
        card.classList.remove('is-drag-over');
    });
    draggedTestId = '';
    draggedTestType = '';
}

async function handleTestCardDrop(event, targetId, targetType) {
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.classList.remove('is-drag-over');

    const normalizedTargetType = String(targetType || 'ru').toLowerCase();
    if (!draggedTestId || !targetId || draggedTestId === targetId || draggedTestType !== normalizedTargetType) {
        return;
    }

    const filters = getFilters();
    const tests = getTestsByType(normalizedTargetType);
    const visibleTests = sortTestsByManualOrder(applyFilters(tests, { ...filters, type: normalizedTargetType }));
    const dragged = visibleTests.find(test => String(test.id) === draggedTestId);
    const target = visibleTests.find(test => String(test.id) === String(targetId));
    if (!dragged || !target) {
        console.warn("[UI][ESSAIS] Reordonnancement ignore: card source ou cible introuvable");
        return;
    }

    const reorderedVisible = visibleTests.filter(test => String(test.id) !== draggedTestId);
    const targetIndex = reorderedVisible.findIndex(test => String(test.id) === String(targetId));
    reorderedVisible.splice(targetIndex, 0, dragged);
    const reorderedWithLinks = recalculateOrderLinks(reorderedVisible);
    const byId = new Map(reorderedWithLinks.map(test => [String(test.id), test]));
    const merged = tests.map(test => byId.get(String(test.id)) || test);

    setTestsByType(normalizedTargetType, merged);
    await syncTypeToServer(normalizedTargetType);
    loadTemplatesList();
    console.info("[UI][ESSAIS] Ordre manuel mis a jour par glisser-deposer");
}

function createNewTest() {
    const type = document.getElementById('create-type')?.value || 'ru';
    // SPA : ouvrir l'éditeur intégré au lieu de naviguer vers une autre page
    openEditor(null, type);
}

function editTest(testId, type) {
    // SPA : ouvrir l'éditeur intégré au lieu de naviguer vers une autre page
    openEditor(testId, type);
}

function generateDuplicateId(type, tests) {
    const prefix = String(type || 'ru').toUpperCase();

    // Même logique fonctionnelle que la création d'un nouveau test :
    // ID court, aléatoire, et unique dans la catégorie.
    let candidate = `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    while (tests.some(test => String(test.id || '').toUpperCase() === candidate)) {
        candidate = `${prefix}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    }
    return candidate;
}

function duplicateTest(testId, type) {
    if (!confirm('Voulez-vous vraiment dupliquer ce test ?')) {
        return;
    }

    const normalizedType = String(type || 'ru').toLowerCase();
    const tests = getTestsByType(normalizedType);
    const original = tests.find(t => t.id === testId);
    if (!original) {
        alert('❌ Test introuvable');
        return;
    }

    const copy = JSON.parse(JSON.stringify(original));
    copy.id = generateDuplicateId(normalizedType, tests);
    copy.name = `${original.name || 'Test'} (copie)`;
    copy.type = normalizedType;
    copy.attachments = [];
    copy.files = [];
    copy.linked_tests_ru = [];
    copy.linked_tests_mvs = [];
    copy.linked_tests_cvs = [];
    copy.created_at = new Date().toISOString();
    copy.updated_at = copy.created_at;

    const ordered = sortTestsByManualOrder(tests);
    const originalIndex = ordered.findIndex(test => String(test.id) === String(original.id));
    if (originalIndex < 0) {
        ordered.push(copy);
    } else {
        // La copie est insérée immédiatement après l'essai source. Le recalcul
        // ci-dessous mettra aussi à jour le test suivant pour pointer vers la
        // copie, ce qui conserve une chaîne d'ordre continue.
        ordered.splice(originalIndex + 1, 0, copy);
    }

    const reordered = recalculateOrderLinks(ordered);
    setTestsByType(normalizedType, reordered);
    syncTypeToServer(normalizedType);
    loadTemplatesList();
}

async function deleteTest(testId, type) {
    const tests = getTestsByType(type);
    const test = tests.find(t => t.id === testId);
    if (!test) {
        alert('❌ Test introuvable');
        return;
    }

    if (!confirm(`Voulez-vous vraiment supprimer le test "${test.name || testId}" ?\n\nCette action est irréversible.`)) {
        return;
    }

    try {
        const response = await fetch(`/api/essais/${encodeURIComponent(testId)}?type=${encodeURIComponent(type)}`, {
            method: 'DELETE'
        });
        if (!response.ok && response.status !== 404) {
            console.warn(`[UI][ESSAIS] Suppression serveur ${testId} echouee: ${response.status}`);
        }
    } catch (error) {
        console.warn(`[UI][ESSAIS] Suppression serveur ${testId} indisponible`, error);
    }

    const updated = recalculateOrderLinks(
        sortTestsByManualOrder(tests.filter(t => t.id !== testId)).map(test => (
            test.previous_test_id === testId ? { ...test, previous_test_id: '' } : test
        ))
    );
    setTestsByType(type, updated);
    await syncTypeToServer(type);
    loadTemplatesList();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Synchronise automatiquement les essais du localStorage vers le serveur.
 * Appelé au chargement de la page pour garantir la cohérence.
 */
async function syncAllToServer() {
    const types = ['ru', 'cvs', 'mvs', 'mvc'];
    for (const type of types) {
        await syncTypeToServer(type);
    }
}

/**
 * Synchronise un type d'essais vers le serveur.
 */
async function syncTypeToServer(type) {
    const tests = getTestsByType(type);
    try {
        const response = await fetch('/api/essais/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ type, essais: tests }),
        });
        if (response.ok) {
            const result = await response.json();
            console.log(`🔄 Sync ${type}: ${result.synced} essai(s) synchronisé(s)`);
        } else {
            console.warn(`⚠️ Sync ${type} échouée:`, response.status);
        }
    } catch (error) {
        console.warn(`⚠️ Sync ${type} indisponible:`, error.message);
    }
}
