/**
 * api.js — Couche API centralisée pour R#BD
 *
 * Toutes les fonctions ici font des appels HTTP vers /api/* endpoints.
 * Pas de logique métier — juste des requêtes/réponses.
 *
 * Organisation :
 *   - api.get / api.post / api.upload / api.delete  → outils génériques
 *   - apiIcd    → endpoints ICD (import, catalogue, patterns)
 *   - apiIsa    → endpoints ISA (import, types, fichiers)
 *   - apiEssais → endpoints Essais (CRUD RU/CVS/MVS)
 *   - apiTemplates → endpoints Templates (CRUD)
 *   - apiFcs    → endpoints FCS (import, catalogue)
 *   - apiRac    → endpoints RAC (import, catalogue)
 */

// ============================================================================
// BASE URL — Tous les endpoints API sont préfixés par /api
// ============================================================================
const API_BASE = "/api";

// ============================================================================
// OUTILS GÉNÉRIQUES
// ============================================================================

/**
 * Objet utilitaire pour les appels HTTP génériques.
 * Chaque méthode gère automatiquement l'erreur et la désérialisation JSON.
 */
const api = {
    /**
     * GET simple vers un endpoint API.
     * @param {string} endpoint - Chemin relatif de l'endpoint (ex: "/icd/")
     * @returns {Promise<Object>} Réponse JSON du serveur
     */
    get: async (endpoint) => {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`[API][GET] ${endpoint}:`, error);
            throw error;
        }
    },

    /**
     * POST avec body JSON.
     * @param {string} endpoint - Chemin relatif de l'endpoint
     * @param {Object} data - Données à envoyer en JSON
     * @returns {Promise<Object>} Réponse JSON du serveur
     */
    post: async (endpoint, data = {}) => {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`[API][POST] ${endpoint}:`, error);
            throw error;
        }
    },

    /**
     * POST multipart (upload de fichier).
     * @param {string} endpoint - Chemin relatif de l'endpoint
     * @param {File} file - Fichier à uploader
     * @param {Object} [extraFields={}] - Champs FormData supplémentaires
     * @returns {Promise<Object>} Réponse JSON du serveur
     */
    upload: async (endpoint, file, extraFields = {}) => {
        try {
            const formData = new FormData();
            formData.append("file", file);
            // Ajouter les champs supplémentaires (ex: type_id pour ISA)
            for (const [key, value] of Object.entries(extraFields)) {
                formData.append(key, value);
            }
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: "POST",
                body: formData
            });
            if (!response.ok) {
                // On tente de récupérer le détail métier renvoyé par FastAPI
                // (ex: detail explicite sur validation RAC).
                let detail = `HTTP ${response.status}`;
                try {
                    const payload = await response.json();
                    detail = payload?.detail || payload?.message || detail;
                } catch (_) {
                    // Si le backend ne renvoie pas de JSON, on garde le fallback.
                }
                throw new Error(detail);
            }
            return await response.json();
        } catch (error) {
            console.error(`[API][UPLOAD] ${endpoint}:`, error);
            throw error;
        }
    },

    /**
     * DELETE vers un endpoint API.
     * @param {string} endpoint - Chemin relatif de l'endpoint
     * @returns {Promise<Object>} Réponse JSON du serveur
     */
    delete: async (endpoint) => {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: "DELETE"
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`[API][DELETE] ${endpoint}:`, error);
            throw error;
        }
    },

    /**
     * PUT avec body JSON.
     * @param {string} endpoint - Chemin relatif de l'endpoint
     * @param {Object} data - Données à envoyer en JSON
     * @returns {Promise<Object>} Réponse JSON du serveur
     */
    put: async (endpoint, data = {}) => {
        try {
            const response = await fetch(`${API_BASE}${endpoint}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(data)
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return await response.json();
        } catch (error) {
            console.error(`[API][PUT] ${endpoint}:`, error);
            throw error;
        }
    }
};


// ============================================================================
// API ICD — Import, catalogue, patterns IED
// ============================================================================

const apiIcd = {
    /** Récupérer le catalogue ICD complet */
    getCatalog: () => api.get("/icd/"),

    /** Importer un fichier ICD */
    upload: (file) => api.upload("/icd/upload", file),

    /** Récupérer les détails d'un ICD */
    getDetails: (icdId) => api.get(`/icd/${encodeURIComponent(icdId)}`),

    /** Supprimer un ICD */
    remove: (icdId) => api.delete(`/icd/${encodeURIComponent(icdId)}`),

    /** Ré-analyser un ICD */
    reanalyze: (icdId) => api.post(`/icd/${encodeURIComponent(icdId)}/reanalyze`),

    /** Ré-analyser tous les ICD */
    reanalyzeAll: () => api.post("/icd/reanalyze-all"),

    /** Récupérer les patterns IED */
    getPatterns: () => api.get("/icd/patterns"),

    /** Créer un pattern IED */
    createPattern: (data) => api.post("/icd/patterns", data),

    /** Supprimer un pattern IED */
    deletePattern: (patternId) => api.delete(`/icd/patterns/${encodeURIComponent(patternId)}`),

    /** Lier un ICD à un pattern */
    linkIcd: (patternId, icdId) => api.post(`/icd/patterns/${encodeURIComponent(patternId)}/link/${encodeURIComponent(icdId)}`),

    /** Délier un ICD d'un pattern */
    unlinkIcd: (patternId, icdId) => api.delete(`/icd/patterns/${encodeURIComponent(patternId)}/link/${encodeURIComponent(icdId)}`),
};


// ============================================================================
// API ISA — Import, types, fichiers, référents
// ============================================================================

const apiIsa = {
    /** Récupérer le catalogue ISA complet */
    getCatalog: () => api.get("/isa/"),

    /** Récupérer les types ISA */
    getTypes: () => api.get("/isa/types"),

    /** Importer un fichier ISA (optionnel: type_id pour auto-link) */
    upload: (file, typeId = null) => {
        const extra = typeId ? { type_id: typeId } : {};
        return api.upload("/isa/upload", file, extra);
    },

    /** Supprimer un fichier ISA */
    remove: (fileId) => api.delete(`/isa/${encodeURIComponent(fileId)}`),

    /** Définir un fichier comme référent pour un type */
    setDefault: (typeId, fileId) => api.post(`/isa/default/${encodeURIComponent(typeId)}/${encodeURIComponent(fileId)}`),

    /** Supprimer le référent d'un type */
    removeDefault: (typeId) => api.delete(`/isa/default/${encodeURIComponent(typeId)}`),

    /** Lier un fichier à un type */
    linkFile: (typeId, fileId) => api.post(`/isa/link/${encodeURIComponent(typeId)}/${encodeURIComponent(fileId)}`),

    /** Délier un fichier d'un type */
    unlinkFile: (typeId, fileId) => api.delete(`/isa/link/${encodeURIComponent(typeId)}/${encodeURIComponent(fileId)}`),
};


// ============================================================================
// API ESSAIS — CRUD essais RU/CVS/MVS
// ============================================================================

const apiEssais = {
    /** Lister les essais d'un type */
    list: (type = "ru") => api.get(`/essais?type=${encodeURIComponent(type)}`),

    /** Récupérer un essai par ID */
    getById: (essaiId, type = "ru") => api.get(`/essais/${encodeURIComponent(essaiId)}?type=${encodeURIComponent(type)}`),

    /** Créer ou mettre à jour un essai */
    save: (essaiData) => api.post("/essais", essaiData),

    /** Supprimer un essai */
    remove: (essaiId, type = "ru") => api.delete(`/essais/${encodeURIComponent(essaiId)}?type=${encodeURIComponent(type)}`),

    /** Synchroniser un type (localStorage → serveur) */
    sync: (type, essais) => api.post("/essais/sync", { type, essais }),
};


// ============================================================================
// API TEMPLATES — CRUD templates RU/CVS/MVS
// ============================================================================

const apiTemplates = {
    /** Lister les templates d'un type */
    list: (type = "ru") => api.get(`/v1/templates/${encodeURIComponent(type)}`),

    /** Récupérer un template */
    getById: (type, templateId) => api.get(`/v1/templates/${encodeURIComponent(type)}/${encodeURIComponent(templateId)}`),

    /** Créer un template */
    create: (type, data) => api.post(`/v1/templates/${encodeURIComponent(type)}`, data),

    /** Mettre à jour un template */
    update: (type, templateId, data) => api.put(`/v1/templates/${encodeURIComponent(type)}/${encodeURIComponent(templateId)}`, data),
};


// ============================================================================
// API FCS — Import et consultation FCS
// ============================================================================

const apiFcs = {
    /** Lister les FCS importés */
    list: () => api.get("/fcs/list"),

    /** Importer un fichier FCS */
    upload: (file) => api.upload("/fcs/import", file),

    /** Récupérer les détails d'un FCS */
    getDetails: (fcsId) => api.get(`/fcs/${encodeURIComponent(fcsId)}`),

    /** Supprimer un FCS */
    remove: (fcsId) => api.delete(`/fcs/${encodeURIComponent(fcsId)}`),
};


// ============================================================================
// API RAC — Import et consultation fichiers RAC
// ============================================================================

const apiRac = {
    /** Lister les catégories RAC */
    categories: () => api.get("/rac/categories"),

    /** Lister les fichiers RAC importés */
    list: () => api.get("/rac/list"),

    /** Lister les RAC groupés (catégorie + clé + versions) */
    grouped: (categoryId = null) => {
        const suffix = categoryId ? `?category_id=${encodeURIComponent(categoryId)}` : "";
        return api.get(`/rac/grouped${suffix}`);
    },

    /** Récupérer les versions d'un groupe RAC */
    versions: (categoryId, racKey) =>
        api.get(`/rac/versions/${encodeURIComponent(categoryId)}/${encodeURIComponent(racKey)}`),

    /** Importer un fichier RAC */
    upload: (file, categoryId) => api.upload("/rac/import", file, { category_id: categoryId }),

    /** Récupérer les détails d'un fichier RAC */
    getDetails: (racId) => api.get(`/rac/${encodeURIComponent(racId)}`),

    /** Récupérer le JSON RAC normalisé */
    getParsed: (racId) => api.get(`/rac/${encodeURIComponent(racId)}/parsed`),

    /** Récupérer le payload enrichi pour la vue d'inspection RAC */
    getInspection: (racId) => api.get(`/rac/${encodeURIComponent(racId)}/inspection`),

    /** Récupérer les brouillons enregistrés de l'inspection RAC */
    getInspectionDrafts: (racId) => api.get(`/rac/${encodeURIComponent(racId)}/inspection-drafts`),

    /** Sauvegarder automatiquement le brouillon graphique d'une liaison RAC */
    saveInspectionDraft: (racId, trackId, draft) => api.put(
        `/rac/${encodeURIComponent(racId)}/inspection-drafts/${encodeURIComponent(trackId)}`,
        draft
    ),

    /** Récupérer les liens câblage RAC (usage BayView/R#SCD) */
    getLinks: (params = {}) => {
        const search = new URLSearchParams();
        Object.entries(params || {}).forEach(([k, v]) => {
            if (v !== null && v !== undefined && `${v}` !== "") {
                search.append(k, `${v}`);
            }
        });
        const suffix = search.toString() ? `?${search.toString()}` : "";
        return api.get(`/rac/links${suffix}`);
    },

    /** Supprimer un fichier RAC */
    remove: (racId) => api.delete(`/rac/${encodeURIComponent(racId)}`),
};
