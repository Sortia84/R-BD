// web/js/rac.js
// ============================================================================
// Module : Gestion des fichiers RAC (Raccordements)
//
// Fonctionnalités :
//   - Import de fichiers RAC (upload via bouton)
//   - Affichage de la liste des RAC importés (grille de cartes)
//   - Suppression d'un RAC
//
// Dépendances :
//   - api.js      → apiRac.list(), apiRac.upload(), apiRac.remove()
//   - app.js      → showToast(), _escHtml()
//
// Convention :
//   La fonction d'entrée initRacPage() est appelée automatiquement par
//   app.js lors du switchView("rac").
// ============================================================================

"use strict";

// ============================================================================
// RENDU DU LAYOUT — Génération HTML de la vue RAC
// ============================================================================

/**
 * Générer et injecter le layout HTML de la vue RAC.
 *
 * Appelée par initRacPage() avant tout événement.
 * Injecte le bandeau (titre + bouton import) et la grille de liste
 * à l'intérieur de #view-rac.
 */
function renderRacLayout() {
    const container = document.getElementById("view-rac");
    if (!container) return;

    container.innerHTML = `
        <!-- Bandeau RAC -->
        <section class="card">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h2>Fichiers RAC (Raccordements)</h2>
                    <p class="muted">Importez et consultez les fichiers de raccordement</p>
                </div>
                <div style="display: flex; gap: 12px; align-items: center;">
                    <button class="btn btn-primary" onclick="triggerRacUpload()">
                        ➕ Importer un RAC
                    </button>
                </div>
            </div>
            <input id="rac-upload" type="file" accept=".rac,.xml,.json,.xlsx" multiple hidden />
        </section>

        <!-- Liste des RAC -->
        <section class="card rbd-section-shell">
            <div class="card-header">
                <h3 style="margin: 0 0 8px 0;">📎 Liste des fichiers RAC</h3>
                <p class="muted" style="margin: 0;">Fichiers RAC importés dans la base</p>
            </div>
            <div id="rac-list" class="rbd-grid">
                <div class="rbd-empty-state">
                    <div class="rbd-empty-state-icon">📎</div>
                    <p>Aucun fichier RAC importé</p>
                    <p style="font-size: 14px;">Cliquez sur "Importer un RAC" pour commencer</p>
                </div>
            </div>
        </section>
    `;

    console.info("[RAC][Init] Layout RAC généré");
}

// ============================================================================
// INITIALISATION
// ============================================================================

/**
 * Initialise la vue RAC.
 * 
 * Appelée automatiquement par app.js au premier affichage de la vue "rac".
 * Attache les événements sur l'input file puis charge la liste.
 */
function initRacPage() {
    console.info("[RAC][Init] Initialisation de la page RAC");

    // --- Génération du layout HTML ---
    renderRacLayout();

    // --- Écouteur sur l'input file caché ---
    const uploadInput = document.getElementById("rac-upload");
    if (uploadInput) {
        uploadInput.addEventListener("change", handleRacFileSelected);
    }

    // --- Chargement initial de la liste ---
    loadRacList();
}


// ============================================================================
// CHARGEMENT ET AFFICHAGE DE LA LISTE
// ============================================================================

/**
 * Charge la liste des RAC depuis le backend et l'affiche dans la grille.
 * 
 * Appelle GET /api/rac/list via apiRac.list().
 * En cas d'erreur, affiche un toast d'erreur.
 */
async function loadRacList() {
    console.info("[RAC][List] Chargement de la liste RAC…");

    const container = document.getElementById("rac-list");
    if (!container) return;

    try {
        const data = await apiRac.list();
        const list = data.rac_list || [];

        // --- Aucun RAC importé : afficher l'état vide ---
        if (list.length === 0) {
            container.innerHTML = `
                <div class="rbd-empty-state">
                    <div class="rbd-empty-state-icon">📎</div>
                    <p>Aucun fichier RAC importé</p>
                    <p style="font-size: 14px;">Cliquez sur "Importer un RAC" pour commencer</p>
                </div>
            `;
            return;
        }

        // --- Construire les cartes RAC ---
        container.innerHTML = list.map(rac => renderRacCard(rac)).join("");
        console.info("[RAC][List] %d RAC affichés", list.length);

    } catch (err) {
        console.error("[RAC][List] Erreur chargement :", err);
        showToast("Erreur lors du chargement des RAC", "error");
    }
}


/**
 * Génère le HTML d'une carte RAC.
 * 
 * @param {Object} rac — Objet RAC renvoyé par le backend
 * @returns {string} HTML de la carte
 */
function renderRacCard(rac) {
    // Échapper les valeurs pour éviter les injections XSS
    const name = _escHtml(rac.filename || rac.id || "Sans nom");
    const date = _escHtml(rac.added_at || "—");
    const id   = _escHtml(rac.id || "");

    return `
        <div class="card rbd-card-clickable" data-rac-id="${id}">
            <div class="card-header" style="display: flex; justify-content: space-between; align-items: center;">
                <div>
                    <h4 style="margin: 0;">${name}</h4>
                    <span class="muted" style="font-size: 13px;">Ajouté le ${date}</span>
                </div>
                <button class="btn btn-outline" title="Supprimer ce RAC"
                        onclick="deleteRac('${id}')">
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
 * Ouvre le sélecteur de fichier pour l'import RAC.
 * 
 * Appelée par le bouton "Importer un RAC" dans l'HTML.
 */
function triggerRacUpload() {
    console.info("[RAC][Upload] Ouverture du sélecteur de fichier");
    const input = document.getElementById("rac-upload");
    if (input) {
        input.value = "";   // Réinitialiser pour permettre la re-sélection
        input.click();
    }
}


/**
 * Gère la sélection de fichier(s) RAC pour upload.
 * 
 * Envoie chaque fichier sélectionné au backend via POST /api/rac/import.
 * Affiche un toast de succès/erreur à chaque upload.
 * Recharge la liste à la fin.
 * 
 * @param {Event} event — Événement change de l'input file
 */
async function handleRacFileSelected(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    console.info("[RAC][Upload] %d fichier(s) sélectionné(s)", files.length);

    let successCount = 0;
    let errorCount = 0;

    // Uploader chaque fichier séquentiellement
    for (const file of files) {
        try {
            console.info("[RAC][Upload] Envoi de : %s", file.name);
            await apiRac.upload(file);
            successCount++;
        } catch (err) {
            console.error("[RAC][Upload] Erreur pour %s :", file.name, err);
            errorCount++;
        }
    }

    // --- Feedback utilisateur ---
    if (successCount > 0) {
        showToast(`${successCount} RAC importé(s) avec succès`, "success");
    }
    if (errorCount > 0) {
        showToast(`${errorCount} RAC en erreur`, "error");
    }

    // --- Recharger la liste ---
    loadRacList();
}


// ============================================================================
// SUPPRESSION
// ============================================================================

/**
 * Supprime un fichier RAC après confirmation utilisateur.
 * 
 * Appelle DELETE /api/rac/{rac_id} via apiRac.remove().
 * Recharge la liste après suppression réussie.
 * 
 * @param {string} racId — Identifiant du RAC à supprimer
 */
async function deleteRac(racId) {
    if (!racId) return;

    // Demander confirmation à l'utilisateur
    const confirmed = confirm("Supprimer ce fichier RAC ?");
    if (!confirmed) return;

    console.info("[RAC][Delete] Suppression de : %s", racId);

    try {
        await apiRac.remove(racId);
        showToast("RAC supprimé", "success");
        loadRacList();
    } catch (err) {
        console.error("[RAC][Delete] Erreur :", err);
        showToast("Erreur lors de la suppression", "error");
    }
}
