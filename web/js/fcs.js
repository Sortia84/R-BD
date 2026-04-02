// web/js/fcs.js
// ============================================================================
// Module : Gestion des Fiches de Configuration Système (FCS)
//
// Fonctionnalités :
//   - Import de fichiers FCS (upload via bouton)
//   - Affichage de la liste des FCS importés (grille de cartes)
//   - Suppression d'un FCS
//
// Dépendances :
//   - api.js      → apiFcs.list(), apiFcs.upload(), apiFcs.remove()
//   - app.js      → showToast(), _escHtml()
//
// Convention :
//   La fonction d'entrée initFcsPage() est appelée automatiquement par
//   app.js lors du switchView("fcs").
// ============================================================================

"use strict";

// ============================================================================
// RENDU DU LAYOUT — Génération HTML de la vue FCS
// ============================================================================

/**
 * Générer et injecter le layout HTML de la vue FCS.
 *
 * Appelée par initFcsPage() avant tout événement.
 * Injecte le bandeau (titre + bouton import) et la grille de liste
 * à l'intérieur de #view-fcs.
 */
function renderFcsLayout() {
    const container = document.getElementById("view-fcs");
    if (!container) return;

    container.innerHTML = `
        <!-- Bandeau FCS -->
        <section class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h2>Fiches de Configuration (FCS)</h2>
                    <p class="muted">Importez et consultez les fichiers FCS</p>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <button class="btn btn-primary" onclick="triggerFcsUpload()">
                        ➕ Importer un FCS
                    </button>
                </div>
            </div>
            <input id="fcs-upload" type="file" accept=".fcs,.xml,.json" multiple hidden />
        </section>

        <!-- Liste des FCS -->
        <section class="card rbd-section-shell">
            <div class="card-header">
                <h3 style="margin: 0 0 8px 0;">📋 Liste des FCS</h3>
                <p class="muted" style="margin: 0;">Fichiers FCS importés dans la base</p>
            </div>
            <div id="fcs-list" class="rbd-grid">
                <div class="rbd-empty-state">
                    <div class="rbd-empty-state-icon">📋</div>
                    <p>Aucun fichier FCS importé</p>
                    <p style="font-size: 14px;">Cliquez sur "Importer un FCS" pour commencer</p>
                </div>
            </div>
        </section>
    `;

    console.info("[FCS][Init] Layout FCS généré");
}

// ============================================================================
// INITIALISATION
// ============================================================================

/**
 * Initialise la vue FCS.
 * 
 * Appelée automatiquement par app.js au premier affichage de la vue "fcs".
 * Attache les événements sur l'input file puis charge la liste.
 */
function initFcsPage() {
    console.info("[FCS][Init] Initialisation de la page FCS");

    // --- Génération du layout HTML ---
    renderFcsLayout();

    // --- Écouteur sur l'input file caché ---
    const uploadInput = document.getElementById("fcs-upload");
    if (uploadInput) {
        uploadInput.addEventListener("change", handleFcsFileSelected);
    }

    // --- Chargement initial de la liste ---
    loadFcsList();
}


// ============================================================================
// CHARGEMENT ET AFFICHAGE DE LA LISTE
// ============================================================================

/**
 * Charge la liste des FCS depuis le backend et l'affiche dans la grille.
 * 
 * Appelle GET /api/fcs/list via apiFcs.list().
 * En cas d'erreur, affiche un toast d'erreur.
 */
async function loadFcsList() {
    console.info("[FCS][List] Chargement de la liste FCS…");

    const container = document.getElementById("fcs-list");
    if (!container) return;

    try {
        const data = await apiFcs.list();
        const list = data.fcs_list || [];

        // --- Aucun FCS importé : afficher l'état vide ---
        if (list.length === 0) {
            container.innerHTML = `
                <div class="rbd-empty-state">
                    <div class="rbd-empty-state-icon">📋</div>
                    <p>Aucun fichier FCS importé</p>
                    <p style="font-size: 14px;">Cliquez sur "Importer un FCS" pour commencer</p>
                </div>
            `;
            return;
        }

        // --- Construire les cartes FCS ---
        container.innerHTML = list.map(fcs => renderFcsCard(fcs)).join("");
        console.info("[FCS][List] %d FCS affichés", list.length);

    } catch (err) {
        console.error("[FCS][List] Erreur chargement :", err);
        showToast("Erreur lors du chargement des FCS", "error");
    }
}


/**
 * Génère le HTML d'une carte FCS.
 * 
 * @param {Object} fcs — Objet FCS renvoyé par le backend
 * @returns {string} HTML de la carte
 */
function renderFcsCard(fcs) {
    // Échapper les valeurs pour éviter les injections XSS
    const name = _escHtml(fcs.filename || fcs.id || "Sans nom");
    const date = _escHtml(fcs.added_at || "—");
    const id   = _escHtml(fcs.id || "");

    return `
        <div class="card rbd-card-clickable" data-fcs-id="${id}">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 style="margin: 0;">${name}</h4>
                    <span class="muted" style="font-size: 13px;">Ajouté le ${date}</span>
                </div>
                <button class="btn btn-outline" title="Supprimer ce FCS"
                        onclick="deleteFcs('${id}')">
                    🗑️
                </button>
            </div>
        </div>
    `;
}


// ============================================================================
// IMPORT (UPLOAD)
// ============================================================================

/**
 * Ouvre le sélecteur de fichier pour l'import FCS.
 * 
 * Appelée par le bouton "Importer un FCS" dans l'HTML.
 */
function triggerFcsUpload() {
    console.info("[FCS][Upload] Ouverture du sélecteur de fichier");
    const input = document.getElementById("fcs-upload");
    if (input) {
        input.value = "";   // Réinitialiser pour permettre la re-sélection
        input.click();
    }
}


/**
 * Gère la sélection de fichier(s) FCS pour upload.
 * 
 * Envoie chaque fichier sélectionné au backend via POST /api/fcs/import.
 * Affiche un toast de succès/erreur à chaque upload.
 * Recharge la liste à la fin.
 * 
 * @param {Event} event — Événement change de l'input file
 */
async function handleFcsFileSelected(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    console.info("[FCS][Upload] %d fichier(s) sélectionné(s)", files.length);

    let successCount = 0;
    let errorCount = 0;

    // Uploader chaque fichier séquentiellement
    for (const file of files) {
        try {
            console.info("[FCS][Upload] Envoi de : %s", file.name);
            await apiFcs.upload(file);
            successCount++;
        } catch (err) {
            console.error("[FCS][Upload] Erreur pour %s :", file.name, err);
            errorCount++;
        }
    }

    // --- Feedback utilisateur ---
    if (successCount > 0) {
        showToast(`${successCount} FCS importé(s) avec succès`, "success");
    }
    if (errorCount > 0) {
        showToast(`${errorCount} FCS en erreur`, "error");
    }

    // --- Recharger la liste ---
    loadFcsList();
}


// ============================================================================
// SUPPRESSION
// ============================================================================

/**
 * Supprime un fichier FCS après confirmation utilisateur.
 * 
 * Appelle DELETE /api/fcs/{fcs_id} via apiFcs.remove().
 * Recharge la liste après suppression réussie.
 * 
 * @param {string} fcsId — Identifiant du FCS à supprimer
 */
async function deleteFcs(fcsId) {
    if (!fcsId) return;

    // Demander confirmation à l'utilisateur
    const confirmed = confirm("Supprimer ce fichier FCS ?");
    if (!confirmed) return;

    console.info("[FCS][Delete] Suppression de : %s", fcsId);

    try {
        await apiFcs.remove(fcsId);
        showToast("FCS supprimé", "success");
        loadFcsList();
    } catch (err) {
        console.error("[FCS][Delete] Erreur :", err);
        showToast("Erreur lors de la suppression", "error");
    }
}
