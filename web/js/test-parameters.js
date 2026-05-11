// test-parameters.js - Gestion du catalogue Injections des essais R#BD.

const RbdTestParameters = {
    catalog: { functions: [] },
    patterns: [],
    icdDetailsCache: {},
    ldsByPattern: {},
    loaded: false,
    referencesLoaded: false,

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

    optionLabelForParameter(parameter) {
        return parameter.description ? `${parameter.name} - ${parameter.description}` : parameter.name;
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

function escapeParameterHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    }[char]));
}

function renderParameterOptions(functionId, selectedValue = "", options = {}) {
    const selected = String(selectedValue || "");
    const onlyTemporisation = Boolean(options.onlyTemporisation);
    const parameters = RbdTestParameters.parametersFor(functionId).filter(parameter =>
        !onlyTemporisation || RbdTestParameters.isTemporisationParameter(parameter)
    );

    if (!parameters.length) {
        return '<option value="">Aucun parametre disponible</option>';
    }

    return [
        '<option value="">Selectionner un parametre</option>',
        ...parameters.map(parameter => `
            <option value="${escapeParameterHtml(parameter.id)}" ${selected === parameter.id || selected === parameter.name ? "selected" : ""}>
                ${escapeParameterHtml(RbdTestParameters.optionLabelForParameter(parameter))}
            </option>
        `)
    ].join("");
}

function renderFunctionOptions(selectedValue = "") {
    const selected = String(selectedValue || "");
    const functions = RbdTestParameters.functions();

    if (!functions.length) {
        return "<option value=\"\">Aucun type d'injection parametre</option>";
    }

    return [
        "<option value=\"\">Selectionner un type d'injection</option>",
        ...functions.map(func => `
            <option value="${escapeParameterHtml(func.id)}" ${selected === func.id || selected === func.name ? "selected" : ""}>
                ${escapeParameterHtml(RbdTestParameters.optionLabelForFunction(func))}
            </option>
        `)
    ].join("");
}

async function openTestParameters() {
    const listView = document.getElementById("essais-list-view");
    const editorView = document.getElementById("essais-editor-view");
    const parametersView = document.getElementById("essais-parameters-view");

    if (listView) listView.style.display = "none";
    if (editorView) editorView.style.display = "none";
    if (parametersView) parametersView.style.display = "block";

    await RbdTestParameters.load(true);
    await RbdTestParameters.loadReferences(true);
    await RbdTestParameters.prepareLdOptionsForCatalog();
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

function renderTestParametersView() {
    const container = document.getElementById("essais-parameters-view");
    if (!container) {
        return;
    }

    const functions = RbdTestParameters.functions();
    const source = RbdTestParameters.catalog?.source || {};

    container.innerHTML = `
        <section class="card">
            <div class="card-header test-param-header">
                <div>
                    <h2 style="margin: 0;">Parametre Test</h2>
                    <p class="muted" style="margin: 4px 0 0 0;">Gestion des donnees Injections issues des fichiers PAR</p>
                </div>
                <div class="test-param-actions">
                    <button class="btn btn-secondary" onclick="closeTestParameters()">Retour</button>
                    <button class="btn btn-secondary" onclick="document.getElementById('test-parameter-import').click()">Importer .par</button>
                    <button class="btn btn-secondary" onclick="addTestParameterFunction()">Ajouter fonction</button>
                    <button class="btn btn-primary" onclick="saveTestParameters()">Sauvegarder</button>
                    <input id="test-parameter-import" type="file" accept=".par,.xml" style="display:none" onchange="importTestParameterFile(event)">
                </div>
            </div>
            <div class="divider"></div>
            <div class="test-param-summary">
                <span>${functions.length} fonction(s)</span>
                <span>${functions.reduce((sum, func) => sum + (func.parameters || []).length, 0)} parametre(s)</span>
                <span>Source: ${escapeParameterHtml(source.filename || "manuel")}</span>
            </div>
        </section>

        <section class="card rbd-section-shell">
            <div class="card-header">
                <h3 style="margin: 0;">Injections</h3>
            </div>
            <div class="divider"></div>
            <div class="test-param-list">
                ${functions.length ? functions.map((func, index) => renderTestParameterFunction(func, index)).join("") : renderEmptyTestParameters()}
            </div>
        </section>
    `;
}

function renderEmptyTestParameters() {
    return `
        <div class="rbd-empty-state">
            <div class="rbd-empty-state-icon">PAR</div>
            <p>Aucune fonction disponible</p>
        </div>
    `;
}

function renderIedOptions(selectedValue = "") {
    const selected = String(selectedValue || "");
    return [
        '<option value="">Selectionner un IED</option>',
        ...RbdTestParameters.parentPatterns().map(pattern => `
            <option value="${escapeParameterHtml(pattern.id)}" ${selected === pattern.id ? "selected" : ""}>
                ${escapeParameterHtml(pattern.display_name || pattern.id)}
            </option>
        `)
    ].join("");
}

function renderVariantOptions(parentId, selectedValue = "") {
    const selected = String(selectedValue || "");
    const variants = RbdTestParameters.variantsFor(parentId);
    if (!parentId || !variants.length) {
        return '<option value="">Aucune variante</option>';
    }
    return [
        '<option value="">Aucune variante</option>',
        ...variants.map(pattern => `
            <option value="${escapeParameterHtml(pattern.id)}" ${selected === pattern.id ? "selected" : ""}>
                ${escapeParameterHtml(pattern.display_name || pattern.id)}
            </option>
        `)
    ].join("");
}

function renderLdOptions(patternId, selectedValue = "") {
    const selected = String(selectedValue || "");
    const lds = RbdTestParameters.ldsByPattern[patternId] || [];
    const currentOption = selected && !lds.includes(selected)
        ? [`<option value="${escapeParameterHtml(selected)}" selected>${escapeParameterHtml(selected)}</option>`]
        : [];

    if (!patternId) {
        return '<option value="">Selectionner un IED</option>';
    }
    if (!lds.length && !currentOption.length) {
        return '<option value="">Aucun LD disponible</option>';
    }

    return [
        '<option value="">Aucun LD</option>',
        ...currentOption,
        ...lds.map(ld => `
            <option value="${escapeParameterHtml(ld)}" ${selected === ld ? "selected" : ""}>
                ${escapeParameterHtml(ld)}
            </option>
        `)
    ].join("");
}

function renderTestParameterFunction(func, functionIndex) {
    const patternId = func.variant || func.ied || "";
    return `
        <article class="test-param-function">
            <div class="test-param-function-grid">
                <label>
                    Nom fonction
                    <input class="form-input" value="${escapeParameterHtml(func.name)}"
                        onchange="updateTestParameterFunction(${functionIndex}, 'name', this.value)">
                </label>
                <label>
                    Description
                    <input class="form-input" value="${escapeParameterHtml(func.description)}"
                        onchange="updateTestParameterFunction(${functionIndex}, 'description', this.value)">
                </label>
                <label>
                    IED
                    <select class="form-input" onchange="updateTestParameterFunctionIed(${functionIndex}, this.value)">
                        ${renderIedOptions(func.ied)}
                    </select>
                </label>
                <label>
                    Variante
                    <select class="form-input" onchange="updateTestParameterFunctionVariant(${functionIndex}, this.value)">
                        ${renderVariantOptions(func.ied, func.variant)}
                    </select>
                </label>
                <label>
                    LD
                    <select class="form-input" onchange="updateTestParameterFunction(${functionIndex}, 'ld', this.value)">
                        ${renderLdOptions(patternId, func.ld)}
                    </select>
                </label>
            </div>
            <div class="test-param-row-actions">
                <button class="btn btn-secondary" onclick="addTestParameter(${functionIndex})">Ajouter parametre</button>
                <button class="btn btn-danger" onclick="removeTestParameterFunction(${functionIndex})">Supprimer fonction</button>
            </div>
            <div class="test-param-parameters">
                ${(func.parameters || []).map((parameter, parameterIndex) =>
                    renderTestParameterRow(parameter, functionIndex, parameterIndex)
                ).join("")}
            </div>
        </article>
    `;
}

function renderTestParameterRow(parameter, functionIndex, parameterIndex) {
    return `
        <div class="test-param-parameter">
            <input class="form-input" placeholder="Nom parametre" value="${escapeParameterHtml(parameter.name)}"
                onchange="updateTestParameter(${functionIndex}, ${parameterIndex}, 'name', this.value)">
            <input class="form-input" placeholder="Description" value="${escapeParameterHtml(parameter.description)}"
                onchange="updateTestParameter(${functionIndex}, ${parameterIndex}, 'description', this.value)">
            <select class="form-input" onchange="updateTestParameter(${functionIndex}, ${parameterIndex}, 'type_parametre', this.value)">
                <option value="Numerique" ${parameter.type_parametre === "Numerique" ? "selected" : ""}>Numerique</option>
                <option value="ListeDeValeurs" ${parameter.type_parametre === "ListeDeValeurs" ? "selected" : ""}>Liste de valeurs</option>
                <option value="" ${!parameter.type_parametre ? "selected" : ""}>Non precise</option>
            </select>
            <button class="btn-remove" onclick="removeTestParameter(${functionIndex}, ${parameterIndex})">Supprimer</button>
        </div>
    `;
}

function updateTestParameterFunction(index, field, value) {
    const func = RbdTestParameters.functions()[index];
    if (!func) return;
    func[field] = value;
}

async function updateTestParameterFunctionIed(index, iedId) {
    const func = RbdTestParameters.functions()[index];
    if (!func) return;

    func.ied = iedId;
    func.variant = "";
    func.ld = "";
    await RbdTestParameters.ensureLdOptions(iedId);
    renderTestParametersView();
}

async function updateTestParameterFunctionVariant(index, variantId) {
    const func = RbdTestParameters.functions()[index];
    if (!func) return;

    func.variant = variantId;
    func.ld = "";
    await RbdTestParameters.ensureLdOptions(variantId || func.ied);
    renderTestParametersView();
}

function addTestParameterFunction() {
    RbdTestParameters.catalog.functions = RbdTestParameters.functions();
    RbdTestParameters.catalog.functions.push({
        id: `fonction_${Date.now()}`,
        name: "NOUVELLE-FONCTION",
        description: "",
        ied: "",
        variant: "",
        ld: "",
        parameters: []
    });
    renderTestParametersView();
}

function removeTestParameterFunction(index) {
    if (!confirm("Supprimer cette fonction et tous ses parametres ?")) {
        return;
    }
    RbdTestParameters.functions().splice(index, 1);
    renderTestParametersView();
}

function addTestParameter(functionIndex) {
    const func = RbdTestParameters.functions()[functionIndex];
    if (!func) return;
    func.parameters = Array.isArray(func.parameters) ? func.parameters : [];
    func.parameters.push({
        id: `param_${Date.now()}`,
        name: "NOUVEAU-PARAM",
        description: "",
        type_parametre: "Numerique",
    });
    renderTestParametersView();
}

function removeTestParameter(functionIndex, parameterIndex) {
    const func = RbdTestParameters.functions()[functionIndex];
    if (!func || !Array.isArray(func.parameters)) return;
    if (!confirm("Supprimer ce parametre ?")) {
        return;
    }
    func.parameters.splice(parameterIndex, 1);
    renderTestParametersView();
}

function updateTestParameter(functionIndex, parameterIndex, field, value) {
    const parameter = RbdTestParameters.functions()[functionIndex]?.parameters?.[parameterIndex];
    if (!parameter) return;
    parameter[field] = value;
}

async function saveTestParameters() {
    try {
        await RbdTestParameters.save();
        renderTestParametersView();
        alert("Parametres de test sauvegardes.");
    } catch (error) {
        alert(`Sauvegarde impossible: ${error.message}`);
    }
}

async function importTestParameterFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
        RbdTestParameters.catalog = await apiTestParameters.importPar(file);
        RbdTestParameters.loaded = true;
        await RbdTestParameters.loadReferences();
        await RbdTestParameters.prepareLdOptionsForCatalog();
        renderTestParametersView();
        alert("Import PAR termine.");
    } catch (error) {
        alert(`Import PAR impossible: ${error.message}`);
    } finally {
        event.target.value = "";
    }
}
