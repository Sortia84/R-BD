// web/js/home.js
// ============================================================================
// Module : Dashboard d'accueil R#BD
//
// Génère dynamiquement la page d'accueil avec :
//   - les cartes cliquables vers chaque module (ICD, ISA, Essais, RAC)
//   - les statistiques résumées par module
//   - le guide rapide
//
// Dépendances :
//   - app.js  → switchView(), _escHtml(), showToast()
//   - api.js  → apiIcd, apiIsa, apiEssais, apiRac
//
// Convention :
//   initHomePage()       → appelée par app.js au démarrage
//   refreshHomeDashboard → appelée par handleViewSwitch("home")
// ============================================================================

"use strict";

// ============================================================================
// RENDU DE LA VUE — Génération HTML complète
// ============================================================================

/**
 * Générer et injecter le layout HTML de la vue Home.
 *
 * Crée les cartes de navigation vers chaque module + le guide rapide.
 * Chaque carte contient des badges (IDs stat-*) mis à jour par refreshHomeDashboard().
 */
function renderHomeLayout() {
    const container = document.getElementById("view-home");
    if (!container) return;

    container.innerHTML = `
        <!-- Carte Modules disponibles -->
        <section class="card rbd-section-shell">
            <div class="card-header">
                <h2>Bienvenue dans R#BD</h2>
                <p class="muted">Base de données centralisée pour les templates et configurations R#SPACE</p>
            </div>
            <div>
                <h3 style="margin-top: 0;">📋 Modules disponibles</h3>
                <div class="rbd-grid rbd-grid-dashboard" style="margin-top: 16px;">

                    <!-- Card IED/ICD -->
                    <div class="rbd-card rbd-card-clickable" onclick="switchView('icd')">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                            <div class="rbd-card-icon">📃</div>
                            <div>
                                <h3 style="margin: 0; color: var(--primary);">IED / ICD</h3>
                                <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--muted);">Gestion des fichiers ICD</p>
                            </div>
                        </div>
                        <p class="rbd-card-description">
                            Importez et associez les fichiers ICD à vos patterns IED.
                        </p>
                        <div class="rbd-badge-row">
                            <span class="rbd-badge rbd-badge-info" id="stat-icd-count">0 ICD</span>
                            <span class="rbd-badge rbd-badge-muted" id="stat-pattern-count">0 patterns</span>
                        </div>
                    </div>

                    <!-- Card ISA -->
                    <div class="rbd-card rbd-card-clickable" onclick="switchView('isa')">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                            <div class="rbd-card-icon">📂</div>
                            <div>
                                <h3 style="margin: 0; color: var(--primary);">Fichiers ISA</h3>
                                <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--muted);">Types de données ISA</p>
                            </div>
                        </div>
                        <p class="rbd-card-description">
                            Importez et organisez vos fichiers ISA par type.
                        </p>
                        <div class="rbd-badge-row">
                            <span class="rbd-badge rbd-badge-info" id="stat-isa-count">0 fichiers</span>
                            <span class="rbd-badge rbd-badge-muted" id="stat-isa-types">0 types</span>
                        </div>
                    </div>

                    <!-- Card Essais -->
                    <div class="rbd-card rbd-card-clickable" onclick="switchView('essais')">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                            <div class="rbd-card-icon">🧪</div>
                            <div>
                                <h3 style="margin: 0; color: var(--primary);">Essais</h3>
                                <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--muted);">RU / CVS / MVS</p>
                            </div>
                        </div>
                        <p class="rbd-card-description">
                            Centralisez les essais Recette Usine, CVS et MVS.
                        </p>
                        <div class="rbd-badge-row">
                            <span class="rbd-badge rbd-badge-info" id="stat-total-tests">0 tests</span>
                            <span class="rbd-badge rbd-badge-muted" id="stat-total-steps">0 étapes</span>
                            <span class="rbd-badge rbd-badge-success" id="stat-ru-tests">RU: 0</span>
                            <span class="rbd-badge rbd-badge-warning" id="stat-cvs-tests">CVS: 0</span>
                            <span class="rbd-badge rbd-badge-info" id="stat-mvs-tests">MVS: 0</span>
                        </div>
                    </div>

                    <!-- Card RAC -->
                    <div class="rbd-card rbd-card-clickable" onclick="switchView('rac')">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
                            <div class="rbd-card-icon">📎</div>
                            <div>
                                <h3 style="margin: 0; color: var(--primary);">Fichiers RAC</h3>
                                <p style="margin: 4px 0 0 0; font-size: 13px; color: var(--muted);">Raccordements</p>
                            </div>
                        </div>
                        <p class="rbd-card-description">
                            Importez et consultez les fichiers RAC.
                        </p>
                        <div class="rbd-badge-row">
                            <span class="rbd-badge rbd-badge-muted" id="stat-rac-count">0 RAC</span>
                        </div>
                    </div>

                </div>
            </div>
        </section>

        <!-- Guide rapide -->
        <section class="card">
            <div class="card-header">
                <h2>💡 Guide rapide</h2>
            </div>
            <div class="divider"></div>
            <ul style="margin: 0; padding-left: 20px; line-height: 1.8;">
                <li><strong>IED / ICD :</strong> Importez vos fichiers ICD et associez-les à des patterns IED.</li>
                <li><strong>Fichiers ISA :</strong> Organisez vos fichiers ISA par type de données.</li>
                <li><strong>Essais :</strong> Créez et gérez vos templates RU, CVS, MVS.</li>
                <li><strong>Wildcards :</strong> Utilisez <code>*</code> ou <code>?</code> pour matcher IED/LD/LN.</li>
                <li><strong>Plages :</strong> <code>IED1-2</code> = IED1 ou IED2.</li>
                <li><strong>Exclusions :</strong> Préfixez par <code>!</code> pour exclure (ex: <code>*BCU*, !*CBO*BCU*</code>).</li>
                <li><strong>Export :</strong> Téléchargez vos templates en JSON pour les partager.</li>
            </ul>
        </section>
    `;

    console.info("[HOME][Init] Layout home généré");
}


// ============================================================================
// INITIALISATION
// ============================================================================

/**
 * Initialise la vue Home.
 *
 * Appelée par app.js au démarrage. Génère le layout puis charge les stats.
 */
function initHomePage() {
    console.info("[HOME][Init] Initialisation de la page d'accueil");
    renderHomeLayout();
    refreshHomeDashboard();
}


// ============================================================================
// ACTUALISATION DES STATISTIQUES
// ============================================================================

/**
 * Actualiser les badges statistiques du dashboard.
 *
 * Appelée au démarrage et à chaque retour sur la vue Home.
 * Cette version lit prioritairement les compteurs backend (API),
 * pour refléter les données réellement présentes en base.
 */
async function refreshHomeDashboard() {
    console.info("[HOME][Stats] Actualisation des statistiques du dashboard");

    // Helper local pour éviter la répétition de garde DOM
    const setText = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    try {
        const [
            icdCatalog,
            icdPatterns,
            isaCatalog,
            isaTypes,
            racCatalog,
            ruEssais,
            cvsEssais,
            mvsEssais,
        ] = await Promise.all([
            apiIcd.getCatalog(),
            apiIcd.getPatterns(),
            apiIsa.getCatalog(),
            apiIsa.getTypes(),
            apiRac.list(),
            apiEssais.list("ru"),
            apiEssais.list("cvs"),
            apiEssais.list("mvs"),
        ]);

        // --- ICD / Patterns ---
        const icdCount = Number(icdCatalog?.count ?? icdCatalog?.icds?.length ?? 0);
        const patternCount = Number(icdPatterns?.count ?? icdPatterns?.patterns?.length ?? 0);
        setText("stat-icd-count", `${icdCount} ICD`);
        setText("stat-pattern-count", `${patternCount} patterns`);

        // --- ISA / Types ---
        const isaFileCount = Number(isaCatalog?.count ?? isaCatalog?.files?.length ?? 0);
        const isaTypeCount = Number(isaTypes?.count ?? isaTypes?.types?.length ?? 0);
        setText("stat-isa-count", `${isaFileCount} fichiers`);
        setText("stat-isa-types", `${isaTypeCount} types`);

        // --- RAC ---
        const racCount = Number(racCatalog?.count ?? racCatalog?.rac_list?.length ?? 0);
        setText("stat-rac-count", `${racCount} RAC`);

        // --- Essais RU/CVS/MVS ---
        const ruCount = Number(ruEssais?.count ?? ruEssais?.essais?.length ?? 0);
        const cvsCount = Number(cvsEssais?.count ?? cvsEssais?.essais?.length ?? 0);
        const mvsCount = Number(mvsEssais?.count ?? mvsEssais?.essais?.length ?? 0);

        const ruSteps = (ruEssais?.essais || []).reduce((sum, t) => sum + ((t?.steps || []).length), 0);
        const cvsSteps = (cvsEssais?.essais || []).reduce((sum, t) => sum + ((t?.steps || []).length), 0);
        const mvsSteps = (mvsEssais?.essais || []).reduce((sum, t) => sum + ((t?.steps || []).length), 0);

        const totalTests = ruCount + cvsCount + mvsCount;
        const totalSteps = ruSteps + cvsSteps + mvsSteps;

        setText("stat-ru-tests", `RU: ${ruCount}`);
        setText("stat-cvs-tests", `CVS: ${cvsCount}`);
        setText("stat-mvs-tests", `MVS: ${mvsCount}`);
        setText("stat-total-tests", `${totalTests} test${totalTests > 1 ? "s" : ""}`);
        setText("stat-total-steps", `${totalSteps} étape${totalSteps > 1 ? "s" : ""}`);

    } catch (error) {
        // En cas d'erreur API, conserver la page utilisable et afficher l'erreur en console.
        console.error("[HOME][Stats] Erreur de chargement des statistiques:", error);
    }
}
