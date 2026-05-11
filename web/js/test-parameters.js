// test-parameters.js - Catalogue Injections des essais R#BD.
//
// Ce module porte deux responsabilites distinctes :
//
//   1. Un objet `RbdTestParameters` qui expose le catalogue normalise
//      (fonctions, parametres, patterns IED, options de LD) au reste de
//      l'application R#BD. L'editeur de tests `test-editor.js` consomme
//      cet objet pour construire ses listes deroulantes : son API publique
//      doit donc rester strictement compatible avec l'existant.
//
//   2. Une vue d'edition "Parametre Test" presentee sous la forme d'un
//      tableau editable a 9 colonnes (Nom fonction, Description, IED,
//      Variante, LD, Nom parametre, Description param, Type, Actions). Le
//      style et le comportement (filtres par colonne, tri, datalists) sont
//      alignes sur les tableaux IDRC du module R_SCD pour preserver une
//      identite visuelle commune entre les applications.
//
// Toute logique metier (parsing PAR, normalisation des ids, validation des
// champs obligatoires) reste cote backend Python. Ce fichier ne fait que
// presenter et collecter les donnees pour l'utilisateur.

const RbdTestParameters = {
    // -----------------------------------------------------------------
    // Donnees de reference partagees avec test-editor.js
    // -----------------------------------------------------------------
    catalog: { functions: [] },
    patterns: [],
    icdDetailsCache: {},
    ldsByPattern: {},
    loaded: false,
    referencesLoaded: false,

    // -----------------------------------------------------------------
    // Etat propre a la vue d'edition (tableau)
    // -----------------------------------------------------------------
    // Liste plate des lignes editables construite a partir du catalogue.
    rows: [],
    // Filtres texte par colonne (cle = colKey, valeur = texte normalise).
    columnFilters: {},
    // Colonne de tri courante et sens (asc/desc).
    sortColumn: "function_name",
    sortAsc: true,
    // Erreurs de validation indexees par "rowId::field" pour mise en
    // evidence dans le DOM apres un echec de sauvegarde.
    validationErrors: {},

    async load(force = false) {
        if (this.loaded && !force) {
            return this.catalog;
        }

        try {
            this.catalog = await apiTestParameters.list();
            this.loaded = true;
        } catch (error) {
            console.warn("[UI][ESSAIS][PARAM] Catalogue indisponible", error);
            this.catalog = { functions: [] };
        }
        return this.catalog;
    },

    async save() {
        // Sauvegarde brute du catalogue tel quel. La vue d'edition appelle
        // `saveTestParameters()` qui se charge de regrouper les lignes du
        // tableau en structure `functions[].parameters[]` avant ce save.
        this.catalog = await apiTestParameters.save(this.catalog);
        this.loaded = true;
        return this.catalog;
    },

    async loadReferences(force = false) {
        if (this.referencesLoaded && !force) {
            return this.patterns;
        }

        try {
            const response = await apiIcd.getPatterns();
            this.patterns = response.patterns || response.ied_patterns || [];
            this.referencesLoaded = true;
        } catch (error) {
            console.warn("[UI][ESSAIS][PARAM] Patterns IED indisponibles", error);
            this.patterns = [];
        }
        return this.patterns;
    },

    async prepareLdOptionsForCatalog() {
        const patternIds = new Set();
        this.functions().forEach(func => {
            const patternId = func.variant || func.ied;
            if (patternId) {
                patternIds.add(patternId);
            }
        });

        for (const patternId of patternIds) {
            await this.ensureLdOptions(patternId);
        }
    },

    functions() {
        return Array.isArray(this.catalog?.functions) ? this.catalog.functions : [];
    },

    functionById(functionId) {
        const identifier = String(functionId || "");
        return this.functions().find(item => item.id === identifier || item.name === identifier) || null;
    },

    parametersFor(functionId) {
        return this.functionById(functionId)?.parameters || [];
    },

    parameterById(functionId, parameterId) {
        const identifier = String(parameterId || "");
        return this.parametersFor(functionId).find(item => item.id === identifier || item.name === identifier) || null;
    },

    optionLabelForFunction(func) {
        const suffix = [this.displayNameForPattern(func.variant || func.ied), func.ld].filter(Boolean).join(" / ");
        return suffix ? `${func.name} - ${suffix}` : func.name;
    },

    /**
     * Libelle court d'une fonction (Nom Fonction uniquement). Utilise pour les
     * listes deroulantes compactes ou la place est limitee. Le libelle complet
     * (avec variante / LD) reste disponible via optionLabelForFunction et est
     * pousse en attribut title pour servir de tooltip natif.
     */
    optionLabelForFunctionCompact(func) {
        return func?.name || "";
    },

    optionLabelForParameter(parameter) {
        return parameter.description ? `${parameter.name} - ${parameter.description}` : parameter.name;
    },

    /**
     * Libelle court d'un parametre (name uniquement). La description complete
     * est destinee a etre exposee via l'attribut title pour ne pas surcharger
     * la liste deroulante.
     */
    optionLabelForParameterCompact(parameter) {
        return parameter?.name || "";
    },

    /**
     * Retourne tous les parametres consideres comme parametres de temporisation
     * (cf. isTemporisationParameter), regroupes par fonction d'origine.
     */
    allTemporisationParameters() {
        const items = [];
        this.functions().forEach(func => {
            (func.parameters || []).forEach(parameter => {
                if (this.isTemporisationParameter(parameter)) {
                    items.push({
                        functionId: String(func.id || ""),
                        functionName: String(func.name || ""),
                        parameter
                    });
                }
            });
        });
        return items;
    },

    /**
     * Resout un parametre de temporisation a partir d'une valeur composite
     * "functionId::parameterId". Renvoie null si la valeur est vide ou
     * introuvable.
     */
    findTemporisationParameterByComposite(compositeValue) {
        const raw = String(compositeValue || "");
        if (!raw) {
            return null;
        }
        const [functionId, parameterId] = raw.split("::");
        if (!functionId || !parameterId) {
            return null;
        }
        const func = this.functionById(functionId);
        if (!func) {
            return null;
        }
        const parameter = (func.parameters || []).find(item => item.id === parameterId || item.name === parameterId) || null;
        if (!parameter) {
            return null;
        }
        return { functionId: String(func.id), functionName: String(func.name || ""), parameter };
    },

    isTemporisationParameter(parameter) {
        const name = String(parameter?.name || "").toUpperCase();
        const description = String(parameter?.description || "").toUpperCase();
        return name.startsWith("T-") || description.includes("TEMPORISATION");
    },

    parentPatterns() {
        return this.patterns
            .filter(pattern => !pattern.parent)
            .sort((a, b) => String(a.display_name || a.id).localeCompare(String(b.display_name || b.id), "fr"));
    },

    variantsFor(parentId) {
        return this.patterns
            .filter(pattern => pattern.parent === parentId)
            .sort((a, b) => String(a.display_name || a.id).localeCompare(String(b.display_name || b.id), "fr"));
    },

    patternById(patternId) {
        return this.patterns.find(pattern => pattern.id === patternId) || null;
    },

    displayNameForPattern(patternId) {
        const pattern = this.patternById(patternId);
        return pattern ? (pattern.display_name || pattern.id) : patternId;
    },

    async ensureLdOptions(patternId) {
        if (!patternId || this.ldsByPattern[patternId]) {
            return this.ldsByPattern[patternId] || [];
        }

        const pattern = this.patternById(patternId);
        const icdRefs = pattern?.icd_refs || [];
        const byName = new Map();

        for (const icdId of icdRefs) {
            const details = await this.loadIcdDetails(icdId);
            for (const ied of details?.ieds || []) {
                for (const ld of ied.lds || []) {
                    if (ld?.name && !byName.has(ld.name)) {
                        byName.set(ld.name, ld.name);
                    }
                }
            }
        }

        this.ldsByPattern[patternId] = [...byName.keys()].sort();
        return this.ldsByPattern[patternId];
    },

    async loadIcdDetails(icdId) {
        if (!icdId) {
            return null;
        }
        if (this.icdDetailsCache[icdId]) {
            return this.icdDetailsCache[icdId];
        }

        try {
            const response = await fetch(`/api/icd/details/${encodeURIComponent(icdId)}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            this.icdDetailsCache[icdId] = await response.json();
            return this.icdDetailsCache[icdId];
        } catch (error) {
            console.warn(`[UI][ESSAIS][PARAM] Details ICD indisponibles: ${icdId}`, error);
            return null;
        }
    }
};

window.RbdTestParameters = RbdTestParameters;

// =====================================================================
// Helpers HTML / texte partages
// =====================================================================

function escapeParameterHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

/**
 * Normalisation utilisee pour le filtrage par colonne : insensible a la
 * casse et aux accents. Reprise du pattern utilise dans les tableaux IDRC
 * du module R_SCD pour preserver une experience utilisateur homogene.
 */
function normalizeFilterText(value) {
    if (value == null) {
        return "";
    }
    return String(value)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim();
}

// =====================================================================
// Helpers d'options pour test-editor.js (API publique conservee)
// =====================================================================

function renderParameterOptions(functionId, selectedValue = "", options = {}) {
    const selected = String(selectedValue || "");
    const onlyTemporisation = Boolean(options.onlyTemporisation);
    const compact = Boolean(options.compact);
    const parameters = RbdTestParameters.parametersFor(functionId).filter(parameter =>
        !onlyTemporisation || RbdTestParameters.isTemporisationParameter(parameter)
    );

    if (!parameters.length) {
        return '<option value="">Aucun parametre disponible</option>';
    }

    return [
        '<option value="">Selectionner un parametre</option>',
        ...parameters.map(parameter => {
            const isSelected = selected === parameter.id || selected === parameter.name;
            const visibleLabel = compact
                ? RbdTestParameters.optionLabelForParameterCompact(parameter)
                : RbdTestParameters.optionLabelForParameter(parameter);
            const fullLabel = RbdTestParameters.optionLabelForParameter(parameter);
            const titleAttr = compact && fullLabel && fullLabel !== visibleLabel
                ? ` title="${escapeParameterHtml(fullLabel)}"`
                : "";
            return `
                <option value="${escapeParameterHtml(parameter.id)}" ${isSelected ? "selected" : ""}${titleAttr}>
                    ${escapeParameterHtml(visibleLabel)}
                </option>
            `;
        })
    ].join("");
}

function renderFunctionOptions(selectedValue = "", options = {}) {
    const selected = String(selectedValue || "");
    const compact = Boolean(options.compact);
    const functions = RbdTestParameters.functions();

    if (!functions.length) {
        return "<option value=\"\">Aucun type d'injection parametre</option>";
    }

    return [
        "<option value=\"\">Selectionner un type d'injection</option>",
        ...functions.map(func => {
            const isSelected = selected === func.id || selected === func.name;
            const visibleLabel = compact
                ? RbdTestParameters.optionLabelForFunctionCompact(func)
                : RbdTestParameters.optionLabelForFunction(func);
            const fullLabel = RbdTestParameters.optionLabelForFunction(func);
            const titleAttr = compact && fullLabel && fullLabel !== visibleLabel
                ? ` title="${escapeParameterHtml(fullLabel)}"`
                : "";
            return `
                <option value="${escapeParameterHtml(func.id)}" ${isSelected ? "selected" : ""}${titleAttr}>
                    ${escapeParameterHtml(visibleLabel)}
                </option>
            `;
        })
    ].join("");
}

/**
 * Construit les options du selecteur de parametre de temporisation a partir
 * de TOUTES les fonctions du catalogue. La valeur de chaque option est
 * composite et encode la fonction d'origine et le parametre sous la forme
 * "functionId::parameterId".
 */
function renderTemporisationParameterOptionsAllFunctions(selectedComposite = "") {
    const items = RbdTestParameters.allTemporisationParameters();

    if (!items.length) {
        return '<option value="">Aucun parametre de temporisation disponible</option>';
    }

    const selected = String(selectedComposite || "");

    const optionsHtml = items.map(({ functionId, functionName, parameter }) => {
        const composite = `${functionId}::${parameter.id}`;
        const isSelected = selected === composite;
        const visibleLabel = RbdTestParameters.optionLabelForParameterCompact(parameter);
        const tooltipParts = [];
        if (functionName) {
            tooltipParts.push(functionName);
        }
        if (parameter.description) {
            tooltipParts.push(parameter.description);
        }
        const tooltip = tooltipParts.join(" - ");
        const titleAttr = tooltip ? ` title="${escapeParameterHtml(tooltip)}"` : "";
        return `
            <option value="${escapeParameterHtml(composite)}" ${isSelected ? "selected" : ""}${titleAttr}>
                ${escapeParameterHtml(visibleLabel)}
            </option>
        `;
    }).join("");

    return `<option value="">Selectionner un parametre de temporisation</option>${optionsHtml}`;
}

// =====================================================================
// Vue d'edition "Parametre Test" - tableau a 9 colonnes
// =====================================================================

/**
 * Definition des colonnes du tableau editable. L'ordre conditionne
 * directement le rendu (en-tete, ligne de filtres, cellules editables).
 *
 *  - key       : identifiant interne dans une ligne `row[key]`
 *  - label     : libelle affiche dans l'en-tete
 *  - required  : true si le champ est obligatoire au moment de la sauvegarde
 *  - placeholder : texte d'aide affiche dans l'input editable
 */
const TEST_PARAM_COLUMNS = [
    { key: "function_name",         label: "Nom fonction",       required: true,  placeholder: "Nom fonction" },
    { key: "function_description",  label: "Description",        required: false, placeholder: "Description fonction" },
    { key: "ied",                   label: "IED",                required: true,  placeholder: "IED" },
    { key: "variant",               label: "Variante",           required: false, placeholder: "Variante" },
    { key: "ld",                    label: "LD",                 required: true,  placeholder: "LD" },
    { key: "parameter_name",        label: "Nom parametre",      required: true,  placeholder: "Nom parametre" },
    { key: "parameter_description", label: "Description param",  required: false, placeholder: "Description parametre" },
    { key: "type_parametre",        label: "Type",               required: false, placeholder: "Type" }
];

// Valeurs proposees dans la datalist de la colonne Type. La saisie reste
// libre pour permettre des types specifiques sans modifier le code.
const TEST_PARAM_TYPE_SUGGESTIONS = ["Numerique", "ListeDeValeurs", "Booleen", "Texte"];

// Compteur monotone pour generer des identifiants UI uniques par ligne.
let _testParamRowCounter = 0;

function _newRowId() {
    _testParamRowCounter += 1;
    return `tprow_${Date.now()}_${_testParamRowCounter}`;
}

/**
 * Convertit le catalogue hierarchique (functions[].parameters[]) en une
 * liste plate de lignes editables consommee par le tableau. Les ids de
 * fonction et de parametre d'origine sont preserves pour permettre une
 * sauvegarde sans casser les references stockees dans les essais.
 */
function _flattenCatalogToRows(catalog) {
    const rows = [];
    const functions = Array.isArray(catalog?.functions) ? catalog.functions : [];

    functions.forEach(func => {
        const baseFunctionFields = {
            functionId: String(func.id || ""),
            function_name: String(func.name || ""),
            function_description: String(func.description || ""),
            ied: String(func.ied || ""),
            variant: String(func.variant || ""),
            ld: String(func.ld || "")
        };

        const parameters = Array.isArray(func.parameters) ? func.parameters : [];

        if (!parameters.length) {
            // Fonction sans parametre : on cree une ligne vide pour qu'elle
            // reste editable. Une fois sauvegardee, la validation forcera
            // l'utilisateur a y saisir au moins un nom de parametre.
            rows.push({
                rowId: _newRowId(),
                parameterId: "",
                parameter_name: "",
                parameter_description: "",
                type_parametre: "",
                ...baseFunctionFields
            });
            return;
        }

        parameters.forEach(parameter => {
            rows.push({
                rowId: _newRowId(),
                parameterId: String(parameter.id || ""),
                parameter_name: String(parameter.name || ""),
                parameter_description: String(parameter.description || ""),
                type_parametre: String(parameter.type_parametre || ""),
                ...baseFunctionFields
            });
        });
    });

    return rows;
}

/**
 * Reconstruit la structure hierarchique attendue par le backend a partir
 * des lignes du tableau.
 *
 * Strategie de regroupement :
 *   1. On regroupe d'abord les lignes partageant le meme `functionId` non
 *      vide : cela preserve les ids historiques et donc les liens vers les
 *      essais existants.
 *   2. Pour les lignes sans `functionId` (lignes ajoutees manuellement), on
 *      regroupe par cle composite (nom + ied + variante + ld + description).
 *
 * Les ids manquants seront regeneres cote backend par `normalize_catalog`.
 */
function _rebuildCatalogFromRows(rows) {
    const functionsById = new Map();

    const buildKey = (row) => `__new__::${row.function_name}|${row.ied}|${row.variant}|${row.ld}|${row.function_description}`;

    rows.forEach(row => {
        const key = row.functionId ? `__id__::${row.functionId}` : buildKey(row);

        if (!functionsById.has(key)) {
            functionsById.set(key, {
                id: row.functionId || "",
                name: String(row.function_name || "").trim(),
                description: String(row.function_description || "").trim(),
                ied: String(row.ied || "").trim(),
                variant: String(row.variant || "").trim(),
                ld: String(row.ld || "").trim(),
                parameters: []
            });
        }

        const target = functionsById.get(key);

        // Si plusieurs lignes du meme groupe portent des descriptions de
        // fonction differentes, on conserve la premiere non vide rencontree.
        // Cela evite les pertes silencieuses lors d'une edition partielle.
        if (!target.description && row.function_description) {
            target.description = String(row.function_description).trim();
        }

        target.parameters.push({
            id: row.parameterId || "",
            name: String(row.parameter_name || "").trim(),
            description: String(row.parameter_description || "").trim(),
            type_parametre: String(row.type_parametre || "").trim()
        });
    });

    return {
        version: Number(RbdTestParameters.catalog?.version) || 1,
        functions: Array.from(functionsById.values())
    };
}

/**
 * Applique les filtres par colonne et le tri courant a une liste de lignes.
 * Le filtrage est insensible a la casse et aux accents.
 */
function _applyFiltersAndSort(rows) {
    const filters = RbdTestParameters.columnFilters || {};
    const filterEntries = Object.entries(filters)
        .map(([col, value]) => [col, normalizeFilterText(value)])
        .filter(([, value]) => value);

    let filtered = rows;
    if (filterEntries.length) {
        filtered = rows.filter(row => filterEntries.every(([col, needle]) => {
            const cellValue = normalizeFilterText(row[col]);
            return cellValue.includes(needle);
        }));
    }

    const sortColumn = RbdTestParameters.sortColumn || "function_name";
    const sortAsc = Boolean(RbdTestParameters.sortAsc);

    return [...filtered].sort((a, b) => {
        const va = String(a[sortColumn] || "");
        const vb = String(b[sortColumn] || "");
        const cmp = va.localeCompare(vb, "fr", { numeric: true, sensitivity: "base" });
        return sortAsc ? cmp : -cmp;
    });
}

/**
 * Calcule les valeurs distinctes d'une colonne pour alimenter la datalist
 * associee au champ de filtre. Les valeurs vides sont ignorees.
 */
function _distinctValuesForColumn(rows, colKey) {
    const set = new Set();
    rows.forEach(row => {
        const value = String(row[colKey] || "").trim();
        if (value) {
            set.add(value);
        }
    });
    return [...set].sort((a, b) => a.localeCompare(b, "fr", { numeric: true }));
}

async function openTestParameters() {
    const listView = document.getElementById("essais-list-view");
    const editorView = document.getElementById("essais-editor-view");
    const parametersView = document.getElementById("essais-parameters-view");

    if (listView) listView.style.display = "none";
    if (editorView) editorView.style.display = "none";
    if (parametersView) parametersView.style.display = "block";

    console.info("[UI][ESSAIS][PARAM] Ouverture de la vue Parametre Test");

    await RbdTestParameters.load(true);
    await RbdTestParameters.loadReferences(true);
    await RbdTestParameters.prepareLdOptionsForCatalog();

    // Synchronisation du tableau editable a partir du catalogue charge.
    RbdTestParameters.rows = _flattenCatalogToRows(RbdTestParameters.catalog);
    RbdTestParameters.validationErrors = {};

    renderTestParametersView();
}

function closeTestParameters() {
    const listView = document.getElementById("essais-list-view");
    const parametersView = document.getElementById("essais-parameters-view");

    if (parametersView) parametersView.style.display = "none";
    if (listView) listView.style.display = "block";
    if (typeof loadTemplatesList === "function") {
        loadTemplatesList();
    }
}

/**
 * Rendu complet de la vue (en-tete, barre d'actions, tableau editable).
 * Cette fonction reconstruit l'integralite du DOM. Pour les modifications
 * de cellule en cours de frappe, on utilise `_updateRowField()` qui ne
 * declenche pas de re-render afin de preserver le focus utilisateur.
 */
function renderTestParametersView() {
    const container = document.getElementById("essais-parameters-view");
    if (!container) {
        return;
    }

    const rows = Array.isArray(RbdTestParameters.rows) ? RbdTestParameters.rows : [];
    const filteredRows = _applyFiltersAndSort(rows);

    container.innerHTML = `
        <section class="card">
            <div class="card-header test-param-header">
                <div>
                    <h2 style="margin: 0;">Parametre Test</h2>
                    <p class="muted" style="margin: 4px 0 0 0;">
                        Catalogue Injections utilise par l'editeur d'essais.
                        Chaque ligne represente un couple (fonction, parametre).
                    </p>
                </div>
                <div class="test-param-actions">
                    <button class="btn btn-secondary" onclick="closeTestParameters()">Retour</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('test-parameter-import').click()">
                        Importer .par
                    </button>
                    <button class="btn btn-primary" onclick="saveTestParameters()">Sauvegarder</button>
                    <input id="test-parameter-import" type="file" accept=".par,.xml"
                        style="display:none" onchange="importTestParameterFile(event)">
                </div>
            </div>
            <div class="divider"></div>
            <div class="test-param-summary">
                <span>${filteredRows.length} / ${rows.length} ligne(s)</span>
                <span>${new Set(rows.map(r => r.function_name).filter(Boolean)).size} fonction(s) distinctes</span>
                <button class="btn btn-secondary" onclick="addTestParameterRow()">+ Ajouter ligne</button>
            </div>
        </section>

        <section class="card rbd-section-shell">
            <div class="divider"></div>
            <div class="test-param-table-wrapper">
                ${_renderTestParameterTable(rows, filteredRows)}
            </div>
        </section>
    `;

    _bindTestParameterTableEvents(container);
}

function _renderTestParameterTable(allRows, filteredRows) {
    // Premiere ligne d'en-tete : libelle + indicateur de tri cliquable.
    const headerCells = TEST_PARAM_COLUMNS.map(col => {
        const isSorted = RbdTestParameters.sortColumn === col.key;
        const arrow = isSorted ? (RbdTestParameters.sortAsc ? " \u25B2" : " \u25BC") : "";
        const requiredMark = col.required ? ' <span class="test-param-required" title="Champ obligatoire">*</span>' : "";
        return `
            <th class="test-param-th-sort" data-col="${col.key}" title="Trier par ${escapeParameterHtml(col.label)}">
                ${escapeParameterHtml(col.label)}${requiredMark}<span class="test-param-sort-arrow">${arrow}</span>
            </th>
        `;
    }).join("");

    // Deuxieme ligne d'en-tete : champs de filtre (datalist par colonne).
    const filterCells = TEST_PARAM_COLUMNS.map(col => {
        const listId = `tparam-dl-${col.key}`;
        const distinct = _distinctValuesForColumn(allRows, col.key);
        const opts = distinct.map(v => `<option value="${escapeParameterHtml(v)}"></option>`).join("");
        const currentVal = escapeParameterHtml(RbdTestParameters.columnFilters?.[col.key] || "");
        return `
            <th class="test-param-th-filter">
                <input type="text"
                       class="test-param-filter-input"
                       list="${listId}"
                       data-col="${col.key}"
                       value="${currentVal}"
                       placeholder="\uD83D\uDD0D"
                       title="Filtrer ${escapeParameterHtml(col.label)}" />
                <datalist id="${listId}">${opts}</datalist>
            </th>
        `;
    }).join("");

    // Corps du tableau : une ligne editable par entree filtree.
    const bodyHtml = filteredRows.length
        ? filteredRows.map(row => _renderTestParameterRow(row)).join("")
        : `
            <tr>
                <td colspan="${TEST_PARAM_COLUMNS.length + 1}" class="test-param-empty-cell">
                    Aucune ligne ne correspond aux filtres.
                </td>
            </tr>
        `;

    // Datalists globales (IED, Variantes, LD, Type) partagees entre toutes
    // les cellules pour faciliter la saisie sans imposer une valeur stricte.
    const globalDatalists = _renderGlobalDatalists();

    return `
        ${globalDatalists}
        <table class="test-param-table">
            <thead>
                <tr class="test-param-header-row">
                    ${headerCells}
                    <th class="test-param-th-actions">Actions</th>
                </tr>
                <tr class="test-param-filter-row">
                    ${filterCells}
                    <th class="test-param-th-filter test-param-th-actions"></th>
                </tr>
            </thead>
            <tbody class="test-param-tbody">
                ${bodyHtml}
            </tbody>
        </table>
    `;
}

function _renderGlobalDatalists() {
    // Liste des IED parents disponibles (issus du catalogue ICD).
    const iedOptions = RbdTestParameters.parentPatterns()
        .map(p => `<option value="${escapeParameterHtml(p.id)}">${escapeParameterHtml(p.display_name || p.id)}</option>`)
        .join("");

    // Toutes les variantes disponibles, tous IED confondus.
    const variantOptions = RbdTestParameters.patterns
        .filter(p => p.parent)
        .map(p => `<option value="${escapeParameterHtml(p.id)}">${escapeParameterHtml(p.display_name || p.id)}</option>`)
        .join("");

    // Tous les LD connus, dedoublonnes.
    const ldSet = new Set();
    Object.values(RbdTestParameters.ldsByPattern || {}).forEach(list => {
        (list || []).forEach(ld => { if (ld) ldSet.add(ld); });
    });
    const ldOptions = [...ldSet].sort()
        .map(ld => `<option value="${escapeParameterHtml(ld)}"></option>`)
        .join("");

    // Suggestions de types de parametre.
    const typeOptions = TEST_PARAM_TYPE_SUGGESTIONS
        .map(t => `<option value="${escapeParameterHtml(t)}"></option>`)
        .join("");

    return `
        <datalist id="tparam-global-ied">${iedOptions}</datalist>
        <datalist id="tparam-global-variant">${variantOptions}</datalist>
        <datalist id="tparam-global-ld">${ldOptions}</datalist>
        <datalist id="tparam-global-type">${typeOptions}</datalist>
    `;
}

/**
 * Met a jour dynamiquement la datalist des Variantes en fonction de l'IED
 * selectionne. Filtre les variantes pour afficher uniquement celles dont le
 * parent est l'IED choisi.
 *
 * Appel : quand l'utilisateur edite une cellule IED.
 */
function _updateVariantDatalistForIED(iedId) {
    if (!iedId) {
        // Si l'IED est vide, afficher toutes les variantes
        const variantOptions = RbdTestParameters.patterns
            .filter(p => p.parent)
            .map(p => `<option value="${escapeParameterHtml(p.id)}">${escapeParameterHtml(p.display_name || p.id)}</option>`)
            .join("");
        const datalist = document.getElementById("tparam-global-variant");
        if (datalist) {
            datalist.innerHTML = variantOptions;
        }
        return;
    }

    // Filtrer les variantes qui sont enfants de cet IED
    const variants = RbdTestParameters.variantsFor(iedId);
    const variantOptions = variants
        .map(v => `<option value="${escapeParameterHtml(v.id)}">${escapeParameterHtml(v.display_name || v.id)}</option>`)
        .join("");

    const datalist = document.getElementById("tparam-global-variant");
    if (datalist) {
        datalist.innerHTML = variantOptions;
    }
}

/**
 * Met a jour dynamiquement la datalist des LD en fonction de l'IED et la
 * Variante selectionnee. Charge et filtre les LD pour afficher uniquement
 * ceux qui correspondent a la combinaison IED/Variante choisie.
 *
 * Appel : quand l'utilisateur edite une cellule IED ou Variante.
 */
async function _updateLdDatalistForVariant(iedId, variantId) {
    // Determiner le pattern a utiliser (variante si specifiee, sinon IED)
    const patternId = variantId || iedId;
    if (!patternId) {
        // Afficher tous les LD
        const ldSet = new Set();
        Object.values(RbdTestParameters.ldsByPattern || {}).forEach(list => {
            (list || []).forEach(ld => { if (ld) ldSet.add(ld); });
        });
        const ldOptions = [...ldSet].sort()
            .map(ld => `<option value="${escapeParameterHtml(ld)}"></option>`)
            .join("");
        const datalist = document.getElementById("tparam-global-ld");
        if (datalist) {
            datalist.innerHTML = ldOptions;
        }
        return;
    }

    // Charger les LD pour ce pattern (et les options qui en dependent)
    const ldList = await RbdTestParameters.ensureLdOptions(patternId);
    const ldOptions = (ldList || [])
        .sort()
        .map(ld => `<option value="${escapeParameterHtml(ld)}"></option>`)
        .join("");

    const datalist = document.getElementById("tparam-global-ld");
    if (datalist) {
        datalist.innerHTML = ldOptions;
    }
}

function _renderTestParameterRow(row) {
    const cells = TEST_PARAM_COLUMNS.map(col => {
        const value = escapeParameterHtml(row[col.key] || "");
        const errorKey = `${row.rowId}::${col.key}`;
        const hasError = Boolean(RbdTestParameters.validationErrors?.[errorKey]);
        const errorClass = hasError ? " test-param-cell-error" : "";

        // Choix de la datalist selon la colonne pour proposer des
        // suggestions metier sans imposer une valeur stricte.
        let listAttr = "";
        if (col.key === "ied") listAttr = ' list="tparam-global-ied"';
        else if (col.key === "variant") listAttr = ' list="tparam-global-variant"';
        else if (col.key === "ld") listAttr = ' list="tparam-global-ld"';
        else if (col.key === "type_parametre") listAttr = ' list="tparam-global-type"';

        const titleAttr = hasError ? ' title="Champ obligatoire manquant"' : "";

        return `
            <td class="test-param-cell${errorClass}">
                <input type="text"
                       class="test-param-cell-input"
                       data-row-id="${escapeParameterHtml(row.rowId)}"
                       data-field="${col.key}"
                       value="${value}"
                       placeholder="${escapeParameterHtml(col.placeholder)}"${listAttr}${titleAttr} />
            </td>
        `;
    }).join("");

    return `
        <tr class="test-param-row" data-row-id="${escapeParameterHtml(row.rowId)}">
            ${cells}
            <td class="test-param-cell test-param-actions-cell">
                <button class="btn-icon-small test-param-btn-duplicate"
                        title="Dupliquer la ligne"
                        data-row-id="${escapeParameterHtml(row.rowId)}">\u29C9</button>
                <button class="btn-icon-small test-param-btn-delete"
                        title="Supprimer la ligne"
                        data-row-id="${escapeParameterHtml(row.rowId)}">\u2715</button>
            </td>
        </tr>
    `;
}

/**
 * Branche les evenements DOM apres chaque rendu complet du tableau :
 *   - tri en cliquant sur l'en-tete
 *   - filtrage par saisie dans la ligne de filtres (avec debounce)
 *   - edition de cellule (mise a jour immediate du modele, sans re-render)
 *   - actions Dupliquer / Supprimer par ligne
 */
function _bindTestParameterTableEvents(container) {
    // Tri sur les en-tetes de premiere ligne.
    container.querySelectorAll(".test-param-th-sort").forEach(th => {
        th.addEventListener("click", () => {
            const colKey = th.getAttribute("data-col");
            if (!colKey) return;
            if (RbdTestParameters.sortColumn === colKey) {
                RbdTestParameters.sortAsc = !RbdTestParameters.sortAsc;
            } else {
                RbdTestParameters.sortColumn = colKey;
                RbdTestParameters.sortAsc = true;
            }
            renderTestParametersView();
        });
    });

    // Filtres par colonne : on debounce pour eviter des re-renders a chaque
    // frappe sur de gros catalogues.
    let filterDebounce = null;
    container.querySelectorAll(".test-param-filter-input").forEach(input => {
        input.addEventListener("input", () => {
            clearTimeout(filterDebounce);
            filterDebounce = setTimeout(() => {
                const colKey = input.getAttribute("data-col");
                if (!colKey) return;
                if (!RbdTestParameters.columnFilters) {
                    RbdTestParameters.columnFilters = {};
                }
                RbdTestParameters.columnFilters[colKey] = input.value;
                renderTestParametersView();
                // On re-donne le focus au champ de filtre concerne et on
                // place le curseur en fin de saisie pour ne pas casser le
                // confort de frappe lors d'un filtre progressif.
                const refocused = document.querySelector(
                    `.test-param-filter-input[data-col="${colKey}"]`
                );
                if (refocused) {
                    refocused.focus();
                    const len = refocused.value.length;
                    refocused.setSelectionRange(len, len);
                }
            }, 200);
        });
    });

    // Edition de cellule : on met a jour le modele sans re-render pour
    // preserver le focus pendant la frappe utilisateur. On met aussi a jour
    // dynamiquement les datalists Variante et LD si l'IED ou Variante change.
    container.querySelectorAll(".test-param-cell-input").forEach(input => {
        input.addEventListener("input", async () => {
            const rowId = input.getAttribute("data-row-id");
            const field = input.getAttribute("data-field");
            _updateRowField(rowId, field, input.value);

            // Mise a jour dynamique des datalists dependants.
            if (field === "ied") {
                // Quand l'IED change, mettre a jour les variantes et LD
                _updateVariantDatalistForIED(input.value);
                await _updateLdDatalistForVariant(input.value, "");
            } else if (field === "variant") {
                // Quand la variante change, mettre a jour les LD
                const row = (RbdTestParameters.rows || []).find(r => r.rowId === rowId);
                const iedValue = row?.ied || "";
                await _updateLdDatalistForVariant(iedValue, input.value);
            }

            // Si la cellule etait en erreur et que l'utilisateur a saisi
            // quelque chose, on retire le marqueur visuel d'erreur.
            const errorKey = `${rowId}::${field}`;
            if (RbdTestParameters.validationErrors?.[errorKey] && input.value.trim()) {
                delete RbdTestParameters.validationErrors[errorKey];
                const cell = input.closest(".test-param-cell");
                if (cell) {
                    cell.classList.remove("test-param-cell-error");
                    input.removeAttribute("title");
                }
            }
        });
    });

    // Actions par ligne : duplication et suppression.
    container.querySelectorAll(".test-param-btn-duplicate").forEach(btn => {
        btn.addEventListener("click", () => duplicateTestParameterRow(btn.getAttribute("data-row-id")));
    });
    container.querySelectorAll(".test-param-btn-delete").forEach(btn => {
        btn.addEventListener("click", () => removeTestParameterRow(btn.getAttribute("data-row-id")));
    });
}

function _updateRowField(rowId, field, value) {
    if (!rowId || !field) return;
    const row = (RbdTestParameters.rows || []).find(r => r.rowId === rowId);
    if (row) {
        row[field] = value;
    }
}

function _findRowIndex(rowId) {
    return (RbdTestParameters.rows || []).findIndex(r => r.rowId === rowId);
}

function addTestParameterRow() {
    if (!Array.isArray(RbdTestParameters.rows)) {
        RbdTestParameters.rows = [];
    }
    RbdTestParameters.rows.push({
        rowId: _newRowId(),
        functionId: "",
        parameterId: "",
        function_name: "",
        function_description: "",
        ied: "",
        variant: "",
        ld: "",
        parameter_name: "",
        parameter_description: "",
        type_parametre: ""
    });
    console.info("[UI][ESSAIS][PARAM] Ligne ajoutee au tableau");
    renderTestParametersView();
}

function duplicateTestParameterRow(rowId) {
    const index = _findRowIndex(rowId);
    if (index < 0) return;
    const source = RbdTestParameters.rows[index];

    // La ligne dupliquee reprend toutes les valeurs metier mais recoit un
    // nouvel identifiant UI. Le `parameterId` est volontairement remis a
    // vide pour qu'un nouvel id stable soit attribue cote backend a la
    // sauvegarde : on evite ainsi qu'un meme parametre soit reference deux
    // fois avec le meme id technique. On preserve `functionId` lorsque la
    // duplication reste dans le perimetre d'une fonction existante.
    const clone = {
        ...source,
        rowId: _newRowId(),
        parameterId: ""
    };
    RbdTestParameters.rows.splice(index + 1, 0, clone);
    console.info("[UI][ESSAIS][PARAM] Ligne dupliquee");
    renderTestParametersView();
}

function removeTestParameterRow(rowId) {
    const index = _findRowIndex(rowId);
    if (index < 0) return;
    if (!confirm("Supprimer cette ligne du catalogue ?")) {
        return;
    }
    RbdTestParameters.rows.splice(index, 1);
    console.info("[UI][ESSAIS][PARAM] Ligne supprimee");
    renderTestParametersView();
}

/**
 * Validation cote frontend des champs obligatoires avant envoi au backend.
 * Retourne le nombre d'erreurs detectees et alimente
 * `RbdTestParameters.validationErrors` (cle `rowId::field`).
 */
function _validateRowsForSave() {
    const errors = {};
    const rows = RbdTestParameters.rows || [];

    rows.forEach(row => {
        TEST_PARAM_COLUMNS.forEach(col => {
            if (!col.required) return;
            const value = String(row[col.key] || "").trim();
            if (!value) {
                errors[`${row.rowId}::${col.key}`] = true;
            }
        });
    });

    RbdTestParameters.validationErrors = errors;
    return Object.keys(errors).length;
}

async function saveTestParameters() {
    const errorCount = _validateRowsForSave();
    if (errorCount > 0) {
        console.warn("[UI][ESSAIS][PARAM] Sauvegarde bloquee : %s champ(s) obligatoire(s) vide(s)", errorCount);
        renderTestParametersView();
        alert(
            `Sauvegarde impossible : ${errorCount} champ(s) obligatoire(s) non rempli(s).\n` +
            "Les cellules concernees sont mises en evidence en rouge dans le tableau."
        );
        return;
    }

    const rebuilt = _rebuildCatalogFromRows(RbdTestParameters.rows || []);
    RbdTestParameters.catalog = rebuilt;

    try {
        await RbdTestParameters.save();
        // Apres sauvegarde le backend peut avoir renumerote les ids :
        // on resynchronise le tableau pour que les futures editions
        // partent de l'etat persiste.
        RbdTestParameters.rows = _flattenCatalogToRows(RbdTestParameters.catalog);
        RbdTestParameters.validationErrors = {};
        renderTestParametersView();
        console.info("[UI][ESSAIS][PARAM] Catalogue sauvegarde avec succes");
        alert("Parametres de test sauvegardes.");
    } catch (error) {
        console.error("[UI][ESSAIS][PARAM] Sauvegarde impossible", error);
        alert(`Sauvegarde impossible: ${error.message}`);
    }
}

async function importTestParameterFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        console.info("[UI][ESSAIS][PARAM] Import .par : %s", file.name);
        // Le backend renvoie le catalogue importe SANS le persister :
        // l'utilisateur doit explicitement cliquer sur Sauvegarder pour
        // ecraser le catalogue courant. Cela laisse une chance de revenir
        // en arriere si l'import ne correspond pas au besoin.
        const importedCatalog = await apiTestParameters.importPar(file);
        RbdTestParameters.catalog = importedCatalog;
        RbdTestParameters.loaded = true;
        await RbdTestParameters.loadReferences();
        await RbdTestParameters.prepareLdOptionsForCatalog();
        RbdTestParameters.rows = _flattenCatalogToRows(RbdTestParameters.catalog);
        RbdTestParameters.validationErrors = {};
        renderTestParametersView();
        alert(
            "Import PAR termine. Les lignes sont chargees dans le tableau.\n" +
            "Cliquez sur Sauvegarder pour persister le nouveau catalogue."
        );
    } catch (error) {
        console.error("[UI][ESSAIS][PARAM] Import PAR impossible", error);
        alert(`Import PAR impossible: ${error.message}`);
    } finally {
        event.target.value = "";
    }
}
