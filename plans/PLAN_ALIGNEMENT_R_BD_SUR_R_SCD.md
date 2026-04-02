# Plan d'alignement R#BD sur l'architecture R#SCD

> **Date** : 01/04/2026  
> **Auteur** : Architecte R#CONTROLE  
> **Référent** : `apps/r_scd/` (architecture cible)  
> **Cible** : `apps/r_bd/` (application à aligner)  
> **Finalité** : Rendre R#BD architecturalement identique à R#SCD + ajouter les catégories FCS et Fichiers RAC

---

## Résumé exécutif

R#BD fonctionne actuellement avec une **architecture multi-pages HTML** (4 fichiers HTML dans `web/pages/` + `index.html` racine), un **header à base de liens `<a>`**, des **chemins relatifs gérés manuellement** et une **absence d'utilisation du UI Kit mutualisé**. L'architecture de R#SCD repose sur un modèle **SPA mono-fichier** avec navigation par vues `<div>`, un **header mutualisé par injection `<button>`/`data-view`**, l'usage du **UI Kit** (`_ui_kit/css/tokens.css` + `base.css`), un **fichier `api_web.py` séparé** et un **module `api/shared.py`** centralisant l'état.

L'alignement nécessite un **refactoring profond mais progressif** de R#BD, phase par phase.

---

## Analyse du périmètre

| Critère | R#SCD (référent) | R#BD (actuel) | Écart |
|---------|-------------------|---------------|-------|
| **Modèle navigation** | SPA mono-page (`web/index.html`) avec vues `<div>` | Multi-pages (`index.html` racine + 4 pages dans `web/pages/`) | **CRITIQUE** |
| **Header** | Composant `header.html` avec `<button data-view>` | Composant `header.html` avec `<a href>` vers fichiers HTML | **FORT** |
| **CSS tokens** | UI Kit (`tokens.css` + `base.css`) + pont `rcscd-tokens.css` | Variables définies en dur dans `main.css` `:root` | **FORT** |
| **Point d'entrée Python** | `api_web.py` (FastAPI app) + `main.py` (launcher) | `main.py` (tout-en-un) | **MOYEN** |
| **Module shared** | `api/shared.py` (état global, managers, modèles Pydantic) | Aucun | **FORT** |
| **`api/__init__.py`** | Docstring + exports nommés + `__all__` | Une seule ligne vide | **MOYEN** |
| **`core/__init__.py`** | Imports complets + `__all__` | Une seule ligne vide | **MOYEN** |
| **JS — couche API** | `api.js` centralisé (`api.get/post/upload/delete`) | Appels `fetch` disséminés dans chaque JS | **FORT** |
| **JS — app bootstrap** | `app.js` (`initApp()`, `switchView()`, `_escHtml()`) | Aucun | **FORT** |
| **CSS — découpage** | 1 fichier tokens + 1 common + N fichiers par vue | 1 fichier `main.css` global + fichiers par page | **MOYEN** |
| **Montage StaticFiles** | `/assets`, `/ui-kit`, `/` (web, html=True) | `/web`, `/data`, `/uploads`, `/assets` + route GET `/` | **MOYEN** |
| **Documentation** | `README.md` + `STRUCTURE.md` + docstrings complets | `README.md` obsolète, pas de `STRUCTURE.md` | **MOYEN** |
| **Docstrings/commentaires** | Très présents (PEP-257, JSDoc) | Partiels | **MOYEN** |
| **Catégorie FCS** | Existe (routeur + core/fcs/ + JS display-fcs) | Absente | **AJOUT** |
| **Catégorie Fichiers RAC** | N'existe nulle part | Absente | **AJOUT** |

---

## Cartographie actuelle R#BD

### Arborescence existante

```
apps/r_bd/
├── main.py                          ← Point d'entrée (tout-en-un FastAPI)
├── config.py                        ← Config (ports 8597/8664, chemins)
├── index.html                       ← Page d'accueil HTML (RACINE, pas dans web/)
├── README.md                        ← Documentation (obsolète)
│
├── api/                             ← 5 routeurs FastAPI
│   ├── __init__.py                  ← Quasi vide
│   ├── icd_api.py                   ← CRUD ICD
│   ├── isa_api.py                   ← CRUD ISA
│   ├── mapping_api.py               ← Consultation mapping IEC 61850
│   ├── essais_api.py                ← CRUD essais RU/CVS/MVS
│   └── templates_api.py             ← CRUD templates
│
├── core/                            ← Logique métier
│   ├── __init__.py                  ← Quasi vide
│   ├── icd_parser.py                ← Parser ICD V2
│   ├── ied_pattern_manager.py       ← Patterns IED + liaisons
│   ├── isa_manager.py               ← Gestionnaire ISA
│   ├── mapping_comparator.py        ← Comparaison mapping vs ICD
│   ├── mapping_merger.py            ← Fusion ICD → mapping
│   └── isa_parsers/                 ← Parsers spécialisés ISA
│       ├── equation_parser.py
│       └── risa_enricher.py
│
├── web/                             ← Frontend
│   ├── components/
│   │   └── header.html              ← Header (liens <a> multi-pages)
│   ├── css/
│   │   ├── main.css                 ← Styles globaux + header + variables
│   │   ├── templates.css
│   │   ├── icd.css
│   │   ├── isa.css
│   │   └── editor.css
│   ├── js/
│   │   ├── header-loader.js         ← Chargement header (chemins relatifs)
│   │   ├── ied-icd-manager.js       ← Vue IED
│   │   ├── isa-manager.js           ← Vue ISA  
│   │   ├── template-manager.js      ← Classes templates
│   │   ├── templates-essais.js      ← Vue essais unifiée
│   │   ├── test-editor.js           ← Éditeur JSON brut
│   │   ├── icd-manager.js           ← (obsolète?)
│   │   ├── isa-picker.js            ← (obsolète?)
│   │   └── templates-ru.js          ← (obsolète?)
│   ├── pages/
│   │   ├── ICD.html                 ← Page IED/ICD
│   │   ├── isa.html                 ← Page ISA
│   │   ├── templates-essais.html    ← Page essais
│   │   └── test-editor.html         ← Éditeur brut
│   └── docs/
│       ├── MIGRATION_HTML_ONLY.md
│       └── icd-page-guide.md
│
├── data/                            ← Persistance JSON
│   ├── essais/
│   ├── icd/
│   ├── ied/
│   ├── isa/
│   └── templates/
│
├── uploads/                         ← Fichiers temporaires
└── assets/
    └── RCONTROLE.png
```

### Points sains à conserver

1. **Découpage API en routeurs distincts** : `icd_api.py`, `isa_api.py`, `mapping_api.py`, `essais_api.py`, `templates_api.py` — bonne séparation
2. **Découpage core** : `icd_parser.py`, `ied_pattern_manager.py`, `isa_manager.py` — modules clairs
3. **Sous-module `isa_parsers/`** : bonne factorisation (équivalent de `core/analysis/` chez r_scd)
4. **Données data/** bien organisées par catégorie
5. **Variables CSS centralisées** dans `:root` (même si pas encore via UI Kit)
6. **Port fixé** et documenté dans config.py

---

## Constats et incohérences

### 1. Navigation multi-pages vs SPA

**R#SCD** : Un seul `web/index.html` contient toutes les vues en `<div class="rscd-view">`. La navigation se fait par `switchView("manager")` / `switchView("analysis")`, etc. Les URLs restent toujours sur `/`.

**R#BD** : Le `index.html` est **à la racine** (pas dans `web/`), et chaque page est un fichier HTML séparé dans `web/pages/`. Cela impose :
- des chemins relatifs différents par page ;
- un `header-loader.js` qui recalcule les chemins selon `window.location.pathname` ;
- des liens `<a href>` dans le header au lieu de boutons ;
- un rechargement complet du navigateur à chaque changement de section.

**Impact** : C'est l'écart le plus structurant. La migration vers SPA est le chantier central.

### 2. Header incompatible

**R#SCD** : Classes préfixées `rscd-*`, boutons `<button data-view>`, sous-titre dédié, injecté via `fetch("/components/header.html")`.

**R#BD** : Classes préfixées `guide-*` (héritage R#GUIDE), liens `<a href>` avec chemins absolus/relatifs mixtes, pas de sous-titre. Le `header-loader.js` contient de la logique de correction de chemins (`isInSubfolder`).

### 3. Absence du UI Kit

**R#SCD** charge :
1. `/ui-kit/css/tokens.css` (variables R-CONTROL centrales)
2. `/ui-kit/css/base.css` (reset + base)
3. `/css/rcscd-tokens.css` (pont aliases locaux)

**R#BD** définit ses variables **en dur** dans `main.css`. Elles sont heureusement proches (même `--accent: #00a7de`, mêmes `--success`, `--warning`, `--danger`) mais ne passent pas par le UI Kit.

### 4. Pas de fichier `api_web.py` séparé

**R#SCD** sépare :
- `main.py` = launcher simple (configure logging + lance uvicorn)
- `api_web.py` = déclaration FastAPI, middleware, routeurs, static files

**R#BD** met tout dans `main.py`.

### 5. Pas de `api/shared.py`

**R#SCD** centralise dans `shared.py` : instances singleton, modèles Pydantic partagés, constantes métier, helpers factorisés, chemins.

**R#BD** duplique ces éléments dans chaque routeur.

### 6. Pas de couche JS `api.js`

**R#SCD** a un fichier `api.js` unique exposant `api.get()`, `api.post()`, `api.upload()`, `api.delete()` + des wrappers métier (`apiManager.importScd()`, etc.).

**R#BD** fait des `fetch()` directement dans chaque fichier JS, sans centralisation.

### 7. Pas de `app.js` bootstrap

**R#SCD** a un fichier `app.js` qui :
- définit `_escHtml()` (protection XSS globale)
- gère `initApp()` + `switchView()`
- initialise toutes les vues
- attache les handlers de navigation

**R#BD** n'a pas d'équivalent. Chaque page se charge indépendamment.

### 8. Fichiers potentiellement obsolètes

- `icd-manager.js` : possiblement remplacé par `ied-icd-manager.js`
- `isa-picker.js` : non référencé
- `templates-ru.js` : remplacé par `templates-essais.js`
- `test-editor.html` + `test-editor.js` : éditeur JSON brut, probablement déprécié

### 9. Conventions de nommage CSS divergentes

| Élément | R#SCD | R#BD |
|---------|-------|------|
| Préfixe classes | `rscd-*` | `guide-*` ou classes génériques (`card`, `btn`) |
| Header | `.rscd-header` | `.guide-header` |
| Container | `.rscd-container` | `.guide-main` |
| Cartes | `.rscd-card` | `.card` |
| Boutons | `.rscd-btn`, `.rscd-btn-primary` | `.btn`, `.btn-primary` |
| Tabs navigation | `.rscd-tab` + `.rscd-nav` | `.nav-button` + `.guide-nav` |

### 10. Styles inline excessifs dans index.html (R#BD)

Le `index.html` de R#BD contient énormément de `style="..."` inline (grilles, badges, icônes). R#SCD n'en a quasiment aucun.

### 11. README obsolète

Le README de R#BD mentionne encore le "mode statique" et "double-clic sur index.html". L'application a depuis un backend FastAPI actif.

---

## Plan d'action recommandé

### Phase 0 — Préparation et nettoyage (Priorité : Haute)

**Objectif** : Nettoyer l'existant avant toute restructuration.

**Actions** :
1. Identifier et archiver les fichiers obsolètes :
   - `web/js/icd-manager.js` → vérifier si utilisé, sinon archiver
   - `web/js/isa-picker.js` → idem
   - `web/js/templates-ru.js` → idem
   - `web/pages/test-editor.html` + `web/js/test-editor.js` → archiver si déprécié
2. Supprimer les styles inline du `index.html` actuel (reporter dans CSS)
3. Mettre à jour `README.md` (supprimer la mention "mode statique")
4. Créer `STRUCTURE.md` avec l'arborescence cible

**Impact** : Base propre pour travailler, moins de confusion.

**Risques** : Casser une fonctionnalité si un fichier "obsolète" est encore référencé.

**Dépendances** : Aucune.

**Priorité** : **Haute** — Prérequis pour les phases suivantes.

---

### Phase 1 — Séparation `main.py` / `api_web.py` (Priorité : Haute)

**Objectif** : Aligner la structure du point d'entrée Python sur R#SCD.

**Actions** :
1. Créer `api_web.py` dans `r_bd/` :
   - Déplacer la déclaration `FastAPI()`, le CORS, les `include_router`, les `mount()` depuis `main.py`
   - Ajouter un `lifespan` context manager (startup/shutdown logging)
   - Monter les statiques comme R#SCD :
     ```python
     app.mount("/assets", StaticFiles(directory=ASSETS_DIR), name="assets")
     app.mount("/ui-kit", StaticFiles(directory=UI_KIT_DIR), name="ui-kit")
     app.mount("/", StaticFiles(directory=WEB_DIR, html=True), name="web")
     ```
   - Supprimer la route `GET /` manuelle (le `html=True` la gère)
   - Supprimer le montage `/data` en StaticFiles (risque sécurité — les données doivent passer par l'API)
2. Simplifier `main.py` en launcher :
   - Configure logging
   - Lance `uvicorn("api_web:app", ...)`
3. Déplacer `index.html` de la racine vers `web/index.html`

**Impact** : Architecture backend identique à R#SCD.

**Risques** : Les chemins de fichiers statiques changent (ancien `/web/css/main.css` → `/css/main.css`).

**Dépendances** : Phase 0 terminée.

**Priorité** : **Haute**.

---

### Phase 2 — Module `api/shared.py` + nettoyage `__init__.py` (Priorité : Haute)

**Objectif** : Centraliser l'état partagé comme R#SCD.

**Actions** :
1. Créer `api/shared.py` contenant :
   - Les imports des managers core : `ICDParserV2`, `IEDPatternManager`, `ISAManager`, `MappingComparator`, `MappingMerger`
   - Les instances singleton : `icd_parser`, `ied_pattern_manager`, `isa_manager`, etc.
   - Les chemins : `BASE_DIR`, `WEB_DIR`, `ASSETS_DIR`, `UI_KIT_DIR`, `DATA_DIR`, `UPLOAD_DIR`
   - Le logger commun : `logging.getLogger("API[r_bd]")`
   - Les modèles Pydantic partagés (extraire `EssaiPayload`, `TemplateModel`, etc. depuis les routeurs)
2. Compléter `api/__init__.py` :
   ```python
   # api/__init__.py
   """
   Package API — Routeurs FastAPI pour R#BD
   
   Organisation :
     - shared.py           : État partagé (managers, helpers, config)
     - router_icd.py       : Endpoints ICD (import, catalogue, patterns)
     - router_isa.py       : Endpoints ISA (import, types, fichiers)
     - router_mapping.py   : Endpoints Mapping (consultation IEC 61850)
     - router_essais.py    : Endpoints Essais (CRUD RU/CVS/MVS)
     - router_templates.py : Endpoints Templates (CRUD)
     - router_fcs.py       : Endpoints FCS (import, comparaison)       ← NOUVEAU
     - router_rac.py       : Endpoints Fichiers RAC                    ← NOUVEAU
   """
   from .router_icd import router as icd_router
   # ... etc.
   ```
3. Compléter `core/__init__.py` avec les exports et `__all__`
4. Renommer les routeurs en `router_*.py` pour cohérence avec R#SCD :
   - `icd_api.py` → `router_icd.py`
   - `isa_api.py` → `router_isa.py`
   - `mapping_api.py` → `router_mapping.py`
   - `essais_api.py` → `router_essais.py`
   - `templates_api.py` → `router_templates.py`

**Impact** : Code factorisé, plus de duplication d'instances et de chemins dans les routeurs.

**Risques** : Beaucoup de fichiers touchés. Nécessite de mettre à jour tous les imports.

**Dépendances** : Phase 1 terminée.

**Priorité** : **Haute**.

---

### Phase 3 — Migration SPA mono-page (Priorité : Haute)

**Objectif** : Passer de multi-pages à un modèle SPA identique à R#SCD.

**Actions** :
1. Créer `web/index.html` unifié (SPA) :
   - Charger le UI Kit : `/ui-kit/css/tokens.css` + `/ui-kit/css/base.css`
   - Charger un pont tokens local : `/css/rbd-tokens.css` (équivalent de `rcscd-tokens.css`)
   - Charger le header commun : `/css/header-common.css`
   - Charger les CSS par vue : `/css/rbd-common.css`, `/css/rbd-icd.css`, `/css/rbd-isa.css`, etc.
   - Structure body :
     ```html
     <div id="app" class="rbd-app">
       <main class="rbd-container">
         <div id="view-home" class="rbd-view active">...</div>
         <div id="view-icd" class="rbd-view">...</div>
         <div id="view-isa" class="rbd-view">...</div>
         <div id="view-essais" class="rbd-view">...</div>
         <div id="view-fcs" class="rbd-view">...</div>          <!-- NOUVEAU -->
         <div id="view-rac" class="rbd-view">...</div>          <!-- NOUVEAU -->
       </main>
     </div>
     ```
   - Charger les scripts en bas :
     ```html
     <script src="/js/api.js"></script>
     <script src="/js/header-loader.js"></script>
     <script src="/js/app.js"></script>
     <script src="/js/home.js"></script>
     <script src="/js/icd.js"></script>
     <script src="/js/isa.js"></script>
     <script src="/js/essais.js"></script>
     <script src="/js/fcs.js"></script>           <!-- NOUVEAU -->
     <script src="/js/rac.js"></script>           <!-- NOUVEAU -->
     <script>
       loadHeader({...}).then(() => initApp());
     </script>
     ```
2. Intégrer le contenu des 4 pages HTML actuelles comme vues `<div>` dans le SPA
3. Supprimer le dossier `web/pages/` une fois la migration validée
4. Supprimer l'ancien `index.html` de la racine

**Impact** : Navigation fluide sans rechargement. Architecture identique à R#SCD.

**Risques** : 
- Tous les JS doivent être adaptés (plus de `window.location` pour la navigation)
- Les fonctionnalités existantes doivent être préservées intégralement
- Phase la plus risquée du projet

**Dépendances** : Phases 1 et 2 terminées.

**Priorité** : **Haute**.

---

### Phase 4 — Header identique R#SCD (Priorité : Haute)

**Objectif** : Le header R#BD doit être visuellement et structurellement identique à R#SCD.

**Actions** :
1. Réécrire `web/components/header.html` :
   ```html
   <header class="rscd-header">
     <img class="rscd-logo" src="/assets/RCONTROLE.png" alt="Logo R-CONTROL" />
     <div class="rscd-header-title-row">
       <div class="rscd-header-title" id="rscd-header-title">R#BD</div>
       <div class="rscd-header-meta" id="rscd-header-meta">© 2026 APPLETON - RTE R#CONTROLE</div>
     </div>
     <div class="rscd-header-subtitle" id="rscd-header-subtitle">
       Base de données IEC 61850
     </div>
     <div class="rscd-header-divider"></div>
     <nav id="nav-main" class="rscd-nav" aria-label="Navigation principale R#BD">
       <button class="rscd-tab active" data-view="home" type="button">🏠 Accueil</button>
       <button class="rscd-tab" data-view="icd" type="button">📃 IED / ICD</button>
       <button class="rscd-tab" data-view="isa" type="button">📂 Fichiers ISA</button>
       <button class="rscd-tab" data-view="essais" type="button">🧪 Essais</button>
       <button class="rscd-tab" data-view="fcs" type="button">📋 FCS</button>
       <button class="rscd-tab" data-view="rac" type="button">📎 Fichiers RAC</button>
     </nav>
   </header>
   ```
   **Note** : utilisation des **mêmes classes CSS** que R#SCD (`rscd-header`, `rscd-logo`, `rscd-tab`, etc.). Cela permet de réutiliser intégralement `header-common.css` sans duplication.
2. Réécrire `web/js/header-loader.js` :
   - Aligner sur la version R#SCD (plus simple car plus de gestion `isInSubfolder`)
   - Même signature : `loadHeader({ activeView, title, subtitle })`
   - Le header est chargé via `fetch("/components/header.html")`
3. Copier `web/css/header-common.css` depuis R#SCD (identique)

**Impact** : Header identique visuellement et structurellement. Plus de divergence.

**Risques** : Les classes CSS changent (`guide-*` → `rscd-*`), nécessite de mettre à jour les CSS locaux.

**Dépendances** : Phase 3 terminée (SPA en place).

**Priorité** : **Haute**.

---

### Phase 5 — Migration CSS vers UI Kit + tokens (Priorité : Moyenne)

**Objectif** : Aligner la chaîne CSS sur le modèle R#SCD.

**Actions** :
1. Créer `web/css/rbd-tokens.css` (pont comme `rcscd-tokens.css`) :
   - Mapper les variables `--rc-*` du UI Kit vers les aliases locaux
   - Supprimer les variables en dur de l'ancien `main.css`
2. Créer `web/css/rbd-common.css` (équivalent `rscd-common.css`) :
   - Classes réutilisables : `.rbd-card`, `.rbd-btn`, `.rbd-badge`, `.rbd-container`
   - OU réutiliser directement les classes `rscd-*` si la décision est de mutualiser inter-applis
3. Renommer/restructurer les CSS :
   - `main.css` → extraire le header (déjà dans `header-common.css`), le layout, les variables
   - `templates.css` → `rbd-essais.css`
   - `icd.css` → `rbd-icd.css`
   - `isa.css` → `rbd-isa.css`
   - Créer `rbd-fcs.css` (nouveau)
   - Créer `rbd-rac.css` (nouveau)
   - `editor.css` → archiver si plus utilisé
4. Supprimer tous les styles inline du HTML

**Point à arbitrer** : Utiliser le préfixe `rbd-*` (propre à R#BD) ou mutualiser `rscd-*` inter-applis ? La recommandation est d'utiliser `rscd-*` pour le header (composant commun) et `rbd-*` pour les vues spécifiques R#BD.

**Impact** : Cohérence visuelle parfaite avec R#SCD et toute appli utilisant le UI Kit.

**Risques** : Régression visuelle si une variable est mal mappée.

**Dépendances** : Phase 4 terminée.

**Priorité** : **Moyenne**.

---

### Phase 6 — Couche JS `api.js` + `app.js` (Priorité : Haute)

**Objectif** : Créer les fichiers JS structurants manquants, identiques au pattern R#SCD.

**Actions** :
1. Créer `web/js/api.js` :
   ```javascript
   const API_BASE = "/api";
   const api = {
     get: async (endpoint) => { ... },
     post: async (endpoint, data) => { ... },
     upload: async (endpoint, file) => { ... },
     delete: async (endpoint) => { ... }
   };
   const apiIcd = { getCatalog, upload, getDetails, ... };
   const apiIsa = { getCatalog, upload, ... };
   const apiEssais = { list, create, update, delete, ... };
   const apiTemplates = { list, create, update, delete, ... };
   const apiFcs = { ... };    // NOUVEAU
   const apiRac = { ... };    // NOUVEAU
   ```
2. Créer `web/js/app.js` :
   ```javascript
   function _escHtml(str) { ... }
   const appState = { currentView: "home", initialized: false };
   async function initApp() { ... }
   function switchView(name) { ... }
   function attachNavHandlers() { ... }
   ```
3. Refactorer les JS existants pour utiliser `api.*` au lieu de `fetch()` direct :
   - `ied-icd-manager.js` → `icd.js` (renommer, utiliser `apiIcd`)
   - `isa-manager.js` → `isa.js`
   - `templates-essais.js` → `essais.js`
   - `template-manager.js` → `essais-utils.js` (utilitaires pattern matching)
4. Ajouter `_escHtml()` partout où du `innerHTML` est utilisé (sécurité XSS)

**Impact** : Code JS factorisé, maintenable, sécurisé.

**Risques** : Régression si un appel API est mal migré.

**Dépendances** : Phase 3 terminée (SPA en place).

**Priorité** : **Haute**.

---

### Phase 7 — Ajout catégorie FCS (Priorité : Moyenne)

**Objectif** : Ajouter la gestion des fichiers FCS dans R#BD.

**Actions** :
1. **Backend — core** :
   - Créer `core/fcs/` avec :
     - `__init__.py`
     - `fcs_parser.py` : parser XML FCS (s'inspirer de `r_scd/core/fcs/fcs_parser.py`)
     - `fcs_manager.py` : gestionnaire FCS (import, catalogue, registre)
   - Stockage : `data/fcs/` + `data/fcs_registry.json`
2. **Backend — API** :
   - Créer `api/router_fcs.py` avec les endpoints :
     - `POST /api/fcs/import` — Importer un fichier FCS
     - `GET /api/fcs/list` — Catalogue FCS
     - `GET /api/fcs/{fcs_id}` — Détails d'un FCS
     - `DELETE /api/fcs/{fcs_id}` — Supprimer
     - `POST /api/fcs/reanalyze/{fcs_id}` — Ré-analyser
   - Ajouter dans `api/shared.py` : `fcs_manager = FCSManager()`
   - Enregistrer dans `api_web.py` : `app.include_router(fcs_router)`
3. **Frontend — JS** :
   - Créer `web/js/fcs.js` : vue FCS (import, catalogue, détails)
   - Ajouter `apiFcs` dans `api.js`
4. **Frontend — CSS** :
   - Créer `web/css/rbd-fcs.css`
5. **Frontend — HTML** :
   - Ajouter `<div id="view-fcs" class="rbd-view">` dans `web/index.html`

**Impact** : Nouvelle fonctionnalité. Gestion autonome des FCS dans R#BD.

**Risques** : Nécessite de comprendre la structure XML FCS. S'appuyer sur le parser existant de R#SCD.

**Dépendances** : Phases 1-6 terminées.

**Priorité** : **Moyenne**.

---

### Phase 8 — Ajout catégorie Fichiers RAC (Priorité : Moyenne)

**Objectif** : Ajouter la gestion des fichiers RAC dans R#BD.

**Actions** :
1. **Backend — core** :
   - Créer `core/rac/` avec :
     - `__init__.py`
     - `rac_parser.py` : parser des fichiers RAC (format à spécifier)
     - `rac_manager.py` : gestionnaire RAC (import, catalogue)
   - Stockage : `data/rac/` + `data/rac_registry.json`
2. **Backend — API** :
   - Créer `api/router_rac.py` avec les endpoints :
     - `POST /api/rac/import` — Importer un fichier RAC
     - `GET /api/rac/list` — Catalogue RAC
     - `GET /api/rac/{rac_id}` — Détails
     - `DELETE /api/rac/{rac_id}` — Supprimer
   - Ajouter dans `api/shared.py` : `rac_manager = RACManager()`
   - Enregistrer dans `api_web.py` : `app.include_router(rac_router)`
3. **Frontend — JS** :
   - Créer `web/js/rac.js` : vue Fichiers RAC
   - Ajouter `apiRac` dans `api.js`
4. **Frontend — CSS** :
   - Créer `web/css/rbd-rac.css`
5. **Frontend — HTML** :
   - Ajouter `<div id="view-rac" class="rbd-view">` dans `web/index.html`

**Point à arbitrer** : Quel est le format exact des fichiers RAC ? XML ? CSV ? JSON ? Quelles données en extraire ? Ce point doit être clarifié avant l'implémentation.

**Impact** : Nouvelle fonctionnalité.

**Risques** : Spécifications métier à confirmer pour le parser.

**Dépendances** : Phases 1-6 terminées. Spécifications métier RAC validées.

**Priorité** : **Moyenne**.

---

### Phase 9 — Documentation et qualité de code (Priorité : Moyenne)

**Objectif** : Aligner la qualité documentaire sur R#SCD.

**Actions** :
1. Réécrire `README.md` :
   - Description, fonctionnalités, installation, Docker, structure
   - S'inspirer du format R#SCD
2. Créer `STRUCTURE.md` avec l'arborescence cible finale
3. Ajouter des docstrings PEP-257 à toutes les classes et fonctions Python :
   - `core/icd_parser.py`
   - `core/ied_pattern_manager.py`
   - `core/isa_manager.py`
   - `core/mapping_comparator.py`
   - `core/mapping_merger.py`
   - `core/isa_parsers/*.py`
   - Tous les routeurs `api/router_*.py`
4. Ajouter des commentaires JSDoc aux fonctions JavaScript
5. Ajouter un `requirements.txt` si absent
6. Créer un `Dockerfile` si absent (pour cohérence Docker)

**Impact** : Projet maintenable et transmissible.

**Risques** : Aucun risque technique.

**Dépendances** : Toutes les phases précédentes terminées.

**Priorité** : **Moyenne**.

---

## Arborescence cible finale

```
apps/r_bd/
├── main.py                          ← Launcher simple (logging + uvicorn)
├── api_web.py                       ← Application FastAPI (routes, static, CORS)
├── config.py                        ← Configuration centralisée
├── requirements.txt                 ← Dépendances Python
├── Dockerfile                       ← Conteneurisation
├── README.md                        ← Documentation complète
├── STRUCTURE.md                     ← Architecture documentée
│
├── api/                             ← Routeurs FastAPI
│   ├── __init__.py                  ← Exports nommés + __all__
│   ├── shared.py                    ← État partagé (singletons, Pydantic, logger)
│   ├── router_icd.py                ← /api/icd/*
│   ├── router_isa.py                ← /api/isa/*
│   ├── router_mapping.py            ← /api/mapping/*
│   ├── router_essais.py             ← /api/essais/*
│   ├── router_templates.py          ← /api/v1/templates/*
│   ├── router_fcs.py                ← /api/fcs/*              ← NOUVEAU
│   └── router_rac.py                ← /api/rac/*              ← NOUVEAU
│
├── core/                            ← Logique métier
│   ├── __init__.py                  ← Imports complets + __all__
│   ├── icd_parser.py                ← Parser ICD V2
│   ├── ied_pattern_manager.py       ← Patterns IED
│   ├── isa_manager.py               ← Gestionnaire ISA
│   ├── mapping_comparator.py        ← Comparaison mapping
│   ├── mapping_merger.py            ← Fusion mapping
│   ├── isa_parsers/                 ← Parsers spécialisés ISA
│   │   ├── __init__.py
│   │   ├── equation_parser.py
│   │   └── risa_enricher.py
│   ├── fcs/                         ← Module FCS             ← NOUVEAU
│   │   ├── __init__.py
│   │   ├── fcs_parser.py
│   │   └── fcs_manager.py
│   └── rac/                         ← Module RAC             ← NOUVEAU
│       ├── __init__.py
│       ├── rac_parser.py
│       └── rac_manager.py
│
├── web/                             ← Frontend (SPA)
│   ├── index.html                   ← SPA mono-page (toutes vues)
│   ├── components/
│   │   └── header.html              ← Header identique R#SCD (boutons data-view)
│   ├── css/
│   │   ├── header-common.css        ← Header mutualisé (copie R#SCD)
│   │   ├── rbd-tokens.css           ← Pont UI Kit → aliases locaux
│   │   ├── rbd-common.css           ← Classes réutilisables (cards, btns, badges)
│   │   ├── rbd-home.css             ← Styles vue Accueil
│   │   ├── rbd-icd.css              ← Styles vue IED/ICD
│   │   ├── rbd-isa.css              ← Styles vue ISA
│   │   ├── rbd-essais.css           ← Styles vue Essais
│   │   ├── rbd-fcs.css              ← Styles vue FCS         ← NOUVEAU
│   │   └── rbd-rac.css              ← Styles vue RAC         ← NOUVEAU
│   ├── js/
│   │   ├── api.js                   ← Couche API centralisée
│   │   ├── app.js                   ← Bootstrap + navigation
│   │   ├── header-loader.js         ← Chargement header (pattern R#SCD)
│   │   ├── home.js                  ← Vue Accueil
│   │   ├── icd.js                   ← Vue IED/ICD
│   │   ├── isa.js                   ← Vue ISA
│   │   ├── essais.js                ← Vue Essais
│   │   ├── essais-utils.js          ← Utilitaires pattern matching
│   │   ├── fcs.js                   ← Vue FCS                ← NOUVEAU
│   │   └── rac.js                   ← Vue RAC                ← NOUVEAU
│   └── docs/                        ← Docs techniques frontend
│
├── data/                            ← Persistance JSON
│   ├── essais/
│   ├── icd/
│   ├── ied/
│   ├── isa/
│   ├── templates/
│   ├── fcs/                         ← Données FCS            ← NOUVEAU
│   └── rac/                         ← Données RAC            ← NOUVEAU
│
├── uploads/                         ← Fichiers temporaires
├── assets/
│   └── RCONTROLE.png
└── plans/                           ← Plans d'architecture
    └── PLAN_ALIGNEMENT_R_BD_SUR_R_SCD.md  ← Ce document
```

---

## Ordre d'exécution conseillé

| Ordre | Phase | Effort estimé | Dépend de |
|-------|-------|---------------|-----------|
| 1 | Phase 0 — Nettoyage | Faible | — |
| 2 | Phase 1 — Séparation main/api_web | Faible | Phase 0 |
| 3 | Phase 2 — shared.py + __init__ + renommage routeurs | Moyen | Phase 1 |
| 4 | Phase 6 — api.js + app.js | Moyen | Phase 2 |
| 5 | Phase 3 — Migration SPA | Fort | Phases 2 + 6 |
| 6 | Phase 4 — Header identique | Moyen | Phase 3 |
| 7 | Phase 5 — Migration CSS UI Kit | Moyen | Phase 4 |
| 8 | Phase 7 — Ajout FCS | Moyen | Phase 5 |
| 9 | Phase 8 — Ajout RAC | Moyen | Phase 5 |
| 10 | Phase 9 — Documentation | Faible | Toutes |

**Note** : Les phases 7 et 8 (FCS et RAC) peuvent être menées en parallèle.

---

## Points à arbitrer avant de commencer

1. **Préfixe CSS** : Utiliser `rbd-*` propre ou mutualiser `rscd-*` ? Recommandation : `rscd-*` pour le header, `rbd-*` pour les vues spécifiques.

2. **Format fichiers RAC** : Quel est le format exact des fichiers RAC (XML, CSV, JSON) ? Quelles données en extraire ? Cela conditionne l'implémentation du parser.

3. **Fichiers obsolètes** : Confirmer que `icd-manager.js`, `isa-picker.js`, `templates-ru.js`, `test-editor.html` peuvent être archivés.

4. **Montage `/data` en StaticFiles** : L'actuel `app.mount("/data", ...)` expose directement le dossier data. Faut-il le conserver (pratique) ou le supprimer (sécurité) et tout passer par l'API ?

5. **Port API** : `API_PORT = 8664` dans config.py n'est pas utilisé. Le supprimer ou le conserver pour un futur usage ?

6. **Routeur templates** : Le préfixe `/api/v1/templates` diffère de la convention `/api/templates` des autres routeurs. Normaliser ?

---

## Résumé exécutif

R#BD est fonctionnelle mais architecturalement **désalignée** par rapport au référent R#SCD. Les écarts majeurs sont :

- **Navigation multi-pages** au lieu de SPA
- **Header à liens `<a>`** au lieu de boutons `data-view`
- **Absence du UI Kit** commun
- **Pas de fichier `api_web.py`** séparé ni de `shared.py`
- **Pas de couche JS `api.js`** centralisée
- **Conventions CSS divergentes** (`guide-*` vs `rscd-*`)

Le plan propose **10 phases** progressives, de la plus structurante (séparation Python, migration SPA, header) à la plus cosmétique (documentation). Les deux nouvelles catégories **FCS** et **Fichiers RAC** s'intègrent naturellement comme nouvelles vues dans l'architecture SPA cible.

L'effort global est **significatif mais séquençable** : chaque phase produit un livrable testable indépendamment.
