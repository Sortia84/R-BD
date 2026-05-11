/**
 * header-loader.js — Charge le header mutualisé R#BD
 *
 * Rôle :
 * - Récupérer le composant HTML /components/header.html
 * - L'injecter au début du body
 * - Appliquer une configuration (titre/sous-titre/vue active)
 *
 * Pattern identique à R#SCD : plus de gestion de chemins relatifs
 * car la SPA est servie depuis la racine (html=True dans StaticFiles).
 */

/**
 * Charger et injecter le header mutualisé.
 *
 * @param {Object} config - Configuration du header
 * @param {string} [config.activeView="home"] - Vue active (home|icd|isa|essais|rac)
 * @param {string} [config.title="R#BD"] - Titre principal du header
 * @param {string} [config.subtitle="Base de données IEC 61850"] - Sous-titre
 * @returns {Promise<void>}
 */
async function loadHeader(config = {}) {
    const {
        activeView = "home",
        title = "R#BD",
        subtitle = "Base de données IEC 61850"
    } = config;

    try {
        // Charger le composant header depuis le serveur
        const response = await fetch("/components/header.html", { cache: "no-store" });
        if (!response.ok) {
            throw new Error(`HTTP ${response.status} lors du chargement du header`);
        }

        const html = await response.text();

        // Créer un conteneur temporaire pour parser la chaîne HTML
        const temp = document.createElement("div");
        temp.innerHTML = html;

        // Extraire la balise <header>
        const header = temp.querySelector("header");
        if (!header) {
            throw new Error("Composant header invalide : balise <header> absente");
        }

        // Injecter le header au tout début du body
        document.body.insertBefore(header, document.body.firstChild);

        // Appliquer les textes dynamiques configurables
        const titleElement = document.getElementById("rscd-header-title");
        if (titleElement) {
            titleElement.textContent = title;
        }

        const subtitleElement = document.getElementById("rscd-header-subtitle");
        if (subtitleElement) {
            subtitleElement.textContent = subtitle;
        }

        // Marquer le bouton de vue active pour cohérence visuelle initiale
        const tabs = document.querySelectorAll("#nav-main .rscd-tab");
        tabs.forEach((tab) => {
            tab.classList.remove("active");
            if (tab.dataset.view === activeView) {
                tab.classList.add("active");
            }
        });

        console.info("[Header] ✅ Header R#BD chargé");
    } catch (error) {
        console.error("[Header] ❌ Erreur chargement header:", error);
        throw error;
    }
}
