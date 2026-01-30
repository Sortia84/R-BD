// templates-ru.js - Interface de gestion des tests RU

const TESTS_KEY = 'tests_ru';

function getSavedTests() {
    return JSON.parse(localStorage.getItem(TESTS_KEY) || '[]');
}

function setSavedTests(tests) {
    localStorage.setItem(TESTS_KEY, JSON.stringify(tests));
}

/**
 * Charge et affiche la liste des templates
 */
function loadTemplatesList() {
    const container = document.getElementById('templates-list');
    const tests = getSavedTests();

    if (tests.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: var(--muted);">
                <p style="font-size: 48px; margin: 0;">📦</p>
                <p style="margin: 16px 0 0 0;">Aucun test disponible</p>
                <p style="margin: 8px 0 0 0; font-size: 14px;">Cliquez sur "Nouveau test" pour commencer</p>
            </div>
        `;
        return;
    }

    container.innerHTML = tests.map(test => {
        const stepCount = (test.steps || []).length;
        const preconCount = (test.preconditions || []).length;
        const linkedCount = (test.linked_tests_ru || []).length
            + (test.linked_tests_mvs || []).length
            + (test.linked_tests_cvs || []).length;
        const identifier = [test.ied, test.ld, test.ln, test.lninst].filter(Boolean).join(' / ');

        return `
            <div class="template-card" onclick="editTest('${test.id}')">
                <div class="template-card-header">
                    <div style="display: flex; align-items: center; flex: 1;">
                        <div class="template-icon">🧪</div>
                        <div class="template-info">
                            <h3>${escapeHtml(test.name || 'Test sans nom')}</h3>
                            <p>${escapeHtml(identifier || 'Sans localisation')}</p>
                        </div>
                    </div>
                    <span class="template-badge">${escapeHtml(test.id || '')}</span>
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
                    <button class="template-action-btn edit" onclick="editTest('${test.id}')">
                        ✏️ Éditer
                    </button>
                    <button class="template-action-btn duplicate" onclick="duplicateTest('${test.id}')">
                        📋 Dupliquer
                    </button>
                    <button class="template-action-btn delete" onclick="deleteTest('${test.id}')">
                        🗑️ Supprimer
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

/**
 * Crée un nouveau template
 */
function createNewTest() {
    window.location.href = './test-editor.html';
}

/**
 * Édite un template existant
 */
function editTest(testId) {
    window.location.href = `./test-editor.html?id=${encodeURIComponent(testId)}`;
}

/**
 * Duplique un template
 */
function duplicateTest(testId) {
    if (!confirm('Voulez-vous vraiment dupliquer ce test ?')) {
        return;
    }

    const tests = getSavedTests();
    const original = tests.find(t => t.id === testId);
    if (!original) {
        alert('❌ Test introuvable');
        return;
    }

    const copy = JSON.parse(JSON.stringify(original));
    copy.id = `${testId}_copy_${Date.now()}`;
    copy.name = `${original.name || 'Test'} (copie)`;
    tests.push(copy);
    setSavedTests(tests);
    loadTemplatesList();
}

/**
 * Supprime un template
 */
function deleteTest(testId) {
    const tests = getSavedTests();
    const test = tests.find(t => t.id === testId);
    if (!test) {
        alert('❌ Test introuvable');
        return;
    }

    if (!confirm(`Voulez-vous vraiment supprimer le test "${test.name || testId}" ?\n\nCette action est irréversible.`)) {
        return;
    }

    const updated = tests.filter(t => t.id !== testId);
    setSavedTests(updated);
    loadTemplatesList();
}

/**
 * Échappe le HTML pour éviter les injections XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}
