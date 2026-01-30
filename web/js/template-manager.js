// template-manager.js - Gestionnaire de templates RU

class TemplateManager {
    constructor(templateType = 'ru') {
        this.templateType = templateType;
        this.templatesKey = `templates_${templateType}`;
        this.templates = this.loadFromLocalStorage();
    }

    /**
     * Charge les templates depuis le localStorage
     */
    loadFromLocalStorage() {
        try {
            const data = localStorage.getItem(this.templatesKey);
            return data ? JSON.parse(data) : [];
        } catch (error) {
            console.error('Erreur chargement templates:', error);
            return [];
        }
    }

    /**
     * Sauvegarde les templates dans le localStorage
     */
    saveToLocalStorage() {
        try {
            localStorage.setItem(this.templatesKey, JSON.stringify(this.templates));
            return true;
        } catch (error) {
            console.error('Erreur sauvegarde templates:', error);
            return false;
        }
    }

    /**
     * Liste tous les templates
     */
    listTemplates() {
        return this.templates;
    }

    /**
     * Vérifie si une valeur correspond à un pattern avec wildcard (*, ?)
     */
    matchPattern(value, pattern) {
        if (!pattern || pattern === '*') {
            return true;
        }

        const safeValue = String(value || '');
        const patterns = this.expandPatternList(pattern);

        if (!patterns.length) {
            return true;
        }

        const includes = patterns.filter(item => !item.exclude);
        const excludes = patterns.filter(item => item.exclude);

        if (excludes.some(item => this.matchSinglePattern(safeValue, item.pattern))) {
            return false;
        }

        if (includes.length === 0) {
            return true;
        }

        return includes.some(item => this.matchSinglePattern(safeValue, item.pattern));
    }

    expandPatternList(pattern) {
        const raw = String(pattern)
            .split(/[,;\s]+/)
            .map(item => item.trim())
            .filter(Boolean);

        return raw.flatMap(item => {
            const exclude = item.startsWith('!') || item.startsWith('-');
            const cleaned = exclude ? item.slice(1) : item;
            const expanded = this.expandRangePattern(cleaned);
            return expanded.map(entry => ({ pattern: entry, exclude }));
        });
    }

    expandRangePattern(pattern) {
        const match = pattern.match(/^(.*?)(\d+)-(\d+)(.*?)$/i);
        if (!match) {
            return [pattern];
        }

        const [, prefix, start, end, suffix] = match;
        const startNum = Number(start);
        const endNum = Number(end);

        if (Number.isNaN(startNum) || Number.isNaN(endNum)) {
            return [pattern];
        }

        const range = [];
        const step = startNum <= endNum ? 1 : -1;
        for (let i = startNum; step > 0 ? i <= endNum : i >= endNum; i += step) {
            range.push(`${prefix}${i}${suffix}`);
        }
        return range;
    }

    matchSinglePattern(value, pattern) {
        if (!pattern || pattern === '*') {
            return true;
        }
        const escaped = String(pattern).replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const regexPattern = `^${escaped.replace(/\*/g, '.*').replace(/\?/g, '.')}$`;
        const regex = new RegExp(regexPattern, 'i');
        return regex.test(String(value || ''));
    }

    /**
     * Vérifie un match IED/LD/LN/LNinst avec wildcards
     */
    matchHierarchy({ ied, ld, ln, lninst }, { iedPattern, ldPattern, lnPattern, lninstPattern }) {
        return this.matchPattern(ied, iedPattern)
            && this.matchPattern(ld, ldPattern)
            && this.matchPattern(ln, lnPattern)
            && this.matchPattern(lninst, lninstPattern);
    }

    /**
     * Charge un template spécifique
     */
    getTemplate(templateId) {
        return this.templates.find(t => t.id === templateId);
    }

    /**
     * Crée un nouveau template
     */
    createTemplate(templateData) {
        // Générer un ID si absent
        if (!templateData.id) {
            templateData.id = `template_${Date.now()}`;
        }

        // Vérifier si l'ID existe déjà
        if (this.templates.find(t => t.id === templateData.id)) {
            throw new Error('Un template avec cet ID existe déjà');
        }

        // Ajouter métadonnées
        templateData.created_at = new Date().toISOString();
        templateData.updated_at = new Date().toISOString();

        // Ajouter le template
        this.templates.push(templateData);
        this.saveToLocalStorage();

        return templateData.id;
    }

    /**
     * Met à jour un template existant
     */
    updateTemplate(templateId, templateData) {
        const index = this.templates.findIndex(t => t.id === templateId);

        if (index === -1) {
            throw new Error('Template introuvable');
        }

        // Conserver les métadonnées de création
        templateData.created_at = this.templates[index].created_at;
        templateData.updated_at = new Date().toISOString();
        templateData.id = templateId;

        this.templates[index] = templateData;
        this.saveToLocalStorage();

        return true;
    }

    /**
     * Supprime un template
     */
    deleteTemplate(templateId) {
        const index = this.templates.findIndex(t => t.id === templateId);

        if (index === -1) {
            throw new Error('Template introuvable');
        }

        this.templates.splice(index, 1);
        this.saveToLocalStorage();

        return true;
    }

    /**
     * Duplique un template
     */
    duplicateTemplate(templateId) {
        const original = this.getTemplate(templateId);

        if (!original) {
            throw new Error('Template introuvable');
        }

        const duplicate = JSON.parse(JSON.stringify(original));
        duplicate.id = `${templateId}_copy_${Date.now()}`;
        duplicate.name = `${original.name} (copie)`;
        delete duplicate.created_at;
        delete duplicate.updated_at;

        return this.createTemplate(duplicate);
    }

    /**
     * Exporte un template en JSON
     */
    exportTemplate(templateId) {
        const template = this.getTemplate(templateId);

        if (!template) {
            throw new Error('Template introuvable');
        }

        const blob = new Blob([JSON.stringify(template, null, 2)], {
            type: 'application/json'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${template.id}.json`;
        a.click();
        URL.revokeObjectURL(url);

        return true;
    }

    /**
     * Importe un template depuis un fichier JSON
     */
    async importTemplate(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const templateData = JSON.parse(e.target.result);

                    // Valider la structure
                    this.validateTemplate(templateData);

                    // Créer le template
                    const id = this.createTemplate(templateData);
                    resolve(id);
                } catch (error) {
                    reject(error);
                }
            };

            reader.onerror = () => reject(new Error('Erreur lecture fichier'));
            reader.readAsText(file);
        });
    }

    /**
     * Valide la structure d'un template
     */
    validateTemplate(templateData) {
        const required = ['name', 'type', 'tranches'];

        for (const field of required) {
            if (!templateData[field]) {
                throw new Error(`Champ requis manquant: ${field}`);
            }
        }

        // Validation des tranches
        if (!Array.isArray(templateData.tranches)) {
            throw new Error('Le champ "tranches" doit être un tableau');
        }

        for (const tranche of templateData.tranches) {
            if (!tranche.name || !Array.isArray(tranche.ieds)) {
                throw new Error('Structure de tranche invalide');
            }
        }

        return true;
    }

    /**
     * Compte le nombre total d'IEDs dans un template
     */
    countIEDs(template) {
        return template.tranches.reduce((sum, tranche) => sum + tranche.ieds.length, 0);
    }

    /**
     * Compte le nombre total de fonctions dans un template
     */
    countFonctions(template) {
        let total = 0;
        for (const tranche of template.tranches) {
            for (const ied of tranche.ieds) {
                total += ied.fonctions.length;
            }
        }
        return total;
    }

    /**
     * Compte le nombre total de tests dans un template
     */
    countTests(template) {
        let total = 0;
        for (const tranche of template.tranches) {
            for (const ied of tranche.ieds) {
                for (const fonction of ied.fonctions) {
                    total += fonction.logical_nodes.length;
                }
            }
        }
        return total;
    }
}
