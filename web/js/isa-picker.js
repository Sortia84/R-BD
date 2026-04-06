// isa-picker.js - Popup de sélection depuis les fichiers ISA référents
// Permet de sélectionner des CDE, Alarmes, TCD depuis la base ISA

// ============================================================
// Configuration
// ============================================================

const ISA_TYPES = {
    cde: {
        type_id: 'isa_cde',
        title: 'Sélectionner des CDE',
        icon: '📊',
        emptyMessage: 'Aucun fichier CDE référent configuré'
    },
    alarmes: {
        type_id: 'isa_alarmes',
        title: 'Sélectionner des Alarmes',
        icon: '⚠️',
        emptyMessage: 'Aucun fichier Alarmes référent configuré'
    },
    tcd: {
        type_id: 'isa_tcd',
        title: 'Sélectionner des TCD',
        icon: 'ℹ️',
        emptyMessage: 'Aucun fichier TCD référent configuré'
    }
};

// Cache des données ISA chargées
let isaDataCache = {};

// État du picker
let pickerState = {
    type: null,
    selectedItems: new Set(),
    allItems: [],
    filteredItems: [],
    onConfirm: null
};

// ============================================================
// API - Chargement des données ISA
// ============================================================

/**
 * Récupère le fichier référent pour un type ISA
 */
async function getIsaDefaultFile(typeId) {
    try {
        const response = await fetch(`/api/isa/default/${typeId}`);
        if (!response.ok) {
            if (response.status === 404) return null;
            throw new Error(`HTTP ${response.status}`);
        }
        const data = await response.json();
        // L'API retourne { file: { id: ..., ... } }
        return data.file?.id || null;
    } catch (error) {
        console.error(`Erreur récupération fichier référent ${typeId}:`, error);
        return null;
    }
}

/**
 * Récupère les données analysées d'un fichier ISA
 */
async function getIsaAnalyzedData(fileId) {
    try {
        const response = await fetch(`/api/isa/analyzed/${fileId}`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.error(`Erreur récupération données analysées ${fileId}:`, error);
        return null;
    }
}

/**
 * Charge les données ISA pour un type (avec cache)
 */
async function loadIsaData(isaType) {
    const config = ISA_TYPES[isaType];
    if (!config) {
        console.error(`Type ISA inconnu: ${isaType}`);
        return null;
    }

    // Vérifier le cache
    if (isaDataCache[isaType]) {
        return isaDataCache[isaType];
    }

    // Récupérer le fichier référent
    const fileId = await getIsaDefaultFile(config.type_id);
    if (!fileId) {
        console.warn(`Pas de fichier référent pour ${config.type_id}`);
        return null;
    }

    // Récupérer les données analysées
    const data = await getIsaAnalyzedData(fileId);
    if (!data) {
        return null;
    }

    // Mettre en cache
    isaDataCache[isaType] = data;
    return data;
}

/**
 * Extrait les entrées depuis les données analysées
 */
function extractEntriesFromData(data, isaType) {
    if (!data) return [];

    const entries = [];

    // Pour les alarmes (structure avec regroupements)
    if (data.regroupements) {
        data.regroupements.forEach(grp => {
            // Ajouter le regroupement lui-même
            entries.push({
                id: grp.id,
                libelle8: grp.libellecourt,
                libelle16: grp.libellecourt,
                type: 'regroupement',
                niveau: grp.niveauregroupement,
                ldgrp: grp.ldgrp,
                entrees_count: grp.entrees?.length || 0
            });
        });
    }

    // Pour les CDE/TCD (structure entries - liste d'objets)
    if (data.entries && Array.isArray(data.entries)) {
        data.entries.forEach(entry => {
            // Gérer les différents formats de champs
            const libelle8 = entry['ISA.Libellé 8 caractères'] || entry.Libelle8 || entry.libellecourt || entry.name || '';
            const libelle16 = entry['ISA.Libellé 16 caractères'] || entry.Libelle16 || entry.libellelong || '';
            const entryType = entry['ISA.type'] || entry.type || '';
            const iedType = entry['RTE-IEDType'] || entry.IED || '';
            const ldInst = entry['LD.inst'] || entry.LD || '';

            // Ne pas ajouter si pas de libellé
            if (!libelle8 && !libelle16) return;

            entries.push({
                id: entry.UniqueID || entry.id || `entry_${entries.length}`,
                libelle8: libelle8,
                libelle16: libelle16,
                type: entryType,
                ied: iedType,
                ld: ldInst,
                idrc: entry['ISA.IDRC'] || entry['ISA.Gen.IDRC'] || ''
            });
        });
    }

    // Si structure index plate (comme dans RISA)
    if (data.index && typeof data.index === 'object') {
        Object.entries(data.index).forEach(([key, value]) => {
            if (value && typeof value === 'object' && value.UniqueID) {
                entries.push({
                    id: value.UniqueID,
                    libelle8: value.Libelle8 || key,
                    libelle16: value.Libelle16 || '',
                    type: value.InfosISA?.['ISA.type'] || 'entry',
                    ied: value.IED || '',
                    ld: value.LD || ''
                });
            }
        });
    }

    return entries;
}

// ============================================================
// UI - Popup
// ============================================================

/**
 * Crée le HTML du popup (une seule fois)
 */
function createPickerPopup() {
    if (document.getElementById('isa-picker-overlay')) {
        return;
    }

    const html = `
        <div id="isa-picker-overlay" class="isa-popup-overlay">
            <div class="isa-popup">
                <div class="isa-popup-header">
                    <h3 id="isa-picker-title">Sélectionner</h3>
                    <button class="isa-popup-close" onclick="closeIsaPicker()">&times;</button>
                </div>

                <div class="isa-popup-search">
                    <input type="text" id="isa-picker-search" placeholder="Rechercher..." oninput="filterIsaItems(this.value)">
                </div>

                <div class="isa-popup-content" id="isa-picker-content">
                    <!-- Contenu dynamique -->
                </div>

                <div class="isa-popup-footer">
                    <span class="selection-count">
                        <strong id="isa-picker-count">0</strong> élément(s) sélectionné(s)
                    </span>
                    <div class="isa-popup-actions">
                        <button class="btn btn-secondary" onclick="closeIsaPicker()">Annuler</button>
                        <button class="btn btn-primary" onclick="confirmIsaSelection()">
                            ➕ Ajouter la sélection
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', html);
}

/**
 * Ouvre le picker ISA pour un type
 */
async function openIsaPicker(isaType, onConfirm) {
    createPickerPopup();

    const config = ISA_TYPES[isaType];
    if (!config) {
        console.error(`Type ISA inconnu: ${isaType}`);
        return;
    }

    // Reset state
    pickerState = {
        type: isaType,
        selectedItems: new Set(),
        allItems: [],
        filteredItems: [],
        onConfirm: onConfirm
    };

    // Mettre à jour le titre
    document.getElementById('isa-picker-title').innerHTML = `${config.icon} ${config.title}`;
    document.getElementById('isa-picker-search').value = '';
    document.getElementById('isa-picker-count').textContent = '0';

    // Afficher loading
    const content = document.getElementById('isa-picker-content');
    content.innerHTML = `
        <div class="isa-popup-loading">
            <div class="spinner"></div>
            <p>Chargement des données...</p>
        </div>
    `;

    // Ouvrir le popup
    document.getElementById('isa-picker-overlay').classList.add('active');

    // Charger les données
    const data = await loadIsaData(isaType);

    if (!data) {
        content.innerHTML = `
            <div class="isa-popup-empty">
                <div class="empty-icon">📭</div>
                <p>${config.emptyMessage}</p>
                <p style="font-size: 12px;">Configurez un fichier référent dans la section ISA.</p>
            </div>
        `;
        return;
    }

    // Extraire les entrées
    pickerState.allItems = extractEntriesFromData(data, isaType);
    pickerState.filteredItems = [...pickerState.allItems];

    if (pickerState.allItems.length === 0) {
        content.innerHTML = `
            <div class="isa-popup-empty">
                <div class="empty-icon">📋</div>
                <p>Aucune entrée trouvée dans le fichier référent.</p>
            </div>
        `;
        return;
    }

    // Afficher la liste
    renderIsaItems();
}

/**
 * Ferme le picker
 */
function closeIsaPicker() {
    document.getElementById('isa-picker-overlay')?.classList.remove('active');
    pickerState.selectedItems.clear();
}

/**
 * Filtre les items par recherche
 */
function filterIsaItems(query) {
    const q = query.toLowerCase().trim();

    if (!q) {
        pickerState.filteredItems = [...pickerState.allItems];
    } else {
        pickerState.filteredItems = pickerState.allItems.filter(item =>
            (item.libelle8 || '').toLowerCase().includes(q) ||
            (item.libelle16 || '').toLowerCase().includes(q) ||
            (item.id || '').toString().toLowerCase().includes(q)
        );
    }

    renderIsaItems();
}

/**
 * Affiche la liste des items
 */
function renderIsaItems() {
    const content = document.getElementById('isa-picker-content');

    if (pickerState.filteredItems.length === 0) {
        content.innerHTML = `
            <div class="isa-popup-empty">
                <div class="empty-icon">🔍</div>
                <p>Aucun résultat pour cette recherche.</p>
            </div>
        `;
        return;
    }

    const itemsHtml = pickerState.filteredItems.map(item => {
        const isSelected = pickerState.selectedItems.has(item.id);
        const selectedClass = isSelected ? 'selected' : '';
        const checkmark = isSelected ? '✓' : '';

        const metaHtml = [];
        if (item.type) metaHtml.push(`<span>${item.type}</span>`);
        if (item.niveau) metaHtml.push(`<span>${item.niveau}</span>`);
        if (item.ied) metaHtml.push(`<span>IED: ${item.ied}</span>`);
        if (item.entrees_count) metaHtml.push(`<span>${item.entrees_count} entrées</span>`);

        return `
            <div class="isa-popup-item ${selectedClass}" onclick="toggleIsaItem('${item.id}')">
                <div class="item-checkbox">${checkmark}</div>
                <div class="item-info">
                    <div class="item-libelle">${escapeHtml(item.libelle8 || item.id)}</div>
                    ${item.libelle16 ? `<div class="item-libelle16">${escapeHtml(item.libelle16)}</div>` : ''}
                    ${metaHtml.length ? `<div class="item-meta">${metaHtml.join('')}</div>` : ''}
                </div>
            </div>
        `;
    }).join('');

    content.innerHTML = `<div class="isa-popup-list">${itemsHtml}</div>`;
}

/**
 * Toggle la sélection d'un item
 */
function toggleIsaItem(itemId) {
    if (pickerState.selectedItems.has(itemId)) {
        pickerState.selectedItems.delete(itemId);
    } else {
        pickerState.selectedItems.add(itemId);
    }

    // Mettre à jour le compteur
    document.getElementById('isa-picker-count').textContent = pickerState.selectedItems.size;

    // Re-render
    renderIsaItems();
}

/**
 * Confirme la sélection
 */
function confirmIsaSelection() {
    if (pickerState.selectedItems.size === 0) {
        closeIsaPicker();
        return;
    }

    // Récupérer les items sélectionnés
    const selectedItems = pickerState.allItems.filter(item =>
        pickerState.selectedItems.has(item.id)
    );

    // Appeler le callback
    if (pickerState.onConfirm) {
        pickerState.onConfirm(selectedItems);
    }

    closeIsaPicker();
}

/**
 * Escape HTML pour éviter XSS
 */
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ============================================================
// Intégration avec l'éditeur de test
// ============================================================

/**
 * Ajoute une info depuis les données ISA
 */
function addInfoFromIsa(type, isaItem) {
    const labels = { cde: 'CDE', alarmes: 'alarme', tcd: 'information TCD' };
    const label = labels[type] || 'information';

    if (typeof addInfo !== 'function') {
        console.error('[ISA][Picker] Fonction addInfo indisponible');
        return;
    }

    // Créer d'abord un item vide via la logique standard.
    addInfo(type, label);

    // Puis remplacer son contenu avec la donnée ISA choisie.
    if (!currentTest || !Array.isArray(currentTest[type]) || currentTest[type].length === 0) {
        return;
    }

    const index = currentTest[type].length - 1;
    const created = currentTest[type][index];
    currentTest[type][index] = {
        ...created,
        name: isaItem.libelle8 || isaItem.id || '',
        isa_id: isaItem.id || '',
        libelle16: isaItem.libelle16 || ''
    };

    // Synchroniser immédiatement le champ texte affiché dans la ligne créée.
    const itemElement = document.getElementById(created.id);
    if (itemElement) {
        const nameInput = itemElement.querySelector('input[type="text"]');
        if (nameInput) {
            nameInput.value = currentTest[type][index].name;
        }
    }
}

/**
 * Ouvre le picker pour CDE et ajoute les sélections
 */
function openCDEPicker() {
    openIsaPicker('cde', (items) => {
        items.forEach(item => addInfoFromIsa('cde', item));
    });
}

/**
 * Ouvre le picker pour Alarmes et ajoute les sélections
 */
function openAlarmesPicker() {
    openIsaPicker('alarmes', (items) => {
        items.forEach(item => addInfoFromIsa('alarmes', item));
    });
}

/**
 * Ouvre le picker pour TCD et ajoute les sélections
 */
function openTCDPicker() {
    openIsaPicker('tcd', (items) => {
        items.forEach(item => addInfoFromIsa('tcd', item));
    });
}

// Exporter pour utilisation globale
window.openIsaPicker = openIsaPicker;
window.closeIsaPicker = closeIsaPicker;
window.filterIsaItems = filterIsaItems;
window.toggleIsaItem = toggleIsaItem;
window.confirmIsaSelection = confirmIsaSelection;
window.openCDEPicker = openCDEPicker;
window.openAlarmesPicker = openAlarmesPicker;
window.openTCDPicker = openTCDPicker;
