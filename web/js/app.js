/**
 * app.js — Bootstrap principal de l'application R#BD (SPA)
 *
 * Gère :
 * - L'initialisation globale de l'application
 * - Le changement de vues (home, icd, isa, essais, fcs, rac)
 * - Le chargement dynamique du header
 * - Les utilitaires globaux (_escHtml, showToast)
 * - Le logging centralisé
 *
 * Architecture SPA :
 *   Chaque vue est un <div id="view-xxx" class="rbd-view"> dans index.html.
 *   La navigation se fait via switchView() qui montre/masque les vues.
 *   Aucun rechargement de page — tout est géré côté client.
 */

// ============================================================================
// UTILITAIRE GLOBAL — Échappement HTML (protection XSS)
// ============================================================================

/**
 * Échapper un texte pour l'injecter en innerHTML de manière sûre.
 *
 * Fonction UNIQUE utilisée par tous les modules JS pour protéger
 * les injections innerHTML contenant des données issues du backend.
 *
 * @param {*} str - La valeur à échapper (null/undefined → chaîne vide)
 * @returns {string} Le texte HTML-safe
 */
function _escHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}


// ============================================================================
// UTILITAIRE GLOBAL — Toast / notification
// ============================================================================

/**
 * Afficher une notification toast temporaire.
 *
 * @param {string} message - Le message à afficher
 * @param {string} [type="info"] - Type: "info", "success", "warning", "error"
 * @param {number} [duration=3000] - Durée d'affichage en ms
 */
function showToast(message, type = "info", duration = 3000) {
    // Chercher ou créer le conteneur de toasts
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.className = "rbd-toast-container";
        document.body.appendChild(container);
    }

    // Créer le toast (protection XSS : on échappe le message)
    const toast = document.createElement("div");
    toast.className = `rbd-toast rbd-toast-${type}`;
    toast.innerHTML = _escHtml(message);

    // Ajouter et retirer après la durée
    container.appendChild(toast);
    setTimeout(() => {
        toast.classList.add("rbd-toast-fade");
        setTimeout(() => toast.remove(), 300);
    }, duration);
}


// ============================================================================
// ÉTAT APPLICATIF
// ============================================================================

/**
 * État global de l'application SPA.
 * - currentView : nom de la vue active
 * - initialized : true quand le bootstrap est terminé
 */
const appState = {
    currentView: "home",
    initialized: false
};

/** Liste des vues valides (correspondant aux data-view du header) */
const VALID_VIEWS = ["home", "icd", "isa", "essais", "fcs", "rac"];


// ============================================================================
// INITIALISATION
// ============================================================================

/**
 * Initialiser l'application.
 *
 * Appelée après le chargement du header. Elle :
 * 1. Initialise chaque module de vue
 * 2. Attache les handlers de navigation
 * 3. Charge les données initiales
 */
async function initApp() {
    console.info("[APP] Démarrage de l'application R#BD...");

    try {
        // Initialiser les modules de chaque vue
        // Chaque fonction init*() prépare l'UI de sa vue
        if (typeof initHomePage === "function") initHomePage();
        if (typeof initIedIcdPage === "function") initIedIcdPage();
        if (typeof initIsaPage === "function") initIsaPage();
        if (typeof initTemplatesPage === "function") initTemplatesPage();
        if (typeof initFcsPage === "function") initFcsPage();
        if (typeof initRacPage === "function") initRacPage();

        // Attacher les handlers de navigation sur les boutons du header
        attachNavHandlers();

        // Charger les données initiales (health check, stats...)
        await loadInitialData();

        // Marquer l'application comme prête
        appState.initialized = true;
        console.info("[APP] ✅ Application R#BD prête");

    } catch (error) {
        console.error("[APP] Erreur d'initialisation:", error);
        logErrorPage(error);
    }
}

/**
 * Charger les données initiales au démarrage.
 *
 * On ne bloque pas si une requête échoue — c'est un best-effort.
 */
async function loadInitialData() {
    try {
        console.info("[APP] Chargement des données initiales...");
        // Futures données à charger au démarrage (stats, config, etc.)
    } catch (error) {
        console.warn("[APP] Erreur données initiales:", error);
    }
}


// ============================================================================
// NAVIGATION SPA
// ============================================================================

/**
 * Attacher les handlers click sur les boutons de navigation du header.
 *
 * Chaque bouton a un attribut data-view (ex: data-view="icd").
 * Au clic, on appelle switchView() pour basculer la vue.
 */
function attachNavHandlers() {
    const tabs = document.querySelectorAll(".rscd-tab");

    tabs.forEach(tab => {
        tab.addEventListener("click", () => {
            const viewName = tab.dataset.view;
            if (viewName) {
                switchView(viewName);
            }
        });
    });

    console.info(`[APP] ${tabs.length} handlers de navigation attachés`);
}

/**
 * Changer de vue dans la SPA.
 *
 * Étapes :
 * 1. Valider le nom de vue
 * 2. Désactiver tous les tabs
 * 3. Activer le tab courant
 * 4. Masquer toutes les vues
 * 5. Afficher la vue demandée
 * 6. Déclencher les actions spécifiques à la vue
 *
 * @param {string} viewName - Nom de la vue (ex: "icd", "isa", "essais")
 */
function switchView(viewName) {
    // Valider que la vue demandée existe
    if (!VALID_VIEWS.includes(viewName)) {
        console.warn(`[APP] Vue invalide demandée: "${viewName}"`);
        return;
    }

    console.info(`[APP] Navigation → ${viewName}`);

    // 1. Désactiver tous les tabs du header
    document.querySelectorAll(".rscd-tab").forEach(tab => {
        tab.classList.remove("active");
    });

    // 2. Activer le tab correspondant
    const activeTab = document.querySelector(`.rscd-tab[data-view="${viewName}"]`);
    if (activeTab) {
        activeTab.classList.add("active");
    }

    // 3. Masquer toutes les vues
    document.querySelectorAll(".rbd-view").forEach(view => {
        view.classList.remove("active");
    });

    // 4. Afficher la vue demandée
    const viewElement = document.getElementById(`view-${viewName}`);
    if (viewElement) {
        viewElement.classList.add("active");
    } else {
        console.warn(`[APP] Élément #view-${viewName} introuvable dans le DOM`);
    }

    // 5. Mettre à jour l'état applicatif
    appState.currentView = viewName;

    // 6. Déclencher les actions spécifiques à la vue
    handleViewSwitch(viewName);
}

/**
 * Gérer les actions spécifiques lors du changement de vue.
 *
 * Permet à chaque vue de recharger ses données ou réinitialiser son état
 * quand l'utilisateur y revient.
 *
 * @param {string} viewName - Nom de la vue activée
 */
function handleViewSwitch(viewName) {
    switch (viewName) {
        case "home":
            // Recharger les statistiques de l'accueil si besoin
            if (typeof refreshHomeDashboard === "function") refreshHomeDashboard();
            break;

        case "icd":
            // Recharger le catalogue ICD
            if (typeof loadCatalog === "function") loadCatalog();
            break;

        case "isa":
            // Recharger les types ISA
            if (typeof loadIsaData === "function") loadIsaData();
            break;

        case "essais":
            // Recharger les templates essais
            if (typeof loadTemplates === "function") loadTemplates();
            break;

        case "fcs":
            // Recharger les FCS
            if (typeof loadFcsList === "function") loadFcsList();
            break;

        case "rac":
            // Recharger les RAC
            if (typeof loadRacList === "function") loadRacList();
            break;
    }
}


// ============================================================================
// GESTION D'ERREUR GLOBALE
// ============================================================================

/**
 * Afficher une page d'erreur quand l'initialisation échoue.
 *
 * Remplace le contenu de la vue active par un message d'erreur lisible.
 *
 * @param {Error} error - L'erreur capturée
 */
function logErrorPage(error) {
    const container = document.querySelector(".rbd-view.active") || document.querySelector(".rbd-view");
    if (container) {
        const safeMessage = _escHtml(error.message);
        const safeStack = _escHtml(error.stack || "");
        container.innerHTML = `
            <div class="rbd-card" style="border: 2px solid var(--danger); padding: 20px;">
                <h2 style="color: var(--danger);">⚠️ Erreur d'initialisation</h2>
                <p><strong>Détail :</strong></p>
                <pre style="background: #f0f0f0; padding: 10px; border-radius: 4px; overflow-x: auto;">
${safeMessage}
${safeStack}
                </pre>
                <button class="rbd-btn rbd-btn-primary" onclick="location.reload()">
                    Recharger la page
                </button>
            </div>
        `;
    }
}


// ============================================================================
// POINT D'ENTRÉE — Au chargement du DOM
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
    console.info("[APP] DOM chargé, début du bootstrap...");

    /**
     * Séquence d'initialisation :
     * 1. Charger le header mutualisé (contient la navigation)
     * 2. Vérifier la présence des éléments critiques
     * 3. Démarrer l'application
     */
    (async () => {
        try {
            // Étape 1 : Charger le header dynamique
            if (typeof loadHeader === "function") {
                await loadHeader({
                    activeView: "home",
                    title: "R#BD",
                    subtitle: "Base de données IEC 61850"
                });
            } else {
                console.warn("[APP] loadHeader indisponible — bootstrap sans header");
            }

            // Étape 2 : Vérifier que les éléments critiques sont présents
            const nav = document.getElementById("nav-main");
            const viewHome = document.getElementById("view-home");

            if (!nav || !viewHome) {
                console.error("[APP] Structure HTML incompatible — nav ou view-home manquant !");
                return;
            }

            // Étape 3 : Initialiser la logique applicative
            await initApp();

            // Debug : raccourcis utiles en console
            console.info("[APP] Debug helpers disponibles :");
            console.info("  switchView('icd')  — changer de vue");
            console.info("  appState           — état courant");

        } catch (error) {
            console.error("[APP] Échec du bootstrap:", error);
            logErrorPage(error);
        }
    })();
});


// ============================================================================
// DEBUG HELPERS (accessibles dans la console)
// ============================================================================

window.DEBUG = {
    /** Forcer le changement de vue */
    goTo: (view) => switchView(view),

    /** Afficher l'état courant */
    state: () => console.table(appState),

    /** Lister les vues disponibles */
    views: () => console.log("Vues :", VALID_VIEWS)
};
