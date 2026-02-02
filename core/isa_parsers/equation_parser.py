# equation_parser.py - Parser XML des fichiers Equation/Alarmes ISA
"""
Parse les fichiers XML d'équations (regroupements d'alarmes) vers JSON structuré.
Gère les wildcards (*) dans les libellés pour le matching avec RISA.
"""

import xml.etree.ElementTree as ET
from pathlib import Path
from datetime import datetime
from typing import Any
import re


def parse_equation_xml(file_path: Path | str) -> dict[str, Any]:
    """
    Parse un fichier XML d'équations et retourne une structure JSON.

    Structure XML attendue :
    <root>
      <regroupement id="..." libellecourt="..." niveauregroupement="..." ...>
        <entrees>
          <entree id="..." value="..." libellecourt="..." Status="..." ...>
            <DAop>...</DAop>
            <valeurs><valeur>...</valeur></valeurs>
            <operateur>...</operateur>
          </entree>
        </entrees>
      </regroupement>
    </root>

    Args:
        file_path: Chemin vers le fichier XML

    Returns:
        dict avec clés: regroupements, index_entrees, metadata
    """
    file_path = Path(file_path)

    if not file_path.exists():
        raise FileNotFoundError(f"Fichier introuvable : {file_path}")

    tree = ET.parse(file_path)
    root = tree.getroot()

    regroupements_data = []
    index_entrees = {}
    wildcards_found = []  # Liste des entrées avec wildcards

    # Parcours de chaque balise <regroupement>
    for regroupement in root.findall(".//regroupement"):
        regroupement_id = regroupement.attrib.get("id")
        regroupement_dict = {
            "id": regroupement_id,
            "libellecourt": regroupement.attrib.get("libellecourt"),
            "niveauregroupement": regroupement.attrib.get("niveauregroupement"),
            "ldgrp": regroupement.attrib.get("ldgrp"),
            "filtremodexp": regroupement.attrib.get("filtremodexp"),
            "temporisationregroupement": regroupement.attrib.get("temporisationregroupement"),
            "entrees": [],
        }

        for entree in regroupement.findall("./entrees/entree"):
            entree_id = entree.attrib.get("id")
            libellecourt = entree.attrib.get("libellecourt", "")

            # Transformation du Status O→Optionnel, M→Mandatory
            brut_status = entree.attrib.get("Status")
            if brut_status == "O":
                status_fr = "Optionnel"
            elif brut_status == "M":
                status_fr = "Mandatory"
            else:
                status_fr = brut_status or ""

            # Détecter si c'est un wildcard pattern
            is_wildcard = "*" in libellecourt or "?" in libellecourt

            entree_dict = {
                "id": entree_id,
                "value": entree.attrib.get("value"),
                "libellecourt": libellecourt,
                "is_wildcard": is_wildcard,  # Flag pour indiquer un pattern wildcard
                "Status": status_fr,
                "BAPIgnoredValue": entree.attrib.get("BAPIgnoredValue"),
                "BAPVariant": entree.attrib.get("BAPVariant"),
                "FIPValeur": entree.attrib.get("FIPValeur"),
                "FIPObligatoire": entree.attrib.get("FIPObligatoire"),
                "DAop": (entree.findtext("DAop") or "").strip(),
                "valeur": (entree.findtext("valeurs/valeur") or "").strip(),
                "operateur": (entree.findtext("operateur") or "").strip(),
                # Champs pour enrichissement RISA (seront remplis plus tard)
                "risa_matches": [],  # Liste des correspondances RISA (pour wildcards)
                "ISA.additionnalLabelForDisappearance": "",
                "ISA.additionnalLabelForAppearance": "",
                "ISA.Degré d'importance apparition PA": "",
                "ISA.Diffusion et avertissement sonore de l'état apparition": "",
                "ISA.Alarme sonore apparition PA": "",
                "ISA.Temporisation de l'état apparition": "",
                "ISA.Libellé 16 caractères": "",
            }

            regroupement_dict["entrees"].append(entree_dict)

            # Index inverse
            if entree_id:
                index_entrees[entree_id] = regroupement_id

            # Tracker les wildcards
            if is_wildcard:
                wildcards_found.append({
                    "regroupement_id": regroupement_id,
                    "entree_id": entree_id,
                    "pattern": libellecourt
                })

        regroupements_data.append(regroupement_dict)

    return {
        "metadata": {
            "source_file": file_path.name,
            "parsed_at": datetime.now().isoformat(),
            "total_regroupements": len(regroupements_data),
            "total_entrees": len(index_entrees),
            "wildcards_count": len(wildcards_found)
        },
        "regroupements": regroupements_data,
        "index_entrees": index_entrees,
        "wildcards": wildcards_found
    }


def wildcard_to_regex(pattern: str) -> re.Pattern:
    """
    Convertit un pattern wildcard en expression régulière.

    Règles :
    - * → .+ (un ou plusieurs caractères)
    - ? → . (un seul caractère)
    - Les autres caractères spéciaux regex sont échappés

    Args:
        pattern: Pattern avec wildcards (ex: "DF.CHA.*")

    Returns:
        Pattern regex compilé
    """
    # Échapper les caractères spéciaux regex sauf * et ?
    escaped = re.escape(pattern)
    # Remplacer les wildcards échappés par leur équivalent regex
    escaped = escaped.replace(r'\*', '.+')  # * = un ou plusieurs caractères
    escaped = escaped.replace(r'\?', '.')   # ? = un seul caractère
    # Ancrer le pattern (match complet)
    return re.compile(f"^{escaped}$", re.IGNORECASE)


def match_wildcard(pattern: str, value: str) -> bool:
    """
    Vérifie si une valeur correspond à un pattern wildcard.

    Args:
        pattern: Pattern avec wildcards (ex: "DF.CHA.*")
        value: Valeur à tester (ex: "DF.CHA.1")

    Returns:
        True si la valeur correspond au pattern
    """
    if "*" not in pattern and "?" not in pattern:
        # Pas de wildcard, comparaison exacte
        return pattern.upper() == value.upper()

    regex = wildcard_to_regex(pattern)
    return bool(regex.match(value))
