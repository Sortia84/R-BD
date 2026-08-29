<div align="center">

<img src="assets/RCONTROLE.png" alt="R-CONTROL" width="280"/>

# R#BD v2.0.0

**Base de données R#SPACE pour ressources IEC 61850**

*Importer · Cataloguer · Associer · Réutiliser*

[![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)]()
[![FastAPI](https://img.shields.io/badge/FastAPI-API%20v2.0.0-009688?logo=fastapi&logoColor=white)]()
[![Docker](https://img.shields.io/badge/Docker-Ready-2496ED?logo=docker&logoColor=white)]()
[![IEC 61850](https://img.shields.io/badge/IEC_61850-ICD%20%7C%20ISA%20%7C%20RAC-orange)]()

</div>

---

## Qu'est-ce que R#BD ?

**R#BD** est l'application R-CONTROL qui centralise les référentiels et fichiers
techniques réutilisés par l'écosystème R#SPACE. Elle expose une interface web
SPA et une API FastAPI pour gérer les fichiers **ICD**, **ISA**, **RAC**,
les mappings IEC 61850, les templates et les essais **RU/CVS/MVS/MVC**.

Elle sert de socle de données pour les autres applications du monorepo,
notamment R#GUIDE qui consomme les templates et essais R#BD lors de la création
de guides opérationnels.

---

## Fonctionnalités principales

### ICD et IED
- Import de fichiers `.icd`.
- Parsing XML IEC 61850 via `core/icd_parser.py`.
- Catalogue JSON persisté dans `data/icd/`.
- Gestion des patterns IED et des associations IED -> ICD.
- Sélection d'un ICD par défaut par pattern et fabricant.

### ISA
- Import et catalogue des fichiers ISA.
- Gestion des types ISA et fichiers référents.
- Analyse de fichiers via les parseurs spécialisés dans `core/isa_parsers/`.
- Détection de fichiers orphelins et liaison/déliaison avec les types ISA.

### Mapping IEC 61850
- Consultation des types, CDC, DA et énumérations issus des mappings locaux.
- Comparaison entre mapping attendu et ICD importés.
- Fusion automatique ICD -> mapping quand l'API de merge est appelée.

### Essais et templates
- CRUD des essais `ru`, `cvs`, `mvs` et `mvc` via `/api/essais`.
- Synchronisation des essais entre frontend et persistance JSON.
- Calcul automatique des numéros d'ordre par type, IED et LD à partir de l'ordre global R#BD.
- Parametrage des injections d'essais via import de fichiers `.par`.
- CRUD des templates via `/api/v1/templates`.
- Liaison entre templates de types différents.

### RAC
- Import RAC, catégorisation et lecture du JSON parsé.
- Parseur RAC Excel dédié dans `core/rac_excel_parser.py`.

---

## Architecture technique

```text
Navigateur web
  -> SPA HTML/CSS/JavaScript dans web/
  -> API REST FastAPI dans api_web.py et api/
  -> Logique métier Python dans core/
  -> Persistance JSON dans data/
  -> Fichiers sources importés dans uploads/
```

L'application fonctionne aujourd'hui en **mono-port** :

| Élément | Valeur observée |
|---|---|
| Interface web + API | `http://localhost:8551/` |
| Swagger UI | `http://localhost:8551/docs` |
| Healthcheck applicatif | `http://localhost:8551/health` |
| Healthcheck templates | `http://localhost:8551/api/v1/templates/health` |
| Port API réservé | `8651` dans `config.py` et Docker, non séparé en phase actuelle |

---

## Structure du projet

```text
apps/r_bd/
├── main.py                    # Point d'entrée - lance uvicorn sur api_web:app
├── api_web.py                 # Application FastAPI, routeurs et static files
├── config.py                  # Chemins applicatifs et ports WEB/API
├── README.md                  # Présentation, exploitation et maintenance
├── STRUCTURE.md               # Cartographie détaillée
│
├── api/                       # Routeurs FastAPI par domaine métier
├── core/                      # Managers, parseurs et logique métier
├── web/                       # Frontend SPA HTML/CSS/JS
├── data/                      # Persistance JSON versionnée ou générée
├── uploads/                   # Fichiers importés par l'utilisateur
├── assets/                    # Logo et ressources statiques locales
└── plans/                     # Plans techniques et alignements documentés
```

> Voir [STRUCTURE.md](STRUCTURE.md) pour la description détaillée des modules,
> données, vues frontend et zones de vigilance.

---

## Installation et lancement

### Développement local

Depuis la racine du dépôt :

```bash
cd apps/r_bd
python main.py
```

L'application démarre Uvicorn sur `api_web:app` avec le port défini dans
`config.py` (`WEB_PORT = 8551`).

### Docker

Le dépôt racine contient `Dockerfile.r_bd` et le service `r_bd` dans
`docker-compose.yml`.

```bash
docker compose up r_bd
```

Le service compose observé :

| Élément | Valeur |
|---|---|
| Image | `rcontrol/r_bd:latest` |
| Port | `8551:8551` |
| Port réservé | `8651` exposé par le Dockerfile |
| Volume données | `./apps/r_bd/data:/app/data` |
| Volume uploads | `./apps/r_bd/uploads:/app/uploads` |
| Healthcheck | `/api/v1/templates/health` |

---

## API principale

Les routeurs sont montés dans `api_web.py`.

| Domaine | Préfixe | Responsabilité |
|---|---|---|
| ICD | `/api/icd` | Import, catalogue, détails, réanalyse, patterns IED, ICD par défaut |
| ISA | `/api/isa` | Import, types, fichiers, analyse, orphelins, fichier par défaut |
| Mapping | `/api/mapping` | Types, enums, CDC, DA, comparaison, merge et recherche |
| Essais | `/api/essais` | CRUD, synchronisation et ordres dérivés des essais RU/CVS/MVS/MVC |
| Parametres essais | `/api/essais/parameters` | Catalogue Injections issu des fichiers PAR |
| Templates | `/api/v1/templates` | CRUD templates et liaisons entre templates |
| RAC | `/api/rac` | Import, liste, catégories, versions, liens et JSON parsé |
| Système | `/health` | Vérification simple de disponibilité |

La documentation OpenAPI complète est générée automatiquement par FastAPI :
[`http://localhost:8551/docs`](http://localhost:8551/docs).

---

## Données manipulées

| Emplacement | Rôle |
|---|---|
| `data/icd/` | Données ICD analysées et index ICD |
| `data/ied/` | Patterns et associations IED |
| `data/isa/` | Index ISA, types et fichiers analysés |
| `data/essais/` | Essais `ru`, `cvs`, `mvs`, `mvc` et `parametres_tests.json` |
| `data/templates/` | Templates d'essais |
| `data/rac/` | Index, catégories et fichiers RAC parsés |
| `uploads/ICD/` | Fichiers ICD importés |
| `uploads/rac/` | Fichiers RAC importés |

`api/shared.py` crée au démarrage les dossiers critiques manquants sous
`data/` et `uploads/`. Les données doivent être considérées comme persistantes,
surtout en Docker où elles sont montées en volumes.

---

## Configuration et dépendances

`config.py` est la source locale pour les chemins et ports :

```python
BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = BASE_DIR / "uploads"
WEB_DIR = BASE_DIR / "web"
ICD_DIR = UPLOADS_DIR / "ICD"

WEB_PORT = 8551
API_PORT = 8651
```

Dépendances Python observées dans le code :

| Dépendance | Usage |
|---|---|
| `fastapi` | API HTTP, routeurs, uploads |
| `uvicorn` | Serveur ASGI lancé par `main.py` |
| `pydantic` | Modèles de payload API |
| `python-multipart` | Uploads FastAPI avec `UploadFile` |
| `lxml` | Parsing XML des fichiers ICD |

Le dossier `apps/r_bd` ne contient pas de `requirements.txt` dédié dans l'état
observé. Le Dockerfile racine `Dockerfile.r_bd` installe un sous-ensemble depuis
le `requirements.txt` racine ou utilise un fallback FastAPI/Uvicorn/Pydantic.

---

## Points de vigilance

| Point | Détail |
|---|---|
| Données persistantes | Ne pas supprimer ni régénérer `data/` ou `uploads/` sans sauvegarde. |
| Mono-port actuel | `API_PORT=8651` est réservé mais l'app sert API et frontend sur `8551`. |
| UI Kit partagé | Le frontend monte `/ui-kit` depuis le résolveur commun (`RCONTROL_UI_KIT_DIR`, kit embarqué, `/_ui_kit` ou `shared/ui_kit`). |
| Routeur templates | Le healthcheck Docker utilise `/api/v1/templates/health`. |
| Fichiers volumineux | Les imports ICD/RAC peuvent dépendre de la taille des fichiers et des permissions. |
| Dépendances Docker | Vérifier `lxml` et `python-multipart` avant un build Docker isolé/offline. |
| Scripts archivés | `web/js/_archive/` conserve d'anciennes versions JS, à ne pas réactiver sans décision explicite. |

---

## Support et dépannage

| Problème | Vérification recommandée |
|---|---|
| L'application ne démarre pas | Lancer `python main.py` depuis `apps/r_bd` et lire les logs `[MAIN]` / `[API]`. |
| Port occupé | Vérifier l'usage local du port `8551`. |
| UI sans styles communs | Vérifier `RCONTROL_UI_KIT_DIR` ou l'existence de `shared/ui_kit/css/tokens.css` et `base.css`. |
| Upload refusé | Vérifier les permissions de `uploads/` et la présence de `python-multipart`. |
| ICD non analysé | Vérifier le XML source, `lxml` et les logs du routeur ICD. |
| Docker unhealthy | Tester `curl http://localhost:8551/api/v1/templates/health`. |

---

<div align="center">

**R#BD** fait partie du projet **R-CONTROL**

*Plateforme interne de gestion des ressources IEC 61850*

</div>
