# R#BD - Base de données R#SPACE

## 📋 Description

R#BD est l'application de gestion centralisée des templates et configurations pour l'écosystème R#SPACE. Elle fournit une interface web pour créer, éditer et gérer les templates utilisés par les différentes applications R-CONTROL.

## 🚀 Mode actuel : Application HTML/CSS/JS pure

R#BD fonctionne actuellement en **mode statique** sans backend Python. Les templates sont gérés via **localStorage** du navigateur.

### Avantages
- ✅ Pas de serveur à lancer
- ✅ Déploiement ultra-simple (double-clic sur `index.html`)
- ✅ Édition instantanée sans latence réseau
- ✅ Fonctionne hors ligne

### Limitations
- ⚠️ Pas d'API REST (pas accessible depuis R#GUIDE pour le moment)
- ⚠️ Stockage local uniquement (navigateur)

## � Structure

```
apps/r_bd/
├── index.html              # Page d'accueil
├── web/
│   ├── components/
│   │   └── header.html            # Header commun
│   ├── css/
│   │   ├── main.css               # Styles communs
│   │   └── templates.css          # Styles templates
│   ├── js/
│   │   ├── header-loader.js       # Chargement header
│   │   ├── template-manager.js    # Gestionnaire templates
│   │   └── templates-ru.js        # Interface templates RU
│   └── pages/
│       └── templates-ru.html      # Gestion templates RU
├── data/
│   └── templates/
│       └── ru/                    # Templates RU (futurs exports)
├── legacy/                        # Code Python archivé
│   ├── main.py
│   ├── config.py
│   ├── core/
│   └── ui/
└── README.md
```

## 🎯 Utilisation

### Lancer l'application

#### Option 1 : Ouverture directe (recommandé)
Double-cliquez sur `index.html`

#### Option 2 : Serveur local (pour éviter problèmes CORS)
```bash
cd apps/r_bd
python -m http.server 8554
```
Puis ouvrir : http://localhost:8554

### Gestion des templates RU

1. **Accueil** → Cliquer sur "Templates RU"
2. **Créer un template** :
   - Cliquer sur "➕ Nouveau template"
   - Un template exemple est créé
   - Cliquer dessus pour l'éditer (JSON pour le moment)
3. **Éditer un template** :
   - Cliquer sur le template dans la liste
   - Modifier le JSON
   - Valider
4. **Dupliquer** : Bouton "📋 Dupliquer"
5. **Supprimer** : Bouton "🗑️ Supprimer"

## 📝 Structure d'un template RU

```json
{
  "id": "template_01",
  "name": "Template Protection Distance",
  "type": "protection",
  "description": "Tests standards pour protections distance",
  "tranches": [
    {
      "name": "Tranche 1",
      "ieds": [
        {
          "name": "IED_PROT",
          "fonctions": [
            {
              "name": "Protection Distance",
              "logical_nodes": [
                {
                  "pattern": "PDIS*",
                  "tests": [
                    {
                      "name": "Test fonctionnel Z1",
                      "description": "Vérification déclenchement zone 1"
                    },
                    {
                      "name": "Test fonctionnel Z2",
                      "description": "Vérification déclenchement zone 2"
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ]
}
```

### Wildcards

Utilisez `*` pour matcher plusieurs Logical Nodes :
- `PDIS*` → PDIS1, PDIS2, PDIS3...
- `MMXU*` → MMXU1, MMXU2...
- `XCBR*` → XCBR1, XCBR2...

## 🔄 Migration future vers API Python

Si besoin d'une API REST (pour communication avec R#GUIDE) :

1. Restaurer le code Python depuis `legacy/`
2. Réactiver `main.py`
3. L'interface HTML reste fonctionnelle en standalone

## 🎨 Personnalisation

### Couleurs
Modifiez les variables CSS dans `web/css/main.css` :
```css
:root {
    --accent: #ff9800;        /* Couleur principale (orange)
    --accent-dark: #e68900;   /* Orange foncé
    --accent-light: #ffb84d;  /* Orange clair
}
```

### Header
Éditez `web/components/header.html` pour modifier les liens de navigation.

## 📚 Documentation

- [MIGRATION_HTML_ONLY.md](MIGRATION_HTML_ONLY.md) : Justification et plan de migration
- [PLAN_RU_TESTS.md (R#GUIDE)](../r_guide/PLAN_RU_TESTS.md) : Plan complet du système de tests RU

## 🤝 Intégration avec R#GUIDE

Lorsque R#GUIDE aura besoin de charger les templates :

### Option 1 : Export manuel
1. R#BD : Exporter template en JSON
2. R#GUIDE : Importer le fichier JSON

### Option 2 : API Python (futur)
1. Réactiver `legacy/main.py`
2. R#GUIDE interroge `http://localhost:8554/api/templates/ru/`

## � Roadmap

### Phase 1 ✅ (Actuelle)
- [x] Structure HTML/CSS/JS
- [x] Gestion templates RU (localStorage)
- [x] CRUD basique (créer, éditer, dupliquer, supprimer)

### Phase 2 (À venir)
- [ ] Éditeur visuel (formulaire structuré)
- [ ] Validation avancée des templates
- [ ] Import/Export fichiers JSON
- [ ] Prévisualisation template

### Phase 3 (Si besoin)
- [ ] Réactivation API Python
- [ ] Intégration avec R#GUIDE
- [ ] Base de données SQLite
- [ ] Versioning templates

## 🛠️ Technologies

- **Frontend** : HTML5, CSS3, JavaScript ES6+
- **Stockage** : localStorage (navigateur)
- **Icons** : Emoji (pas de dépendance externe)

## 📞 Support

Pour toute question sur R#BD :
- Consulter `MIGRATION_HTML_ONLY.md`
- Voir les exemples de templates dans `data/templates/ru/`
- Consulter le plan complet dans `../r_guide/PLAN_RU_TESTS.md`
- **Base de données** : SQLite dans `data/rcontrol.db`
- **Sauvegardes** : `data/backups/`

## 📦 Dépendances

- Python 3.10+
- flet (interface utilisateur)
- sqlite3 (base de données)

## 🏗️ En développement

Cette application est actuellement en cours de développement. Les fonctionnalités seront ajoutées progressivement.

## 📝 Notes

- L'application utilise SQLite pour la gestion de la base de données
- Les sauvegardes sont créées automatiquement dans `data/backups/`
- Compatible avec les autres applications R-CONTROL
