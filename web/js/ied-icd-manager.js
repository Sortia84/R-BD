// ied-icd-manager.js - Vue centrée sur les IED avec leurs ICD associés

const ICD_API_BASE = '/api/icd';

let iedPatterns = [];   // Patterns IED depuis liste_ied.json
let icdCatalog = [];    // ICD importés
let icdDefaults = {};   // ICD référents: {pattern_id: {manufacturer: icd_id, ...}, ...}


// ============================================================
// RENDU DU LAYOUT — Génération HTML de la vue ICD
// ============================================================

/**
 * Générer et injecter le layout HTML de la vue ICD.
 *
 * Crée : panneau orphelins, bandeau d'action, filtres, grille IED.
 * Tous les éléments DOM référencés par les fonctions suivantes sont
 * générés ici (orphan-panel, icd-upload, filter-search, ied-cards…).
 */
function renderIcdLayout() {
    const container = document.getElementById("view-icd");
    if (!container) return;

    container.innerHTML = `
        <!-- Panneau flottant ICD orphelins -->
        <aside class="orphan-panel hidden" id="orphan-panel">
            <div class="orphan-panel-header" onclick="toggleOrphanPanel()">
                <span class="orphan-panel-title">⚠️ ICD non assignés</span>
                <span class="orphan-panel-count" id="orphan-count">0</span>
                <span class="orphan-panel-arrow" id="orphan-arrow">◀</span>
            </div>
            <div class="orphan-panel-content" id="orphan-panel-content">
                <p class="orphan-panel-hint">Glissez-déposez sur une carte IED</p>
                <div id="orphan-icds" class="orphan-list"></div>
            </div>
        </aside>

        <!-- Bandeau d'action -->
        <section class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h2>Gestion IED / ICD</h2>
                    <p class="muted">Associez les fichiers ICD analysés à vos équipements (patterns IED)</p>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <button class="btn btn-primary" onclick="triggerIcdUpload()">➕ Importer un ICD</button>
                    <button class="btn" onclick="reanalyzeAll()" title="Relancer toutes les analyses">🔄 Tout ré-analyser</button>
                </div>
            </div>
            <input id="icd-upload" type="file" accept=".icd,.xml" multiple hidden />
        </section>

        <!-- Filtres ICD -->
        <section class="card">
            <div class="card-header">
                <h3 style="margin: 0 0 8px 0;">🔎 Filtres</h3>
            </div>
            <div class="filters-bar">
                <div class="filter-group">
                    <label for="filter-search">Recherche</label>
                    <input type="text" id="filter-search" class="filter-input" placeholder="Nom, pattern..." oninput="renderIedCards()">
                </div>
                <div class="filter-group">
                    <label for="filter-linked">Statut</label>
                    <select id="filter-linked" class="filter-select" onchange="renderIedCards()">
                        <option value="">Tous</option>
                        <option value="linked">Avec ICD</option>
                        <option value="unlinked">Sans ICD</option>
                    </select>
                </div>
                <div class="filter-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-secondary" onclick="resetFilters()">Réinitialiser</button>
                </div>
            </div>
        </section>

        <!-- Grille IED -->
        <section class="card rbd-section-shell">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h3 style="margin: 0 0 8px 0;">🖲️ Équipements IED</h3>
                    <p class="muted" style="margin: 0;">Chaque carte représente un type d'équipement et ses ICD associés</p>
                </div>
                <div class="stats-summary" id="stats-summary"></div>
            </div>
            <div id="ied-cards" class="ied-grid">
                <div class="empty-state">
                    <div class="empty-state-icon">📂</div>
                    <p>Chargement...</p>
                </div>
            </div>
        </section>
    `;

    console.info("[ICD][Init] Layout ICD généré");
}


// ============================================================
// Initialisation
// ============================================================

async function initIedIcdPage() {
    // Générer le layout HTML dans le conteneur vide
    renderIcdLayout();
    await Promise.all([
        loadIedPatterns(),
        loadIcdCatalog(),
        loadIcdDefaults()
    ]);
    setupIcdUploadWithAutoLink();
    renderIedCards();
    renderOrphanIcds();
    updateStats();
    initOrphanPanel();
}

// Charger les ICD référents (par pattern ET manufacturer)
async function loadIcdDefaults() {
    try {
        const response = await fetch(`${ICD_API_BASE}/default`);
        if (!response.ok) throw new Error('Erreur chargement defaults');
        const data = await response.json();
        // Structure: {pattern_id: {manufacturer: icd_id, ...}, ...}
        icdDefaults = data.defaults || {};
        const totalCount = Object.values(icdDefaults).reduce((sum, v) => sum + Object.keys(v).length, 0);
        console.log(`⭐ ${totalCount} ICD référent(s) chargés pour ${Object.keys(icdDefaults).length} pattern(s)`);
    } catch (error) {
        console.warn('Erreur chargement defaults:', error);
        icdDefaults = {};
    }
}

// Vérifier si un ICD est le référent pour un pattern + manufacturer
function isDefaultIcd(icd, patternId) {
    const manufacturer = icd.manufacturer;
    if (!patternId || !manufacturer) return false;

    const patternDefaults = icdDefaults[patternId];
    if (!patternDefaults) return false;

    return patternDefaults[manufacturer] === icd.icd_id;
}

// Définir/supprimer un ICD comme référent pour un pattern + manufacturer
async function toggleDefaultIcd(encodedIcdId, encodedPatternId, encodedManufacturer) {
    const icdId = decodeURIComponent(encodedIcdId);
    const patternId = decodeURIComponent(encodedPatternId);
    const manufacturer = decodeURIComponent(encodedManufacturer);

    const patternDefaults = icdDefaults[patternId] || {};
    const isCurrentlyDefault = patternDefaults[manufacturer] === icdId;

    try {
        if (isCurrentlyDefault) {
            // Supprimer le référent
            const response = await fetch(`${ICD_API_BASE}/default/${encodeURIComponent(patternId)}/${encodeURIComponent(manufacturer)}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Erreur suppression référent');

            // Mise à jour locale
            if (icdDefaults[patternId]) {
                delete icdDefaults[patternId][manufacturer];
                if (Object.keys(icdDefaults[patternId]).length === 0) {
                    delete icdDefaults[patternId];
                }
            }
            console.log(`⭐ Référent supprimé pour ${patternId}/${manufacturer}`);
        } else {
            // Définir comme référent
            const response = await fetch(`${ICD_API_BASE}/default/${encodeURIComponent(patternId)}/${encodeURIComponent(manufacturer)}/${encodeURIComponent(icdId)}`, {
                method: 'POST'
            });
            if (!response.ok) throw new Error('Erreur définition référent');

            // Mise à jour locale
            if (!icdDefaults[patternId]) {
                icdDefaults[patternId] = {};
            }
            icdDefaults[patternId][manufacturer] = icdId;
            console.log(`⭐ ${icdId} défini comme référent pour ${patternId}/${manufacturer}`);
        }

        // Re-rendre l'UI
        renderIedCards();
        renderOrphanIcds();
    } catch (error) {
        console.error('Erreur toggle default:', error);
        alert('Erreur: ' + error.message);
    }
}

// Gestion du panneau flottant orphelins
function initOrphanPanel() {
    const panel = document.getElementById('orphan-panel');
    if (!panel) return;

    // Restaurer l'état depuis localStorage
    const isCollapsed = localStorage.getItem('orphanPanelCollapsed') === 'true';
    if (isCollapsed) {
        panel.classList.add('collapsed');
    }
}

function toggleOrphanPanel() {
    const panel = document.getElementById('orphan-panel');
    if (!panel) return;

    panel.classList.toggle('collapsed');

    // Sauvegarder l'état
    localStorage.setItem('orphanPanelCollapsed', panel.classList.contains('collapsed'));
}

function updateOrphanPanelVisibility() {
    const panel = document.getElementById('orphan-panel');
    const orphans = getOrphanIcds();

    if (!panel) return;

    if (orphans.length === 0) {
        // Pas d'orphelins : cacher le panneau
        panel.classList.add('hidden');
    } else {
        // Des orphelins : afficher le panneau
        panel.classList.remove('hidden');
    }

    // Mettre à jour le compteur
    const countEl = document.getElementById('orphan-count');
    if (countEl) countEl.textContent = orphans.length;
}

async function loadIedPatterns() {
    try {
        const response = await fetch(`${ICD_API_BASE}/patterns`);
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
        const response = await fetch(`${ICD_API_BASE}/`);
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
                const response = await fetch(`${ICD_API_BASE}/upload`, { method: 'POST', body: formData });
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
    pendingPatternForUpload = null;
    document.getElementById('icd-upload')?.click();
}

// Variable pour stocker le pattern cible lors d'un import direct
let pendingPatternForUpload = null;

function triggerIcdUploadForPattern(patternId) {
    pendingPatternForUpload = patternId;
    document.getElementById('icd-upload')?.click();
}

// Modifier setupIcdUpload pour gérer l'association automatique
function setupIcdUploadWithAutoLink() {
    const input = document.getElementById('icd-upload');
    if (!input) return;

    input.addEventListener('change', async (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) return;

        const targetPattern = pendingPatternForUpload;
        pendingPatternForUpload = null;

        let successCount = 0;
        const errors = [];
        const uploadedIcds = [];

        for (const file of files) {
            try {
                const formData = new FormData();
                formData.append('file', file);
                const response = await fetch(`${ICD_API_BASE}/upload`, { method: 'POST', body: formData });
                if (!response.ok) throw new Error((await response.json()).detail || 'Erreur');
                const result = await response.json();
                successCount += result.entries.length;

                // Collecter les ICD uploadés pour l'association
                if (result.entries) {
                    uploadedIcds.push(...result.entries);
                }
            } catch (error) {
                errors.push(`${file.name}: ${error.message}`);
            }
        }

        // Si un pattern cible était défini, associer automatiquement
        if (targetPattern && uploadedIcds.length > 0) {
            for (const icd of uploadedIcds) {
                // Utiliser icd_id (basé sur type IED) pour l'association
                await linkIcdToPattern(icd.icd_id, targetPattern);
            }
        }

        await loadIcdCatalog();
        await loadIedPatterns();
        renderIedCards();
        renderOrphanIcds();
        updateStats();
        input.value = '';

        let msg = `✅ ${successCount} ICD importé(s)`;
        if (targetPattern) msg += ` et associé(s) à ${targetPattern}`;
        if (errors.length) msg += `\n❌ Erreurs:\n${errors.join('\n')}`;
        showToast(msg);
    });
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
    const filtered = iedPatterns.filter(p => {
        // Exclure les enfants (ils seront affichés dans la carte du parent)
        if (p.parent) return false;

        // Filtre recherche : inclut display_name, pattern, id ET infos ICD liés
        const linkedIcds = getIcdsForPatternWithVariants(p);
        const matchSearch = !search ||
            p.display_name.toLowerCase().includes(search) ||
            p.pattern.toLowerCase().includes(search) ||
            p.id.toLowerCase().includes(search) ||
            linkedIcds.some(icd =>
                (icd.desc || '').toLowerCase().includes(search) ||
                (icd.ied_type_attr || '').toLowerCase().includes(search) ||
                (icd.ied_type || '').toLowerCase().includes(search) ||
                (icd.manufacturer || '').toLowerCase().includes(search) ||
                (icd.icd_id || '').toLowerCase().includes(search)
            );

        // Filtre statut liaison
        const hasIcd = linkedIcds.length > 0;
        const matchLinked = !linkedValue ||
            (linkedValue === 'linked' && hasIcd) ||
            (linkedValue === 'unlinked' && !hasIcd);

        return matchSearch && matchLinked;
    });

    // Tri alphabétique par display_name
    return filtered.sort((a, b) =>
        a.display_name.localeCompare(b.display_name, 'fr', { sensitivity: 'base' })
    );
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
        <div class="ied-card ${statusClass}"
             data-pattern-id="${pattern.id}"
             ondragover="handleDragOver(event)"
             ondragleave="handleDragLeave(event)"
             ondrop="handleDrop(event)">
            <div class="ied-card-header">
                <div class="ied-icon">🖲️</div>
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
                    <div class="icds-actions">
                        <button class="btn btn-small btn-secondary" onclick="triggerIcdUploadForPattern('${pattern.id}')" title="Importer un ICD directement lié">
                            📥 Importer
                        </button>
                        <button class="btn btn-small btn-add" onclick="showAssignIcdModal('${pattern.id}')">
                            + Associer
                        </button>
                    </div>
                </div>
                ${icdsHtml}
            </div>
        </div>
    `;
}

function buildIcdItem(icd, currentPattern) {
    // Utiliser icd_id comme identifiant unique
    const icdId = icd.icd_id;
    const encodedId = encodeURIComponent(icdId);
    const patternId = currentPattern.id;
    const encodedPatternId = encodeURIComponent(patternId);
    const manufacturer = icd.manufacturer || '';
    const encodedManufacturer = encodeURIComponent(manufacturer);
    // Afficher desc s'il existe (ex: SAMUA1), sinon ied_type_attr, sinon ied_type
    const displayType = icd.desc || icd.ied_type_attr || icd.ied_type;

    // Bouton référent ⭐ (par pattern + manufacturer)
    const isDefault = isDefaultIcd(icd, patternId);
    const starClass = isDefault ? 'btn-star active' : 'btn-star';
    const starIcon = isDefault ? '⭐' : '☆';
    const starTitle = isDefault ? 'Retirer comme référent' : `Définir comme référent (${manufacturer})`;

    return `
        <div class="icd-item ${isDefault ? 'is-default' : ''}" data-icd-id="${escapeHtml(icdId)}">
            <div class="icd-item-info">
                <strong>${escapeHtml(displayType)}</strong>
                ${isDefault ? '<span class="default-badge">Référent</span>' : ''}
                <div class="icd-item-meta">
                    ${escapeHtml(icd.manufacturer)} • ${escapeHtml(icd.version)} • ${icd.ld_count || 0} LD • ${icd.ln_count || 0} LN
                </div>
            </div>
            <div class="icd-item-actions">
                <button class="btn-icon ${starClass}" onclick="toggleDefaultIcd('${encodedId}', '${encodedPatternId}', '${encodedManufacturer}')" title="${starTitle}">
                    ${starIcon}
                </button>
                <button class="btn-icon" onclick="showMoveIcdModal(decodeURIComponent('${encodedId}'), '${currentPattern.id}')" title="Changer d'équipement">
                    ↔️
                </button>
                <button class="btn-icon btn-danger" onclick="unlinkIcd('${currentPattern.id}', decodeURIComponent('${encodedId}'))" title="Dissocier">
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
        // Matcher uniquement par icd_id
        return refs.includes(icd.icd_id);
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
    const allLinkedRefs = new Set();
    iedPatterns.forEach(p => {
        (p.icd_refs || []).forEach(ref => allLinkedRefs.add(ref));
    });

    return icdCatalog.filter(icd => {
        // Vérifier uniquement par icd_id
        return !allLinkedRefs.has(icd.icd_id);
    });
}

// ============================================================
// Rendu des ICD orphelins (cartes draggables dans panneau flottant)
// ============================================================

function renderOrphanIcds() {
    const container = document.getElementById('orphan-icds');
    if (!container) return;

    const orphans = getOrphanIcds();

    // Mettre à jour la visibilité du panneau
    updateOrphanPanelVisibility();

    if (!orphans.length) {
        container.innerHTML = '<p class="muted" style="text-align:center; font-size:12px;">Aucun ICD orphelin 🎉</p>';
        return;
    }

    // Tri alphabétique par type IED puis manufacturer
    orphans.sort((a, b) => {
        const typeCompare = a.ied_type.localeCompare(b.ied_type, 'fr', { sensitivity: 'base' });
        if (typeCompare !== 0) return typeCompare;
        return a.manufacturer.localeCompare(b.manufacturer, 'fr', { sensitivity: 'base' });
    });

    container.innerHTML = orphans.map(icd => {
        const icdId = icd.icd_id;
        // Afficher desc s'il existe (ex: SAMUA1), sinon ied_type_attr, sinon ied_type
        const displayType = icd.desc || icd.ied_type_attr || icd.ied_type;
        const subInfo = icd.desc ? `${icd.ied_type_attr || icd.ied_type} • ${icd.manufacturer}` : icd.manufacturer;
        return `
            <div class="orphan-icd-card"
                 draggable="true"
                 data-icd-id="${escapeHtml(icdId)}"
                 ondragstart="handleDragStart(event)"
                 ondragend="handleDragEnd(event)">
                <div class="orphan-card-icon">📄</div>
                <div class="orphan-card-info">
                    <div class="orphan-card-type">${escapeHtml(displayType)}</div>
                    <div class="orphan-card-manufacturer">${escapeHtml(subInfo)}</div>
                    <div class="orphan-card-version">${escapeHtml(icd.version)}</div>
                </div>
                <div class="orphan-card-actions">
                    <button class="btn-icon btn-danger"
                            onclick="event.stopPropagation(); deleteOrphanIcd('${escapeHtml(icdId)}')"
                            title="Supprimer cet ICD">
                        ✕
                    </button>
                    <span class="orphan-card-hint">⋮⋮</span>
                </div>
            </div>
        `;
    }).join('');
}

// ============================================================
// Drag & Drop
// ============================================================

let draggedIcdId = null;

function handleDragStart(event) {
    draggedIcdId = event.target.dataset.icdId;
    event.target.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', draggedIcdId);

    // Activer les zones de drop sur les cartes IED
    document.querySelectorAll('.ied-card').forEach(card => {
        card.classList.add('drop-target');
    });
}

function handleDragEnd(event) {
    event.target.classList.remove('dragging');
    draggedIcdId = null;

    // Désactiver les zones de drop
    document.querySelectorAll('.ied-card').forEach(card => {
        card.classList.remove('drop-target', 'drag-over');
    });
}

function handleDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
}

function handleDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
}

async function handleDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');

    const icdId = event.dataTransfer.getData('text/plain');
    const patternId = event.currentTarget.dataset.patternId;

    if (!icdId || !patternId) return;

    // Assigner l'ICD au pattern
    await linkIcdToPattern(icdId, patternId);
}

async function linkIcdToPattern(icdId, patternId) {
    try {
        const response = await fetch(`/api/icd/patterns/${patternId}/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icd_id: icdId })
        });

        if (response.ok) {
            await loadIedPatterns();
            renderIedCards();
            renderOrphanIcds();
            updateStats();
            showToast(`✅ ICD associé à ${patternId}`);
        } else {
            const err = await response.json();
            showToast(`❌ Erreur: ${err.detail || 'Échec'}`, 'error');
        }
    } catch (error) {
        showToast(`❌ Erreur: ${error.message}`, 'error');
    }
}

function showToast(message, type = 'success') {
    const existing = document.querySelector('.toast-notification');
    if (existing) existing.remove();

    const toast = document.createElement('div');
    toast.className = `toast-notification ${type}`;
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================================
// Statistiques
// ============================================================

function updateStats() {
    const container = document.getElementById('stats-summary');
    if (!container) return;

    // Ne compter que les patterns parents (sans parent défini)
    const parentPatterns = iedPatterns.filter(p => !p.parent);
    const totalPatterns = parentPatterns.length;
    const patternsWithIcd = parentPatterns.filter(p => (p.icd_refs || []).length > 0).length;
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
        const isLinked = currentRefs.includes(icd.icd_id);
        const isOrphan = orphans.some(o => o.icd_id === icd.icd_id);
        // Afficher desc s'il existe (ex: SAMUA1), sinon ied_type_attr, sinon ied_type
        const displayType = icd.desc || icd.ied_type_attr || icd.ied_type;

        return `
            <label class="icd-option ${isLinked ? 'already-linked' : ''} ${isOrphan ? 'orphan' : ''}">
                <input type="checkbox" value="${escapeHtml(icd.icd_id)}" ${isLinked ? 'checked' : ''}>
                <span class="icd-option-name">${escapeHtml(displayType)}</span>
                <span class="icd-option-version">${escapeHtml(icd.manufacturer)} • ${escapeHtml(icd.version)}</span>
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

async function showMoveIcdModal(icdId, currentPatternId) {
    const currentPattern = iedPatterns.find(p => p.id === currentPatternId);
    const icd = icdCatalog.find(i => i.icd_id === icdId);
    // Afficher desc s'il existe (ex: SAMUA1), sinon ied_type_attr
    const displayType = icd?.desc || icd?.ied_type_attr || icd?.ied_type || icdId;
    const displayName = icd ? `${displayType} (${icd.manufacturer})` : icdId;

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
                    <p><strong>ICD:</strong> ${escapeHtml(displayName)}</p>
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
                    <button class="btn btn-primary" onclick="moveIcd('${encodeURIComponent(icdId)}', '${currentPatternId}')">Déplacer</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

async function showAssignOrphanModal(icdId) {
    const icd = icdCatalog.find(i => i.icd_id === icdId);
    // Afficher desc s'il existe (ex: SAMUA1), sinon ied_type_attr
    const displayType = icd?.desc || icd?.ied_type_attr || icd?.ied_type || icdId;
    const displayName = icd ? `${displayType} (${icd.manufacturer})` : icdId;

    // Exclure les variants (patterns avec parent) - ils partagent le même ICD que leur parent
    const patternOptions = iedPatterns
        .filter(p => !p.parent)
        .map(p => `<option value="${p.id}">${escapeHtml(p.display_name)} (${escapeHtml(p.pattern)})</option>`)
        .join('');

    const encodedId = encodeURIComponent(icdId);

    const modalHtml = `
        <div class="modal-overlay" id="assign-orphan-modal" onclick="closeModal(event)">
            <div class="modal-content modal-small" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3>📎 Assigner l'ICD orphelin</h3>
                    <button class="btn-close" onclick="closeModal()">✕</button>
                </div>
                <div class="modal-body">
                    <p><strong>ICD:</strong> ${escapeHtml(displayName)}</p>
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
                    <button class="btn btn-primary" onclick="assignOrphan(decodeURIComponent('${encodedId}'))">Assigner</button>
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
        const icdId = cb.value;  // Maintenant c'est icd_id
        const wasLinked = currentRefs.has(icdId);

        if (cb.checked && !wasLinked) {
            await linkIcd(patternId, icdId);
        } else if (!cb.checked && wasLinked) {
            await unlinkIcdApi(patternId, icdId);
        }
    }

    await loadIedPatterns();
    renderIedCards();
    renderOrphanIcds();
    updateStats();
    closeModal();
}

async function moveIcd(encodedIcdId, currentPatternId) {
    const icdId = decodeURIComponent(encodedIcdId);
    const newPatternId = document.getElementById('new-pattern-select')?.value;
    if (!newPatternId) {
        alert('Veuillez sélectionner un équipement');
        return;
    }

    // Délier de l'ancien
    await unlinkIcdApi(currentPatternId, icdId);
    // Lier au nouveau
    await linkIcd(newPatternId, icdId);

    await loadIedPatterns();
    renderIedCards();
    renderOrphanIcds();
    updateStats();
    closeModal();
    console.log(`↔️ ICD déplacé: ${icdId} → ${newPatternId}`);
}

async function assignOrphan(icdId) {
    const patternId = document.getElementById('target-pattern-select')?.value;
    if (!patternId) {
        alert('Veuillez sélectionner un équipement');
        return;
    }

    await linkIcd(patternId, icdId);

    await loadIedPatterns();
    renderIedCards();
    renderOrphanIcds();
    updateStats();
    closeModal();
}

async function linkIcd(patternId, icdId) {
    try {
        await fetch(`${ICD_API_BASE}/patterns/${patternId}/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icd_id: icdId })
        });
        console.log(`🔗 Lié: ${patternId} → ${icdId}`);
    } catch (e) {
        console.error('Erreur liaison:', e);
    }
}

async function unlinkIcd(patternId, icdId) {
    if (!confirm(`Dissocier cet ICD de "${patternId}" ?`)) return;
    await unlinkIcdApi(patternId, icdId);
    await loadIedPatterns();
    renderIedCards();
    renderOrphanIcds();
    updateStats();
}

async function unlinkIcdApi(patternId, icdId) {
    try {
        console.log(`🔓 Envoi unlink: patternId=${patternId}, icdId=${icdId}`);
        const response = await fetch(`${ICD_API_BASE}/patterns/${patternId}/unlink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ icd_id: icdId })
        });
        const result = await response.json();
        console.log(`🔓 Réponse unlink:`, result);
        if (!response.ok) {
            console.error('❌ Erreur unlink:', result);
        }
    } catch (e) {
        console.error('Erreur déliaison:', e);
    }
}

async function deleteOrphanIcd(icdId) {
    // Récupérer les infos de l'ICD pour affichage
    const icd = icdCatalog.find(i => i.icd_id === icdId);
    // Afficher desc s'il existe (ex: SAMUA1), sinon ied_type_attr
    const displayName = icd?.desc || icd?.ied_type_attr || icd?.ied_type || icdId;

    if (!confirm(`Supprimer définitivement l'ICD "${displayName}" ?\n\nCette action est irréversible.`)) {
        return;
    }

    try {
        const response = await fetch(`${ICD_API_BASE}/${icdId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'Erreur de suppression');
        }

        const result = await response.json();
        console.log(`🗑️ ICD supprimé:`, result);

        // Recharger le catalogue et mettre à jour l'affichage
        await loadIcdCatalog();
        renderOrphanIcds();
        updateStats();

        // Notification visuelle
        showNotification(`✅ ICD "${displayName}" supprimé`);
    } catch (e) {
        console.error('❌ Erreur suppression ICD:', e);
        alert('❌ Erreur: ' + e.message);
    }
}

function showNotification(message) {
    // Créer une notification temporaire
    const notif = document.createElement('div');
    notif.className = 'toast-notification';
    notif.textContent = message;
    notif.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        background: #28a745;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        z-index: 10000;
        animation: slideIn 0.3s ease;
    `;
    document.body.appendChild(notif);

    setTimeout(() => {
        notif.style.animation = 'fadeOut 0.3s ease';
        setTimeout(() => notif.remove(), 300);
    }, 3000);
}

async function reanalyzeAll() {
    if (!confirm('Relancer l\'analyse de TOUS les fichiers ICD ?')) return;

    try {
        const response = await fetch(`${ICD_API_BASE}/reanalyze-all`, { method: 'POST' });
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
