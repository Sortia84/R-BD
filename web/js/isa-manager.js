// isa-manager.js - Gestion des fichiers ISA (xlsx, xml, csv, json...)

const ISA_API_BASE = '/api/isa';

let isaTypes = [];      // Types ISA depuis liste_isa.json
let isaCatalog = [];    // Fichiers ISA importés
let isaDefaults = {};   // Fichiers référents par type: {type_id: file_entry}


// ============================================================
// RENDU DU LAYOUT — Génération HTML de la vue ISA
// ============================================================

/**
 * Générer et injecter le layout HTML de la vue ISA.
 *
 * Crée : panneau orphelins ISA, bandeau d'action, grille des types.
 * Tous les éléments DOM (isa-orphan-panel, isa-upload, isa-cards…)
 * sont créés ici pour être utilisés par les fonctions suivantes.
 */
function renderIsaLayout() {
    const container = document.getElementById("view-isa");
    if (!container) return;

    container.innerHTML = `
        <!-- Panneau flottant ISA orphelins -->
        <aside class="orphan-panel hidden" id="isa-orphan-panel">
            <div class="orphan-panel-header" onclick="toggleIsaOrphanPanel()">
                <span class="orphan-panel-title">⚠️ Fichiers non assignés</span>
                <span class="orphan-panel-count" id="isa-orphan-count">0</span>
                <span class="orphan-panel-arrow" id="isa-orphan-arrow">◀</span>
            </div>
            <div class="orphan-panel-content" id="isa-orphan-panel-content">
                <p class="orphan-panel-hint">Glissez-déposez sur une carte de type ISA</p>
                <div id="orphan-files" class="orphan-list"></div>
            </div>
        </aside>

        <!-- Bandeau d'action -->
        <section class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h2>Gestion Fichiers ISA</h2>
                    <p class="muted">Importez et associez vos fichiers ISA (xlsx, xml, csv...) aux types de données</p>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <button class="btn btn-primary" onclick="triggerIsaUpload()">➕ Importer des fichiers</button>
                    <button class="btn" onclick="reanalyzeAll()" title="Relancer toutes les analyses">🔄 Tout ré-analyser</button>
                </div>
            </div>
            <input id="isa-upload" type="file" accept=".xlsx,.xls,.xml,.csv,.json" multiple hidden />
        </section>

        <!-- Grille types ISA -->
        <section class="card rbd-section-shell">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div class="stats-summary" id="isa-stats-summary"></div>
            </div>
            <div id="isa-cards" class="isa-grid">
                <div class="empty-state">
                    <div class="empty-state-icon">📂</div>
                    <p>Chargement...</p>
                </div>
            </div>
        </section>
    `;

    console.info("[ISA][Init] Layout ISA généré");
}


// ============================================================
// Initialisation
// ============================================================

async function initIsaPage() {
    // Générer le layout HTML dans le conteneur vide
    renderIsaLayout();
    await Promise.all([
        loadIsaTypes(),
        loadIsaCatalog()
    ]);
    // Les defaults sont dans chaque fichier (is_default: true)
    buildIsaDefaults();
    setupIsaUploadWithAutoLink();
    renderIsaTypeCards();
    renderOrphanFiles();
    updateIsaStats();
    initIsaOrphanPanel();
}

// Construire la map des fichiers référents à partir du catalogue
function buildIsaDefaults() {
    isaDefaults = {};
    for (const file of isaCatalog) {
        // Utiliser is_default_for (liste de type_ids)
        const defaultFor = file.is_default_for || [];
        for (const typeId of defaultFor) {
            isaDefaults[typeId] = file;
        }
    }
    console.log(`⭐ ${Object.keys(isaDefaults).length} fichier(s) référent(s) ISA`);
}

// Vérifier si un fichier est le référent pour un type
function isDefaultFile(file, typeId) {
    const defaultFile = isaDefaults[typeId];
    return defaultFile && defaultFile.id === file.id;
}

// Définir/supprimer un fichier comme référent
async function toggleDefaultFile(fileId, typeId) {
    const currentDefault = isaDefaults[typeId];
    const isCurrentlyDefault = currentDefault && currentDefault.id === fileId;

    try {
        if (isCurrentlyDefault) {
            // Supprimer le référent
            const response = await fetch(`${ISA_API_BASE}/default/${encodeURIComponent(typeId)}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('Erreur suppression référent');
            delete isaDefaults[typeId];
            console.log(`⭐ Référent supprimé pour ${typeId}`);
        } else {
            // Définir comme référent
            const response = await fetch(`${ISA_API_BASE}/default/${encodeURIComponent(typeId)}/${encodeURIComponent(fileId)}`, {
                method: 'POST'
            });
            if (!response.ok) throw new Error('Erreur définition référent');
            // Recharger le catalogue pour avoir les données à jour
            await loadIsaCatalog();
            buildIsaDefaults();
            console.log(`⭐ ${fileId} défini comme référent pour ${typeId}`);
        }

        // Re-rendre l'UI
        renderIsaTypeCards();
        renderOrphanFiles();
    } catch (error) {
        console.error('Erreur toggle default:', error);
        alert('Erreur: ' + error.message);
    }
}

// Gestion du panneau flottant orphelins
function initIsaOrphanPanel() {
    const panel = document.getElementById('isa-orphan-panel');
    if (!panel) return;

    // Restaurer l'état depuis localStorage
    const isCollapsed = localStorage.getItem('isaOrphanPanelCollapsed') === 'true';
    if (isCollapsed) {
        panel.classList.add('collapsed');
    }
}

function toggleIsaOrphanPanel() {
    const panel = document.getElementById('isa-orphan-panel');
    if (!panel) return;

    panel.classList.toggle('collapsed');

    // Sauvegarder l'état
    localStorage.setItem('isaOrphanPanelCollapsed', panel.classList.contains('collapsed'));
}

function updateIsaOrphanPanelVisibility() {
    const panel = document.getElementById('isa-orphan-panel');
    const orphans = getOrphanFiles();

    if (!panel) return;

    if (orphans.length === 0) {
        panel.classList.add('hidden');
    } else {
        panel.classList.remove('hidden');
    }

    const countEl = document.getElementById('isa-orphan-count');
    if (countEl) countEl.textContent = orphans.length;
}

async function loadIsaTypes() {
    try {
        const response = await fetch(`${ISA_API_BASE}/types`);
        if (!response.ok) throw new Error('Erreur chargement types ISA');
        const data = await response.json();
        isaTypes = data.types || [];
        console.log(`📋 ${isaTypes.length} types ISA chargés`);
    } catch (error) {
        console.warn('Erreur chargement types ISA:', error);
        isaTypes = [];
    }
}

async function loadIsaCatalog() {
    try {
        const response = await fetch(`${ISA_API_BASE}/`);
        if (!response.ok) throw new Error('Erreur chargement fichiers ISA');
        const data = await response.json();
        isaCatalog = data.files || [];
        console.log(`📚 ${isaCatalog.length} fichiers ISA chargés`);
    } catch (error) {
        console.warn('Erreur chargement fichiers ISA:', error);
        isaCatalog = [];
    }
}

// ============================================================
// Upload fichiers ISA
// ============================================================

function triggerIsaUpload() {
    pendingTypeForUpload = null;
    document.getElementById('isa-upload')?.click();
}

let pendingTypeForUpload = null;

function triggerIsaUploadForType(typeId) {
    pendingTypeForUpload = typeId;
    document.getElementById('isa-upload')?.click();
}

function setupIsaUploadWithAutoLink() {
    const input = document.getElementById('isa-upload');
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

                // Si un type est pré-sélectionné, l'ajouter
                if (pendingTypeForUpload) {
                    formData.append('type_id', pendingTypeForUpload);
                }

                const response = await fetch(`${ISA_API_BASE}/upload`, { method: 'POST', body: formData });
                if (!response.ok) throw new Error((await response.json()).detail || 'Erreur');
                successCount++;
            } catch (error) {
                errors.push(`${file.name}: ${error.message}`);
            }
        }

        await loadIsaCatalog();
        renderIsaTypeCards();
        renderOrphanFiles();
        updateIsaStats();
        input.value = '';
        pendingTypeForUpload = null;

        if (successCount > 0) {
            showToast(`✅ ${successCount} fichier(s) importé(s)`);
        }
        if (errors.length) {
            showToast(`❌ ${errors.length} erreur(s)`, 'error');
            console.error('Erreurs import:', errors);
        }
    });
}

// ============================================================
// Rendu des cartes types ISA
// ============================================================

function renderIsaTypeCards() {
    const container = document.getElementById('isa-cards');
    if (!container) return;

    if (isaTypes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <p>Aucun type ISA trouvé</p>
            </div>
        `;
        return;
    }

    container.innerHTML = isaTypes.map(type => renderIsaCard(type)).join('');

    // Setup drag & drop
    setupDragAndDrop();
}

function renderIsaCard(type) {
    const linkedFiles = getFilesForType(type.id);
    const hasFiles = linkedFiles.length > 0;
    const statusClass = hasFiles ? 'has-files' : 'no-files-status';

    // Utiliser l'icône définie dans le type, sinon fallback sur la catégorie
    const icon = type.icon || getTypeIcon(type.category || type.id);
    const formats = (type.formats || ['xlsx', 'xml', 'csv']).map(f =>
        `<span class="format-tag ${f}">.${f}</span>`
    ).join('');

    return `
        <div class="isa-card ${statusClass} drop-target" data-type-id="${type.id}">
            <div class="isa-card-header">
                <span class="isa-icon">${icon}</span>
                <div class="isa-info">
                    <h3>${type.name || type.id}</h3>
                    <span class="type-code">${type.id}</span>
                </div>
                <div class="isa-badge">
                    ${hasFiles
            ? `<span class="badge-count">${linkedFiles.length}</span>`
            : '<span class="badge-empty">0</span>'}
                </div>
            </div>

            ${type.description ? `<p class="isa-description">${type.description}</p>` : ''}

            <div class="isa-formats">
                <span class="label">Formats:</span>
                ${formats}
            </div>

            <div class="isa-files-list">
                <div class="files-header">
                    <span class="label">Fichiers associés</span>
                    <div class="files-actions">
                        <button class="btn-add" onclick="triggerIsaUploadForType('${type.id}')">
                            ➕ Ajouter
                        </button>
                        <button class="btn-icon" onclick="openSelectFilesModal('${type.id}')" title="Sélectionner des fichiers existants">
                            📎
                        </button>
                    </div>
                </div>
                ${hasFiles ? renderFilesList(linkedFiles, type.id) : '<div class="no-files">Aucun fichier associé</div>'}
            </div>
        </div>
    `;
}

function renderFilesList(files, typeId) {
    return files.map(file => {
        const isDefault = isDefaultFile(file, typeId);
        const starClass = isDefault ? 'btn-star active' : 'btn-star';
        const starIcon = isDefault ? '⭐' : '☆';
        const starTitle = isDefault ? 'Retirer comme référent' : 'Définir comme référent';
        const itemClass = isDefault ? 'file-item is-default' : 'file-item';

        return `
            <div class="${itemClass}" data-file-id="${file.id}">
                <div class="file-item-info">
                    <strong>${file.original_name || file.filename}</strong>
                    ${isDefault ? '<span class="default-badge">Référent</span>' : ''}
                    <div class="file-item-meta">
                        <span class="file-format-badge format-tag ${file.format}">${file.format.toUpperCase()}</span>
                        <span>${formatFileSize(file.size)}</span>
                        <span>${formatDate(file.imported_at)}</span>
                    </div>
                </div>
                <div class="file-item-actions">
                    <button class="btn-icon ${starClass}" onclick="toggleDefaultFile('${file.id}', '${typeId}')" title="${starTitle}">
                        ${starIcon}
                    </button>
                    <button class="btn-icon" onclick="viewFileDetails('${file.id}')" title="Détails">👁️</button>
                    <button class="btn-icon btn-danger" onclick="unlinkFile('${file.id}', '${typeId}')" title="Retirer">✕</button>
                </div>
            </div>
        `;
    }).join('');
}

function getFilesForType(typeId) {
    return isaCatalog.filter(file =>
        file.type_refs && file.type_refs.includes(typeId)
    );
}

function getOrphanFiles() {
    return isaCatalog.filter(file =>
        !file.type_refs || file.type_refs.length === 0
    );
}

function getTypeIcon(category) {
    const icons = {
        'config': '⚙️',
        'data': '📊',
        'mapping': '🗺️',
        'reference': '📖',
        'template': '📋',
        'export': '📤',
        'import': '📥',
        'report': '📈',
        'default': '📁'
    };
    return icons[category] || icons.default;
}

// ============================================================
// Fichiers orphelins
// ============================================================

function renderOrphanFiles() {
    const container = document.getElementById('orphan-files');
    if (!container) return;

    const orphans = getOrphanFiles();
    updateIsaOrphanPanelVisibility();

    if (orphans.length === 0) {
        container.innerHTML = '<p class="muted" style="text-align: center; font-size: 12px;">Aucun fichier orphelin</p>';
        return;
    }

    container.innerHTML = orphans.map(file => `
        <div class="orphan-file-card" draggable="true" data-file-id="${file.id}">
            <span class="orphan-card-icon">${getFormatIcon(file.format)}</span>
            <div class="orphan-card-info">
                <div class="orphan-card-name">${file.original_name || file.filename}</div>
                <div class="orphan-card-format">${file.format.toUpperCase()}</div>
                <div class="orphan-card-size">${formatFileSize(file.size)}</div>
            </div>
            <div class="orphan-card-actions">
                <button class="btn-icon btn-danger" onclick="deleteFile('${file.id}')" title="Supprimer">🗑️</button>
            </div>
            <span class="orphan-card-hint">⇄</span>
        </div>
    `).join('');

    // Setup drag events pour les orphelins
    setupOrphanDragEvents();
}

function getFormatIcon(format) {
    const icons = {
        'xlsx': '📗',
        'xls': '📗',
        'xml': '📘',
        'csv': '📙',
        'json': '📕',
        'txt': '📄'
    };
    return icons[format] || '📄';
}

// ============================================================
// Drag & Drop
// ============================================================

function setupDragAndDrop() {
    const cards = document.querySelectorAll('.isa-card.drop-target');

    cards.forEach(card => {
        card.addEventListener('dragover', (e) => {
            e.preventDefault();
            card.classList.add('drag-over');
        });

        card.addEventListener('dragleave', () => {
            card.classList.remove('drag-over');
        });

        card.addEventListener('drop', async (e) => {
            e.preventDefault();
            card.classList.remove('drag-over');

            const fileId = e.dataTransfer.getData('text/plain');
            const typeId = card.dataset.typeId;

            if (fileId && typeId) {
                await linkFileToType(fileId, typeId);
            }
        });
    });
}

function setupOrphanDragEvents() {
    const orphanCards = document.querySelectorAll('.orphan-file-card');

    orphanCards.forEach(card => {
        card.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', card.dataset.fileId);
            card.classList.add('dragging');
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
        });
    });
}

// ============================================================
// API Actions
// ============================================================

async function linkFileToType(fileId, typeId) {
    try {
        const response = await fetch(`${ISA_API_BASE}/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId, type_id: typeId })
        });

        if (!response.ok) throw new Error('Erreur liaison');

        await loadIsaCatalog();
        renderIsaTypeCards();
        renderOrphanFiles();
        updateIsaStats();

        showToast('✅ Fichier associé au type');
    } catch (error) {
        console.error('Erreur liaison:', error);
        showToast('❌ Erreur lors de l\'association', 'error');
    }
}

async function unlinkFile(fileId, typeId) {
    if (!confirm('Retirer ce fichier du type ?')) return;

    try {
        const response = await fetch(`${ISA_API_BASE}/unlink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId, type_id: typeId })
        });

        if (!response.ok) throw new Error('Erreur retrait');

        await loadIsaCatalog();
        renderIsaTypeCards();
        renderOrphanFiles();
        updateIsaStats();

        showToast('✅ Fichier retiré du type');
    } catch (error) {
        console.error('Erreur retrait:', error);
        showToast('❌ Erreur lors du retrait', 'error');
    }
}

async function deleteFile(fileId) {
    if (!confirm('Supprimer définitivement ce fichier ?')) return;

    try {
        const response = await fetch(`${ISA_API_BASE}/${fileId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Erreur suppression');

        await loadIsaCatalog();
        renderIsaTypeCards();
        renderOrphanFiles();
        updateIsaStats();

        showToast('✅ Fichier supprimé');
    } catch (error) {
        console.error('Erreur suppression:', error);
        showToast('❌ Erreur lors de la suppression', 'error');
    }
}

async function reanalyzeAll() {
    if (!confirm('Relancer l\'analyse de tous les fichiers ? Cela peut prendre du temps.')) return;

    showToast('🔄 Ré-analyse en cours...');

    try {
        const response = await fetch(`${ISA_API_BASE}/reanalyze`, {
            method: 'POST'
        });

        if (!response.ok) throw new Error('Erreur ré-analyse');

        await loadIsaCatalog();
        renderIsaTypeCards();
        renderOrphanFiles();
        updateIsaStats();

        showToast('✅ Ré-analyse terminée');
    } catch (error) {
        console.error('Erreur ré-analyse:', error);
        showToast('❌ Erreur lors de la ré-analyse', 'error');
    }
}

function viewFileDetails(fileId) {
    const file = isaCatalog.find(f => f.id === fileId);
    if (!file) return;

    alert(`Détails du fichier:\n\nNom: ${file.original_name || file.filename}\nFormat: ${file.format}\nTaille: ${formatFileSize(file.size)}\nImporté: ${formatDate(file.imported_at)}\n\nTypes associés: ${(file.type_refs || []).join(', ') || 'Aucun'}`);
}

// ============================================================
// Modal sélection fichiers
// ============================================================

function openSelectFilesModal(typeId) {
    const orphans = getOrphanFiles();

    if (orphans.length === 0) {
        showToast('Aucun fichier disponible à associer');
        return;
    }

    const modal = document.createElement('div');
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h3>Sélectionner des fichiers</h3>
                <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
            </div>
            <div class="modal-body">
                <p>Sélectionnez les fichiers à associer à ce type :</p>
                <div class="file-options-list">
                    ${orphans.map(file => `
                        <label class="file-option orphan">
                            <input type="checkbox" value="${file.id}">
                            <span class="file-option-name">${file.original_name || file.filename}</span>
                            <span class="file-option-format">${file.format.toUpperCase()}</span>
                        </label>
                    `).join('')}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="this.closest('.modal-overlay').remove()">Annuler</button>
                <button class="btn btn-primary" onclick="confirmSelectFiles('${typeId}', this)">Associer</button>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
}

async function confirmSelectFiles(typeId, btn) {
    const modal = btn.closest('.modal-overlay');
    const checkboxes = modal.querySelectorAll('input[type="checkbox"]:checked');
    const fileIds = Array.from(checkboxes).map(cb => cb.value);

    if (fileIds.length === 0) {
        showToast('Sélectionnez au moins un fichier');
        return;
    }

    for (const fileId of fileIds) {
        await linkFileToType(fileId, typeId);
    }

    modal.remove();
}

// ============================================================
// Stats
// ============================================================

function updateIsaStats() {
    const container = document.getElementById('stats-summary');
    if (!container) return;

    // Les compteurs de synthese sont volontairement masques dans l'IHM
    // pour eviter un doublon d'information dans l'entete de section.
    container.innerHTML = '';
}

// ============================================================
// Utilitaires
// ============================================================

function formatFileSize(bytes) {
    if (!bytes) return '—';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr) {
    if (!dateStr) return '—';
    const date = new Date(dateStr);
    return date.toLocaleDateString('fr-FR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
    });
}

function showToast(message, type = 'success') {
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
