// isa-manager.js - Gestion des fichiers ISA (xlsx, xml, csv, json...)

const API_BASE = '/api/isa';

let isaTypes = [];      // Types ISA depuis liste_isa.json
let isaCatalog = [];    // Fichiers ISA importés

// ============================================================
// Initialisation
// ============================================================

async function initIsaPage() {
    await Promise.all([
        loadIsaTypes(),
        loadIsaCatalog()
    ]);
    setupIsaUploadWithAutoLink();
    renderIsaTypeCards();
    renderOrphanFiles();
    updateStats();
    initOrphanPanel();
}

// Gestion du panneau flottant orphelins
function initOrphanPanel() {
    const panel = document.getElementById('orphan-panel');
    if (!panel) return;

    // Restaurer l'état depuis localStorage
    const isCollapsed = localStorage.getItem('isaOrphanPanelCollapsed') === 'true';
    if (isCollapsed) {
        panel.classList.add('collapsed');
    }
}

function toggleOrphanPanel() {
    const panel = document.getElementById('orphan-panel');
    if (!panel) return;

    panel.classList.toggle('collapsed');

    // Sauvegarder l'état
    localStorage.setItem('isaOrphanPanelCollapsed', panel.classList.contains('collapsed'));
}

function updateOrphanPanelVisibility() {
    const panel = document.getElementById('orphan-panel');
    const orphans = getOrphanFiles();

    if (!panel) return;

    if (orphans.length === 0) {
        panel.classList.add('hidden');
    } else {
        panel.classList.remove('hidden');
    }

    const countEl = document.getElementById('orphan-count');
    if (countEl) countEl.textContent = orphans.length;
}

async function loadIsaTypes() {
    try {
        const response = await fetch(`${API_BASE}/types`);
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
        const response = await fetch(`${API_BASE}/`);
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

                const response = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
                if (!response.ok) throw new Error((await response.json()).detail || 'Erreur');
                successCount++;
            } catch (error) {
                errors.push(`${file.name}: ${error.message}`);
            }
        }

        await loadIsaCatalog();
        renderIsaTypeCards();
        renderOrphanFiles();
        updateStats();
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

    const searchFilter = document.getElementById('filter-search')?.value.toLowerCase() || '';
    const linkedFilter = document.getElementById('filter-linked')?.value || '';
    const formatFilter = document.getElementById('filter-format')?.value || '';

    // Filtrer les types
    let filteredTypes = isaTypes.filter(type => {
        // Filtre recherche
        if (searchFilter) {
            const searchIn = `${type.name} ${type.id} ${type.description || ''}`.toLowerCase();
            if (!searchIn.includes(searchFilter)) return false;
        }

        // Filtre statut
        const linkedFiles = getFilesForType(type.id);
        if (linkedFilter === 'linked' && linkedFiles.length === 0) return false;
        if (linkedFilter === 'unlinked' && linkedFiles.length > 0) return false;

        // Filtre format
        if (formatFilter) {
            const acceptedFormats = type.formats || [];
            if (!acceptedFormats.includes(formatFilter)) return false;
        }

        return true;
    });

    if (filteredTypes.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <p>Aucun type ISA trouvé</p>
            </div>
        `;
        return;
    }

    container.innerHTML = filteredTypes.map(type => renderIsaCard(type)).join('');

    // Setup drag & drop
    setupDragAndDrop();
}

function renderIsaCard(type) {
    const linkedFiles = getFilesForType(type.id);
    const hasFiles = linkedFiles.length > 0;
    const statusClass = hasFiles ? 'has-files' : 'no-files-status';

    const icon = getTypeIcon(type.category || type.id);
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
    return files.map(file => `
        <div class="file-item" data-file-id="${file.id}">
            <div class="file-item-info">
                <strong>${file.original_name || file.filename}</strong>
                <div class="file-item-meta">
                    <span class="file-format-badge format-tag ${file.format}">${file.format.toUpperCase()}</span>
                    <span>${formatFileSize(file.size)}</span>
                    <span>${formatDate(file.imported_at)}</span>
                </div>
            </div>
            <div class="file-item-actions">
                <button class="btn-icon" onclick="viewFileDetails('${file.id}')" title="Détails">👁️</button>
                <button class="btn-icon btn-danger" onclick="unlinkFile('${file.id}', '${typeId}')" title="Retirer">✕</button>
            </div>
        </div>
    `).join('');
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
    updateOrphanPanelVisibility();

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
        const response = await fetch(`${API_BASE}/link`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId, type_id: typeId })
        });

        if (!response.ok) throw new Error('Erreur liaison');

        await loadIsaCatalog();
        renderIsaTypeCards();
        renderOrphanFiles();
        updateStats();

        showToast('✅ Fichier associé au type');
    } catch (error) {
        console.error('Erreur liaison:', error);
        showToast('❌ Erreur lors de l\'association', 'error');
    }
}

async function unlinkFile(fileId, typeId) {
    if (!confirm('Retirer ce fichier du type ?')) return;

    try {
        const response = await fetch(`${API_BASE}/unlink`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ file_id: fileId, type_id: typeId })
        });

        if (!response.ok) throw new Error('Erreur retrait');

        await loadIsaCatalog();
        renderIsaTypeCards();
        renderOrphanFiles();
        updateStats();

        showToast('✅ Fichier retiré du type');
    } catch (error) {
        console.error('Erreur retrait:', error);
        showToast('❌ Erreur lors du retrait', 'error');
    }
}

async function deleteFile(fileId) {
    if (!confirm('Supprimer définitivement ce fichier ?')) return;

    try {
        const response = await fetch(`${API_BASE}/${fileId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Erreur suppression');

        await loadIsaCatalog();
        renderIsaTypeCards();
        renderOrphanFiles();
        updateStats();

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
        const response = await fetch(`${API_BASE}/reanalyze`, {
            method: 'POST'
        });

        if (!response.ok) throw new Error('Erreur ré-analyse');

        await loadIsaCatalog();
        renderIsaTypeCards();
        renderOrphanFiles();
        updateStats();

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
// Stats & Filters
// ============================================================

function updateStats() {
    const container = document.getElementById('stats-summary');
    if (!container) return;

    const totalFiles = isaCatalog.length;
    const orphanCount = getOrphanFiles().length;
    const linkedCount = totalFiles - orphanCount;

    container.innerHTML = `
        <span class="stat-item">${totalFiles} fichiers</span>
        <span class="stat-item">${linkedCount} associés</span>
        ${orphanCount > 0 ? `<span class="stat-item warning">${orphanCount} orphelins</span>` : ''}
    `;
}

function resetFilters() {
    const searchInput = document.getElementById('filter-search');
    const linkedSelect = document.getElementById('filter-linked');
    const formatSelect = document.getElementById('filter-format');

    if (searchInput) searchInput.value = '';
    if (linkedSelect) linkedSelect.value = '';
    if (formatSelect) formatSelect.value = '';

    renderIsaTypeCards();
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
