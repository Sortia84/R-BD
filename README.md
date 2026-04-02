# R#BD — Base de données R#SPACE

## Description

R#BD est l'application de gestion centralisée des fichiers IEC 61850 pour
l'écosystème R#SPACE. Elle fournit une interface SPA (Single Page Application)
pour importer, consulter et gérer les fichiers ICD, ISA, FCS, RAC ainsi que
les templates et essais RU/CVS/MVS.

## Architecture

L'application suit le modèle **SPA + FastAPI** identique à R#SCD :

- **Backend** : FastAPI (Python), routeurs découpés par domaine métier.
- **Frontend** : HTML/CSS/JS vanilla, une seule page `web/index.html`.
- **Communication** : API REST JSON entre le frontend et le backend.
- **Données** : Persistance JSON dans `data/`, fichiers uploadés dans `uploads/`.

```
Port : 8597 (WEB_PORT)
URL  : http://localhost:8597
Docs : http://localhost:8597/docs (Swagger auto FastAPI)
```

## Démarrage

```bash
cd apps/r_bd
python main.py
```

Ouvrir ensuite : http://localhost:8597

## Modules fonctionnels

| Module   | Description                              | Backend (api/)        | Frontend (js/)        |
|----------|------------------------------------------|-----------------------|-----------------------|
| ICD      | Import et catalogue de fichiers ICD      | router_icd.py         | ied-icd-manager.js    |
| ISA      | Catalogue ISA et types de fichiers       | router_isa.py         | isa-manager.js        |
| Mapping  | Comparaison IEC 61850 / ICD              | router_mapping.py     | —                     |
| Essais   | CRUD essais RU / CVS / MVS              | router_essais.py      | templates-essais.js   |
| Templates| CRUD templates de tests                  | router_templates.py   | template-manager.js   |
| FCS      | Import et catalogue FCS                  | router_fcs.py         | fcs.js                |
| RAC      | Import et catalogue fichiers RAC         | router_rac.py         | rac.js                |

## Structure détaillée

Voir [STRUCTURE.md](STRUCTURE.md) pour l'arborescence complète.

## Technologies

- **Backend** : Python 3.10+, FastAPI, uvicorn
- **Frontend** : HTML5, CSS3, JavaScript ES6+ (vanilla, sans framework)
- **Stockage** : JSON fichiers (pas de base de données)
- **Design System** : UI Kit commun (`apps/_ui_kit/`) + tokens CSS
- **Icônes** : Emoji (pas de dépendance externe)

## Dépendances Python

- fastapi
- uvicorn
- pydantic
- python-multipart (pour les uploads)
- lxml (pour le parsing XML IEC 61850)
- Compatible avec les autres applications R-CONTROL
