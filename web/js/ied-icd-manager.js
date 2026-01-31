// ied-icd-manager.js - Vue centrée sur les IED avec leurs ICD associés

const API_BASE = '/api/icd';

let iedPatterns = [];   // Patterns IED depuis liste_ied.json
let icdCatalog = [];    // ICD importés

// ============================================================
// Initialisation
// ============================================================

async function initIedIcdPage() {
    await Promise.all([
        loadIedPatterns(),
        loadIcdCatalog()
    ]);
    setupIcdUpload();
    renderIedCards();
    renderOrphanIcds();
    updateStats();
}

async function loadIedPatterns() {
    try {
        const response = await fetch(`${API_BASE}/patterns`);
        if (!response.ok) throw new Error('Erreur chargement patterns');
        const data = await response.json();
        iedPatterns = data.patterns || [];
        console.log(`📋 ${iedPatterns.length} patterns IED chargés`);
    } catch (error) {
        console.warn('Erreur chargement patterns:', error);
        iedPatterns = [];
    }
}

async function loadIcdCatalog() {
    try {
        const response = await fetch(`${API_BASE}/`);
        if (!response.ok) throw new Error('Erreur chargement ICD');
        const data = await response.json();
        icdCatalog = data.icds || [];
        console.log(`📚 ${icdCatalog.length} ICD chargés`);
    } catch (error) {
        console.warn('Erreur chargement ICD:', error);
        icdCatalog = [];
    }
}

// ============================================================
// Upload ICD
// ============================================================

function setupIcdUpload() {
    const input = document.getElementById('icd-upload');
    if (!input) return;

    input.addEventListener('change', async (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;

        let successCount = 0;
        const errors = [];

        for (const file of files) {
            try {
                const formData = new FormData();
                formData.append('file', file);
                const response = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
                if (!response.ok) throw new Error((await response.json()).detail || 'Erreur');
                const result = await response.json();
                successCount += result.entries.length;
            } catch (error) {
                errors.push(`${file.name}: ${error.message}`);
            }
        }

        await loadIcdCatalog();
        renderIedCards();
        renderOrphanIcds();
        updateStats();
        input.value = '';

        let msg = `✅ ${successCount} ICD importé(s)`;
        if (errors.length) msg += `\n❌ Erreurs:\n${errors.join('\n')}`;
        alert(msg);
    });
}

function triggerIcdUpload() {
    document.getElementById('icd-upload')?.click();
}

// ============================================================
// Rendu des cartes IED
// ============================================================

function renderIedCards() {
    const container = document.getElementById('ied-cards');
    if (!container) return;

    const filtered = getFilteredPatterns();

    if (!filtered.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <p>Aucun équipement ne correspond aux filtres</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filtered.map(pattern => buildIedCard(pattern)).join('');
}

function getFilteredPatterns() {
    const searchInput = document.getElementById('filter-search');
    const linkedFilter = document.getElementById('filter-linked');

    const search = (searchInput?.value || '').toLowerCase();
    const linkedValue = linkedFilter?.value || '';

    // Ne garder que les patterns SANS parent (les parents ou patterns autonomes)
    return iedPatterns.filter(p => {
        // Exclure les enfants (ils seront affichés dans la carte du parent)
        if (p.parent) return false;

        // Filtre recherche
        const matchSearch = !search ||
            p.display_name.toLowerCase().includes(search) ||
            p.pattern.toLowerCase().includes(search) ||
            p.id.toLowerCase().includes(search);

        // Filtre statut liaison (inclure les ICD des variants aussi)
        const linkedIcds = getIcdsForPatternWithVariants(p);
        const hasIcd = linkedIcds.length > 0;
        const matchLinked = !linkedValue ||
            (linkedValue === 'linked' && hasIcd) ||
            (linkedValue === 'unlinked' && !hasIcd);

        return matchSearch && matchLinked;
    });
}

function buildIedCard(pattern) {
    const linkedIcds = getIcdsForPattern(pattern);
    const childPatterns = getChildPatterns(pattern.id);
    const hasChildren = childPatterns.length > 0;

    // Construire la liste des variants avec leur pattern
    const variantsHtml = hasChildren ? `
        <div class="ied-variants-section">
            ${childPatterns.map(child => `
                <div class="variant-row">
                    <span class="variant-name">${escapeHtml(child.display_name)}</span>
                    <code class="variant-pattern">${escapeHtml(child.pattern)}</code>
                </div>
            `).join('')}
        </div>
    ` : '';

    const icdsHtml = linkedIcds.length > 0 ? linkedIcds.map(icd => buildIcdItem(icd, pattern)).join('') : `
        <div class="no-icd">
            <span class="muted">Aucun ICD associé</span>
        </div>
    `;

    const totalIcds = getIcdsForPatternWithVariants(pattern).length;
    const statusClass = totalIcds > 0 ? 'has-icd' : 'no-icd-status';

    return `
        <div class="ied-card ${statusClass}" data-pattern-id="${pattern.id}">
            <div class="ied-card-header">
                <div class="ied-icon">📦</div>
                <div class="ied-info">
                    <h3>${escapeHtml(pattern.display_name)}</h3>
                    <code class="pattern-code">${escapeHtml(pattern.pattern)}</code>
                </div>
                <div class="ied-badge">
                    ${totalIcds > 0 ? `<span class="badge-count">${totalIcds}</span>` : '<span class="badge-empty">—</span>'}
                </div>
            </div>

            ${pattern.description ? `<p class="ied-description">${escapeHtml(pattern.description)}</p>` : ''}
            ${variantsHtml}

            <div class="divider"></div>

            <div class="ied-icds-list">
                <div class="icds-header">
                    <span class="label">ICD associés</span>
                    <button class="btn btn-small btn-add" onclick="showAssignIcdModal('${pattern.id}')">
                        + Associer
                    </button>
                </div>
                ${icdsHtml}
            </div>
        </div>
    `;
}

function buildIcdItem(icd, currentPattern) {
    const icdPath = icd.path || `${icd.ied_type}/${icd.manufacturer}`;

    return `
        <div class="icd-item" data-icd-path="${escapeHtml(icdPath)}">
            <div class="icd-item-info">
                <strong>${escapeHtml(icd.ied_type)} / ${escapeHtml(icd.manufacturer)}</strong>
                <div class="icd-item-meta">
                    ${escapeHtml(icd.version)} • ${icd.ld_count || 0} LD • ${icd.ln_count || 0} LN
                </div>
            </div>
            <div class="icd-item-actions">
                <button class="btn-icon" onclick="showMoveIcdModal('${escapeHtml(icdPath)}', '${currentPattern.id}')" title="Changer d'équipement">
                    ↔️
                </button>
                <button class="btn-icon btn-danger" onclick="unlinkIcd('${currentPattern.id}', '${escapeHtml(icdPath)}')" title="Dissocier">
                    ✕
                </button>
            </div>
        </div>
    `;
}

// ============================================================
// Helpers pour trouver les ICD liés à un pattern
// ============================================================

function getIcdsForPattern(pattern) {
    const refs = pattern.icd_refs || [];
    if (!refs.length) return [];

    return icdCatalog.filter(icd => {
        const icdPath = `${icd.ied_type}/${icd.manufacturer}`;
        return refs.some(ref => icdPath.includes(ref) || ref.includes(icdPath));
    });
}

/**
 * Récupère tous les patterns enfants (variants) d'un pattern parent
 */
function getChildPatterns(parentId) {
    return iedPatterns.filter(p => p.parent === parentId);
}

/**
 * Récupère tous les ICD liés à un pattern ET ses variants
 */
function getIcdsForPatternWithVariants(pattern) {
    // ICD du pattern lui-même
    const ownIcds = getIcdsForPattern(pattern);

    // ICD des enfants/variants
    const children = getChildPatterns(pattern.id);
    const childrenIcds = children.flatMap(child => getIcdsForPattern(child));

    // Fusionner sans doublons (par icd_id)
    const allIcds = [...ownIcds];
    childrenIcds.forEach(icd => {
        if (!allIcds.some(existing => existing.icd_id === icd.icd_id)) {
            allIcds.push(icd);
        }
    });

    return allIcds;
}

function getOrphanIcds() {
    // ICD qui ne sont liés à aucun pattern
    const allLinkedPaths = new Set();
    iedPatterns.forEach(p => {
        (p.icd_refs || []).forEach(ref => allLinkedPaths.add(ref));
    });

    return icdCatalog.filter(icd => {
        const icdPath = `${icd.ied_type}/${icd.manufacturer}`;
        return ![...allLinkedPaths].some(ref => icdPath.includes(ref) || ref.includes(icdPath));
    });
}

// ============================================================
// Rendu des ICD orphelins
// ============================================================

function renderOrphanIcds() {
    const section = document.getElementById('orphan-section');
    const container = document.getElementById('orphan-icds');
    if (!section || !container) return;

    const orphans = getOrphanIcds();

    if (!orphans.length) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    container.innerHTML = orphans.map(icd => {
        const icdPath = `${icd.ied_type}/${icd.manufacturer}`;
        return `
            <div class="orphan-icd-item">
                <div class="orphan-info">
                    <strong>📄 ${escapeHtml(icd.ied_type)} / ${escapeHtml(icd.manufacturer)}</strong>
                    <span class="muted">${escapeHtml(icd.version)}</span>
                </div>
                <button class="btn btn-small btn-primary" onclick="showAssignOrphanModal('${escapeHtml(icdPath)}')">
                    Assigner à un IED
                </button>
            </div>
        `;
    }).join('');
}

// ============================================================
// Statistiques
// ============================================================

function updateStats() {
    const container = document.getElementById('stats-summary');
    if (!container) return;

    const totalPatterns = iedPatterns.length;
    const patternsWithIcd = iedPatterns.filter(p => (p.icd_refs || []).length > 0).length;
    const orphanCount = getOrphanIcds().length;

    container.innerHTML = `
        <span class="stat-item">${patternsWithIcd}/${totalPatterns} équipés</span>
        ${orphanCount > 0 ? `<span class="stat-item warning">${orphanCount} ICD orphelin(s)</span>` : ''}
    `;
}

// ============================================================
// Modales
// ============================================================

async function showAssignIcdModal(patternId) {
    const orphans = getOrphanIcds();
    const allIcds = icdCatalog;

    // Grouper les ICD par statut
    const pattern = iedPatterns.find(p => p.id === patternId);
    const currentRefs = pattern?.icd_refs || [];

    const icdOptions = allIcds.map(icd => {
        const icdPath = `${icd.ied_type}/${icd.manufacturer}`;
        const isLinked = currentRefs.some(ref => icdPath.includes(ref) || ref.includes(icdPath));
        const isOrphan = orphans.some(o => `${o.ied_type}/${o.manufacturer}` === icdPath);

        return `
            <label class="icd-option ${isLinked ? 'already-linked' : ''} ${isOrphan ? 'orphan' : ''}">
                <input type="checkbox" value="${escapeHtml(icdPath)}" ${isLinked ? 'checked' : ''}>
                <span class="icd-option-name">${escapeHtml(icd.ied_type)} / ${escapeHtml(icd.manufacturer)}</span>
                <span class="icd-option-version">${escapeHtml(icd.version)}</span>
                ${isOrphan ? '<span class="badge-orphan">Non assigné</span>' : ''}
            </label>
        `;
    }).join('');

    const modalHtml = `
        <div class="modal-overlay" id="assign-modal" onclick="closeModal(event)">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3>📎 Associer des ICD à "${pattern?.display_name || patternId}"</h3>
                    <button class="btn-close" onclick="closeModal()">✕</button>
                </div>
                <div class="modal-body">
                    <p class="muted">Cochez les ICD à associer à cet équipement :</p>
                    <div class="icd-options-list">
                        ${icdOptions || '<p class="muted">Aucun ICD disponible. Importez des fichiers ICD.</p>'}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
                    <button class="btn btn-primary" onclick="saveAssignments('${patternId}')">Enregistrer</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function showMoveIcdModal(icdPath, currentPatternId) {
    const currentPattern = iedPatterns.find(p => p.id === currentPatternId);

    // Exclure les variants (patterns avec parent) - ils partagent le même ICD que leur parent
    const patternOptions = iedPatterns
        .filter(p => p.id !== currentPatternId && !p.parent)
        .map(p => `<option value="${p.id}">${escapeHtml(p.display_name)} (${escapeHtml(p.pattern)})</option>`)
        .join('');

    const modalHtml = `
        <div class="modal-overlay" id="move-modal" onclick="closeModal(event)">
            <div class="modal-content modal-small" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3>↔️ Déplacer l'ICD</h3>
                    <button class="btn-close" onclick="closeModal()">✕</button>
                </div>
                <div class="modal-body">
                    <p><strong>ICD:</strong> ${escapeHtml(icdPath)}</p>
                    <p><strong>Actuellement:</strong> ${escapeHtml(currentPattern?.display_name || currentPatternId)}</p>
                    <div class="form-group">
                        <label>Nouvel équipement :</label>
                        <select id="new-pattern-select" class="filter-select">
                            <option value="">-- Sélectionner --</option>
                            ${patternOptions}
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
                    <button class="btn btn-primary" onclick="moveIcd('${escapeHtml(icdPath)}', '${currentPatternId}')">Déplacer</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function showAssignOrphanModal(icdPath) {
    // Exclure les variants (patterns avec parent) - ils partagent le même ICD que leur parent
    const patternOptions = iedPatterns
        .filter(p => !p.parent)
        .map(p => `<option value="${p.id}">${escapeHtml(p.display_name)} (${escapeHtml(p.pattern)})</option>`)
        .join('');

    const modalHtml = `
        <div class="modal-overlay" id="assign-orphan-modal" onclick="closeModal(event)">
            <div class="modal-content modal-small" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3>📎 Assigner l'ICD orphelin</h3>
                    <button class="btn-close" onclick="closeModal()">✕</button>
                </div>
                <div class="modal-body">
                    <p><strong>ICD:</strong> ${escapeHtml(icdPath)}</p>
                    <div class="form-group">
                        <label>Équipement cible :</label>
                        <select id="target-pattern-select" class="filter-select">
                            <option value="">-- Sélectionner --</option>
                            ${patternOptions}
                        </select>
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeModal()">Annuler</button>
                    <button class="btn btn-primary" onclick="assignOrphan('${escapeHtml(icdPath)}')">Assigner</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function closeModal(event) {
    if (event && !event.target.classList.contains('modal-overlay')) return;
    document.querySelectorAll('.modal-overlay').forEach(m => m.remove());
}

// ============================================================
// Actions API
// ============================================================

async function saveAssignments(patternId) {
    const modal = document.getElementById('assign-modal');
    if (!modal) return;

    const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
    const pattern = iedPatterns.find(p => p.id === patternId);
    const currentRefs = new Set(pattern?.icd_refs || []);

    for (const cb of checkboxes) {
        const icdPath = cb.value;
        const wasLinked = [...currentRefs].some(ref => icdPath.includes(ref) || ref.includes(icdPath));

        if (cb.checked && !wasLinked) {
            await linkIcd(patternId, icdPath);
        } else if (!cb.checked && wasLinked) {
            await unlinkIcdApi(patternId, icdPath);
        }
    }

    await loadIedPatterns();
    renderIedCards();
    renderOrphanIcds();
    updateStats();
    closeModal();
}

async function moveIcd(icdPath, currentPatternId) {
    const newPatternId = document.getElementById('new-pattern-select')?.value;
    if (!newPatternId) {
        alert('Veuillez sélectionner un équipement');
        return;
    }

    // Délier de l'ancien
    await unlinkIcdApi(currentPatternId, icdPath);
    // Lier au nouveau
    await linkIcd(newPatternId, icdPath);

    await loadIedPatterns();
    renderIedCards();
    renderOrphanIcds();
    updateStats();
    closeModal();
    console.log(`↔️ ICD déplacé: ${icdPath} → ${newPatternId}`);
}

async function assignOrphan(icdPath) {
    const patternId = document.getElementById('target-pattern-select')?.value;
    if (!patternId) {
        alert('Veuillez sélectionner un équipement');
        return;
    }

    await linkIcd(patternId, icdPath);

    await loadIedPatterns();
    renderIedCards();
    renderOrphanIcds();
    updateStats();
    closeModal();
}

async function linkIcd(patternId, icdPath) {
    try {
        await fetch(`${API_BASE}/patterns/${patternId}/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icd_path: icdPath })
        });
        console.log(`🔗 Lié: ${patternId} → ${icdPath}`);
    } catch (e) {
        console.error('Erreur liaison:', e);
    }
}

async function unlinkIcd(patternId, icdPath) {
    if (!confirm(`Dissocier cet ICD de "${patternId}" ?`)) return;
    await unlinkIcdApi(patternId, icdPath);
    await loadIedPatterns();
    renderIedCards();
    renderOrphanIcds();
    updateStats();
}

async function unlinkIcdApi(patternId, icdPath) {
    try {
        await fetch(`${API_BASE}/patterns/${patternId}/unlink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icd_path: icdPath })
        });
        console.log(`🔓 Délié: ${patternId} ↛ ${icdPath}`);
    } catch (e) {
        console.error('Erreur déliaison:', e);
    }
}

async function reanalyzeAll() {
    if (!confirm('Relancer l\'analyse de TOUS les fichiers ICD ?')) return;

    try {
        const response = await fetch(`${API_BASE}/reanalyze-all`, { method: 'POST' });
        const result = await response.json();
        await loadIcdCatalog();
        renderIedCards();
        renderOrphanIcds();
        updateStats();
        alert(`✅ ${result.reanalyzed} ICD ré-analysé(s)`);
    } catch (e) {
        alert('❌ Erreur: ' + e.message);
    }
}

// ============================================================
// Utilitaires
// ============================================================

function resetFilters() {
    const search = document.getElementById('filter-search');
    const linked = document.getElementById('filter-linked');
    if (search) search.value = '';
    if (linked) linked.value = '';
    renderIedCards();
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}
