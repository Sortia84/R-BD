"""Parseur XML des équations ISA : données complètes, provenance et validation.

Les champs historiques sont conservés. Les listes ``valeurs``, l'AST et les
index par regroupement permettent aux consommateurs de travailler sans perte.
Ce module ne calcule aucune alarme et n'interprète aucune variante métier BAP.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import hashlib
import logging
from pathlib import Path
import re
from typing import Any
import xml.etree.ElementTree as ET

from .equation_validation import validate_equations


LOGGER = logging.getLogger(__name__)
SCHEMA_VERSION = "2.0"
PARSER_VERSION = "2.0.0"

# Même clés que l'enrichisseur RISA historique, initialisées avant enrichissement.
RISA_FIELDS = (
    "ISA.additionnalLabelForDisappearance", "ISA.additionnalLabelForAppearance",
    "ISA.Degré d'importance apparition PA",
    "ISA.Diffusion et avertissement sonore de l'état apparition",
    "ISA.Alarme sonore apparition PA", "ISA.Temporisation de l'état apparition",
    "ISA.Libellé 16 caractères",
)
GROUP_FIELDS = (
    "id", "libellecourt", "niveauregroupement", "ldgrp", "filtremodexp",
    "temporisationregroupement",
)
ENTRY_FIELDS = (
    "id", "value", "BAPIgnoredValue", "BAPVariant", "FIPValeur", "FIPObligatoire",
)


def _text(element: ET.Element, path: str) -> str:
    """Lit un champ texte et retire seulement ses espaces périphériques."""
    return (element.findtext(path) or "").strip()


def _parse_entry(element: ET.Element) -> dict[str, Any]:
    """Conserve toutes les valeurs d'entrée et les attributs XML originaux."""
    label = element.get("libellecourt", "")
    raw_status = element.get("Status")
    values = [(node.text or "").strip() for node in element.findall("valeurs/valeur")]
    entry = {key: element.get(key) for key in ENTRY_FIELDS}
    entry.update({
        "libellecourt": label,
        "is_wildcard": "*" in label or "?" in label,
        "Status": {"O": "Optionnel", "M": "Mandatory"}.get(raw_status, raw_status or ""),
        "rawStatus": raw_status,
        "raw_attributes": dict(element.attrib),
        "DAop": _text(element, "DAop"),
        "valeurs": values,
        # Alias compatible avec l'affichage/enrichissement existants.
        "valeur": values[0] if values else "",
        "operateur": _text(element, "operateur"),
        "operateurs": [(node.text or "").strip() for node in element.findall("operateur")],
        "risa_matches": [],
        **{key: "" for key in RISA_FIELDS},
    })
    return entry


def _build_indices(groups: list[dict[str, Any]]) -> dict[str, Any]:
    """Indexe chaque occurrence, même en présence d'identifiants invalides.

    L'ancien index global ne contient plus que les identifiants réellement
    uniques. Les collisions globales sont normales entre groupes ; les doublons
    internes sont invalides et restent inspectables dans l'index scoped.
    """
    scoped: dict[str, dict[str, list[dict[str, int]]]] = {}
    occurrences: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for group_position, group in enumerate(groups):
        group_id = group["id"]
        if group_id is not None:
            scoped.setdefault(group_id, {})
        for entry_position, entry in enumerate(group["entrees"]):
            entry_id = entry["id"]
            position = {"regroupement_index": group_position, "entree_index": entry_position}
            if group_id is not None and entry_id is not None:
                scoped[group_id].setdefault(entry_id, []).append(position)
            if entry_id is not None:
                occurrences[entry_id].append({"regroupement_id": group_id, **position})
    return {
        "index_entrees": {
            entry_id: positions[0]["regroupement_id"]
            for entry_id, positions in occurrences.items() if len(positions) == 1
        },
        "index_entrees_scoped": scoped,
        "index_entrees_collisions": {
            entry_id: positions for entry_id, positions in occurrences.items()
            if len(positions) > 1
        },
    }


def parse_equation_xml(file_path: Path | str) -> dict[str, Any]:
    """Lit un XML d'équations et retourne un document JSON inspectable.

    Un XML malformé ou contenant DTD/entités est rejeté avant exploitation.
    Les erreurs de contenu (références, opérateurs, champs) sont conservées dans
    ``validation`` et rendent le résultat inutilisable pour le calcul automatique.
    Les versions proviennent exclusivement du contenu XML, jamais du nom du fichier.
    """
    file_path = Path(file_path)
    source = file_path.read_bytes()
    # Les octets NUL retirés couvrent aussi les déclarations UTF-16/UTF-32.
    if re.search(br"<!\s*(?:DOCTYPE|ENTITY)\b", source.replace(b"\x00", b""), re.IGNORECASE):
        LOGGER.warning("[XML][EQUATION] DTD ou entité refusée : %s", file_path.name)
        raise ValueError("DTD et déclarations d'entités interdites dans un fichier d'équations.")
    root = ET.fromstring(source)
    # Parcours par noms locaux : mêmes balises avec ou sans namespace XML.
    for node in root.iter():
        if isinstance(node.tag, str):
            node.tag = node.tag.rsplit("}", 1)[-1]

    groups = []
    wildcards = []
    for element in root.findall(".//regroupement"):
        group = {key: element.get(key) for key in GROUP_FIELDS}
        group.update({
            "raw_attributes": dict(element.attrib),
            "equation": _text(element, "equation"),
            "equation_raw": element.findtext("equation") or "",
            "equations": [(node.text or "").strip() for node in element.findall("equation")],
            "equation_ast": None,
            "equation_references": [],
            "entrees": [_parse_entry(entry) for entry in element.findall("entrees/entree")],
        })
        for entry in group["entrees"]:
            if entry["is_wildcard"]:
                wildcards.append({
                    "regroupement_id": group["id"], "entree_id": entry["id"],
                    "pattern": entry["libellecourt"],
                })
        groups.append(group)

    result = {
        "metadata": {
            "source_file": file_path.name,
            "source_sha256": hashlib.sha256(source).hexdigest(),
            "source_size_bytes": len(source),
            "parsed_at": datetime.now(timezone.utc).isoformat(),
            "schema_version": SCHEMA_VERSION,
            "parser_version": PARSER_VERSION,
            "numero_version": _text(root, "numero_version"),
            "equation_version": _text(root, "numero_version"),
            "numero_version_values": [(node.text or "").strip() for node in root.findall("numero_version")],
            "date_modification": _text(root, "date_modification"),
            "date_modification_values": [(node.text or "").strip() for node in root.findall("date_modification")],
            "root_element": root.tag,
            "total_regroupements": len(groups),
            "total_entrees": sum(len(group["entrees"]) for group in groups),
            "wildcards_count": len(wildcards),
            "expression_operators": ["AND", "OR", "XOR"],
            "expression_precedence": ["AND", "XOR", "OR"],
            "mixed_precedence_requires_parentheses": True,
        },
        "regroupements": groups,
        **_build_indices(groups),
        "wildcards": wildcards,
    }
    result["validation"] = validate_equations(result)
    result["metadata"]["validation_status"] = "valid" if result["validation"]["valid"] else "invalid"
    result["metadata"]["usable"] = result["validation"]["usable"]
    LOGGER.info(
        "[XML][EQUATION] %s version=%s : %d regroupements, %d entrées, %d erreurs, %d avertissements",
        file_path.name, result["metadata"]["numero_version"], len(groups),
        result["metadata"]["total_entrees"], result["validation"]["error_count"],
        result["validation"]["warning_count"],
    )
    return result


def wildcard_to_regex(pattern: str) -> re.Pattern:
    """Convertit * en .+ et ? en . : sémantique historique RISA conservée."""
    escaped = re.escape(pattern).replace(r"\*", ".+").replace(r"\?", ".")
    return re.compile(f"^{escaped}$", re.IGNORECASE)


def match_wildcard(pattern: str, value: str) -> bool:
    """Compare sans tenir compte de la casse, avec les wildcards historiques."""
    if "*" not in pattern and "?" not in pattern:
        return pattern.upper() == value.upper()
    return bool(wildcard_to_regex(pattern).match(value))
