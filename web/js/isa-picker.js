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
    onConfirm: null,
    addedCount: 0
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
 * Normalise les identifiants ISA pour les comparaisons côté interface.
 *
 * Les fichiers CDE/TCD fournissent parfois des UniqueID numériques, tandis
 * que les clics HTML renvoient des chaînes de caractères.
 */
function normalizeIsaItemId(value, fallback = '') {
    const rawId = value !== undefined && value !== null && value !== '' ? value : fallback;
    return String(rawId);
}

/**
 * Retourne la premiere valeur renseignee parmi plusieurs cles possibles.
 *
 * Les donnees ISA analysees peuvent provenir de plusieurs parseurs. Cette
 * fonction evite de disperser les variantes de cles dans le rendu du picker.
 */
function getFirstDefinedValue(source, keys, fallback = '') {
    if (!source || typeof source !== 'object') {
        return fallback;
    }

    for (const key of keys) {
        const value = source[key];
        if (value !== undefined && value !== null && value !== '') {
            return value;
        }
    }

    return fallback;
}

/**
 * Construit un item standard du picker a partir d'une entree ISA analysee.
 */
function buildIsaPickerItem(entry, fallbackId) {
    const libelle8 = getFirstDefinedValue(
        entry,
        ['ISA.Libellé 8 caractères', 'ISA.Libelle 8 caracteres', 'Libelle8', 'libelle8', 'libellecourt', 'name'],
        ''
    );
    const libelle16 = getFirstDefinedValue(
        entry,
        ['ISA.Libellé 16 caractères', 'ISA.Libelle 16 caracteres', 'Libelle16', 'libelle16', 'libellelong'],
        ''
    );
    const rawId = getFirstDefinedValue(entry, ['UniqueID', 'id'], fallbackId);

    return {
        id: normalizeIsaItemId(rawId, fallbackId),
        libelle8: libelle8,
        libelle16: libelle16,
        type: getFirstDefinedValue(entry, ['ISA.type', 'type'], ''),
        ied: getFirstDefinedValue(entry, ['RTE-IEDType', 'IED'], ''),
        ld: getFirstDefinedValue(entry, ['LD.inst', 'LD'], ''),
        idrc: getFirstDefinedValue(entry, ['ISA.IDRC', 'ISA.Gen.IDRC'], ''),
        allowed_states: extractIsaStateOptions(entry.InfosISA || entry)
    };
}

/**
 * Extrait les entrées depuis les données analysées
 */
function getFirstIsaText(source, keys) {
    if (!source || typeof source !== 'object') {
        return '';
    }

    for (const key of keys) {
        const value = source[key];
        if (value !== undefined && value !== null && String(value).trim() !== '') {
            return String(value).trim();
        }
    }

    return '';
}

function addIsaStateOption(options, seen, source, code, labelKeys, valueKeys) {
    const value = getFirstIsaText(source, valueKeys);
    const label = getFirstIsaText(source, labelKeys) || code;

    // Un etat est disponible uniquement si ISA.DEB, ISA.FIN ou ISA.INVALID
    // porte une valeur. Le libelle seul ne suffit pas a prouver l'etat.
    if (!value) {
        return;
    }

    const uniqueKey = `${code}:${label.toUpperCase()}:${value}`;
    if (seen.has(uniqueKey)) {
        return;
    }

    seen.add(uniqueKey);
    options.push({
        code,
        label,
        value,
        source: `ISA.${code}`
    });
}

function extractIsaStateOptions(record) {
    const options = [];
    const seen = new Set();

    // Les libelles additionnels portent le vocabulaire metier affiche a l'utilisateur.
    addIsaStateOption(options, seen, record, 'DEB', ['ISA.additionnalLabelForAppearance'], ['ISA.DEB']);
    addIsaStateOption(options, seen, record, 'FIN', ['ISA.additionnalLabelForDisappearance'], ['ISA.FIN']);
    addIsaStateOption(options, seen, record, 'INVALID', ['ISA.additionnalLabelForInvalidity'], ['ISA.INVALID']);

    return options;
}

function extractAlarmGroupStateOptions(group) {
    const options = [];
    const seen = new Set();

    (group.entrees || []).forEach(entry => {
        extractIsaStateOptions(entry).forEach(option => {
            const key = `${option.code}:${option.label}:${option.value}`;
            if (!seen.has(key)) {
                seen.add(key);
                options.push(option);
            }
        });

        // Les alarmes enrichies peuvent porter leurs etats dans les correspondances RISA.
        (entry.risa_matches || []).forEach(match => {
            extractIsaStateOptions(match.InfosISA || match).forEach(option => {
                const key = `${option.code}:${option.label}:${option.value}`;
                if (!seen.has(key)) {
                    seen.add(key);
                    options.push(option);
                }
            });
        });
    });

    return options;
}

function extractEntriesFromData(data, isaType) {
    if (!data) return [];

    const entries = [];

    // Pour les alarmes (structure avec regroupements)
    if (data.regroupements) {
        data.regroupements.forEach((grp, groupIndex) => {
            // Ajouter le regroupement lui-même
            entries.push({
                id: normalizeIsaItemId(grp.id, `regroupement_${entries.length}`),
                libelle8: grp.libellecourt,
                libelle16: grp.libellecourt,
                type: 'regroupement',
                niveau: grp.niveauregroupement,
                ldgrp: grp.ldgrp,
                entrees_count: grp.entrees?.length || 0,
                allowed_states: extractAlarmGroupStateOptions(grp)
            });

            // Les alarmes enrichies peuvent porter les etats ISA au niveau des
            // entrees ou de leurs risa_matches. Ces lignes completent les
            // regroupements pour permettre un choix d'etat fin dans l'editeur.
            (grp.entrees || []).forEach((entry, entryIndex) => {
                const directItem = buildIsaPickerItem(
                    entry,
                    `${grp.id || groupIndex}_entree_${entryIndex}`
                );

                if (directItem.libelle8 || directItem.libelle16) {
                    entries.push({
                        ...directItem,
                        type: directItem.type || 'alarme',
                        regroupement_id: grp.id || '',
                        regroupement_label: grp.libellecourt || ''
                    });
                }

                (entry.risa_matches || []).forEach((match, matchIndex) => {
                    const matchItem = buildIsaPickerItem(
                        match,
                        `${grp.id || groupIndex}_entree_${entryIndex}_match_${matchIndex}`
                    );

                    if (matchItem.libelle8 || matchItem.libelle16) {
                        entries.push({
                            ...matchItem,
                            type: matchItem.type || 'risa_match',
                            regroupement_id: grp.id || '',
                            regroupement_label: grp.libellecourt || ''
                        });
                    }
                });
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

            const rawId = entry.UniqueID !== undefined && entry.UniqueID !== null && entry.UniqueID !== ''
                ? entry.UniqueID
                : entry.id;

            entries.push({
                id: normalizeIsaItemId(rawId, `entry_${entries.length}`),
                libelle8: libelle8,
                libelle16: libelle16,
                type: entryType,
                ied: iedType,
                ld: ldInst,
                idrc: entry['ISA.IDRC'] || entry['ISA.Gen.IDRC'] || '',
                allowed_states: extractIsaStateOptions(entry)
            });
        });
    }

    // Si structure index plate (comme dans RISA)
    if (data.index && typeof data.index === 'object') {
        Object.entries(data.index).forEach(([key, value]) => {
            const hasUniqueId = value?.UniqueID !== undefined && value.UniqueID !== null && value.UniqueID !== '';
            if (value && typeof value === 'object' && hasUniqueId) {
                entries.push({
                    id: normalizeIsaItemId(value.UniqueID, key),
                    libelle8: value.Libelle8 || key,
                    libelle16: value.Libelle16 || '',
                    type: value.InfosISA?.['ISA.type'] || 'entry',
                    ied: value.IED || '',
                    ld: value.LD || '',
                    allowed_states: extractIsaStateOptions(value.InfosISA || value)
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
                        <strong id="isa-picker-count">0</strong> ajout(s) dans le test
                    </span>
                    <div class="isa-popup-actions">
                        <button class="btn btn-secondary" onclick="closeIsaPicker()">Fermer</button>
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
        onConfirm: onConfirm,
        addedCount: 0
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
            normalizeIsaItemId(item.id).toLowerCase().includes(q)
        );
    }

    renderIsaItems();
}

/**
 * Recherche les occurrences deja presentes dans le test pour un couple
 * (identifiant ISA, libelle d'etat). Renvoie la liste des entrees existantes,
 * ce qui permet d'afficher un badge "Etape N" ou "Ajoute" a cote du bouton
 * d'etat correspondant dans la modale ISA picker.
 *
 * @param {string} type Type d'info courant (cde / alarmes / tcd).
 * @param {string} isaId Identifiant ISA de l'item visualise.
 * @param {string} stateLabel Libelle de l'etat associe au bouton.
 * @returns {Array<object>} Liste des info-items deja ajoutes correspondants.
 */
function findExistingInfosForState(type, isaId, stateLabel) {
    const test = window.currentTest || {};
    const items = Array.isArray(test[type]) ? test[type] : [];
    const normalizedIsaId = String(isaId || '').trim();
    const normalizedState = String(stateLabel || '').trim().toUpperCase();

    return items.filter(info => {
        const matchIsa = String(info.isa_id || '').trim() === normalizedIsaId;
        const matchState = String(info.state || '').trim().toUpperCase() === normalizedState;
        return matchIsa && matchState;
    });
}

/**
 * Construit le badge d'avertissement affiche pres d'un bouton d'etat de la
 * modale ISA picker. Il sert de retour visuel immediat pour signaler que la
 * combinaison item+etat est deja presente dans le test, et indiquer (si la
 * liaison existe) le numero de l'etape associee.
 *
 * @param {string} type Type d'info (cde / alarmes / tcd).
 * @param {string} isaId Identifiant ISA de l'item.
 * @param {string} stateLabel Libelle de l'etat (ou chaine vide pour "sans etat").
 * @returns {string} HTML du badge ou chaine vide si aucune correspondance.
 */
function buildIsaPickerStateBadge(type, isaId, stateLabel) {
    const matches = findExistingInfosForState(type, isaId, stateLabel);

    if (!matches.length) {
        return '';
    }

    // On privilegie l'affichage du numero d'etape lie a la premiere occurrence
    // associee a une etape, sinon on signale simplement que l'item est ajoute.
    const steps = Array.isArray(window.currentTest?.steps) ? window.currentTest.steps : [];
    const linkedNumbers = matches
        .map(info => steps.find(step => step.id === info.step_id)?.number)
        .filter(Boolean);

    if (linkedNumbers.length) {
        // Si plusieurs etapes sont liees on les concatene pour rester lisible.
        const uniqueNumbers = [...new Set(linkedNumbers)].sort((a, b) => a - b);
        const labelText = uniqueNumbers.length === 1
            ? `Etape ${uniqueNumbers[0]}`
            : `Etapes ${uniqueNumbers.join(', ')}`;
        return `<span class="isa-state-badge isa-state-badge-step" title="Deja present dans le test">${escapeHtml(labelText)}</span>`;
    }

    // Aucun rattachement explicite a une etape, on affiche juste "Ajoute(s)".
    const countLabel = matches.length > 1 ? `${matches.length} ajouts` : 'Ajoute';
    return `<span class="isa-state-badge isa-state-badge-added" title="Deja present dans le test">${escapeHtml(countLabel)}</span>`;
}

/**
 * Affiche la liste des items
 */
function renderIsaStateButtons(item, itemId) {
    const states = Array.isArray(item.allowed_states) ? item.allowed_states : [];
    const type = pickerState.type;
    const isaId = item.id || itemId;

    if (!states.length) {
        // Cas particulier : item sans etat predefini, on propose "Ajouter sans etat"
        // et on affiche un badge "Ajoute" si un item identique sans etat existe deja.
        const badgeHtml = buildIsaPickerStateBadge(type, isaId, '');
        return `
            <div class="item-states">
                <div class="isa-state-cell">
                    <button type="button"
                        class="isa-state-button is-empty-state"
                        onclick="addIsaItemState('${escapeJsString(itemId)}', -1); event.stopPropagation();">
                        Ajouter sans etat
                    </button>
                    ${badgeHtml}
                </div>
            </div>
        `;
    }

    const buttons = states.map((state, index) => {
        const stateLabel = state.label || state.code || 'Etat';
        const safeLabel = escapeHtml(stateLabel);
        const title = state.value
            ? ` title="${escapeHtml(state.source || state.code)} : ${escapeHtml(state.value)}"`
            : '';
        // Badge construit avec le libelle reel d'etat (state.label) car c'est
        // ce libelle qui est stocke dans info.state cote test-editor.
        const badgeHtml = buildIsaPickerStateBadge(type, isaId, stateLabel);
        return `
            <div class="isa-state-cell">
                <button type="button"
                    class="isa-state-button"
                    onclick="addIsaItemState('${escapeJsString(itemId)}', ${index}); event.stopPropagation();"${title}>
                    ${safeLabel}
                </button>
                ${badgeHtml}
            </div>
        `;
    }).join('');

    return `<div class="item-states">${buttons}</div>`;
}

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
        const itemId = normalizeIsaItemId(item.id);

        const metaHtml = [];
        if (item.type) metaHtml.push(`<span>${item.type}</span>`);
        if (item.niveau) metaHtml.push(`<span>${item.niveau}</span>`);
        if (item.ied) metaHtml.push(`<span>IED: ${item.ied}</span>`);
        if (item.regroupement_label) metaHtml.push(`<span>Regroupement: ${escapeHtml(item.regroupement_label)}</span>`);
        if (item.entrees_count) metaHtml.push(`<span>${item.entrees_count} entrees</span>`);
        const statesHtml = renderIsaStateButtons(item, itemId);

        // Le bloc "item-states" est sorti du conteneur item-info pour devenir
        // un sibling direct : il s'affiche sur la droite de la ligne via flex,
        // ce qui exploite mieux la largeur disponible de la modale.
        return `
            <div class="isa-popup-item">
                <div class="item-info">
                    <div class="item-libelle">${escapeHtml(item.libelle8 || itemId)}</div>
                    ${item.libelle16 ? `<div class="item-libelle16">${escapeHtml(item.libelle16)}</div>` : ''}
                    ${metaHtml.length ? `<div class="item-meta">${metaHtml.join('')}</div>` : ''}
                </div>
                ${statesHtml}
            </div>
        `;
    }).join('');

    content.innerHTML = `<div class="isa-popup-list">${itemsHtml}</div>`;
}

function addIsaItemState(itemId, stateIndex) {
    const normalizedItemId = normalizeIsaItemId(itemId);
    const item = pickerState.allItems.find(candidate =>
        normalizeIsaItemId(candidate.id) === normalizedItemId
    );

    if (!item) {
        console.warn(`[ISA][Picker] Item introuvable pour l'identifiant ${normalizedItemId}`);
        return;
    }

    const states = Array.isArray(item.allowed_states) ? item.allowed_states : [];
    const selectedState = states[stateIndex] || null;

    if (pickerState.onConfirm) {
        pickerState.onConfirm([{
            ...item,
            selected_state: selectedState
        }]);
    }

    pickerState.addedCount += 1;
    document.getElementById('isa-picker-count').textContent = pickerState.addedCount;

    // Re-render de la liste pour rafraichir les badges "Ajoute" / "Etape N" :
    // l'ajout vient juste d'enrichir window.currentTest, le badge associe
    // doit donc apparaitre immediatement a cote du bouton declenche.
    renderIsaItems();
}

/**
 * Toggle la sélection d'un item
 */
function toggleIsaItem(itemId) {
    const normalizedItemId = normalizeIsaItemId(itemId);

    if (pickerState.selectedItems.has(normalizedItemId)) {
        pickerState.selectedItems.delete(normalizedItemId);
    } else {
        pickerState.selectedItems.add(normalizedItemId);
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
        pickerState.selectedItems.has(normalizeIsaItemId(item.id))
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

/**
 * Echappe une valeur inseree dans un handler onclick.
 */
function escapeJsString(text) {
    return String(text)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
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
    const selectedState = isaItem.selected_state || null;

    if (typeof addInfo !== 'function') {
        console.error('[ISA][Picker] Fonction addInfo indisponible');
        return;
    }

    // Creer l'item via la logique standard pour conserver un seul chemin
    // d'ajout, que l'information vienne de la base ISA ou d'une saisie manuelle.
    addInfo(type, label, {
        name: isaItem.libelle8 || isaItem.id || '',
        state: selectedState?.label || '',
        isa_id: isaItem.id || '',
        libelle16: isaItem.libelle16 || '',
        allowed_states: isaItem.allowed_states || [],
        state_code: selectedState?.code || '',
        state_value: selectedState?.value || '',
        state_source: selectedState?.source || ''
    });
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
window.addIsaItemState = addIsaItemState;
window.confirmIsaSelection = confirmIsaSelection;
window.openCDEPicker = openCDEPicker;
window.openAlarmesPicker = openAlarmesPicker;
window.openTCDPicker = openTCDPicker;
