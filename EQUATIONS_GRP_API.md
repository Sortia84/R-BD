# Équations GRP — analyse complète et API R#SCD

## Responsabilités

R#BD importe et analyse le XML d'équations, conserve les paramètres et publie un référentiel versionné. R#SCD lit la version exigée par les IED GRP/GRPR du SCD et demande cette version exacte. La valeur par défaut du catalogue ISA et l'ordre d'import ne servent pas à sélectionner les équations.

Cette livraison prépare les données du simulateur d'impact. Elle ne calcule pas les alarmes et ne définit pas de nouvelle sémantique normative des variantes BAP.

## Résultat d'analyse

Le schéma d'analyse est `2.0`, le parseur `2.0.0`. Les champs historiques de groupes/entrées sont conservés ; les ajouts comprennent :

- `metadata.numero_version` / `equation_version`, `date_modification` extraits **du XML**, empreinte `source_sha256`, versions du schéma/parseur et compteurs réels ;
- `equation`, `equation_raw`, `equation_ast` et `equation_references` de chaque regroupement ;
- `valeurs` complet, avec `valeur` conservé comme alias de la première valeur ;
- `raw_attributes`, `rawStatus`, attributs typés et paramètres BAP/FIP conservés ;
- `index_entrees_scoped`, indexant les occurrences par regroupement puis identifiant d'entrée ;
- `index_entrees` historique limité aux identifiants globalement uniques, et collisions déclarées séparément ;
- `validation` avec `valid`, `usable`, nombre d'erreurs/avertissements et diagnostics localisés ; état d'utilisation également résumé dans les métadonnées.

Deux entrées `E1` dans deux regroupements différents sont autorisées et conservées. Un doublon à l'intérieur d'un regroupement est invalide. Une entrée déclarée mais inutilisée produit un avertissement, sans être effacée.

### Expressions

Le lecteur accepte les références aux entrées, `AND`, `OR`, `XOR` et les parenthèses. Il produit un AST JSON sans `eval` ni exécution de code. Une expression mélangeant des opérateurs sans parenthèses explicites reste inspectable mais n'est pas utilisable automatiquement : aucune priorité métier non documentée n'est imposée.

L'opérateur d'une entrée et l'équation globale sont deux niveaux distincts. Les listes de comparaison ne doivent pas être réduites à une seule valeur. Les filtres, temporisations, valeurs BAP/FIP et wildcards sont conservés ; leur interprétation appartient au futur moteur de simulation.

Le XML malformé et les déclarations DTD/entités sont refusés. Les espaces de noms XML sont pris en charge. Les erreurs de contenu restent consultables dans le document analysé et empêchent son utilisation automatique.

## Publication et réanalyse

L'analyse d'un XML `isa_alarmes` publie un résultat brut `.analyzed.raw.json`. L'analyse enrichie conserve aussi ce résultat structurel et produit `.analyzed.json` avec l'enrichissement RISA. Les publications JSON sont atomiques.

Après mise à jour du parseur, les anciens JSON doivent être réanalysés depuis leurs XML sources. Une lecture API ne déclenche jamais cette réanalyse ni une écriture implicite.

Route d'analyse existante :

```text
POST /api/isa/analyze/{file_id}?type_id=isa_alarmes&enrich=false
POST /api/isa/analyze/{file_id}?type_id=isa_alarmes&enrich=true
```

Un diagnostic invalide reste disponible à la consultation. Il ne doit pas être confondu avec une analyse prête pour le calcul.

## Contrat HTTP de consultation

```text
GET /api/integrations/rscd/v1/equations
GET /api/integrations/rscd/v1/equations/resolve?version=1.5.53
GET /api/integrations/rscd/v1/equations/resolve?version=1.5.53&file_id=IDENTIFIANT
```

Le catalogue décrit les fichiers, leurs versions et états, sans chemins hôte. La résolution renvoie :

```json
{
  "schema_version": "1.0",
  "file": {
    "id": "IDENTIFIANT",
    "original_name": "GRP.xml",
    "equation_version": "1.5.53",
    "date_modification": "2026-09-18",
    "source_sha256": "EMPREINTE_SHA256",
    "parser_version": "2.0.0",
    "analysis_schema_version": "2.0"
  },
  "document": {"metadata": {}, "regroupements": [], "validation": {}}
}
```

Ce JSON illustre l'enveloppe ; les groupes et diagnostics du document réel ne sont pas vides. La version et la date d'exemple ne créent pas un référentiel absent : elles proviennent du XML importé dans une réponse réelle.

### Sélection stricte

1. Rechercher la version exacte dans les XML catalogués `isa_alarmes`.
2. Vérifier l'existence de la source et son SHA-256 réel.
3. Vérifier schéma/parseur, provenance du résultat et validation utilisable.
4. Lire l'analyse brute de préférence, sans enrichissement nécessaire au calcul.
5. Refuser plusieurs XML différents portant la même version, sauf `file_id` explicitement choisi et compatible.

Des imports du même XML, avec version et empreinte identiques, sont des doublons identiques ; une sélection déterministe peut les dédupliquer. Un nom contenant `modif` ou une date d'import plus récente n'autorise pas à choisir entre deux contenus différents.

### Erreurs structurées

Les erreurs utilisent `detail.code` et `detail.message` :

| HTTP | Code | Situation |
|---|---|---|
| 404 | `EQUATION_NOT_FOUND` | Version exacte absente, avec versions disponibles lorsque pertinent |
| 409 | `EQUATION_AMBIGUOUS` | Plusieurs contenus pour la même version |
| 409 | `EQUATION_VERSION_MISMATCH` | Identifiant explicite incompatible avec la version demandée |
| 409 | `EQUATION_ANALYSIS_STALE` | Analyse absente/ancienne, schéma ou parseur incompatible, source modifiée |
| 409 | `EQUATION_SOURCE_MISSING` | Source cataloguée absente |
| 422 | `EQUATION_INVALID` | Validation refusant l'utilisation automatique |

Les refus d'authentification restent des refus 401/403 ; ils ne deviennent pas des absences de version.

## Authentification inter-applications

Les routes restent protégées par le middleware R-CONTROL existant. Pour accepter l'identité relayée par R#SCD en mode central, configurer **R#BD** avec :

```text
RCONTROL_DELEGATED_ASSERTION_AUDIENCES=r_scd
```

Conserver les autres audiences déjà nécessaires si cette variable est renseignée. R#SCD transmet son assertion vérifiée dans `X-RControl-Assertion`. Le middleware partagé vérifie signature, expiration et application délégante sur les routes d'intégration. Aucun changement du middleware partagé ou des ports n'est requis.

## Vérifications

Les tests couvrent parseur/grammaire, valeurs multiples, identifiants, erreurs de validation, sélection de version, ambiguïtés, empreintes et résultats obsolètes. Ils utilisent des répertoires temporaires et ne migrent pas les données de production.

### Réanalyse locale du 15 octobre 2026

Les nouveaux imports ont été pris en compte pendant la livraison : **32 XML sources retrouvés et réanalysés**, avec publication des résultats brut et enrichi. Les anciennes analyses ont été sauvegardées et les empreintes des 32 XML sources sont inchangées. Aucune source manquante ni analyse orpheline n'a été détectée.

- **16 documents utilisables**, dont la version **1.5.53** : 123 regroupements, 323 entrées, aucune erreur et un avertissement d'entrée inutilisée (`Expr275`, groupe `ID000311`).
- **16 documents refusés à l'utilisation automatique**, parmi les anciennes versions 1.5.21 à 1.5.38 importées : références absentes et/ou groupes dupliqués. Leurs données et diagnostics sont conservés ; les XML n'ont pas été corrigés automatiquement.
- Les deux contenus différents portant 1.5.47 restent ambigus sans `file_id` explicite.

Le rapport détaillé est disponible dans [REANALYSE_2026-10-15.json](data/isa/equation_analysis_backups/REANALYSE_2026-10-15.json), avec les chemins de sauvegarde, empreintes et diagnostics par fichier.

Vérification ciblée R#BD : **47 tests réussis** (parseur, catalogue/API et essais existants). La suite élargie rencontre trois échecs dans les tests PAR existants car `assets/PMED_3LABAR1.par` est absent ; ces tests ne concernent pas les équations et ce fichier n'a pas été remplacé par une fixture inventée.
