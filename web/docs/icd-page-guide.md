# Guide — Page de gestion des ICD 61850 (modèle Template Essais)

Ce document décrit les étapes pour créer une page **gestion ICD** sur la base du modèle `templates-essais.html` et permettre l’extraction **IED / LD / LN / LNinst** depuis des fichiers ICD (XML IEC 61850).

## 🎯 Objectif fonctionnel

- Centraliser les ICD de l’application (liste + détails).
- Gérer **plusieurs ICD par type d’IED**, avec **plusieurs constructeurs**.
- Afficher **une carte par ICD traité**, à la manière des cartes de tests dans `templates-essais`.
- Filtrer par **type d’IED** et **constructeur**, puis par LD/LN/LNinst si besoin.
- Parser les ICD pour extraire automatiquement la hiérarchie IEC 61850.
- Conserver un index local (JSON) pour l’affichage rapide.

## ✅ Contrat minimal (inputs/outputs)

- **Input** : Fichiers `.icd` (XML IEC 61850), uploadés par l’utilisateur.
- **Output** :
  - Une **carte par ICD traité** (type IED + constructeur + versions).
  - Un index JSON exploitable côté UI (type d’IED → constructeur → versions → détails).
- **Erreurs** :
  - XML invalide → afficher un message d’erreur.
  - ICD sans IED → marquer comme incomplet.

## 🧭 Étapes recommandées

### 1) Créer la page HTML (copie du modèle)

Dupliquer `apps/r_bd/web/pages/templates-essais.html` vers une nouvelle page, par exemple :

- `apps/r_bd/web/pages/icd-manager.html`

Adapter :
- Le **titre** et sous-titre (ex : “Gestion des ICD 61850”).
- Le bouton principal : “➕ Importer un ICD”.
- Les filtres : **Type d’IED** et **Constructeur** (puis LD/LN/LNinst si nécessaire).
- La grille : **cartes ICD** avec résumé (Type IED, constructeur, dernière version).

### 2) Ajouter les scripts dédiés

Créer une page JS dédiée (par ex. `apps/r_bd/web/js/icd-manager.js`) inspirée de `templates-essais.js` :

- `initIcdPage()`
- `loadIcdCatalog()` (index structuré par type IED et constructeur)
- `applyFilters()`
- `resetFilters()`
- `renderIcdCards()`

### 3) Définir un format d’index JSON

Stocker un index local pour éviter de reparser tout le temps. Exemple :

**Règle de classification (icd_id)**

Pour classer les ICD (et construire `icd_id`), utiliser la concaténation :

1. **Type d’IED** : valeur de `<Private type="COMPAS-IEDType">` (ex: `BCU`).
2. **Constructeur** : attribut `manufacturer` de `<IED>` (ex: `Efacec`).
3. **Version ICD** : attribut `desc` de `<IED>` (ex: `BCU CBO V11.6.8`).

Exemple d’identifiant :

`ICD_{COMPAS-IEDType}_{MANUFACTURER}` pour la carte principale, puis version dans `versions[]`.

Exemple complet :

- `icd_id`: `ICD_BCU_EFACEC`
- `version`: `BCU CBO V11.6.8`

```json
{
  "ied_type": "BCU",
  "manufacturer": "Efacec",
  "icd_id": "ICD_BCU_EFACEC",
  "versions": [
    {
      "version": "BCU CBO V11.6.8",
      "filename": "BCU_Efacec_V11.6.8.icd",
      "imported_at": "2026-01-31T10:12:00Z",
      "ieds": [
        {
          "name": "IED_BCU_1",
          "lds": [
            {
              "name": "LD0",
              "lns": [
                { "ln_class": "LLN0", "lninst": "1" },
                { "ln_class": "PTOC", "lninst": "1" }
              ]
            }
          ]
        }
      ]
    },
    {
      "version": "BCU CBO V11.7.9",
      "filename": "BCU_Efacec_V11.7.9.icd",
      "imported_at": "2026-02-02T09:30:00Z",
      "ieds": []
    }
  ]
}
```

La page doit afficher **une carte par couple (type IED + constructeur)**, avec la liste des versions à l’intérieur et un **sélecteur de version active**.

Cet index peut être stocké côté **serveur** (JSON en data/) ou en **localStorage** si la page est 100% statique.

### 4) Ajouter un endpoint de parsing côté serveur (recommandé)

La logique de parsing IEC 61850 est **métier** → à placer dans un module Python (ex: `apps/r_bd/core/icd_parser.py`) ou dans l’app SCD si vous centralisez la logique.

Pseudo-flow :

1. Upload d’un `.icd`
2. Parsing XML
3. Extraction :
   - `IED/@name`
   - `LDevice/@inst` (LD)
   - `LN/@lnClass`
   - `LN/@inst` (LNinst)
4. Sauvegarde JSON indexé

#### 🔎 Détails d’extraction (basé sur les ICD fournis)

Sur les ICD du dossier `apps/r_bd/uploads/ICD`, on retrouve bien :

```xml
<IED name="TEMPLATE" type="Protection" manufacturer="Efacec" ... desc="BCU CBO V11.6.8">
  <Private type="COMPAS-IEDType">BCU</Private>
  ...
</IED>
```

**Champs à extraire pour le classement :**

- `COMPAS-IEDType` → valeur du `<Private type="COMPAS-IEDType">`
- `manufacturer` → attribut `IED/@manufacturer`
- `desc` → attribut `IED/@desc` (version ICD)

**XPath (namespace IEC 61850) :**

- `//scl:IED`
- `./@manufacturer`
- `./@desc`
- `.//scl:Private[@type="COMPAS-IEDType"]/text()`
- `.//scl:LDevice/@inst`
- `.//scl:LN/@lnClass`
- `.//scl:LN/@inst`
- `.//scl:LN0/@lnClass` (souvent `LLN0`)
- `.//scl:LN0/@inst` (souvent vide → traiter comme `""` ou `"0"`)

**Notes pratiques :**

- `LN0` est un cas particulier (LLN0) : il n’a pas toujours d’`inst`.
- Il faut agréger **LN0 + LN** pour la liste complète des LN.
- La hiérarchie est généralement : `IED > AccessPoint > Server > LDevice > LN0/LN`.

### 5) Brancher l’UI sur l’API (ou un JSON local)

Dans `icd-manager.js`, charger l’index pour l’affichage :

- `fetch('/api/icd')` → si API
- ou `fetch('../data/icd_index.json')` → si fichier local

### 6) Filtres (même pattern que Template Essais)

Récupérer toutes les valeurs possibles depuis l’index :

- `Type IED` = liste issue de `apps/r_bd/data/ied/liste_ied.json` (ex: `*BCU*`, `*PIU*`, `*SCU*`...)
- `Constructeur` = liste déduite de l’index ICD
- `LD` = liste d’instances LDevice (optionnel)
- `LN` = liste de classes LN (optionnel)
- `LNinst` = liste d’instances LN (optionnel)

Puis filtrer la grille comme dans `templates-essais.js`.

## 🧪 Cas limites à prévoir

- Plusieurs ICD **pour un même type d’IED** (constructeurs différents).
- Plusieurs versions **pour un même constructeur** → sélection de version active.
- ICD avec **plusieurs IED** → un résumé par IED.
- ICD sans `LDevice` → mention “LD manquant”.
- LN sans `inst` → afficher “LNinst = 0/—”.
- Gros ICD → éviter de parser côté UI (préférer API).

## 🧩 Structure de fichiers suggérée

```
apps/r_bd/
├── core/
│   └── icd_parser.py
├── api/
│   └── icd_api.py
└── web/
    ├── pages/
    │   └── icd-manager.html
  ├── js/
  │   └── icd-manager.js
    ├── css/
    │   └── icd-manager.css
    └── data/
        └── icd_index.json
```

## ✅ Bonus (optionnel, utile)

- Bouton “Reparser” un ICD.
- Indicateur d’erreurs XML.
- Badge “x IED / y LD / z LN”.
- Export JSON des données extraites.
- Sélecteur de version active par carte + indication “version utilisée”.

---

Si tu veux, je peux aussi :
- créer la page `icd-manager.html` complète (HTML + CSS + JS),
- ajouter l’API FastAPI de parsing,
- brancher le parsing SCD/ICD existant si déjà disponible dans `r_scd`.
