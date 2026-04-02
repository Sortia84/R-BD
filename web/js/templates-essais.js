// templates-essais.js - Vue unifiée des essais RU / CVS / MVS

const TYPE_LABELS = {
    ru: 'Recette Usine',
    mvs: 'MVS',
    cvs: 'CVS'
};

function getTestsByType(type) {
    return JSON.parse(localStorage.getItem(`tests_${type}`) || '[]');
}

function setTestsByType(type, tests) {
    localStorage.setItem(`tests_${type}`, JSON.stringify(tests));
}

function normalizeTests() {
    return ['ru', 'cvs', 'mvs'].flatMap(type => {
        const tests = getTestsByType(type);
        return tests.map(test => ({
            ...test,
            type: (test.type || type).toLowerCase()
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
                <div class="card-header">
                    <h3 style="margin: 0 0 8px 0;">📋 Liste des essais</h3>
                    <p class="muted" style="margin: 0;">Cliquez sur un essai pour l'éditer</p>
                </div>
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

function initTemplatesPage() {
    // Générer le layout HTML complet (liste + éditeur)
    renderEssaisLayout();
    loadEssaisReferenceLists();
    bindFilters();
    loadTemplatesList();
    // Synchroniser automatiquement le localStorage vers le serveur
    syncAllToServer();
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
    await Promise.all([
        loadList('/data/ied/liste_ied.json', document.getElementById('filter-ied')),
        loadList('/data/ld/liste_ld.json', document.getElementById('filter-ld')),
        loadList('/data/ln/liste_ln.json', document.getElementById('filter-ln'))
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
    return tests.filter(test => (
        matchesType(test, filters.type)
        && matchesValue(test.ied, filters.ied)
        && matchesValue(test.ld, filters.ld)
        && matchesValue(test.ln, filters.ln)
    ));
}

function loadTemplatesList() {
    const container = document.getElementById('templates-list');
    const tests = normalizeTests();
    const filters = getFilters();
    const filtered = applyFilters(tests, filters);

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
    const linkedCount = (test.linked_tests_ru || []).length
        + (test.linked_tests_mvs || []).length
        + (test.linked_tests_cvs || []).length;
    const identifier = [test.ied, test.ld, test.ln, test.lninst].filter(Boolean).join(' / ');
    const typeLabel = TYPE_LABELS[(test.type || 'ru').toLowerCase()] || 'Essai';

    return `
        <div class="template-card" onclick="editTest('${test.id}', '${test.type || 'ru'}')">
            <div class="template-card-header">
                <div style="display: flex; align-items: center; flex: 1;">
                    <div class="template-icon">🧪</div>
                    <div class="template-info">
                        <h3>${escapeHtml(test.name || 'Test sans nom')}</h3>
                        <p>${escapeHtml(identifier || typeLabel)}</p>
                    </div>
                </div>
                <span class="template-badge">${escapeHtml(test.id || '')}</span>
            </div>

            <div class="template-tags">
                <span class="template-tag">${escapeHtml(typeLabel)}</span>
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
                    <span class="template-stat-label">Liens</span>
                    <span class="template-stat-value">${linkedCount}</span>
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

function createNewTest() {
    const type = document.getElementById('create-type')?.value || 'ru';
    // SPA : ouvrir l'éditeur intégré au lieu de naviguer vers une autre page
    openEditor(null, type);
}

function editTest(testId, type) {
    // SPA : ouvrir l'éditeur intégré au lieu de naviguer vers une autre page
    openEditor(testId, type);
}

function duplicateTest(testId, type) {
    if (!confirm('Voulez-vous vraiment dupliquer ce test ?')) {
        return;
    }

    const tests = getTestsByType(type);
    const original = tests.find(t => t.id === testId);
    if (!original) {
        alert('❌ Test introuvable');
        return;
    }

    const copy = JSON.parse(JSON.stringify(original));
    copy.id = `${testId}_copy_${Date.now()}`;
    copy.name = `${original.name || 'Test'} (copie)`;
    copy.type = type;
    tests.push(copy);
    setTestsByType(type, tests);
    syncTypeToServer(type);
    loadTemplatesList();
}

function deleteTest(testId, type) {
    const tests = getTestsByType(type);
    const test = tests.find(t => t.id === testId);
    if (!test) {
        alert('❌ Test introuvable');
        return;
    }

    if (!confirm(`Voulez-vous vraiment supprimer le test "${test.name || testId}" ?\n\nCette action est irréversible.`)) {
        return;
    }

    const updated = tests.filter(t => t.id !== testId);
    setTestsByType(type, updated);
    syncTypeToServer(type);
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
    const types = ['ru', 'cvs', 'mvs'];
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
