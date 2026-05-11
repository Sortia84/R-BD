<div align="center">

<img src="assets/RCONTROLE.png" alt="R-CONTROL" width="280"/>

# R#BD - Structure du projet

**Cartographie technique de la base de données R#SPACE**

*FastAPI · SPA · Référentiels IEC 61850 · Données persistantes*

[![Backend](https://img.shields.io/badge/Backend-FastAPI-009688?logo=fastapi&logoColor=white)]()
[![Frontend](https://img.shields.io/badge/Frontend-SPA_JS_modulaire-F7DF1E?logo=javascript&logoColor=black)]()
[![Mode](https://img.shields.io/badge/Mode-Base%20de%20données%20IEC%2061850-blue)]()

</div>

---

## Comment lire ce document

Ce document complète le [README.md](README.md). Il décrit l'état observé de
`apps/r_bd` : application FastAPI, frontend SPA, routeurs métier, managers,
persistance JSON et fichiers importés.

| Vous êtes... | Sections recommandées |
|---|---|
| Développeur | [Arborescence complète](#arborescence-complète) -> [Modules clés](#modules-clés---détails) |
| Auditeur | [Métriques](#métriques-et-seuils) -> [Zones de vigilance](#zones-de-vigilance) |
| Intégrateur | [Point d'entrée](#1-point-dentrée--mainpy--api_webpy) -> [Docker](#7-docker-et-compose-racine) |

---

## Arborescence complète

```text
apps/r_bd/
├── main.py                         # Point d'entrée - lance uvicorn sur api_web:app
├── api_web.py                      # Application FastAPI, routeurs et static files
├── config.py                       # Configuration locale : chemins et ports
├── README.md                       # Présentation, lancement et exploitation
├── STRUCTURE.md                    # Ce document
│
├── api/                            # Couche API - routeurs FastAPI
│   ├── __init__.py                 # Exporte les routeurs importés par api_web.py
│   ├── shared.py                   # Chemins, managers singletons, modèles Pydantic, helpers JSON
│   ├── router_icd.py               # Endpoints ICD, patterns IED et ICD par défaut
│   ├── router_isa.py               # Endpoints ISA, types, fichiers, analyse et orphelins
│   ├── router_mapping.py           # Endpoints mapping IEC 61850, comparaison et merge
│   ├── router_essais.py            # Endpoints essais RU/CVS/MVS/MVC et ordres dérivés
│   ├── router_essais_parameters.py # Endpoints parametres d'essais PAR
│   ├── router_templates.py         # Endpoints templates /api/v1/templates
│   └── router_rac.py               # Endpoints RAC
│
├── core/                           # Couche métier Python
│   ├── __init__.py                 # Exports des managers principaux
│   ├── icd_parser.py               # Parsing ICD XML IEC 61850
│   ├── ied_pattern_manager.py      # Patterns IED et associations IED -> ICD
│   ├── isa_manager.py              # Catalogue ISA, types, fichiers et analyse
│   ├── mapping_comparator.py       # Comparaison mapping attendu vs ICD
│   ├── mapping_merger.py           # Fusion automatique ICD -> mapping
│   ├── rac_manager.py              # Catalogue RAC, import et index
│   ├── rac_excel_parser.py         # Lecture RAC depuis fichier Excel
│   ├── test_parameter_manager.py   # Import PAR et catalogue Injections essais
│   └── isa_parsers/                # Parseurs ISA spécialisés
│       ├── __init__.py             # Exports des helpers de parsing ISA
│       ├── equation_parser.py      # Parsing XML d'équations ISA
│       └── risa_enricher.py        # Enrichissement à partir de données RISA
│
├── web/                            # Interface web SPA
│   ├── index.html                  # Shell SPA et chargement CSS/JS
│   ├── components/header.html      # Header local injecté par header-loader.js
│   ├── css/                        # Tokens, composants communs et styles par vue
│   ├── js/                         # Bootstrap SPA, client API et vues métier
│   ├── js/_archive/                # Anciennes versions JS conservées
│   ├── pages/                      # Pages HTML historiques conservées
│   └── docs/                       # Documentation interne frontend et exemples
│
├── data/                           # Persistance JSON
│   ├── essais/                     # Essais ru/cvs/mvs/mvc et parametres_tests.json
│   ├── icd/                        # Données ICD analysées et index
│   ├── ied/                        # Patterns IED
│   ├── isa/                        # Index ISA, types et fichiers analysés
│   ├── rac/                        # Index, catégories et fichiers RAC parsés
│   └── templates/                  # Templates d'essais
│
├── uploads/                        # Fichiers importés
│   ├── ICD/                        # Fichiers .icd importés
│   └── rac/                        # Fichiers RAC importés
│
├── assets/                         # Logo et ressources statiques locales
└── plans/                          # Plans techniques et alignements internes
```

Les dossiers `__pycache__` existent localement mais ne portent pas de
responsabilité applicative.

---

## Modules clés - Détails

### 1. Point d'entrée : main.py -> api_web.py

`main.py` configure le logging, ajoute le dossier applicatif au `sys.path` et
lance Uvicorn sur `api_web:app`.

| Élément | Valeur observée |
|---|---|
| Module ASGI | `api_web:app` |
| Host | `0.0.0.0` |
| Port | `WEB_PORT`, soit `8551` |
| Reload | `True` en lancement local |

`api_web.py` assemble l'application FastAPI avec les routeurs métier, le
middleware CORS, l'endpoint `/health` et les montages statiques `/assets`,
`/ui-kit` puis `/`.

### 2. Configuration et chemins

`config.py` contient la configuration locale directe :

| Constante | Valeur |
|---|---|
| `BASE_DIR` | Dossier `apps/r_bd` |
| `DATA_DIR` | `apps/r_bd/data` |
| `UPLOADS_DIR` | `apps/r_bd/uploads` |
| `WEB_DIR` | `apps/r_bd/web` |
| `ICD_DIR` | `apps/r_bd/uploads/ICD` |
| `WEB_PORT` | `8551` |
| `API_PORT` | `8651`, réservé pour une séparation future |
| `CACHE_EXPIRY_DAYS` | `30` |

`api/shared.py` redéfinit les chemins utilisés par les routeurs, crée les
dossiers critiques manquants et monte le kit UI commun depuis `apps/_ui_kit`.

### 3. Couche API : api/

| Routeur | Préfixe | Responsabilité |
|---|---|---|
| `router_icd.py` | `/api/icd` | ICD, détails, versions, patterns IED, défauts par fabricant |
| `router_isa.py` | `/api/isa` | Import ISA, types, fichiers, analyse, orphelins, défauts |
| `router_mapping.py` | `/api/mapping` | Types, enums, CDC, DA, comparaison, merge et recherche |
| `router_essais.py` | `/api/essais` | CRUD, synchronisation et ordres dérivés des essais |
| `router_essais_parameters.py` | `/api/essais/parameters` | Parametres Injections importes depuis PAR |
| `router_templates.py` | `/api/v1/templates` | CRUD templates, liens et healthcheck |
| `router_rac.py` | `/api/rac` | Catégories, liste, versions, liens, import, JSON parsé |

`api/shared.py` centralise les singletons `ICDParserV2`,
`IEDPatternManager`, `ISAManager`, `MappingComparator`, `MappingMerger`,
et `RACManager`.

### 4. Couche métier : core/

| Module | Rôle |
|---|---|
| `icd_parser.py` | Parse les fichiers ICD XML IEC 61850 et produit les données de catalogue. |
| `ied_pattern_manager.py` | Gère les patterns IED, les correspondances et les ICD par défaut. |
| `isa_manager.py` | Gère le catalogue ISA, les types, uploads, analyses et fichiers référents. |
| `isa_parsers/equation_parser.py` | Parse les équations ISA au format XML. |
| `isa_parsers/risa_enricher.py` | Enrichit les analyses ISA avec les données RISA. |
| `mapping_comparator.py` | Compare le mapping IEC 61850 attendu avec les données ICD disponibles. |
| `mapping_merger.py` | Fusionne des informations ICD dans les mappings locaux. |
| `rac_manager.py` | Gère les RAC, catégories, versions, liens et fichiers parsés. |
| `rac_excel_parser.py` | Extrait les informations RAC depuis un fichier Excel. |
| `test_parameter_manager.py` | Parse les fichiers PAR et produit le catalogue Injections des essais. |

### 5. Frontend : web/

`web/index.html` est le shell SPA. Il charge le kit UI commun, les tokens R#BD,
les styles communs, puis les styles par vue. Les scripts suivent l'ordre :
`api.js`, `header-loader.js`, `app.js`, puis les modules de vues.

| Fichier | Rôle |
|---|---|
| `web/js/api.js` | Client API centralisé et wrappers `fetch`. |
| `web/js/app.js` | Bootstrap SPA, navigation et notifications. |
| `web/js/home.js` | Vue d'accueil. |
| `web/js/ied-icd-manager.js` | Vue ICD et association IED/ICD. |
| `web/js/isa-manager.js` | Vue ISA. |
| `web/js/template-manager.js` | Gestion des templates. |
| `web/js/test-parameters.js` | Gestion IHM des fonctions/parametres d'injection. |
| `web/js/templates-essais.js` | Liste et gestion des essais. |
| `web/js/test-editor.js` | Éditeur de tests. |
| `web/js/rac.js` | Vue RAC. |

Vues SPA déclarées : `view-home`, `view-icd`, `view-isa`, `view-essais`,
et `view-rac`.

### 6. Données et fichiers importés

| Emplacement | Contenu observé |
|---|---|
| `data/icd/` | Index et fichiers JSON issus d'ICD analysés |
| `data/ied/liste_ied.json` | Liste/patterns IED |
| `data/isa/index.json` | Index ISA |
| `data/isa/liste_isa.json` | Types ou liste ISA |
| `data/isa/files/` | Fichiers ISA analysés par famille |
| `data/essais/essais_ru.json` | Essais RU |
| `data/essais/essais_cvs.json` | Essais CVS |
| `data/essais/essais_mvs.json` | Essais MVS |
| `data/essais/essais_mvc.json` | Essais MVC si le type est utilisé |
| `data/essais/parametres_tests.json` | Catalogue Injections issu des fichiers PAR |
| `data/templates/` | Templates JSON |
| `data/rac/index.json` | Index RAC |
| `data/rac/categories.json` | Catégories RAC |
| `data/rac/files/` | RAC parsés en JSON |
| `uploads/ICD/` | Fichiers ICD sources |
| `uploads/rac/` | Fichiers RAC sources |

Les fichiers FCS sont désormais gérés côté R#SCD et ne font plus partie du
périmètre actif de R#BD.

### 7. Docker et compose racine

Le Dockerfile utilisé est `Dockerfile.r_bd` à la racine du dépôt.

| Élément | Valeur observée |
|---|---|
| Image de base | `python:3.10-slim` |
| Workdir | `/app` |
| Copie applicative | `COPY apps/r_bd/ ${WORKDIR}/` |
| Copie lib commune | `COPY lib/ /lib/` |
| Ports exposés | `8551` et `8651` |
| Commande | `python main.py` |
| Healthcheck | `http://localhost:8551/api/v1/templates/health` |

Le `docker-compose.yml` racine définit le service `r_bd` avec le port
`8551:8551`, les volumes `./apps/r_bd/data:/app/data` et
`./apps/r_bd/uploads:/app/uploads`, ainsi que `PORT_WEB=8551` et `PORT_API=8651`.

---

## Flux de données

```text
Utilisateur
  -> web/index.html + web/js/*
  -> API REST FastAPI (api/)
  -> Managers métier (core/)
  -> JSON persisté (data/)
  -> Fichiers sources importés (uploads/)
```

Le frontend ne doit pas porter la logique métier IEC 61850 lourde : les analyses,
comparaisons, imports et exports structurants restent côté Python.

---

## Métriques et seuils

| Fichier | Taille actuelle | Statut |
|---|---:|---|
| `web/js/ied-icd-manager.js` | ~1105 lignes | Problématique |
| `web/js/isa-manager.js` | ~715 lignes | À surveiller |
| `api/router_icd.py` | ~481 lignes | À surveiller |
| `api/router_isa.py` | ~369 lignes | Sous seuil de vigilance |
| `api/router_templates.py` | ~357 lignes | Sous seuil de vigilance |
| `web/css/main.css` | ~288 lignes | Sous seuil de vigilance |
| `api_web.py` | ~131 lignes | Sain |

Seuils projet : > 400 lignes à surveiller, > 800 problématique, > 1200 urgent.

---

## Zones de vigilance

- `web/js/ied-icd-manager.js` concentre une forte part de la logique frontend
  ICD/IED. Toute évolution doit rester ciblée ou préparer un découpage progressif.
- Les données de `data/` et `uploads/` sont persistantes et montées en volumes
  Docker. Ne pas les réinitialiser lors d'une correction documentaire ou UI.
- Le port `8651` existe comme convention réservée, mais le fonctionnement actuel
  est mono-port sur `8551`.
- Le frontend dépend du montage `/ui-kit` vers `apps/_ui_kit`; une exécution
  isolée de `apps/r_bd` doit conserver ce dossier parent.
- Le Dockerfile installe un sous-ensemble de dépendances depuis le
  `requirements.txt` racine. Les imports réels utilisent aussi `lxml` et les
  uploads FastAPI nécessitent `python-multipart`.
- `web/js/_archive/` et `web/pages/` sont des zones historiques. Les supprimer
  ou les remettre en service demande une décision explicite.
- Les règles métier IEC 61850 / RTE doivent rester dans `core/` ou être
  documentées avant d'être figées dans le frontend.

---

## Documentation liée

| Document | Rôle |
|---|---|
| [README.md](README.md) | Présentation, lancement, API principale et dépannage |
| [web/docs/icd-page-guide.md](web/docs/icd-page-guide.md) | Guide interne de la page ICD |
| [web/docs/MIGRATION_HTML_ONLY.md](web/docs/MIGRATION_HTML_ONLY.md) | Historique de migration frontend |
| [web/docs/rac-json-format.example.json](web/docs/rac-json-format.example.json) | Exemple de format JSON RAC |
| [plans/PLAN_ALIGNEMENT_R_BD_SUR_R_SCD.md](plans/PLAN_ALIGNEMENT_R_BD_SUR_R_SCD.md) | Plan d'alignement R#BD / R#SCD |
