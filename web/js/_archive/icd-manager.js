// icd-manager.js - Gestion des ICD 61850 via API

const API_BASE = '/api/icd';

let icdCatalog = [];  // Liste d'entrées (index global)
let iedTypeOptions = [];
let iedPatterns = [];  // Chargé au démarrage pour afficher le compteur de liaisons

async function initIcdPage() {
    await loadIedPatterns();  // Charger les patterns d'abord pour le compteur
    await loadCatalogFromApi();
    setupIcdUpload();
    setupFilters();
    await loadIedTypeOptions();
    renderIcdCards();
}

function setupIcdUpload() {
    const input = document.getElementById('icd-upload');
    if (!input) {
        return;
    }

    input.addEventListener('change', async (event) => {
        const files = Array.from(event.target.files || []);
        if (!files.length) {
            return;
        }

        let successCount = 0;
        let errorCount = 0;
        const errors = [];

        for (const file of files) {
            try {
                const result = await uploadIcdFile(file);
                successCount += result.entries.length;
                result.entries.forEach(entry => {
                    console.log(`✅ ICD sauvegardé: ${entry.path}`);
                });
            } catch (error) {
                console.error(`Erreur upload ICD ${file.name}:`, error);
                errors.push(`${file.name}: ${error.message}`);
                errorCount++;
            }
        }

        // Recharger le catalogue depuis l'API
        await loadCatalogFromApi();
        refreshFilters();
        renderIcdCards();
        input.value = '';

        // Résumé de l'import
        if (successCount > 0 || errorCount > 0) {
            let message = `📊 Import terminé:\n✅ ${successCount} ICD importé(s) et sauvegardé(s)`;
            if (errorCount > 0) {
                message += `\n❌ ${errorCount} erreur(s):\n${errors.join('\n')}`;
            }
            alert(message);
        }
    });
}

async function uploadIcdFile(file) {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE}/upload`, {
        method: 'POST',
        body: formData
    });

    if (!response.ok) {
        const data = await response.json();
        throw new Error(data.detail || 'Erreur upload');
    }

    return await response.json();
}

async function loadCatalogFromApi() {
    try {
        const response = await fetch(`${API_BASE}/`);
        if (!response.ok) {
            throw new Error('Erreur chargement catalogue');
        }
        const data = await response.json();
        icdCatalog = data.icds || [];
        console.log(`📚 Catalogue chargé depuis API: ${icdCatalog.length} ICD(s)`);
    } catch (error) {
        console.warn('Erreur chargement API ICD:', error);
        icdCatalog = [];
    }
}

function setupFilters() {
    const typeFilter = document.getElementById('filter-ied-type');
    const manufacturerFilter = document.getElementById('filter-manufacturer');

    if (typeFilter) {
        typeFilter.addEventListener('change', renderIcdCards);
    }
    if (manufacturerFilter) {
        manufacturerFilter.addEventListener('change', renderIcdCards);
    }
}

async function loadIedTypeOptions() {
    try {
        // Essayer de charger les types depuis l'API
        const response = await fetch(`${API_BASE}/types`);
        if (response.ok) {
            iedTypeOptions = await response.json();
        } else {
            // Fallback sur le fichier statique
            const fallback = await fetch('/data/ied/liste_ied.json');
            if (fallback.ok) {
                const list = await fallback.json();
                iedTypeOptions = Array.isArray(list) ? list.map(item => String(item)) : [];
            }
        }
    } catch (error) {
        console.warn('Liste IED non disponible:', error);
        iedTypeOptions = [];
    }
    refreshFilters();
}

function triggerIcdUpload() {
    const input = document.getElementById('icd-upload');
    if (input) {
        input.click();
    }
}

async function exportIcdCatalog() {
    // Recharger depuis l'API pour avoir les données fraîches
    await loadCatalogFromApi();
    const dataStr = JSON.stringify(icdCatalog, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = 'icd_catalog_export.json';
    link.click();
    URL.revokeObjectURL(url);
}

function resetIcdFilters() {
    const typeFilter = document.getElementById('filter-ied-type');
    const manufacturerFilter = document.getElementById('filter-manufacturer');
    if (typeFilter) {
        typeFilter.value = '';
    }
    if (manufacturerFilter) {
        manufacturerFilter.value = '';
    }
    renderIcdCards();
}

function refreshFilters() {
    const typeFilter = document.getElementById('filter-ied-type');
    const manufacturerFilter = document.getElementById('filter-manufacturer');

    // icdCatalog est maintenant un tableau
    const manufacturers = Array.from(new Set(icdCatalog.map(item => item.manufacturer))).sort();
    const catalogTypes = Array.from(new Set(icdCatalog.map(item => item.ied_type))).sort();

    if (typeFilter) {
        const allTypes = iedTypeOptions.length ? iedTypeOptions : catalogTypes;
        typeFilter.innerHTML = '<option value="">Tous</option>' + allTypes.map(type => {
            const safe = escapeHtml(type);
            return `<option value="${safe}">${safe}</option>`;
        }).join('');
    }

    if (manufacturerFilter) {
        manufacturerFilter.innerHTML = '<option value="">Tous</option>' + manufacturers.map(item => {
            const safe = escapeHtml(item);
            return `<option value="${safe}">${safe}</option>`;
        }).join('');
    }
}

function renderIcdCards() {
    const container = document.getElementById('icd-cards');
    if (!container) {
        return;
    }

    const filtered = getFilteredCatalog();
    if (!filtered.length) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📂</div>
                <p>Aucun ICD correspond au filtre</p>
                <p class="muted">Importez des fichiers pour alimenter la bibliothèque</p>
            </div>
        `;
        return;
    }

    // Grouper par icd_id (type + manufacturer) pour afficher les versions ensemble
    const grouped = groupByIcdId(filtered);

    container.innerHTML = '';
    grouped.forEach(card => {
        container.insertAdjacentHTML('beforeend', buildCardHtml(card));
    });
}

function groupByIcdId(entries) {
    const groups = {};
    entries.forEach(entry => {
        const key = `${entry.ied_type}_${entry.manufacturer}`;
        if (!groups[key]) {
            groups[key] = {
                icd_id: entry.icd_id,
                ied_type: entry.ied_type,
                manufacturer: entry.manufacturer,
                active_version: entry.version,
                versions: []
            };
        }
        groups[key].versions.push({
            version: entry.version,
            filename: entry.filename,
            path: entry.path,
            imported_at: entry.imported_at,
            ld_count: entry.ld_count,
            ln_count: entry.ln_count
        });
    });
    return Object.values(groups);
}

function getFilteredCatalog() {
    const typeFilter = document.getElementById('filter-ied-type');
    const manufacturerFilter = document.getElementById('filter-manufacturer');
    const typeValue = typeFilter ? typeFilter.value : '';
    const manufacturerValue = manufacturerFilter ? manufacturerFilter.value : '';

    return icdCatalog.filter(entry => {
        const matchType = !typeValue || entry.ied_type === typeValue;
        const matchManufacturer = !manufacturerValue || entry.manufacturer === manufacturerValue;
        return matchType && matchManufacturer;
    });
}

function buildCardHtml(card) {
    const active = getActiveVersion(card);
    const versionOptions = card.versions.map(version => {
        const selected = version.version === active.version ? 'selected' : '';
        return `<option value="${escapeHtml(version.version)}" ${selected}>${escapeHtml(version.version)}</option>`;
    }).join('');

    const versionsList = card.versions.map(version => {
        const typeEnc = encodeURIComponent(card.ied_type);
        const manuEnc = encodeURIComponent(card.manufacturer);
        const versionEnc = encodeURIComponent(version.version);
        return `
            <div class="icd-version-item">
                <div class="icd-version-info">
                    <strong>${escapeHtml(version.version)}</strong>
                    <div class="icd-version-meta">${escapeHtml(version.filename)}</div>
                    <div class="icd-version-meta">📁 ${escapeHtml(version.path || '')}</div>
                </div>
                <div class="icd-version-actions">
                    <span class="icd-version-meta">${formatDate(version.imported_at)}</span>
                    <button class="btn-icon" onclick="reanalyzeIcd('${typeEnc}', '${manuEnc}', '${versionEnc}')" title="Relancer l'analyse">🔄</button>
                    <button class="btn-icon btn-danger" onclick="deleteIcd('${typeEnc}', '${manuEnc}', '${versionEnc}')" title="Supprimer">🗑️</button>
                </div>
            </div>
        `;
    }).join('');

    const typeEnc = encodeURIComponent(card.ied_type);
    const manuEnc = encodeURIComponent(card.manufacturer);
    const activeVersionEnc = encodeURIComponent(active.version);

    return `
        <div class="template-card icd-card" data-ied-type="${escapeHtml(card.ied_type)}" data-manufacturer="${escapeHtml(card.manufacturer)}">
            <div class="template-card-header">
                <div class="template-icon">📄</div>
                <div class="template-info">
                    <h3>${escapeHtml(card.ied_type)} — ${escapeHtml(card.manufacturer)}</h3>
                    <p>${card.versions.length} version(s) • ${active.ld_count || 0} LD • ${active.ln_count || 0} LN</p>
                </div>
                <span class="template-badge icd-badge">ICD</span>
            </div>
            <div class="template-tags">
                <span class="template-tag">Type: ${escapeHtml(card.ied_type)}</span>
                <span class="template-tag">Constructeur: ${escapeHtml(card.manufacturer)}</span>
            </div>
            <div class="icd-version-select">
                <label>Version active</label>
                <select onchange="setActiveVersion('${escapeHtml(card.ied_type)}', '${escapeHtml(card.manufacturer)}', this.value)">
                    ${versionOptions}
                </select>
            </div>
            <div class="template-stats">
                <div class="template-stat">
                    <span class="template-stat-label">LD</span>
                    <span class="template-stat-value">${active.ld_count || 0}</span>
                </div>
                <div class="template-stat">
                    <span class="template-stat-label">LN</span>
                    <span class="template-stat-value">${active.ln_count || 0}</span>
                </div>
            </div>
            <div class="icd-version-list">${versionsList}</div>
            <div class="icd-card-actions">
                <button class="btn btn-small" onclick="viewIcdDetails('${typeEnc}', '${manuEnc}', '${activeVersionEnc}')">
                    👁️ Détails
                </button>
                ${buildLinkButton(card.ied_type, card.manufacturer, typeEnc, manuEnc)}
            </div>
        </div>
    `;
}

function buildLinkButton(iedType, manufacturer, typeEnc, manuEnc) {
    // Compter les liaisons pour cet ICD
    const icdPath = `${iedType}/${manufacturer}`;
    const linkCount = iedPatterns.filter(p =>
        (p.icd_refs || []).some(ref => ref.includes(icdPath))
    ).length;

    const hasLinks = linkCount > 0;
    const btnClass = hasLinks ? 'btn-linked' : 'btn-secondary';
    const badge = hasLinks ? `<span class="link-count">${linkCount}</span>` : '';

    return `
        <button class="btn btn-small ${btnClass}" onclick="showLinkPatternModal('${typeEnc}', '${manuEnc}')">
            🔗 Lier IED ${badge}
        </button>
    `;
}

function getActiveVersion(card) {
    const active = card.versions.find(version => version.version === card.active_version);
    const fallback = card.versions[card.versions.length - 1];
    return active || fallback || { version: 'n/a', ld_count: 0, ln_count: 0 };
}

function setActiveVersion(iedType, manufacturer, version) {
    // Mise à jour locale pour l'affichage
    const grouped = groupByIcdId(icdCatalog);
    const card = grouped.find(c => c.ied_type === iedType && c.manufacturer === manufacturer);
    if (card) {
        card.active_version = version;
    }
    renderIcdCards();
}

async function viewIcdDetails(iedType, manufacturer, version) {
    try {
        const response = await fetch(`${API_BASE}/details/${iedType}/${manufacturer}/${version}`);
        if (!response.ok) {
            throw new Error('ICD non trouvé');
        }
        const details = await response.json();
        console.log('📋 Détails ICD:', details);
        alert(`ICD: ${details.ied_type} / ${details.manufacturer}\nVersion: ${details.version}\nLD: ${details.ld_count} | LN: ${details.ln_count}`);
    } catch (error) {
        console.error('Erreur chargement détails:', error);
        alert('Erreur: ' + error.message);
    }
}

// ============================================================
// Actions ICD : Suppression, Relance analyse
// ============================================================

async function deleteIcd(iedType, manufacturer, version) {
    const confirmMsg = `Supprimer l'ICD ?\n\nType: ${decodeURIComponent(iedType)}\nConstructeur: ${decodeURIComponent(manufacturer)}\nVersion: ${decodeURIComponent(version)}`;
    if (!confirm(confirmMsg)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/${iedType}/${manufacturer}/${version}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || 'Erreur suppression');
        }

        console.log(`🗑️ ICD supprimé: ${iedType}/${manufacturer}/${version}`);
        await loadCatalogFromApi();
        refreshFilters();
        renderIcdCards();
        alert('✅ ICD supprimé avec succès');
    } catch (error) {
        console.error('Erreur suppression ICD:', error);
        alert('❌ Erreur: ' + error.message);
    }
}

async function reanalyzeIcd(iedType, manufacturer, version) {
    if (!confirm(`Relancer l'analyse de cet ICD ?\n\nVersion: ${decodeURIComponent(version)}`)) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/reanalyze/${iedType}/${manufacturer}/${version}`, {
            method: 'POST'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || 'Erreur ré-analyse');
        }

        const result = await response.json();
        console.log('� ICD ré-analysé:', result);
        await loadCatalogFromApi();
        renderIcdCards();
        alert(`✅ ${result.message}`);
    } catch (error) {
        console.error('Erreur ré-analyse ICD:', error);
        alert('❌ Erreur: ' + error.message);
    }
}

async function reanalyzeAll() {
    if (!confirm('Relancer l\'analyse de TOUS les fichiers ICD ?\n\nCela peut prendre du temps.')) {
        return;
    }

    try {
        const response = await fetch(`${API_BASE}/reanalyze-all`, {
            method: 'POST'
        });

        if (!response.ok) {
            const data = await response.json();
            throw new Error(data.detail || 'Erreur');
        }

        const result = await response.json();
        console.log('🔄 Tous les ICD ré-analysés:', result);
        await loadCatalogFromApi();
        refreshFilters();
        renderIcdCards();

        let message = `✅ ${result.reanalyzed} ICD ré-analysé(s)`;
        if (result.errors && result.errors.length > 0) {
            message += `\n\n❌ Erreurs:\n${result.errors.map(e => e.file + ': ' + e.error).join('\n')}`;
        }
        alert(message);
    } catch (error) {
        console.error('Erreur ré-analyse globale:', error);
        alert('❌ Erreur: ' + error.message);
    }
}

// ============================================================
// Liaison ICD ↔ Patterns IED
// ============================================================

async function loadIedPatterns() {
    try {
        const response = await fetch(`${API_BASE}/patterns`);
        if (!response.ok) {
            throw new Error('Erreur chargement patterns');
        }
        const data = await response.json();
        iedPatterns = data.patterns || [];
        console.log(`📋 ${iedPatterns.length} patterns IED chargés`);
    } catch (error) {
        console.warn('Erreur chargement patterns IED:', error);
        iedPatterns = [];
    }
}

async function showLinkPatternModal(iedType, manufacturer) {
    // Charger les patterns si pas encore fait
    if (!iedPatterns.length) {
        await loadIedPatterns();
    }

    // Chercher les suggestions
    const suggestResponse = await fetch(`${API_BASE}/suggest/${iedType}`);
    const suggestions = suggestResponse.ok ? (await suggestResponse.json()).suggestions : [];
    const suggestedIds = new Set(suggestions.map(s => s.id));

    // Construire la liste avec checkboxes
    const patternHtml = iedPatterns.map(p => {
        const isSuggested = suggestedIds.has(p.id);
        const currentIcdPath = `${decodeURIComponent(iedType)}/${decodeURIComponent(manufacturer)}`;
        const isLinked = (p.icd_refs || []).some(ref => ref.includes(currentIcdPath));
        const hasVariants = p.variants && p.variants.length > 0;
        const isChild = p.parent ? true : false;

        return `
            <label class="pattern-option ${isSuggested ? 'suggested' : ''} ${isLinked ? 'linked' : ''} ${isChild ? 'child-pattern' : ''}">
                <input type="checkbox" value="${p.id}" ${isLinked ? 'checked' : ''}
                    data-parent="${p.parent || ''}"
                    data-has-variants="${hasVariants}"
                    onchange="handlePatternCheckChange(this)">
                <span class="pattern-name">${escapeHtml(p.display_name)}</span>
                <span class="pattern-desc">${escapeHtml(p.pattern)}</span>
                ${isSuggested ? '<span class="badge-suggested">Suggéré</span>' : ''}
                ${hasVariants ? '<span class="badge-parent">Parent</span>' : ''}
            </label>
        `;
    }).join('');

    const modalHtml = `
        <div class="modal-overlay" id="link-pattern-modal" onclick="closeLinkPatternModal(event)">
            <div class="modal-content" onclick="event.stopPropagation()">
                <div class="modal-header">
                    <h3>🔗 Lier ICD aux patterns IED</h3>
                    <button class="btn-close" onclick="closeLinkPatternModal()">✕</button>
                </div>
                <div class="modal-body">
                    <p><strong>ICD:</strong> ${decodeURIComponent(iedType)} / ${decodeURIComponent(manufacturer)}</p>
                    <p class="muted">Sélectionnez les patterns IED qui correspondent à cet ICD :</p>
                    <div class="pattern-list">
                        ${patternHtml || '<p class="muted">Aucun pattern disponible</p>'}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn btn-secondary" onclick="closeLinkPatternModal()">Annuler</button>
                    <button class="btn btn-primary" onclick="saveLinkPatterns('${iedType}', '${manufacturer}')">Enregistrer</button>
                </div>
            </div>
        </div>
    `;

    document.body.insertAdjacentHTML('beforeend', modalHtml);
}

function handlePatternCheckChange(checkbox) {
    const patternId = checkbox.value;
    const isChecked = checkbox.checked;
    const hasVariants = checkbox.dataset.hasVariants === 'true';
    const modal = document.getElementById('link-pattern-modal');

    if (!modal) return;

    // Si c'est un parent avec des variants, propager aux enfants
    if (hasVariants && isChecked) {
        // Trouver tous les enfants de ce pattern
        const childCheckboxes = modal.querySelectorAll(`input[data-parent="${patternId}"]`);
        childCheckboxes.forEach(childCb => {
            childCb.checked = true;
            // Mettre à jour visuellement
            childCb.closest('.pattern-option').classList.add('auto-checked');
        });
        console.log(`📌 Parent ${patternId} coché → ${childCheckboxes.length} enfant(s) cochés`);
    }

    // Si c'est un enfant et qu'on le décoche, ne pas toucher au parent
    // (l'utilisateur peut vouloir décocher un enfant spécifique)
}

function closeLinkPatternModal(event) {
    if (event && event.target.id !== 'link-pattern-modal') {
        return;
    }
    const modal = document.getElementById('link-pattern-modal');
    if (modal) {
        modal.remove();
    }
}

async function saveLinkPatterns(iedType, manufacturer) {
    const modal = document.getElementById('link-pattern-modal');
    if (!modal) return;

    const checkboxes = modal.querySelectorAll('input[type="checkbox"]');
    const icdPath = `${decodeURIComponent(iedType)}/${decodeURIComponent(manufacturer)}`;

    for (const checkbox of checkboxes) {
        const patternId = checkbox.value;
        const pattern = iedPatterns.find(p => p.id === patternId);
        const wasLinked = pattern && (pattern.icd_refs || []).some(ref => ref.includes(icdPath));

        if (checkbox.checked && !wasLinked) {
            // Ajouter la liaison
            await fetch(`${API_BASE}/patterns/${patternId}/link`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ icd_path: icdPath })
            });
            console.log(`🔗 Lié: ${patternId} → ${icdPath}`);
        } else if (!checkbox.checked && wasLinked) {
            // Supprimer la liaison
            await fetch(`${API_BASE}/patterns/${patternId}/unlink`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ icd_path: icdPath })
            });
            console.log(`🔓 Délié: ${patternId} ↛ ${icdPath}`);
        }
    }

    // Recharger les patterns et rafraîchir l'affichage
    await loadIedPatterns();
    renderIcdCards();  // Rafraîchir pour mettre à jour le compteur de liaisons
    closeLinkPatternModal();
    alert('✅ Liaisons enregistrées');
}

function formatDate(value) {
    if (!value) {
        return '—';
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }
    return date.toLocaleDateString('fr-FR');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text ?? '';
    return div.innerHTML;
}
