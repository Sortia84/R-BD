# risa_enricher.py - Enrichissement des données avec RISA
"""
Enrichit les données d'équations/alarmes avec les informations du fichier RISA.
Gère les wildcards pour trouver toutes les correspondances.
"""

from typing import Any
from .equation_parser import match_wildcard


def find_risa_matches(pattern: str, risa_data: dict, search_field: str = "Libelle8") -> list[dict]:
    """
    Trouve toutes les entrées RISA qui correspondent à un pattern (avec ou sans wildcard).

    Args:
        pattern: Pattern à chercher (ex: "DF.CHA.*" ou "DF.CHA.1")
        risa_data: Dictionnaire RISA (clés = libellés, valeurs = infos)
        search_field: Champ à utiliser pour la recherche ("Libelle8" ou "Libelle16")

    Returns:
        Liste des entrées RISA correspondantes avec leurs InfosISA
    """
    matches = []
    is_wildcard = "*" in pattern or "?" in pattern

    for key, value in risa_data.items():
        if not isinstance(value, dict):
            continue

        # Récupérer le libellé à comparer
        libelle = value.get(search_field, key)

        # Vérifier la correspondance
        if is_wildcard:
            if match_wildcard(pattern, libelle):
                matches.append({
                    "key": key,
                    "libelle8": value.get("Libelle8", ""),
                    "libelle16": value.get("Libelle16", ""),
                    "UniqueID": value.get("UniqueID", ""),
                    "IED": value.get("IED", ""),
                    "LD": value.get("LD", ""),
                    "LN": value.get("LN", ""),
                    "InfosISA": value.get("InfosISA", {})
                })
        else:
            # Comparaison exacte (insensible à la casse)
            if libelle.upper() == pattern.upper() or key.upper() == pattern.upper():
                matches.append({
                    "key": key,
                    "libelle8": value.get("Libelle8", ""),
                    "libelle16": value.get("Libelle16", ""),
                    "UniqueID": value.get("UniqueID", ""),
                    "IED": value.get("IED", ""),
                    "LD": value.get("LD", ""),
                    "LN": value.get("LN", ""),
                    "InfosISA": value.get("InfosISA", {})
                })

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
