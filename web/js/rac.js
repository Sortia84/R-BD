// web/js/rac.js
// ============================================================================
// Module : Gestion des fichiers RAC (Raccordements)
//
// Fonctionnalités :
//   - Import RAC avec catégorie obligatoire (Ligne/CBO/TG)
//   - Affichage groupé par catégorie + clé RAC (rac_key)
//   - Gestion des versions par groupe (inspiré de la logique ICD)
//   - Suppression d'une version RAC
//
// Dépendances :
//   - api.js      → apiRac.categories/grouped/upload/remove
//   - app.js      → showToast(), _escHtml()
// ============================================================================

"use strict";

let racCategories = [];
let racGroups = [];

// Sélection locale de version active par groupe
// Format: { [groupId]: racId }
const racVersionSelection = {};

// ============================================================================
// RENDU DU LAYOUT — Génération HTML de la vue RAC
// ============================================================================

function renderRacLayout() {
    const container = document.getElementById("view-rac");
    if (!container) return;

    container.innerHTML = `
        <section class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center; gap: 16px; flex-wrap: wrap;">
                <div>
                    <h2>Fichiers RAC (Raccordements)</h2>
                    <p class="muted">Importez des classeurs RAC et gérez les versions par catégorie</p>
                </div>

                <div class="rbd-flex rbd-flex-center rbd-flex-gap">
                    <div class="rbd-form-group" style="min-width: 220px;">
                        <label class="rbd-form-label" for="rac-upload-category">Catégorie d'import</label>
                        <select id="rac-upload-category" class="rbd-form-input"></select>
                    </div>

                    <button class="btn btn-primary" onclick="triggerRacUpload()">
                        ➕ Importer un RAC
                    </button>
                </div>
            </div>

            <input id="rac-upload" type="file" accept=".xlsx,.xlsm" multiple hidden />
        </section>

        <section class="card">
            <div class="card-header">
                <h3 style="margin: 0 0 8px 0;">🔎 Filtres RAC</h3>
            </div>

            <div class="rbd-filters-bar">
                <div class="rbd-filter-group" style="min-width: 240px;">
                    <label for="rac-filter-category">Catégorie</label>
                    <select id="rac-filter-category" class="rbd-form-input"></select>
                </div>

                <div class="rbd-filter-group">
                    <label>&nbsp;</label>
                    <button class="btn btn-secondary" onclick="loadRacList()">Rafraîchir</button>
                </div>
            </div>
        </section>

        <section class="card rbd-section-shell">
            <div class="card-header">
                <h3 style="margin: 0 0 8px 0;">📎 Catalogue RAC par groupe/version</h3>
                <p class="muted" style="margin: 0;">Chaque carte regroupe les versions d'un même RAC (par catégorie + clé logique)</p>
            </div>

            <div id="rac-list" class="rbd-grid">
                <div class="rbd-empty-state">
                    <div class="rbd-empty-state-icon">📎</div>
                    <p>Aucun fichier RAC importé</p>
                </div>
            </div>
        </section>
    `;

    const uploadInput = document.getElementById("rac-upload");
    if (uploadInput) {
        uploadInput.addEventListener("change", handleRacFileSelected);
    }

    const filterCategory = document.getElementById("rac-filter-category");
    if (filterCategory) {
        filterCategory.addEventListener("change", loadRacList);
    }

    console.info("[RAC][Init] Layout RAC généré");
}

// ============================================================================
// INITIALISATION
// ============================================================================

async function initRacPage() {
    console.info("[RAC][Init] Initialisation de la page RAC");

    renderRacLayout();
    await loadRacCategories();
    await loadRacList();
}

// ============================================================================
// CATEGORIES
// ============================================================================

async function loadRacCategories() {
    try {
        const data = await apiRac.categories();
        racCategories = data.categories || [];
        renderCategorySelects();
    } catch (err) {
        console.error("[RAC][Categories] Erreur chargement :", err);
        racCategories = [];
        renderCategorySelects();
        showToast("Erreur chargement catégories RAC", "error");
    }
}

function renderCategorySelects() {
    const uploadSelect = document.getElementById("rac-upload-category");
    const filterSelect = document.getElementById("rac-filter-category");

    const options = racCategories.map((cat) => {
        const id = _escHtml(cat.id || "");
        const name = _escHtml(cat.name || cat.id || "");
        return `<option value="${id}">${name}</option>`;
    }).join("");

    if (uploadSelect) {
        uploadSelect.innerHTML = options || `<option value="">Aucune catégorie</option>`;
    }

    if (filterSelect) {
        filterSelect.innerHTML = `
            <option value="">Toutes les catégories</option>
            ${options}
        `;
    }
}

function getCategoryName(categoryId) {
    const found = racCategories.find((c) => c.id === categoryId);
    return found?.name || categoryId || "—";
}

// ============================================================================
// CHARGEMENT ET AFFICHAGE
// ============================================================================

async function loadRacList() {
    console.info("[RAC][List] Chargement des groupes RAC...");

    const container = document.getElementById("rac-list");
    if (!container) return;

    const filterCategory = document.getElementById("rac-filter-category");
    const categoryId = filterCategory?.value || null;

    try {
        const data = await apiRac.grouped(categoryId);
        racGroups = data.groups || [];

        if (racGroups.length === 0) {
            container.innerHTML = `
                <div class="rbd-empty-state">
                    <div class="rbd-empty-state-icon">📎</div>
                    <p>Aucun groupe RAC trouvé</p>
                    <p style="font-size: 14px;">Importez un classeur RAC pour créer une première version.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = racGroups.map((group) => renderRacGroupCard(group)).join("");
        console.info("[RAC][List] %d groupe(s) RAC affiché(s)", racGroups.length);

    } catch (err) {
        console.error("[RAC][List] Erreur chargement :", err);
        showToast("Erreur lors du chargement du catalogue RAC", "error");
    }
}

function renderRacGroupCard(group) {
    const groupId = _escHtml(group.group_id || "");
    const categoryName = _escHtml(group.category_name || getCategoryName(group.category_id));
    const racKey = _escHtml(group.rac_key || "");

    const versions = Array.isArray(group.versions) ? group.versions : [];
    const selectedRacId = racVersionSelection[group.group_id] || (versions[0]?.id || "");

    const selectedVersion = versions.find((v) => v.id === selectedRacId) || versions[0] || null;
    if (!selectedVersion) {
        return "";
    }

    const versionOptions = versions.map((v) => {
        const vid = _escHtml(v.id || "");
        const label = _escHtml(v.version || "vNA");
        const filename = _escHtml(v.filename || "");
        const selected = (v.id === selectedVersion.id) ? "selected" : "";
        return `<option value="${vid}" ${selected}>${label} • ${filename}</option>`;
    }).join("");

    const metadata = selectedVersion.metadata || {};
    const importedAt = _escHtml(selectedVersion.imported_at || "—");
    const sheetName = _escHtml(metadata.sheet_name || "—");
    const rowsParsed = Number(metadata.rows_parsed || 0);
    const rowsSkipped = Number(metadata.rows_skipped || 0);
    const groupCount = Number(metadata.equipment_group_count || 0);

    const versionLabel = _escHtml(selectedVersion.version || "vNA");
    const versionCount = Number(group.version_count || versions.length);

    return `
        <div class="card rbd-card-clickable rbd-rac-group-card" data-group-id="${groupId}">
            <div class="card-header">
                <div class="rbd-flex rbd-flex-between rbd-flex-center" style="gap: 12px; flex-wrap: wrap;">
                    <div>
                        <h4 style="margin: 0;">${racKey || "RAC"}</h4>
                        <div class="rbd-rac-parser-meta mt-1">
                            <span class="rbd-rac-pill">Catégorie: ${categoryName}</span>
                            <span class="rbd-rac-pill">Version active: ${versionLabel}</span>
                            <span class="rbd-rac-pill">Total versions: ${versionCount}</span>
                        </div>
                    </div>

                    <div class="rbd-rac-version-select-wrap">
                        <label class="rbd-form-label" for="rac-version-${groupId}">Version</label>
                        <select id="rac-version-${groupId}" class="rbd-form-input"
                                onchange="switchRacVersion('${groupId}', this.value)">
                            ${versionOptions}
                        </select>
                    </div>
                </div>
            </div>

            <div class="rbd-rac-parser-meta">
                <span class="rbd-rac-pill">Ajouté le: ${importedAt}</span>
                <span class="rbd-rac-pill">Onglet: ${sheetName}</span>
                <span class="rbd-rac-pill">Lignes parsees: ${rowsParsed}</span>
                <span class="rbd-rac-pill">Lignes ignorees: ${rowsSkipped}</span>
                <span class="rbd-rac-pill">Groupes equipement: ${groupCount}</span>
            </div>

            <div class="rbd-divider"></div>

            <div class="rbd-flex rbd-flex-between rbd-flex-center" style="gap: 12px; flex-wrap: wrap;">
                <div class="muted" style="font-size: 13px;">Fichier: ${_escHtml(selectedVersion.filename || "")}</div>
                <div class="rbd-flex rbd-flex-gap-sm">
                    <button class="btn btn-secondary" onclick="viewRacParsed('${_escHtml(selectedVersion.id || "")}')">
                        Voir JSON
                    </button>
                    <button class="btn btn-danger" onclick="deleteRac('${_escHtml(selectedVersion.id || "")}')">
                        Supprimer version
                    </button>
                </div>
            </div>
        </div>
    `;
}

function switchRacVersion(groupId, racId) {
    if (!groupId) return;
    racVersionSelection[groupId] = racId;

    const container = document.getElementById("rac-list");
    if (!container) return;

    container.innerHTML = racGroups.map((group) => renderRacGroupCard(group)).join("");
}

// ============================================================================
// IMPORT
// ============================================================================

function triggerRacUpload() {
    const input = document.getElementById("rac-upload");
    if (!input) return;

    input.value = "";
    input.click();
}

async function handleRacFileSelected(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const categorySelect = document.getElementById("rac-upload-category");
    const categoryId = categorySelect?.value || "";

    if (!categoryId) {
        showToast("Veuillez sélectionner une catégorie RAC avant import.", "warning");
        return;
    }

    let successCount = 0;
    let errorCount = 0;

    for (const file of files) {
        try {
            await apiRac.upload(file, categoryId);
            successCount++;
        } catch (err) {
            const detail = err?.message || "Erreur d'import";
            console.error("[RAC][Upload] Erreur:", err);
            showToast(`${file.name} : ${detail}`, "error", 5500);
            errorCount++;
        }
    }

    if (successCount > 0) {
        showToast(`${successCount} RAC importé(s)`, "success");
    }
    if (errorCount > 0) {
        showToast(`${errorCount} import(s) RAC en erreur`, "error");
    }

    await loadRacList();
}

// ============================================================================
// ACTIONS
// ============================================================================

async function viewRacParsed(racId) {
    if (!racId) return;

    try {
        const payload = await apiRac.getParsed(racId);
        const summary = payload?.summary || {};
        showToast(
            `JSON RAC chargé — lignes: ${summary.rows_parsed || 0}, groupes: ${summary.equipment_group_count || 0}`,
            "info",
            3500
        );

        // Affichage simple pour diagnostic local (sans créer de nouvelle fenêtre UI).
        console.info("[RAC][Parsed]", payload);
    } catch (err) {
        console.error("[RAC][Parsed] Erreur:", err);
        showToast("Impossible de charger le JSON RAC", "error");
    }
}

async function deleteRac(racId) {
    if (!racId) return;

    const confirmed = confirm("Supprimer cette version RAC ?");
    if (!confirmed) return;

    try {
        await apiRac.remove(racId);
        showToast("Version RAC supprimée", "success");
        await loadRacList();
    } catch (err) {
        console.error("[RAC][Delete] Erreur:", err);
        showToast("Erreur lors de la suppression", "error");
    }
}
