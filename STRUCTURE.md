# STRUCTURE.md — Arborescence R#BD

## Vue d'ensemble

```
apps/r_bd/
│
├── main.py                     # Point d'entrée — lance uvicorn sur api_web:app
├── api_web.py                  # Application FastAPI (routeurs + static files)
├── config.py                   # Configuration centralisée (ports, chemins)
├── README.md                   # Documentation principale
├── STRUCTURE.md                # Ce fichier
│
├── api/                        # Couche API — Routeurs FastAPI
│   ├── __init__.py             # Exports : tous les routeurs
│   ├── shared.py               # État partagé : singletons, models Pydantic, helpers
│   ├── router_icd.py           # Endpoints ICD (import, catalogue, patterns)
│   ├── router_isa.py           # Endpoints ISA (import, types, fichiers)
│   ├── router_mapping.py       # Endpoints Mapping (comparaison IEC 61850)
│   ├── router_essais.py        # Endpoints Essais (CRUD RU/CVS/MVS)
│   ├── router_templates.py     # Endpoints Templates (CRUD)
│   ├── router_fcs.py           # Endpoints FCS (import, catalogue)
│   └── router_rac.py           # Endpoints RAC (import, catalogue)
│
├── core/                       # Couche métier — Managers et parseurs
│   ├── __init__.py             # Exports : toutes les classes métier
│   ├── icd_parser.py           # Analyse des fichiers ICD (XML IEC 61850)
│   ├── ied_pattern_manager.py  # Association IED ↔ ICD (patterns)
│   ├── isa_manager.py          # Catalogue ISA (import, types, fichiers)
│   ├── isa_parsers/            # Sous-parseurs ISA spécialisés
│   ├── mapping_comparator.py   # Comparaison mapping IEC 61850 vs ICD
│   ├── mapping_merger.py       # Fusion automatique ICD → mapping
│   ├── fcs_manager.py          # Catalogue FCS (CRUD, index JSON)
│   └── rac_manager.py          # Catalogue RAC (CRUD, index JSON)
│
├── web/                        # Interface web SPA
│   ├── index.html              # Page unique SPA (6 vues)
│   │
│   ├── components/
│   │   └── header.html         # Header HTML chargé dynamiquement
│   │
│   ├── css/
│   │   ├── rbd-tokens.css      # Design tokens R#BD (couleurs, variables)
│   │   ├── header-common.css   # Styles du header (partagé rscd)
│   │   ├── rscd-common.css     # Composants communs rscd (cards, etc.)
│   │   ├── rbd-common.css      # Composants communs R#BD (grilles, toast, etc.)
│   │   ├── main.css            # Styles globaux de la page
│   │   ├── icd.css             # Styles spécifiques vue ICD
│   │   ├── isa.css             # Styles spécifiques vue ISA
│   │   ├── templates.css       # Styles spécifiques vue Essais
│   │   └── editor.css          # Styles spécifiques éditeur de tests
│   │
│   ├── js/
│   │   ├── api.js              # Couche API centralisée (fetch wrappers)
│   │   ├── app.js              # Bootstrap SPA (navigation, toast, état)
│   │   ├── header-loader.js    # Chargement dynamique du header
│   │   ├── ied-icd-manager.js  # Logique vue ICD (grille IED, orphelins)
│   │   ├── isa-manager.js      # Logique vue ISA (types, orphelins)
│   │   ├── template-manager.js # Logique de gestion des templates
│   │   ├── templates-essais.js # Logique vue liste Essais
│   │   ├── test-editor.js      # Logique vue éditeur de tests
│   │   ├── fcs.js              # Logique vue FCS (import, liste)
│   │   ├── rac.js              # Logique vue RAC (import, liste)
│   │   └── _archive/           # Scripts JS archivés (anciennes versions)
│   │
│   ├── pages/                  # Anciennes pages HTML (avant SPA, archivées)
│   └── docs/                   # Documentation interne
│
├── data/                       # Persistance JSON
│   ├── icd/                    # Données ICD analysées
│   ├── ied/                    # Patterns IED
│   ├── isa/                    # Index ISA
│   ├── essais/                 # Essais RU/CVS/MVS
│   ├── templates/              # Templates de tests
│   ├── fcs/                    # Index FCS
│   └── rac/                    # Index RAC
│
├── uploads/                    # Fichiers uploadés par l'utilisateur
│   ├── ICD/                    # Fichiers .icd importés
│   ├── isa/                    # Fichiers ISA importés
│   ├── fcs/                    # Fichiers FCS importés
│   └── rac/                    # Fichiers RAC importés
│
├── assets/                     # Logo et ressources statiques
└── plans/                      # Plans d'alignement et documentation interne
```

## Vues SPA

L'interface est organisée en 6 vues dans `web/index.html` :

| ID HTML       | Vue          | Description                                   |
|---------------|--------------|-----------------------------------------------|
| `view-home`   | Accueil      | Dashboard avec cartes d'accès aux modules     |
| `view-icd`    | ICD          | Catalogue ICD, grille IED, panneau orphelins  |
| `view-isa`    | ISA          | Catalogue ISA, types, panneau orphelins       |
| `view-essais` | Essais       | Liste essais + sous-vue éditeur de tests      |
| `view-fcs`    | FCS          | Import et liste des fichiers FCS              |
| `view-rac`    | RAC          | Import et liste des fichiers RAC              |

## Flux de données

```
Utilisateur  →  JavaScript (web/js/)  →  API REST (api/)  →  Core (core/)  →  JSON (data/)
                                                                            →  Fichiers (uploads/)
```

## Hiérarchie CSS

```
[UI Kit] tokens.css + base.css     → variables globales R-CONTROL
    ↓
rbd-tokens.css                     → surcharges R#BD
    ↓
header-common.css                  → styles header partagés
    ↓
rscd-common.css                    → composants visuels communs (cards, etc.)
    ↓
rbd-common.css                     → composants R#BD (grille, toast, badge, etc.)
    ↓
main.css                           → layout général
    ↓
[vue].css                          → styles spécifiques à chaque vue
```
