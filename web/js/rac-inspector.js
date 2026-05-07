// web/js/rac-inspector.js
// ============================================================================
// Module : Inspecteur RAC
//
// Responsabilites :
//   - charger le payload d'inspection JSON oriente IHM ;
//   - afficher une vue type "borniers" inspiree de R#SCD ;
//   - afficher le detail complet de la liaison selectionnee ;
//   - proposer un tableau de suivi pour choisir l'information a verifier.
//
// Ce module reste purement frontal. Toute la logique metier de calcul de
// statut, de regroupement et d'enrichissement des records reste cote Python.
// ============================================================================

"use strict";

const racInspectorState = {
    activeRacId: null,
    activeGroupId: "",
    payload: null,
    selectedTrackId: null,
    displayMode: "schema",
    statusFilter: "all",
    searchText: "",
    draftsByTrackId: {},
    expandedDraftStepKey: null,
    selectedEdgeId: null,
    expandedGroups: new Set(),
    expandedBlocks: new Set(),
};

function getActiveRacInspectionId() {
    return racInspectorState.activeRacId;
}

function getActiveRacInspectionGroupId() {
    return racInspectorState.activeGroupId;
}

function resetRacInspectorView() {
    const root = document.getElementById("rac-inspector-root");
    if (!root) return;

    root.innerHTML = `
        <div class="rbd-rac-empty-state">
            <div class="rbd-rac-empty-icon">🧭</div>
            <div>
                <h4>Inspection RAC inactive</h4>
                <p>Selectionnez une version RAC dans le catalogue pour afficher la vue JSON detaillee.</p>
            </div>
        </div>
    `;
}

function clearRacInspectionView() {
    racInspectorState.activeRacId = null;
    racInspectorState.activeGroupId = "";
    racInspectorState.payload = null;
    racInspectorState.selectedTrackId = null;
    racInspectorState.displayMode = "schema";
    racInspectorState.statusFilter = "all";
    racInspectorState.searchText = "";
    racInspectorState.draftsByTrackId = {};
    racInspectorState.expandedDraftStepKey = null;
    racInspectorState.selectedEdgeId = null;
    racInspectorState.expandedGroups = new Set();
    racInspectorState.expandedBlocks = new Set();

    resetRacInspectorView();
}

async function loadRacInspectionView(racId, options = {}) {
    if (!racId) return;

    const root = document.getElementById("rac-inspector-root");
    if (!root) return;

    root.innerHTML = `
        <div class="rbd-rac-empty-state is-loading">
            <div class="rbd-rac-empty-icon">⏳</div>
            <div>
                <h4>Chargement de l'inspection RAC</h4>
                <p>Analyse du JSON normalise et preparation de la vue de verification...</p>
            </div>
        </div>
    `;

    try {
        const payload = await apiRac.getInspection(racId);
        const records = Array.isArray(payload?.records) ? payload.records : [];

        racInspectorState.payload = payload || null;
        racInspectorState.activeRacId = payload?.source?.rac_id || racId;
        racInspectorState.activeGroupId = options.groupId || "";
        racInspectorState.displayMode = "schema";
        racInspectorState.statusFilter = "all";
        racInspectorState.searchText = "";
        racInspectorState.draftsByTrackId = {};
        racInspectorState.expandedDraftStepKey = null;
        racInspectorState.selectedEdgeId = null;

        const groups = Array.isArray(payload?.board_schema?.groups) ? payload.board_schema.groups : [];
        racInspectorState.expandedGroups = new Set();
        racInspectorState.expandedBlocks = new Set();

        if (groups.length > 0) {
            racInspectorState.expandedGroups.add(groups[0].group_key);
            const firstBlock = Array.isArray(groups[0].blocks) ? groups[0].blocks[0] : null;
            if (firstBlock?.block_key) {
                racInspectorState.expandedBlocks.add(buildRacBlockStateKey(groups[0].group_key, firstBlock.block_key));
            }
        }

        const firstRecord = records[0] || null;
        racInspectorState.selectedTrackId = firstRecord?.track_id || null;

        if (firstRecord) {
            expandRacInspectorSelection(firstRecord);
        }

        renderRacInspectionView();

        const inspectionSummary = payload?.inspection_summary || {};
        showToast(
            `Inspection RAC chargee — ${inspectionSummary.record_count || 0} liaison(s), ${inspectionSummary.complete_count || 0} complete(s)`,
            "success",
            3200
        );
    } catch (err) {
        console.error("[RAC][Inspector] Erreur chargement:", err);
        root.innerHTML = `
            <div class="rbd-rac-empty-state is-error">
                <div class="rbd-rac-empty-icon">⚠️</div>
                <div>
                    <h4>Impossible de charger l'inspection RAC</h4>
                    <p>${_escHtml(err?.message || "Erreur inconnue")}</p>
                </div>
            </div>
        `;
        showToast("Impossible de charger le JSON d'inspection RAC", "error");
    }
}

function buildRacBlockStateKey(groupKey, blockKey) {
    return `${groupKey}::${blockKey}`;
}

function getRacInspectionSelectedRecord() {
    const records = Array.isArray(racInspectorState.payload?.records) ? racInspectorState.payload.records : [];
    return records.find((record) => record.track_id === racInspectorState.selectedTrackId) || null;
}

function expandRacInspectorSelection(record) {
    if (!record) return;

    const groupKey = record.equipment_family || "SANS_EQUIPEMENT";
    const blockKey = record.block_label || "Sans chemin intermediaire";
    racInspectorState.expandedGroups.add(groupKey);
    racInspectorState.expandedBlocks.add(buildRacBlockStateKey(groupKey, blockKey));
}

function setRacInspectionSelection(trackId) {
    if (!trackId) return;

    const records = Array.isArray(racInspectorState.payload?.records) ? racInspectorState.payload.records : [];
    const record = records.find((item) => item.track_id === trackId);
    if (!record) return;

    racInspectorState.selectedTrackId = trackId;
    racInspectorState.expandedDraftStepKey = null;
    racInspectorState.selectedEdgeId = null;
    expandRacInspectorSelection(record);
    renderRacInspectionView();
}

function updateRacInspectionDisplayMode(mode) {
    const normalized = mode === "table" ? "table" : "schema";
    racInspectorState.displayMode = normalized;
    renderRacInspectionView();
}

function toggleRacInspectionGroup(groupKey) {
    if (!groupKey) return;

    if (racInspectorState.expandedGroups.has(groupKey)) {
        racInspectorState.expandedGroups.delete(groupKey);
    } else {
        racInspectorState.expandedGroups.add(groupKey);
    }

    renderRacInspectionView();
}

function toggleRacInspectionBlock(groupKey, blockKey) {
    if (!groupKey || !blockKey) return;

    const stateKey = buildRacBlockStateKey(groupKey, blockKey);
    if (racInspectorState.expandedBlocks.has(stateKey)) {
        racInspectorState.expandedBlocks.delete(stateKey);
    } else {
        racInspectorState.expandedBlocks.add(stateKey);
        racInspectorState.expandedGroups.add(groupKey);
    }

    renderRacInspectionView();
}

function updateRacInspectionSearch(value) {
    racInspectorState.searchText = String(value || "").trim().toLowerCase();
    syncRacInspectorSelectionWithFilters();
    renderRacInspectionView();
}

function updateRacInspectionStatusFilter(value) {
    racInspectorState.statusFilter = String(value || "all");
    syncRacInspectorSelectionWithFilters();
    renderRacInspectionView();
}

function resetRacInspectionFilters() {
    racInspectorState.searchText = "";
    racInspectorState.statusFilter = "all";
    syncRacInspectorSelectionWithFilters();
    renderRacInspectionView();
}

function syncRacInspectorSelectionWithFilters() {
    const filteredRecords = getFilteredRacInspectionRecords();
    if (filteredRecords.length === 0) {
        return;
    }

    const currentInFilter = filteredRecords.some((record) => record.track_id === racInspectorState.selectedTrackId);
    if (!currentInFilter) {
        racInspectorState.selectedTrackId = filteredRecords[0].track_id;
        expandRacInspectorSelection(filteredRecords[0]);
    }
}

function getFilteredRacInspectionRecords() {
    const records = Array.isArray(racInspectorState.payload?.records) ? racInspectorState.payload.records : [];
    const statusFilter = racInspectorState.statusFilter;
    const searchText = racInspectorState.searchText;

    return records.filter((record) => {
        if (statusFilter !== "all" && record?.status?.code !== statusFilter) {
            return false;
        }

        if (!searchText) {
            return true;
        }

        const embases = formatRacEmbases(record?.intermediate_path?.embases || []).join(" ");
        const connections = Array.isArray(record?.equipment_connections)
            ? record.equipment_connections.map((connection) => [
                connection.equipment_type || "",
                connection.vendor || "",
                connection.card_number || "",
                connection.card_terminal || "",
            ].join(" ")).join(" ")
            : "";

        const haystack = [
            record.signal_label,
            record.signal_type,
            record.board_name,
            record.terminal_number,
            record.source_label,
            record.female_socket,
            record.socket_terminal,
            record.equipment_family,
            record.block_label,
            (record.target_equipment_types || []).join(" "),
            embases,
            connections,
            record.revision_tag,
        ].join(" ").toLowerCase();

        return haystack.includes(searchText);
    });
}

function renderRacInspectionView() {
    const root = document.getElementById("rac-inspector-root");
    if (!root) return;

    const payload = racInspectorState.payload;
    if (!payload) {
        resetRacInspectorView();
        return;
    }

    const selectedRecord = getRacInspectionSelectedRecord();
    const filteredRecords = getFilteredRacInspectionRecords();

    root.innerHTML = `
        <div class="rbd-rac-inspector">
            <section class="rbd-rac-panel">
                <div class="rbd-rac-panel-header">
                    <div>
                        <h4>Detail de la liaison selectionnee</h4>
                        <p>Edition locale du chemin de liaison pour verifier, enrichir ou restructurer la lecture RAC.</p>
                    </div>
                </div>
                ${renderRacInspectionDetail(payload, selectedRecord)}
            </section>

            ${renderRacInspectionViewerPanel(payload, selectedRecord, filteredRecords)}
        </div>
    `;

    // Apres chaque rendu, recalcule la position des liens SVG du canvas en
    // tenant compte de la taille reelle des noeuds dans le DOM. Sans cet appel
    // les aretes restent vides puisqu'elles sont generees apres mesure.
    if (selectedRecord?.track_id && racInspectorState.draftsByTrackId[selectedRecord.track_id]) {
        // requestAnimationFrame garantit que la mesure se fait apres layout.
        window.requestAnimationFrame(() => updateRacCanvasEdges(selectedRecord.track_id));
    }
}

function renderRacInspectionViewerPanel(payload, selectedRecord, filteredRecords) {
    const totalRecords = Array.isArray(payload?.records) ? payload.records.length : 0;
    const isTableMode = racInspectorState.displayMode === "table";

    return `
        <section class="rbd-rac-panel rbd-rac-viewer-panel">
            <div class="rscd-dido-header">
                <div class="rbd-rac-panel-header rbd-rac-panel-header-tight">
                    <div>
                        <h4>${isTableMode ? "Tableau de suivi des informations" : "Vue borniers"}</h4>
                        <p>${isTableMode ? "Selectionnez une liaison a verifier dans le tableau detaille." : "Representation automatique des borniers RAC, calquee sur la vue de reference R#SCD."}</p>
                    </div>
                </div>

                <div class="rscd-dido-top-actions rbd-rac-view-toggle-row">
                    <span class="rscd-dido-info-pill">
                        <span class="rscd-dido-info-icon">🧩</span>
                        ${Number(payload?.inspection_summary?.board_count || 0)} borniers
                    </span>
                    <span class="rscd-dido-info-pill">
                        <span class="rscd-dido-info-icon">📎</span>
                        ${filteredRecords.length} / ${totalRecords} liaisons visibles
                    </span>
                    <button
                        class="rscd-dido-view-toggle-btn ${!isTableMode ? "is-schema" : ""}"
                        type="button"
                        onclick="updateRacInspectionDisplayMode('schema')"
                    >
                        Vue borniers
                    </button>
                    <button
                        class="rscd-dido-view-toggle-btn ${isTableMode ? "is-table" : ""}"
                        type="button"
                        onclick="updateRacInspectionDisplayMode('table')"
                    >
                        Tableau de suivi
                    </button>
                </div>
            </div>

            ${isTableMode
                ? `${renderRacInspectionFilters()}${renderRacInspectionTable(filteredRecords, selectedRecord)}`
                : renderRacBoardSchema(payload, selectedRecord)}
        </section>
    `;
}

function renderRacKpiCard(label, value, extraClass = "") {
    return `
        <div class="rbd-rac-kpi-card ${extraClass}">
            <span class="rbd-rac-kpi-label">${_escHtml(String(label || ""))}</span>
            <strong class="rbd-rac-kpi-value">${_escHtml(String(value ?? "—"))}</strong>
        </div>
    `;
}

function openRacModal(modalId, title, bodyHtml, options = {}) {
    const existingModal = document.getElementById(modalId);
    if (existingModal) {
        existingModal.remove();
    }

    const modalClass = options.large ? "modal-content rbd-rac-modal-content is-large" : "modal-content rbd-rac-modal-content";
    const footerHtml = options.hideFooter
        ? ""
        : `
            <div class="modal-footer">
                <button class="btn btn-secondary" type="button" onclick="closeRacModal()">Fermer</button>
            </div>
        `;

    document.body.insertAdjacentHTML(
        "beforeend",
        `
            <div class="modal-overlay" id="${modalId}" onclick="closeRacModal(event)">
                <div class="${modalClass}" onclick="event.stopPropagation()">
                    <div class="modal-header">
                        <h3>${_escHtml(title)}</h3>
                        <button class="btn-close" type="button" onclick="closeRacModal()">✕</button>
                    </div>
                    <div class="modal-body">
                        ${bodyHtml}
                    </div>
                    ${footerHtml}
                </div>
            </div>
        `
    );
}

function closeRacModal(event) {
    if (event && !event.target.classList.contains("modal-overlay")) {
        return;
    }

    document.querySelectorAll(".modal-overlay[id^='rac-']").forEach((modal) => modal.remove());
}

function showRacInspectionContextModal() {
    const payload = racInspectorState.payload;
    if (!payload) {
        showToast("Le contexte RAC n'est pas encore charge.", "warning");
        return;
    }

    const source = payload.source || {};
    const summary = payload.summary || {};
    const inspectionSummary = payload.inspection_summary || {};

    openRacModal(
        "rac-context-modal",
        "Contexte RAC",
        `
            <div class="rbd-rac-kpi-grid">
                ${renderRacKpiCard("Fichier", source.filename || "—")}
                ${renderRacKpiCard("Categorie", source.category_name || source.category_id || "—")}
                ${renderRacKpiCard("Version", source.version || "—")}
                ${renderRacKpiCard("Onglet", source.sheet_name || "—")}
                ${renderRacKpiCard("Lignes parsees", summary.rows_parsed || 0)}
                ${renderRacKpiCard("Groupes equipement", inspectionSummary.group_count || 0)}
                ${renderRacKpiCard("Borniers", inspectionSummary.board_count || 0)}
                ${renderRacKpiCard("Complets", inspectionSummary.complete_count || 0, "is-success")}
                ${renderRacKpiCard("A verifier", inspectionSummary.to_check_count || 0, "is-warning")}
                ${renderRacKpiCard("Non traites", inspectionSummary.non_treated_count || 0, "is-warning")}
                ${renderRacKpiCard("Sans terminaison", inspectionSummary.without_connection_count || 0)}
                ${renderRacKpiCard("Importe le", source.imported_at || "—")}
            </div>
        `,
        { large: true }
    );
}

function showRacRawTraceModal(trackId) {
    const records = Array.isArray(racInspectorState.payload?.records) ? racInspectorState.payload.records : [];
    const record = records.find((item) => item.track_id === (trackId || racInspectorState.selectedTrackId));
    if (!record) {
        showToast("Aucune trace brute disponible pour cette liaison.", "warning");
        return;
    }

    const rawEntries = Object.entries(record.raw || {});
    const bodyHtml = rawEntries.length > 0
        ? `
            <div class="rbd-rac-table-wrap">
                <table class="rbd-table">
                    <thead>
                        <tr>
                            <th>Colonne</th>
                            <th>Valeur detectee</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rawEntries.map(([column, value]) => `
                            <tr>
                                <td>${_escHtml(column)}</td>
                                <td>${_escHtml(Array.isArray(value) ? value.join(", ") : String(value ?? "")) || "—"}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `
        : `<p class="muted">Aucune trace brute n'est disponible pour cette ligne.</p>`;

    openRacModal(
        "rac-raw-trace-modal",
        `Trace brute du parser — ${record.track_id || "liaison"}`,
        bodyHtml,
        { large: true }
    );
}

function renderRacBoardSchema(payload, selectedRecord) {
    const groups = Array.isArray(payload?.board_schema?.groups) ? payload.board_schema.groups : [];
    if (groups.length === 0) {
        return `
            <div class="rbd-rac-empty-state compact">
                <div class="rbd-rac-empty-icon">🪫</div>
                <div>
                    <h4>Aucun bornier exploitable</h4>
                    <p>Le JSON parse ne contient pas de regroupement de type bornier.</p>
                </div>
            </div>
        `;
    }

    return `
        <div class="rbd-rac-board-tree">
            ${groups.map((group) => renderRacBoardGroup(group, selectedRecord)).join("")}
        </div>
    `;
}

function renderRacBoardGroup(group, selectedRecord) {
    const groupKey = group?.group_key || "";
    const isOpen = racInspectorState.expandedGroups.has(groupKey);
    const groupBlocks = Array.isArray(group?.blocks) ? group.blocks : [];

    return `
        <div class="rscd-dm-tranche-group ${isOpen ? "is-open" : ""}">
            <button class="rscd-dm-tranche-header" type="button" onclick="toggleRacInspectionGroup('${escapeJsString(groupKey)}')">
                <div class="rscd-dm-tranche-title">
                    <span class="rscd-dm-tranche-chevron">▸</span>
                    <span class="rscd-dm-tranche-name">${_escHtml(group?.group_label || groupKey || "Sans groupe")}</span>
                </div>
                <div class="rscd-dm-tranche-badges">
                    <span class="rscd-dm-badge">${Number(group?.record_count || 0)} liaison(s)</span>
                    <span class="rscd-dm-badge">${Number(group?.board_count || 0)} bornier(s)</span>
                </div>
            </button>
            <div class="rscd-dm-tranche-body">
                ${groupBlocks.map((block) => renderRacBoardBlock(groupKey, block, selectedRecord)).join("")}
            </div>
        </div>
    `;
}

function renderRacBoardBlock(groupKey, block, selectedRecord) {
    const blockKey = block?.block_key || "";
    const stateKey = buildRacBlockStateKey(groupKey, blockKey);
    const isOpen = racInspectorState.expandedBlocks.has(stateKey);
    const boards = Array.isArray(block?.boards) ? block.boards : [];

    return `
        <div class="rbd-rac-block ${isOpen ? "is-open" : ""}">
            <button class="rbd-rac-block-header" type="button" onclick="toggleRacInspectionBlock('${escapeJsString(groupKey)}', '${escapeJsString(blockKey)}')">
                <div>
                    <strong>${_escHtml(block?.block_label || blockKey || "Sans chemin")}</strong>
                    <p>${Number(block?.record_count || 0)} liaison(s) rattachee(s)</p>
                </div>
                <span class="rbd-rac-block-counter">${Number(block?.board_count || 0)} bornier(s)</span>
            </button>
            <div class="rbd-rac-block-body">
                ${boards.map((board) => renderRacBoardCard(board, selectedRecord)).join("")}
            </div>
        </div>
    `;
}

function renderRacBoardCard(board, selectedRecord) {
    const entries = Array.isArray(board?.entries) ? board.entries : [];

    return `
        <article class="rscd-dido-board-card">
            <div class="rscd-dido-board-card-head">
                <div>
                    <h5 class="rscd-dido-board-title">${_escHtml(board?.board_name || "Sans bornier")}</h5>
                    <p class="rscd-dido-board-subtitle">${Number(board?.record_count || 0)} entree(s) detectee(s)</p>
                </div>
            </div>

            <div class="rscd-dido-board-list">
                ${entries.map((entry) => renderRacBoardEntry(entry, selectedRecord)).join("")}
            </div>
        </article>
    `;
}

function renderRacBoardEntry(entry, selectedRecord) {
    const isSelected = entry?.track_id && selectedRecord?.track_id === entry.track_id;
    const statusCode = entry?.status?.code || "sans_terminaison";
    const statusLabel = entry?.status?.label || "Sans terminaison";
    const signalType = String(entry?.signal_type || "").trim().toLowerCase();
    const iconClass = signalType.startsWith("do") ? "do" : (signalType.startsWith("di") ? "di" : "generic");

    return `
        <button
            type="button"
            class="rscd-dido-board-entry ${isSelected ? "is-selected" : ""} ${statusCode === "complet" ? "is-complete" : ""}"
            onclick="setRacInspectionSelection('${escapeJsString(entry?.track_id || "")}')"
        >
            <span class="rscd-dido-entry-icon has-borner ${iconClass}">${_escHtml(entry?.terminal_number || "?")}</span>
            <span class="rscd-dido-entry-main">
                <span class="rscd-dido-entry-title">${_escHtml(entry?.info_label || "Signal sans libelle")}</span>
                <span class="rscd-dido-entry-subtitle">${_escHtml(entry?.signal_type || "Type non renseigne")} • ${_escHtml(entry?.ref_label || "—")}</span>
            </span>
            <span class="rbd-rac-entry-status is-${_escHtml(String(entry?.status?.tone || "neutral"))}">${_escHtml(statusLabel)}</span>
        </button>
    `;
}

function formatRacEmbases(embases) {
    if (!Array.isArray(embases) || embases.length === 0) {
        return [];
    }

    return embases.map((embase) => {
        if (!embase || typeof embase !== "object") {
            return String(embase || "").trim();
        }

        const parts = [];
        if (embase.name) {
            parts.push(String(embase.name).trim());
        }
        if (embase.position) {
            parts.push(`pos. ${String(embase.position).trim()}`);
        }
        if (embase.index) {
            parts.push(`index ${String(embase.index).trim()}`);
        }

        return parts.filter(Boolean).join(" • ");
    }).filter(Boolean);
}

function formatRacConnectionSummaries(connections) {
    if (!Array.isArray(connections) || connections.length === 0) {
        return [];
    }

    return connections.map((connection) => {
        const parts = [];
        if (connection.equipment_target || connection.equipment_type || connection.equipment_header) {
            parts.push(connection.equipment_target || connection.equipment_type || connection.equipment_header);
        }
        if (connection.card_number) {
            parts.push(`Carte ${connection.card_number}`);
        }
        if (connection.card_terminal) {
            parts.push(`Borne ${connection.card_terminal}`);
        }
        return parts.filter(Boolean).join(" • ");
    }).filter(Boolean);
}

// ============================================================================
// Editeur "canvas" du chemin de liaison
// ----------------------------------------------------------------------------
// Le chemin est modelise comme un graphe libre :
//   - chaque etape est un noeud ({ id, title, x, y, fields[] })
//   - chaque liaison est une arete ({ id, sourceNodeId, targetNodeId })
// L'utilisateur peut deplacer librement les noeuds dans la zone et tracer
// des liens en glissant depuis un point de connexion d'un noeud vers un
// autre. Les liens sont rendus en SVG par dessus la grille de fond.
// ============================================================================

// Dimensions par defaut d'un noeud (utilisees pour la mise en page initiale).
const RAC_CANVAS_NODE_WIDTH = 230;
const RAC_CANVAS_NODE_VSPACE = 60;

// Genere un identifiant simple pour les noeuds et les aretes.
function buildRacCanvasId(prefix) {
    return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// Construit le brouillon initial du graphe a partir d'un enregistrement RAC.
// Chaque concept metier devient un noeud autonome positionne en colonne.
function buildRacEditableDraft(record) {
    const terminalBoard = record?.terminal_board || {};
    const intermediatePath = record?.intermediate_path || {};
    const embases = Array.isArray(intermediatePath.embases) ? intermediatePath.embases : [];
    const embaseLabels = formatRacEmbases(embases);
    const targets = Array.isArray(record?.target_equipment_types) ? record.target_equipment_types : [];
    const connections = Array.isArray(record?.equipment_connections) ? record.equipment_connections : [];

    const nodes = [];
    const edges = [];

    // Construit le noeud "Bornier" qui represente le point d'entree de la liaison.
    const bornierNode = {
        id: buildRacCanvasId("node"),
        title: "Bornier",
        x: 40,
        y: 40,
        fields: [
            { label: "Nom bornier", value: terminalBoard.name || "" },
            { label: "Borne", value: terminalBoard.terminal || "" },
            { label: "Signal", value: record?.signal_label || "" },
            { label: "Type", value: terminalBoard.signal_type || "" },
            { label: "Polarite", value: terminalBoard.polarity_name || "" },
        ],
    };
    nodes.push(bornierNode);

    // Construit le noeud "Connecteur intermediaire" qui porte la donnee brute Y/Z/AA.
    const connecteurNode = {
        id: buildRacCanvasId("node"),
        title: "Connecteur intermediaire",
        x: 320,
        y: 40,
        fields: [
            { label: "Source", value: intermediatePath.source || "" },
            { label: "Connecteur brut", value: intermediatePath.female_socket || "" },
            { label: "Index", value: intermediatePath.socket_index || "" },
            { label: "Borne connecteur", value: intermediatePath.socket_terminal || "" },
        ],
    };
    nodes.push(connecteurNode);
    edges.push({
        id: buildRacCanvasId("edge"),
        sourceNodeId: bornierNode.id,
        targetNodeId: connecteurNode.id,
    });

    // Construit un noeud par connecteur resolu (ex : TOR1-SCU1, TOR1-SCU2).
    const resolvedNodes = [];
    const resolvedSources = embaseLabels.length > 0 ? embaseLabels : [""];
    resolvedSources.forEach((embase, index) => {
        const node = {
            id: buildRacCanvasId("node"),
            title: `Connecteur resolu ${index + 1}`,
            x: 600,
            y: 40 + index * (160 + RAC_CANVAS_NODE_VSPACE),
            fields: [
                { label: "Nom resolu", value: embase || "" },
                { label: "Equipement cible", value: targets[index] || "" },
            ],
        };
        resolvedNodes.push(node);
        nodes.push(node);
        edges.push({
            id: buildRacCanvasId("edge"),
            sourceNodeId: connecteurNode.id,
            targetNodeId: node.id,
        });
    });

    // Construit un noeud par terminaison equipement detectee.
    const terminationDescriptors = connections.length > 0
        ? connections.map((connection, index) => ({
            title: connection.equipment_target || `Terminaison ${index + 1}`,
            fields: [
                { label: "Equipement", value: connection.equipment_target || connection.equipment_type || connection.equipment_header || "" },
                { label: "Constructeur", value: connection.vendor || "" },
                { label: "Type carte", value: connection.card_type || "" },
                { label: "Carte", value: connection.card_number || "" },
                { label: "Borne carte", value: connection.card_terminal || "" },
            ],
        }))
        : (targets.length > 0
            ? targets.map((target, index) => ({
                title: target || `Terminaison ${index + 1}`,
                fields: [
                    { label: "Equipement", value: target || "" },
                    { label: "Reference", value: record?.socket_terminal || "" },
                ],
            }))
            : [{
                title: "Terminaison 1",
                fields: [{ label: "Reference", value: record?.socket_terminal || "" }],
            }]);

    terminationDescriptors.forEach((desc, index) => {
        const node = {
            id: buildRacCanvasId("node"),
            title: desc.title,
            x: 880,
            y: 40 + index * (200 + RAC_CANVAS_NODE_VSPACE),
            fields: desc.fields,
        };
        nodes.push(node);

        // Relie chaque terminaison au connecteur resolu correspondant si possible,
        // sinon directement au connecteur intermediaire pour eviter un noeud orphelin.
        const upstream = resolvedNodes[index] || resolvedNodes[0] || connecteurNode;
        edges.push({
            id: buildRacCanvasId("edge"),
            sourceNodeId: upstream.id,
            targetNodeId: node.id,
        });
    });

    return {
        trackId: record?.track_id || "",
        nodes,
        edges,
    };
}

// Recupere le brouillon courant pour une liaison, en le construisant si besoin.
function getRacEditableDraft(record) {
    if (!record?.track_id) {
        return null;
    }

    if (!racInspectorState.draftsByTrackId[record.track_id]) {
        racInspectorState.draftsByTrackId[record.track_id] = buildRacEditableDraft(record);
    }

    return racInspectorState.draftsByTrackId[record.track_id];
}

// ----------------------------------------------------------------------------
// Operations CRUD sur les noeuds et les aretes du brouillon.
// ----------------------------------------------------------------------------

function findRacDraftNode(trackId, nodeId) {
    const draft = racInspectorState.draftsByTrackId[trackId];
    if (!draft) return null;
    return draft.nodes.find((node) => node.id === nodeId) || null;
}

function findRacDraftEdge(trackId, edgeId) {
    const draft = racInspectorState.draftsByTrackId[trackId];
    if (!draft) return null;
    return draft.edges.find((edge) => edge.id === edgeId) || null;
}

function updateRacDraftNodeTitle(trackId, nodeId, value) {
    const node = findRacDraftNode(trackId, nodeId);
    if (!node) return;
    node.title = String(value || "");
    renderRacInspectionView();
}

function updateRacDraftNodeField(trackId, nodeId, fieldIndex, property, value) {
    const node = findRacDraftNode(trackId, nodeId);
    const field = node?.fields?.[fieldIndex];
    if (!field) return;
    field[property] = String(value || "");
    renderRacInspectionView();
}

function addRacDraftNodeField(trackId, nodeId) {
    const node = findRacDraftNode(trackId, nodeId);
    if (!node) return;
    node.fields = Array.isArray(node.fields) ? node.fields : [];
    node.fields.push({ label: "Champ", value: "" });
    renderRacInspectionView();
}

function removeRacDraftNodeField(trackId, nodeId, fieldIndex) {
    const node = findRacDraftNode(trackId, nodeId);
    if (!node || !Array.isArray(node.fields)) return;
    node.fields.splice(fieldIndex, 1);
    renderRacInspectionView();
}

function addRacDraftNode(trackId) {
    const draft = racInspectorState.draftsByTrackId[trackId];
    if (!draft) return;

    // Place le nouveau noeud en bas a droite de la zone existante pour eviter
    // un chevauchement immediat avec les noeuds deja en place.
    let maxX = 40;
    let maxY = 40;
    draft.nodes.forEach((node) => {
        if (node.x > maxX) maxX = node.x;
        if (node.y > maxY) maxY = node.y;
    });

    draft.nodes.push({
        id: buildRacCanvasId("node"),
        title: "Nouvelle etape",
        x: maxX + RAC_CANVAS_NODE_WIDTH + 30,
        y: maxY,
        fields: [{ label: "Champ", value: "" }],
    });

    renderRacInspectionView();
}

function duplicateRacDraftNode(trackId, nodeId) {
    const draft = racInspectorState.draftsByTrackId[trackId];
    const node = findRacDraftNode(trackId, nodeId);
    if (!draft || !node) return;

    const copy = JSON.parse(JSON.stringify(node));
    copy.id = buildRacCanvasId("node");
    copy.title = `${copy.title || "Etape"} (copie)`;
    copy.x = (node.x || 0) + 40;
    copy.y = (node.y || 0) + 40;

    draft.nodes.push(copy);
    renderRacInspectionView();
}

function removeRacDraftNode(trackId, nodeId) {
    const draft = racInspectorState.draftsByTrackId[trackId];
    if (!draft || draft.nodes.length <= 1) return;

    draft.nodes = draft.nodes.filter((node) => node.id !== nodeId);
    // Supprime aussi toutes les aretes connectees au noeud retire pour eviter
    // les liens orphelins qui ne pourraient plus etre relies dans le rendu.
    draft.edges = draft.edges.filter(
        (edge) => edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId
    );

    if (racInspectorState.selectedEdgeId && !findRacDraftEdge(trackId, racInspectorState.selectedEdgeId)) {
        racInspectorState.selectedEdgeId = null;
    }

    renderRacInspectionView();
}

function addRacDraftEdge(trackId, sourceNodeId, targetNodeId) {
    const draft = racInspectorState.draftsByTrackId[trackId];
    if (!draft || !sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) {
        return;
    }

    // Empeche la creation de doublons stricts pour garder le graphe lisible.
    const exists = draft.edges.some(
        (edge) => edge.sourceNodeId === sourceNodeId && edge.targetNodeId === targetNodeId
    );
    if (exists) return;

    draft.edges.push({
        id: buildRacCanvasId("edge"),
        sourceNodeId,
        targetNodeId,
    });

    renderRacInspectionView();
}

function removeRacDraftEdge(trackId, edgeId) {
    const draft = racInspectorState.draftsByTrackId[trackId];
    if (!draft) return;

    draft.edges = draft.edges.filter((edge) => edge.id !== edgeId);
    if (racInspectorState.selectedEdgeId === edgeId) {
        racInspectorState.selectedEdgeId = null;
    }
    renderRacInspectionView();
}

function selectRacDraftEdge(trackId, edgeId) {
    racInspectorState.selectedEdgeId = edgeId || null;
    renderRacInspectionView();
}

function clearRacDraftEdgeSelection() {
    if (racInspectorState.selectedEdgeId) {
        racInspectorState.selectedEdgeId = null;
        renderRacInspectionView();
    }
}

// ----------------------------------------------------------------------------
// Rendu HTML/SVG du canvas
// ----------------------------------------------------------------------------

function renderRacEditablePath(record) {
    const draft = getRacEditableDraft(record);
    if (!draft) {
        return `<p class="muted">Aucun chemin editable disponible.</p>`;
    }

    const trackIdAttr = _escHtml(draft.trackId);
    const nodesHtml = draft.nodes.map((node) => renderRacCanvasNode(draft.trackId, node)).join("");

    return `
        <div class="rbd-rac-canvas-toolbar">
            <span class="rbd-rac-canvas-hint">
                Glissez les etapes pour les positionner. Reliez deux etapes en glissant
                d'un point de droite (sortie) vers un point de gauche (entree).
            </span>
            <button class="btn btn-secondary btn-small" type="button"
                onclick="addRacDraftNode('${escapeJsString(draft.trackId)}')">
                + Nouvelle etape
            </button>
        </div>
        <div
            class="rbd-rac-canvas"
            data-canvas-id="${trackIdAttr}"
            onmousedown="handleRacCanvasBackgroundMouseDown(event, '${escapeJsString(draft.trackId)}')"
        >
            <svg class="rbd-rac-canvas-svg" data-canvas-svg="${trackIdAttr}"></svg>
            <div class="rbd-rac-canvas-nodes" data-canvas-nodes="${trackIdAttr}">
                ${nodesHtml}
            </div>
            <div class="rbd-rac-canvas-popover" data-canvas-popover="${trackIdAttr}" hidden></div>
        </div>
    `;
}

// Rendu d'un noeud unique (carte deplacable). Le drag & drop est attache via
// onmousedown au conteneur. Les inputs et boutons internes sont exclus du
// drag par le filtre de la fonction startRacNodeDrag.
function renderRacCanvasNode(trackId, node) {
    const fields = Array.isArray(node.fields) ? node.fields : [];

    return `
        <article
            class="rbd-rac-canvas-node"
            data-node-id="${_escHtml(node.id)}"
            style="left:${Number(node.x) || 0}px; top:${Number(node.y) || 0}px; width:${RAC_CANVAS_NODE_WIDTH}px;"
            onmousedown="startRacNodeDrag(event, '${escapeJsString(trackId)}', '${escapeJsString(node.id)}')"
        >
            <header class="rbd-rac-canvas-node-header">
                <input
                    class="rbd-form-input rbd-rac-inline-input"
                    type="text"
                    value="${_escHtml(node.title || "") }"
                    oninput="updateRacDraftNodeTitle('${escapeJsString(trackId)}', '${escapeJsString(node.id)}', this.value)"
                />
                <div class="rbd-rac-canvas-node-actions">
                    <button class="btn btn-secondary btn-small" type="button"
                        onclick="duplicateRacDraftNode('${escapeJsString(trackId)}', '${escapeJsString(node.id)}')"
                        title="Dupliquer ce noeud">⎘</button>
                    <button class="btn btn-secondary btn-small" type="button"
                        onclick="removeRacDraftNode('${escapeJsString(trackId)}', '${escapeJsString(node.id)}')"
                        title="Supprimer ce noeud">×</button>
                </div>
            </header>

            <div class="rbd-rac-canvas-node-body">
                ${fields.map((field, fieldIndex) => `
                    <div class="rbd-rac-field-row">
                        <input
                            class="rbd-form-input"
                            type="text"
                            value="${_escHtml(field?.label || "") }"
                            placeholder="Nom du champ"
                            oninput="updateRacDraftNodeField('${escapeJsString(trackId)}', '${escapeJsString(node.id)}', ${fieldIndex}, 'label', this.value)"
                        />
                        <input
                            class="rbd-form-input"
                            type="text"
                            value="${_escHtml(field?.value || "") }"
                            placeholder="Valeur"
                            oninput="updateRacDraftNodeField('${escapeJsString(trackId)}', '${escapeJsString(node.id)}', ${fieldIndex}, 'value', this.value)"
                        />
                        <button class="btn btn-secondary btn-small" type="button"
                            onclick="removeRacDraftNodeField('${escapeJsString(trackId)}', '${escapeJsString(node.id)}', ${fieldIndex})">−</button>
                    </div>
                `).join("")}
                <button class="btn btn-secondary btn-small rbd-rac-canvas-node-addfield" type="button"
                    onclick="addRacDraftNodeField('${escapeJsString(trackId)}', '${escapeJsString(node.id)}')">
                    + Champ
                </button>
            </div>

            <span
                class="rbd-rac-handle rbd-rac-handle-target"
                data-handle-type="target"
                data-node-id="${_escHtml(node.id)}"
                title="Point d'entree (cliquez/glissez depuis une sortie)"
            ></span>
            <span
                class="rbd-rac-handle rbd-rac-handle-source"
                data-handle-type="source"
                data-node-id="${_escHtml(node.id)}"
                onmousedown="startRacEdgeDrag(event, '${escapeJsString(trackId)}', '${escapeJsString(node.id)}')"
                title="Point de sortie (glissez vers une entree)"
            ></span>
        </article>
    `;
}

// ----------------------------------------------------------------------------
// Mise a jour dynamique des aretes SVG et de la popover de lien selectionne.
// Cette fonction est appelee apres chaque rendu pour positionner les liens
// en fonction de la taille reelle des noeuds (calculee via offsetWidth/Height).
// ----------------------------------------------------------------------------

function updateRacCanvasEdges(trackId) {
    const canvas = document.querySelector(`.rbd-rac-canvas[data-canvas-id="${cssEscapeAttr(trackId)}"]`);
    const svg = document.querySelector(`svg[data-canvas-svg="${cssEscapeAttr(trackId)}"]`);
    const popover = document.querySelector(`[data-canvas-popover="${cssEscapeAttr(trackId)}"]`);
    const draft = racInspectorState.draftsByTrackId[trackId];
    if (!canvas || !svg || !draft) return;

    const canvasRect = canvas.getBoundingClientRect();

    // Adapte la taille du SVG a la zone visible pour eviter les liens tronques.
    svg.setAttribute("width", String(canvas.scrollWidth));
    svg.setAttribute("height", String(canvas.scrollHeight));
    svg.setAttribute("viewBox", `0 0 ${canvas.scrollWidth} ${canvas.scrollHeight}`);

    const nodePositions = new Map();
    draft.nodes.forEach((node) => {
        const nodeEl = canvas.querySelector(`[data-node-id="${cssEscapeAttr(node.id)}"]`);
        if (!nodeEl) return;
        const rect = nodeEl.getBoundingClientRect();
        const x = rect.left - canvasRect.left + canvas.scrollLeft;
        const y = rect.top - canvasRect.top + canvas.scrollTop;
        nodePositions.set(node.id, {
            sourceX: x + rect.width,
            sourceY: y + rect.height / 2,
            targetX: x,
            targetY: y + rect.height / 2,
        });
    });

    const selectedEdgeId = racInspectorState.selectedEdgeId;
    let selectedMidpoint = null;
    let selectedEdge = null;

    const pathsHtml = draft.edges.map((edge) => {
        const source = nodePositions.get(edge.sourceNodeId);
        const target = nodePositions.get(edge.targetNodeId);
        if (!source || !target) return "";

        const d = buildRacBezierPath(source.sourceX, source.sourceY, target.targetX, target.targetY);
        const isSelected = edge.id === selectedEdgeId;

        if (isSelected) {
            selectedEdge = edge;
            selectedMidpoint = {
                x: (source.sourceX + target.targetX) / 2,
                y: (source.sourceY + target.targetY) / 2,
            };
        }

        // Le path "hit" (transparent et large) facilite le clic sur le lien.
        return `
            <path d="${d}" class="rbd-rac-edge-hit"
                onclick="selectRacDraftEdge('${escapeJsString(trackId)}', '${escapeJsString(edge.id)}'); event.stopPropagation();"
            ></path>
            <path d="${d}" class="rbd-rac-edge ${isSelected ? "is-selected" : ""}"
                onclick="selectRacDraftEdge('${escapeJsString(trackId)}', '${escapeJsString(edge.id)}'); event.stopPropagation();"
            ></path>
        `;
    }).join("");

    svg.innerHTML = pathsHtml;

    // Met a jour la popover du lien selectionne (informations + suppression).
    if (popover) {
        if (selectedEdge && selectedMidpoint) {
            const sourceNode = draft.nodes.find((node) => node.id === selectedEdge.sourceNodeId);
            const targetNode = draft.nodes.find((node) => node.id === selectedEdge.targetNodeId);

            popover.style.left = `${selectedMidpoint.x}px`;
            popover.style.top = `${selectedMidpoint.y}px`;
            popover.innerHTML = `
                <div class="rbd-rac-canvas-popover-row">
                    <span class="rbd-rac-canvas-popover-label">Tenant</span>
                    <strong>${_escHtml(sourceNode?.title || "?")}</strong>
                </div>
                <div class="rbd-rac-canvas-popover-row">
                    <span class="rbd-rac-canvas-popover-label">Aboutissant</span>
                    <strong>${_escHtml(targetNode?.title || "?")}</strong>
                </div>
                <div class="rbd-rac-canvas-popover-actions">
                    <button class="btn btn-secondary btn-small" type="button"
                        onclick="clearRacDraftEdgeSelection()">Fermer</button>
                    <button class="btn btn-danger btn-small" type="button"
                        onclick="removeRacDraftEdge('${escapeJsString(trackId)}', '${escapeJsString(selectedEdge.id)}')">
                        Supprimer le lien
                    </button>
                </div>
            `;
            popover.hidden = false;
        } else {
            popover.hidden = true;
            popover.innerHTML = "";
        }
    }
}

// Construit un trace de Bezier doux entre deux points. La distance horizontale
// influence la courbure pour conserver un rendu lisible meme avec des noeuds
// proches verticalement.
function buildRacBezierPath(x1, y1, x2, y2) {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

// Echappe une chaine pour usage dans un selecteur d'attribut CSS [attr="..."].
function cssEscapeAttr(value) {
    return String(value || "").replace(/(["\\])/g, "\\$1");
}

// ----------------------------------------------------------------------------
// Gestion souris : drag d'un noeud, drag d'un lien, clic sur fond.
// Les listeners globaux (mousemove/mouseup) sont attaches a la fenetre puis
// retires en fin de geste. Pour eviter de perturber les inputs, on n'effectue
// pas de re-render pendant le drag : la position est appliquee en direct sur
// l'element, et le commit (re-render complet) intervient au mouseup.
// ----------------------------------------------------------------------------

function startRacNodeDrag(event, trackId, nodeId) {
    // Ignore si l'utilisateur clique sur un controle interne (input, bouton, handle).
    if (event.target.closest("input,textarea,select,button,label,.rbd-rac-handle")) {
        return;
    }
    event.preventDefault();

    const node = findRacDraftNode(trackId, nodeId);
    const canvas = document.querySelector(`.rbd-rac-canvas[data-canvas-id="${cssEscapeAttr(trackId)}"]`);
    const nodeEl = canvas?.querySelector(`[data-node-id="${cssEscapeAttr(nodeId)}"]`);
    if (!node || !canvas || !nodeEl) return;

    const canvasRect = canvas.getBoundingClientRect();
    const startMouseX = event.clientX - canvasRect.left + canvas.scrollLeft;
    const startMouseY = event.clientY - canvasRect.top + canvas.scrollTop;
    const offsetX = startMouseX - (Number(node.x) || 0);
    const offsetY = startMouseY - (Number(node.y) || 0);

    nodeEl.classList.add("is-dragging");

    function onMove(moveEvent) {
        const x = moveEvent.clientX - canvasRect.left + canvas.scrollLeft - offsetX;
        const y = moveEvent.clientY - canvasRect.top + canvas.scrollTop - offsetY;
        node.x = Math.max(0, x);
        node.y = Math.max(0, y);
        nodeEl.style.left = `${node.x}px`;
        nodeEl.style.top = `${node.y}px`;
        // Met a jour les liens et la popover en temps reel.
        updateRacCanvasEdges(trackId);
    }

    function onUp() {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        nodeEl.classList.remove("is-dragging");
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
}

function startRacEdgeDrag(event, trackId, sourceNodeId) {
    event.preventDefault();
    event.stopPropagation();

    const canvas = document.querySelector(`.rbd-rac-canvas[data-canvas-id="${cssEscapeAttr(trackId)}"]`);
    const svg = canvas?.querySelector(`svg[data-canvas-svg="${cssEscapeAttr(trackId)}"]`);
    const sourceEl = canvas?.querySelector(`[data-node-id="${cssEscapeAttr(sourceNodeId)}"]`);
    if (!canvas || !svg || !sourceEl) return;

    const canvasRect = canvas.getBoundingClientRect();
    const sourceRect = sourceEl.getBoundingClientRect();
    const sourceX = sourceRect.right - canvasRect.left + canvas.scrollLeft;
    const sourceY = sourceRect.top + sourceRect.height / 2 - canvasRect.top + canvas.scrollTop;

    // Trace temporaire affiche pendant le drag du lien.
    const tempPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
    tempPath.setAttribute("class", "rbd-rac-edge rbd-rac-edge-temp");
    svg.appendChild(tempPath);

    function onMove(moveEvent) {
        const currentX = moveEvent.clientX - canvasRect.left + canvas.scrollLeft;
        const currentY = moveEvent.clientY - canvasRect.top + canvas.scrollTop;
        tempPath.setAttribute("d", buildRacBezierPath(sourceX, sourceY, currentX, currentY));
    }

    function onUp(upEvent) {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        tempPath.remove();

        // Detecte si le mouseup tombe sur un point d'entree (target) d'un autre noeud.
        const dropEl = document.elementFromPoint(upEvent.clientX, upEvent.clientY);
        const targetHandle = dropEl?.closest('.rbd-rac-handle[data-handle-type="target"]');
        const targetNodeId = targetHandle?.getAttribute("data-node-id");
        if (targetNodeId) {
            addRacDraftEdge(trackId, sourceNodeId, targetNodeId);
        }
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
}

function handleRacCanvasBackgroundMouseDown(event, trackId) {
    // Un clic sur le fond du canvas (en dehors d'un noeud, d'un handle ou d'un lien)
    // referme la popover de lien selectionne.
    if (event.target.closest(".rbd-rac-canvas-node, .rbd-rac-handle, .rbd-rac-edge, .rbd-rac-edge-hit, .rbd-rac-canvas-popover")) {
        return;
    }
    if (racInspectorState.selectedEdgeId) {
        clearRacDraftEdgeSelection();
    }
}

function renderRacInspectionDetail(payload, record) {
    if (!record) {
        return `
            <div class="rbd-rac-empty-state compact">
                <div class="rbd-rac-empty-icon">🔎</div>
                <div>
                    <h4>Aucune liaison selectionnee</h4>
                    <p>Choisissez une entree dans le schema ou dans le tableau de suivi.</p>
                </div>
            </div>
        `;
    }

    const terminalBoard = record.terminal_board || {};
    const intermediatePath = record.intermediate_path || {};
    const embases = Array.isArray(intermediatePath.embases) ? intermediatePath.embases : [];
    const targets = Array.isArray(record.target_equipment_types) ? record.target_equipment_types : [];
    const connections = Array.isArray(record.equipment_connections) ? record.equipment_connections : [];
    const hasUsefulTargets = targets.length > 0;
    const hasUsefulConnections = connections.length > 0;

    return `
        <div class="rbd-rac-detail-stack">
            <div class="rbd-rac-detail-hero">
                <div>
                    <div class="rbd-rac-detail-caption">Liaison ${_escHtml(record.track_id || "")}</div>
                    <h4>${_escHtml(record.signal_label || "Signal sans libelle")}</h4>
                    <p>${_escHtml(record.signal_type || "Type non renseigne")} • Ligne Excel ${Number(record.excel_row || 0)}</p>
                </div>
                <div class="rbd-rac-inline-actions">
                    <span class="rbd-rac-entry-status large is-${_escHtml(String(record?.status?.tone || "neutral"))}">${_escHtml(record?.status?.label || "Sans terminaison")}</span>
                    <button class="btn btn-secondary btn-small" type="button" onclick="showRacRawTraceModal('${escapeJsString(record.track_id || "")}')">Trace brute</button>
                </div>
            </div>

            <section class="rbd-rac-detail-section">
                <h5>Chemin de la liaison</h5>
                <p class="muted">Chaque etape, branche parallele et champ est modifiable localement pour verifier le chemin RAC avant toute evolution metier.</p>
                ${renderRacEditablePath(record)}
            </section>

            ${(hasUsefulTargets || hasUsefulConnections || embases.length > 0) ? `
                <section class="rbd-rac-detail-section">
                    <h5>Synthese detectee</h5>
                    <div class="rbd-rac-tag-list">
                        ${formatRacEmbases(embases).map((embase) => `<span class="rbd-rac-tag">${_escHtml(embase)}</span>`).join("")}
                        ${targets.map((target) => `<span class="rbd-rac-tag">${_escHtml(target)}</span>`).join("")}
                        ${formatRacConnectionSummaries(connections).map((summary) => `<span class="rbd-rac-tag is-success">${_escHtml(summary)}</span>`).join("")}
                    </div>
                </section>
            ` : ""}
        </div>
    `;
}

function renderRacInspectionFilters() {
    return `
        <div class="rbd-rac-filter-bar">
            <div class="rbd-filter-group rbd-rac-filter-grow">
                <label for="rac-inspection-search">Recherche</label>
                <input
                    id="rac-inspection-search"
                    class="rbd-form-input"
                    type="search"
                    value="${_escHtml(racInspectorState.searchText || "") }"
                    placeholder="Signal, bornier, prise, equipement..."
                    oninput="updateRacInspectionSearch(this.value)"
                />
            </div>

            <div class="rbd-filter-group">
                <label for="rac-inspection-status-filter">Statut</label>
                <select
                    id="rac-inspection-status-filter"
                    class="rbd-form-input"
                    onchange="updateRacInspectionStatusFilter(this.value)"
                >
                    ${renderRacStatusOptions(racInspectorState.statusFilter)}
                </select>
            </div>

            <div class="rbd-filter-group">
                <label>&nbsp;</label>
                <button class="btn btn-secondary" type="button" onclick="resetRacInspectionFilters()">Reinitialiser</button>
            </div>
        </div>
    `;
}

function renderRacStatusOptions(selectedValue) {
    const options = [
        ["all", "Tous les statuts"],
        ["complet", "Complet"],
        ["a_verifier", "A verifier"],
        ["non_traite", "Non traite"],
        ["sans_terminaison", "Sans terminaison"],
    ];

    return options.map(([value, label]) => {
        const selected = value === selectedValue ? "selected" : "";
        return `<option value="${value}" ${selected}>${label}</option>`;
    }).join("");
}

function renderRacInspectionTable(records, selectedRecord) {
    if (!records || records.length === 0) {
        return `
            <div class="rbd-rac-empty-state compact">
                <div class="rbd-rac-empty-icon">📭</div>
                <div>
                    <h4>Aucune liaison pour ce filtre</h4>
                    <p>Elargissez la recherche ou reinitialisez le filtre de statut.</p>
                </div>
            </div>
        `;
    }

    return `
        <div class="rbd-rac-table-wrap">
            <table class="rbd-table rbd-rac-table">
                <thead>
                    <tr>
                        <th>Ligne</th>
                        <th>Statut</th>
                        <th>Bornier</th>
                        <th>Borne</th>
                        <th>Information</th>
                        <th>Type</th>
                        <th>Chemin intermediaire</th>
                        <th>Cibles</th>
                        <th>Carte</th>
                        <th>Borne carte</th>
                    </tr>
                </thead>
                <tbody>
                    ${records.map((record) => renderRacInspectionTableRow(record, selectedRecord)).join("")}
                </tbody>
            </table>
        </div>
    `;
}

function renderRacInspectionTableRow(record, selectedRecord) {
    const isSelected = selectedRecord?.track_id === record?.track_id;
    const targets = Array.isArray(record?.target_equipment_types) ? record.target_equipment_types.join(", ") : "";
    const connections = Array.isArray(record?.equipment_connections) ? record.equipment_connections : [];
    const firstConnection = connections[0] || null;

    return `
        <tr class="${isSelected ? "is-selected" : ""}" onclick="setRacInspectionSelection('${escapeJsString(record?.track_id || "")}')">
            <td>${Number(record?.excel_row || 0)}</td>
            <td>
                <span class="rbd-rac-entry-status is-${_escHtml(String(record?.status?.tone || "neutral"))}">
                    ${_escHtml(record?.status?.label || "Sans terminaison")}
                </span>
            </td>
            <td>${_escHtml(record?.board_name || "—")}</td>
            <td>${_escHtml(record?.terminal_number || "—")}</td>
            <td>
                <strong>${_escHtml(record?.signal_label || "—")}</strong>
                <div class="muted">${_escHtml(record?.track_id || "")}</div>
            </td>
            <td>${_escHtml(record?.signal_type || "—")}</td>
            <td>${_escHtml(record?.female_socket || record?.source_label || "—")}</td>
            <td>${_escHtml(targets || "—")}</td>
            <td>${_escHtml(firstConnection?.card_number || "—")}</td>
            <td>${_escHtml(firstConnection?.card_terminal || "—")}</td>
        </tr>
    `;
}

function escapeJsString(value) {
    return String(value || "")
        .replace(/\\/g, "\\\\")
        .replace(/'/g, "\\'")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
}