# risa_enricher.py - Enrichissement des données avec RISA
"""
Enrichit les données d'équations/alarmes avec les informations du fichier RISA.
Gère les wildcards pour trouver toutes les correspondances.
"""

from typing import Any
from .equation_parser import match_wildcard


def flatten_risa_data(risa_data: dict) -> list[dict]:
    """
    Aplatit les données RISA en liste d'entrées.

    Le fichier RISA peut avoir deux structures:
    - "index": dictionnaire plat indexé par Libelle8/Libelle16 (PRINCIPAL)
    - "tree": structure arborescente IED -> LD -> LN -> ... (SECONDAIRE)

    Cette fonction utilise prioritairement l'index s'il existe.

    Args:
        risa_data: Données RISA brutes

    Returns:
        Liste d'entrées aplaties
    """
    entries = []

    # 1. Utiliser l'index s'il existe (c'est le format principal et le plus complet)
    index = risa_data.get("index", {})
    if index:
        for key, value in index.items():
            if not isinstance(value, dict):
                continue
            # Ignorer les entrées vides (clés sans valeur)
            if not value:
                continue
            # Vérifier que c'est une entrée valide avec au moins Libelle8 ou UniqueID
            if "UniqueID" in value or "Libelle8" in value:
                entries.append({
                    "key": key,
                    "IED": value.get("IED", ""),
                    "LD": value.get("LD", ""),
                    "LN": value.get("LN", ""),
                    "instance": value.get("LN.inst", ""),
                    "DO": value.get("DO", ""),
                    "UniqueID": value.get("UniqueID", ""),
                    "Libelle8": value.get("Libelle8", key),  # Utiliser la clé si pas de Libelle8
                    "Libelle16": value.get("Libelle16", ""),
                    "InfosISA": value.get("InfosISA", {})
                })
        return entries

    # 2. Fallback sur l'arbre si pas d'index
    tree = risa_data.get("tree", risa_data)

    def recurse(node: Any, path: list[str] | None = None):
        if path is None:
            path = []

        if not isinstance(node, dict):
            return

        # Si on trouve un noeud feuille avec UniqueID et Libelle8, c'est une entrée
        if "UniqueID" in node and "Libelle8" in node:
            entries.append({
                "key": "/".join(path),
                "IED": path[0] if len(path) > 0 else "",
                "LD": path[1] if len(path) > 1 else "",
                "LN": path[2] if len(path) > 2 else "",
                "instance": path[3] if len(path) > 3 else "",
                "DO": path[4] if len(path) > 4 else "",
                "UniqueID": node.get("UniqueID"),
                "Libelle8": node.get("Libelle8", ""),
                "Libelle16": node.get("Libelle16", ""),
                "InfosISA": node.get("InfosISA", {})
            })
            return

        # Sinon, continuer la récursion
        for key, value in node.items():
            if isinstance(value, dict):
                recurse(value, path + [key])

    recurse(tree)
    return entries


# Alias pour compatibilité
flatten_risa_tree = flatten_risa_data


# Cache pour éviter de recalculer l'aplatissement à chaque appel
_flattened_cache: dict[int, list[dict]] = {}


def get_flattened_risa(risa_data: dict) -> list[dict]:
    """
    Retourne la version aplatie du RISA, avec cache.

    Args:
        risa_data: Données RISA brutes

    Returns:
        Liste d'entrées aplaties
    """
    cache_key = id(risa_data)
    if cache_key not in _flattened_cache:
        _flattened_cache[cache_key] = flatten_risa_tree(risa_data)
    return _flattened_cache[cache_key]


def find_risa_matches(pattern: str, risa_data: dict, search_field: str = "both") -> list[dict]:
    """
    Trouve toutes les entrées RISA qui correspondent à un pattern (avec ou sans wildcard).

    Args:
        pattern: Pattern à chercher (ex: "DF.CHA.*" ou "DF.CHA.1")
        risa_data: Dictionnaire RISA (structure arborescente ou aplatie)
        search_field: Champ à utiliser pour la recherche:
            - "Libelle8" : cherche uniquement dans Libelle8
            - "Libelle16" : cherche uniquement dans Libelle16
            - "both" (défaut) : cherche dans Libelle8 ET Libelle16

    Returns:
        Liste des entrées RISA correspondantes avec leurs InfosISA
    """
    matches = []
    seen_ids = set()  # Pour éviter les doublons
    is_wildcard = "*" in pattern or "?" in pattern

    # Aplatir la structure RISA si nécessaire
    flat_entries = get_flattened_risa(risa_data)

    # Déterminer les champs à chercher
    if search_field == "both":
        fields_to_search = ["Libelle8", "Libelle16"]
    else:
        fields_to_search = [search_field]

    for entry in flat_entries:
        unique_id = entry.get("UniqueID", "")

        # Vérifier si déjà trouvé (éviter doublons)
        if unique_id and unique_id in seen_ids:
            continue

        # Chercher dans tous les champs spécifiés
        for field in fields_to_search:
            libelle = entry.get(field, "")
            if not libelle:
                continue

            matched = False
            # Vérifier la correspondance
            if is_wildcard:
                if match_wildcard(pattern, libelle):
                    matched = True
            else:
                # Comparaison exacte (insensible à la casse)
                if libelle.upper() == pattern.upper():
                    matched = True

            if matched:
                if unique_id:
                    seen_ids.add(unique_id)
                matches.append({
                    "key": entry.get("key", ""),
                    "libelle8": entry.get("Libelle8", ""),
                    "libelle16": entry.get("Libelle16", ""),
                    "UniqueID": unique_id,
                    "IED": entry.get("IED", ""),
                    "LD": entry.get("LD", ""),
                    "LN": entry.get("LN", ""),
                    "InfosISA": entry.get("InfosISA", {})
                })
                break  # Pas besoin de chercher dans l'autre champ

    return matches


def filter_value(val: Any) -> str:
    """
    Filtre les valeurs invalides (NC, NaN, Val, None).

    Args:
        val: Valeur à filtrer

    Returns:
        Chaîne vide si invalide, sinon la valeur
    """
    if val in [None, "NC", "NaN", "Val", ""]:
        return ""
    return str(val)


def extract_isa_fields(infos_isa: dict) -> dict:
    """
    Extrait les champs ISA pertinents d'un dictionnaire InfosISA.

    Args:
        infos_isa: Dictionnaire InfosISA du RISA

    Returns:
        Dictionnaire avec les champs ISA filtrés
    """
    return {
        "ISA.additionnalLabelForDisappearance": filter_value(
            infos_isa.get("ISA.additionnalLabelForDisappearance")
        ),
        "ISA.additionnalLabelForAppearance": filter_value(
            infos_isa.get("ISA.additionnalLabelForAppearance")
        ),
        "ISA.additionnalLabelForInvalidity": filter_value(
            infos_isa.get("ISA.additionnalLabelForInvalidity")
        ),
        "ISA.Degré d'importance apparition PA": filter_value(
            infos_isa.get("ISA.Degré d'importance apparition PA")
        ),
        "ISA.Diffusion et avertissement sonore de l'état apparition": filter_value(
            infos_isa.get("ISA.Diffusion et avertissement sonore de l'état apparition")
        ),
        "ISA.Alarme sonore apparition PA": filter_value(
            infos_isa.get("ISA.Alarme sonore apparition PA")
        ),
        "ISA.Temporisation de l'état apparition": filter_value(
            infos_isa.get("ISA.Temporisation de l'état apparition")
        ),
        "ISA.Libellé 16 caractères": filter_value(
            infos_isa.get("ISA.Libellé 16 caractères")
        ),
        "ISA.type": filter_value(
            infos_isa.get("ISA.type")
        ),
        "ISA.NatureTS": filter_value(
            infos_isa.get("ISA.NatureTS")
        ),
        "ISA.IDRC": filter_value(
            infos_isa.get("ISA.IDRC")
        ),
    }


def enrich_with_risa(equation_data: dict, risa_data: dict) -> dict:
    """
    Enrichit les données d'équation avec les informations RISA.

    Pour chaque entrée :
    - Si c'est un wildcard (*) : trouve toutes les correspondances et les stocke dans risa_matches
    - Si c'est un libellé exact : enrichit directement les champs ISA

    Args:
        equation_data: Données parsées du fichier équation (depuis parse_equation_xml)
        risa_data: Données RISA (dictionnaire clé/valeur)

    Returns:
        Données équation enrichies
    """
    stats = {
        "total_entrees": 0,
        "wildcards_processed": 0,
        "exact_matches": 0,
        "no_match": 0,
        "total_risa_matches": 0
    }

    for regroupement in equation_data.get("regroupements", []):
        for entree in regroupement.get("entrees", []):
            stats["total_entrees"] += 1
            libellecourt = entree.get("libellecourt", "")

            if not libellecourt:
                stats["no_match"] += 1
                continue

            is_wildcard = entree.get("is_wildcard", False) or "*" in libellecourt or "?" in libellecourt

            # Chercher les correspondances dans RISA
            matches = find_risa_matches(libellecourt, risa_data)

            if is_wildcard:
                stats["wildcards_processed"] += 1
                # Stocker toutes les correspondances pour les wildcards
                entree["risa_matches"] = matches
                stats["total_risa_matches"] += len(matches)

                # Si au moins une correspondance, prendre les infos de la première pour les champs principaux
                if matches:
                    first_match = matches[0]
                    infos_isa = first_match.get("InfosISA", {})
                    isa_fields = extract_isa_fields(infos_isa)
                    entree.update(isa_fields)
                    entree["risa_match_count"] = len(matches)
            else:
                # Correspondance exacte
                if matches:
                    stats["exact_matches"] += 1
                    first_match = matches[0]
                    infos_isa = first_match.get("InfosISA", {})
                    isa_fields = extract_isa_fields(infos_isa)
                    entree.update(isa_fields)
                    entree["risa_matches"] = matches
                    entree["risa_match_count"] = len(matches)
                else:
                    stats["no_match"] += 1
                    entree["risa_matches"] = []
                    entree["risa_match_count"] = 0

    # Ajouter les stats d'enrichissement aux metadata
    equation_data["metadata"]["enrichment_stats"] = stats
    equation_data["metadata"]["enriched"] = True

    return equation_data


def get_all_risa_keys_for_regroupement(regroupement: dict) -> list[str]:
    """
    Récupère toutes les clés RISA uniques pour un regroupement.
    Utile pour avoir la liste complète des signaux couverts par un regroupement.

    Args:
        regroupement: Dictionnaire d'un regroupement

    Returns:
        Liste des clés RISA uniques (Libelle8)
    """
    keys = set()
    for entree in regroupement.get("entrees", []):
        for match in entree.get("risa_matches", []):
            libelle8 = match.get("libelle8", "")
            if libelle8:
                keys.add(libelle8)
    return sorted(keys)


def summarize_regroupement(regroupement: dict) -> dict:
    """
    Génère un résumé d'un regroupement avec statistiques.

    Args:
        regroupement: Dictionnaire d'un regroupement

    Returns:
        Résumé avec stats
    """
    entrees = regroupement.get("entrees", [])
    wildcards = [e for e in entrees if e.get("is_wildcard")]
    exact = [e for e in entrees if not e.get("is_wildcard")]

    total_matches = sum(e.get("risa_match_count", 0) for e in entrees)
    all_keys = get_all_risa_keys_for_regroupement(regroupement)

    return {
        "id": regroupement.get("id"),
        "libellecourt": regroupement.get("libellecourt"),
        "total_entrees": len(entrees),
        "wildcards_count": len(wildcards),
        "exact_count": len(exact),
        "total_risa_signals": total_matches,
        "unique_risa_keys": len(all_keys),
        "risa_keys_sample": all_keys[:10]  # Échantillon des 10 premières
    }
