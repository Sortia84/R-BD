# R#BD - Migration vers HTML/CSS/JS pur

## 🎯 Objectif

Transformer R#BD en une **application web statique** (HTML/CSS/JS uniquement) pour la gestion des templates RU. Pas de backend Python nécessaire pour le moment.

## 📋 Justification

### Pourquoi abandonner Python ?

1. **Cas d'usage actuel** : Création et édition de templates JSON
2. **Pas de traitement complexe** : Simple CRUD sur fichiers JSON
3. **API locale suffisante** : JavaScript peut lire/écrire via File System Access API
4. **Déploiement simplifié** : Pas besoin de serveur Python en arrière-plan
5. **Performance** : Pas de latence réseau, édition instantanée
6. **Portabilité** : Fonctionne directement en double-cliquant sur `index.html`

### Quand revenir à Python ?

- Besoin de validation métier complexe
- Intégration avec base de données SQL
- API REST pour communication avec autres apps R-CONTROL
- Traitement batch ou génération automatique de templates

## 🏗️ Architecture cible

```
apps/r_bd/
├── index.html              # ✅ Page principale (hub templates)
├── web/
│   ├── pages/
│   │   ├── templates-ru.html      # ✅ Gestion templates RU
│   │   └── template-editor.html   # ✅ Éditeur JSON
│   ├── css/
│   │   ├── main.css               # ✅ Styles communs
│   │   ├── templates.css          # ✅ Styles liste templates
│   │   └── editor.css             # ✅ Styles éditeur JSON
│   └── js/
│       ├── template-manager.js    # ✅ Logique CRUD templates
│       ├── json-validator.js      # ✅ Validation schema JSON
│       └── file-utils.js          # ✅ File System Access API
├── data/
│   └── templates/
│       └── ru/                    # ✅ Templates JSON stockés localement
│           ├── template_01.json
│           ├── template_02.json
│           └── ...
├── config.json             # ✅ Configuration app (ports futurs, chemins)
└── README.md               # ✅ Documentation

# ❌ Fichiers Python à archiver (pas supprimer)
legacy/
├── main.py
├── config.py
├── api.py
├── core/
└── ui/
```

## 🔄 Plan de migration

### **Étape 1 : Créer la structure HTML/CSS/JS**

#### 1.1 Page principale (`index.html`)

```html
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>R#BD - Gestion des templates</title>
    <link rel="stylesheet" href="web/css/main.css">
</head>
<body>
    <header class="app-header">
        <h1>R#BD - Base de données R#SPACE</h1>
        <p>Gestion centralisée des templates</p>
    </header>

    <nav class="app-nav">
        <button onclick="loadPage('templates-ru')">Templates RU</button>
        <button onclick="loadPage('templates-visite')">Templates Visite</button>
    </nav>

    <main id="content-container"></main>

    <script src="web/js/app.js"></script>
</body>
</html>
```

#### 1.2 Gestionnaire de templates (`web/js/template-manager.js`)

```javascript
class TemplateManager {
    constructor(templateType = 'ru') {
        this.templateType = templateType;
        this.templatesDir = `../../data/templates/${templateType}/`;
    }

    /**
     * Liste tous les templates disponibles
     */
    async listTemplates() {
        try {
            // Option 1: Lecture via File System Access API (Chrome/Edge)
            const dirHandle = await window.showDirectoryPicker();
            const templates = [];

            for await (const entry of dirHandle.values()) {
                if (entry.kind === 'file' && entry.name.endsWith('.json')) {
                    const file = await entry.getFile();
                    const content = await file.text();
                    templates.push({
                        id: entry.name.replace('.json', ''),
                        name: entry.name,
                        data: JSON.parse(content)
                    });
                }
            }

            return templates;

        } catch (error) {
            console.error('Erreur lecture templates:', error);
            // Fallback: charger depuis data statique
            return this.loadFromStaticData();
        }
    }

    /**
     * Charge un template spécifique
     */
    async loadTemplate(templateId) {
        const response = await fetch(`${this.templatesDir}${templateId}.json`);
        return await response.json();
    }

    /**
     * Crée un nouveau template
     */
    async createTemplate(templateData) {
        const blob = new Blob([JSON.stringify(templateData, null, 2)], {
            type: 'application/json'
        });

        // Télécharger le fichier (utilisateur choisit l'emplacement)
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${templateData.id}.json`;
        a.click();

        URL.revokeObjectURL(url);

        return templateData.id;
    }

    /**
     * Met à jour un template existant
     */
    async updateTemplate(templateId, templateData) {
        // Même logique que createTemplate
        return this.createTemplate(templateData);
    }

    /**
     * Valide la structure d'un template
     */
    validateTemplate(templateData) {
        const required = ['id', 'name', 'type', 'tranches'];
        for (const field of required) {
            if (!templateData[field]) {
                throw new Error(`Champ requis manquant: ${field}`);
            }
        }

        // Validation des tranches
        for (const tranche of templateData.tranches) {
            if (!tranche.name || !tranche.ieds) {
                throw new Error('Structure tranche invalide');
            }
        }

        return true;
    }
}
```

#### 1.3 Éditeur JSON (`web/pages/template-editor.html`)

```html
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <title>Éditeur de template</title>
    <link rel="stylesheet" href="../css/editor.css">
</head>
<body>
    <div class="editor-container">
        <div class="editor-header">
            <h2 id="editor-title">Nouveau template</h2>
            <div class="editor-actions">
                <button onclick="validateJSON()" class="btn-validate">Valider</button>
                <button onclick="saveTemplate()" class="btn-save">Enregistrer</button>
                <button onclick="closeEditor()" class="btn-cancel">Annuler</button>
            </div>
        </div>

        <div class="editor-body">
            <!-- Formulaire structuré OU éditeur JSON brut -->
            <div class="editor-tabs">
                <button class="tab active" onclick="switchTab('form')">Formulaire</button>
                <button class="tab" onclick="switchTab('json')">JSON brut</button>
            </div>

            <div id="form-view" class="editor-view active">
                <!-- Formulaire structuré pour faciliter la saisie -->
                <div class="form-group">
                    <label>ID du template</label>
                    <input type="text" id="template-id" placeholder="template_01">
                </div>

                <div class="form-group">
                    <label>Nom du template</label>
                    <input type="text" id="template-name" placeholder="Template Protection Distance">
                </div>

                <div class="form-group">
                    <label>Type d'équipement</label>
                    <select id="template-type">
                        <option value="protection">Protection</option>
                        <option value="controle-commande">Contrôle-commande</option>
                        <option value="mesure">Mesure</option>
                    </select>
                </div>

                <!-- Section Tranches -->
                <div class="form-section">
                    <h3>Tranches <button onclick="addTranche()">+ Ajouter</button></h3>
                    <div id="tranches-container"></div>
                </div>
            </div>

            <div id="json-view" class="editor-view">
                <textarea id="json-editor" rows="30"></textarea>
            </div>
        </div>

        <div class="editor-validation">
            <div id="validation-status"></div>
        </div>
    </div>

    <script src="../js/template-manager.js"></script>
    <script src="../js/json-validator.js"></script>
    <script src="../js/editor.js"></script>
</body>
</html>
```

### **Étape 2 : Gestion des fichiers locaux**

#### Options techniques

##### Option A : File System Access API (Recommandé)

```javascript
// Permet d'accéder au système de fichiers local
// Compatible Chrome 86+, Edge 86+

async function pickDirectory() {
    const dirHandle = await window.showDirectoryPicker();
    localStorage.setItem('templatesDirHandle', dirHandle);
    return dirHandle;
}

async function saveTemplateToFile(templateData) {
    const handle = await window.showSaveFilePicker({
        suggestedName: `${templateData.id}.json`,
        types: [{
            description: 'Template JSON',
            accept: { 'application/json': ['.json'] }
        }]
    });

    const writable = await handle.createWritable();
    await writable.write(JSON.stringify(templateData, null, 2));
    await writable.close();
}
```

##### Option B : LocalStorage (Fallback)

```javascript
// Pour navigateurs ne supportant pas File System Access API
class LocalStorageTemplateManager {
    saveTemplate(template) {
        const key = `template_ru_${template.id}`;
        localStorage.setItem(key, JSON.stringify(template));
    }

    loadTemplate(templateId) {
        const key = `template_ru_${templateId}`;
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : null;
    }

    listTemplates() {
        const templates = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('template_ru_')) {
                const data = localStorage.getItem(key);
                templates.push(JSON.parse(data));
            }
        }
        return templates;
    }
}
```

##### Option C : Fichiers statiques + Export manuel

```javascript
// Templates pré-chargés dans le HTML
const TEMPLATES = {
    'template_01': { /* ... */ },
    'template_02': { /* ... */ }
};

// Export via téléchargement
function exportTemplate(template) {
    const blob = new Blob([JSON.stringify(template, null, 2)], {
        type: 'application/json'
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${template.id}.json`;
    a.click();
}
```

### **Étape 3 : Interface utilisateur**

#### 3.1 Liste des templates (`web/pages/templates-ru.html`)

```html
<div class="templates-page">
    <header class="page-header">
        <h2>Templates Recette Usine</h2>
        <button onclick="createNewTemplate()" class="btn-primary">
            + Nouveau template
        </button>
    </header>

    <div class="templates-grid" id="templates-list">
        <!-- Généré dynamiquement -->
    </div>
</div>

<script>
async function loadTemplatesList() {
    const manager = new TemplateManager('ru');
    const templates = await manager.listTemplates();

    const container = document.getElementById('templates-list');
    container.innerHTML = templates.map(tpl => `
        <div class="template-card">
            <h3>${tpl.data.name}</h3>
            <p>${tpl.data.type}</p>
            <div class="template-stats">
                <span>${tpl.data.tranches.length} tranches</span>
            </div>
            <div class="template-actions">
                <button onclick="editTemplate('${tpl.id}')">Éditer</button>
                <button onclick="duplicateTemplate('${tpl.id}')">Dupliquer</button>
                <button onclick="deleteTemplate('${tpl.id}')">Supprimer</button>
            </div>
        </div>
    `).join('');
}
</script>
```

### **Étape 4 : Configuration et déploiement**

#### 4.1 Configuration (`config.json`)

```json
{
    "app": {
        "name": "R#BD",
        "version": "2.0.0",
        "mode": "static"
    },
    "paths": {
        "templates_ru": "data/templates/ru/",
        "templates_visite": "data/templates/visite/"
    },
    "features": {
        "file_system_access": true,
        "local_storage_fallback": true,
        "export_templates": true
    },
    "future": {
        "python_api_port": 8554,
        "enable_api_when_needed": false
    }
}
```

#### 4.2 Serveur de développement (optionnel)

```bash
# Pour tester localement avec CORS
cd apps/r_bd
python -m http.server 8554

# OU avec Node.js
npx serve -p 8554
```

### **Étape 5 : Archivage du code Python**

```bash
# Déplacer le code Python existant
mkdir legacy
mv main.py legacy/
mv config.py legacy/
mv api.py legacy/
mv core/ legacy/
mv ui/ legacy/

# Créer un README dans legacy/
echo "Code Python archivé - Sera réutilisé si besoin d'API REST" > legacy/README.md
```

## 🎨 Design et UX

### Style visuel

- Reprendre la charte graphique R-CONTROL
- Couleur principale : `#ff9800` (orange)
- Interface card-based pour les templates
- Éditeur JSON avec coloration syntaxique (Monaco Editor ou CodeMirror)

### Fonctionnalités clés

1. **Création guidée** : Formulaire structuré pour faciliter la création
2. **Vue JSON brute** : Pour utilisateurs avancés
3. **Validation temps réel** : Signaler les erreurs de structure
4. **Prévisualisation** : Voir le rendu du template avant sauvegarde
5. **Import/Export** : Charger/télécharger templates JSON
6. **Duplication** : Créer rapidement des variantes

## 📦 Dépendances JavaScript (optionnelles)

```html
<!-- Éditeur JSON avec coloration syntaxique -->
<script src="https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs/loader.js"></script>

<!-- Validation JSON Schema -->
<script src="https://cdn.jsdelivr.net/npm/ajv@8.12.0/dist/ajv.min.js"></script>

<!-- Bibliothèque d'icônes -->
<link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
```

## 🚀 Avantages de cette approche

### ✅ Avantages

1. **Simplicité** : Pas de backend à maintenir
2. **Performance** : Édition instantanée, pas de latence réseau
3. **Portabilité** : Fonctionne en double-cliquant sur `index.html`
4. **Déploiement** : Servir depuis n'importe quel serveur HTTP statique
5. **Maintenance** : Moins de code, moins de dépendances
6. **Hors ligne** : Fonctionne sans connexion réseau

### ⚠️ Limitations

1. **Pas d'API REST** : Pas accessible depuis R#GUIDE (pour le moment)
2. **Partage limité** : Fichiers locaux uniquement
3. **Validation basique** : Pas de validation métier complexe
4. **Pas de base de données** : Stockage fichier JSON uniquement

### 🔄 Migration future vers Python (si besoin)

Si besoin ultérieur d'une API REST :

1. Réactiver `legacy/main.py`
2. Implémenter endpoints GET/POST sur templates
3. R#GUIDE pourra consommer l'API
4. Interface HTML reste fonctionnelle en standalone

## 📅 Planning de migration

### Phase 1 : Structure HTML/CSS (1-2h)
- [ ] Créer `index.html` avec navigation
- [ ] Créer `web/pages/templates-ru.html`
- [ ] Créer `web/pages/template-editor.html`
- [ ] Styles CSS communs

### Phase 2 : Logique JavaScript (2-3h)
- [ ] `template-manager.js` - Gestion CRUD
- [ ] `json-validator.js` - Validation structure
- [ ] `file-utils.js` - File System Access API
- [ ] `editor.js` - Éditeur interactif

### Phase 3 : Interface éditeur (2-3h)
- [ ] Formulaire structuré (mode facile)
- [ ] Éditeur JSON brut (mode avancé)
- [ ] Validation temps réel
- [ ] Prévisualisation

### Phase 4 : Tests et documentation (1-2h)
- [ ] Tester création/édition/suppression
- [ ] Tester import/export
- [ ] Documentation utilisateur
- [ ] README.md

**Total estimé** : 6-10 heures

## 🎯 Résultat final

```
apps/r_bd/
├── index.html                  # ✅ Application standalone
├── web/                        # ✅ Interface complète HTML/CSS/JS
├── data/templates/ru/          # ✅ Templates JSON
├── config.json                 # ✅ Configuration
└── legacy/                     # ✅ Code Python archivé (réutilisable)
```

**Mode d'utilisation** :
1. Double-cliquer sur `index.html`
2. Créer/éditer templates via interface
3. Templates sauvegardés dans `data/templates/ru/`
4. Export manuel vers R#GUIDE si besoin

**Évolution future** :
- Activer `legacy/main.py` pour API REST
- R#GUIDE consomme API pour charger templates
- Interface HTML reste utilisable en standalone

---

## 🤔 Décision finale

**RECOMMANDATION** : Adopter l'approche HTML/CSS/JS pure pour R#BD

**Arguments** :
- Cas d'usage actuel = simple gestion de fichiers JSON
- Pas besoin d'API tant que R#GUIDE n'en a pas besoin
- Déploiement ultra-simplifié
- Code Python conservé dans `legacy/` pour réactivation rapide

**Action** : Démarrer Phase 1 (Structure HTML/CSS)
