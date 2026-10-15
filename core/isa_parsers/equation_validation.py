"""Validation structurelle des équations, sans interprétation normative BAP.

Les diagnostics identifient les occurrences par position, même si leurs IDs sont
absents ou dupliqués. Aucun contenu invalide n'est supprimé ou corrigé en silence.
"""

from __future__ import annotations

from collections import Counter
from datetime import date
import math
import re
from typing import Any

from .equation_syntax import (
    IDENTIFIER, OPERATORS, EquationSyntaxError, expression_references,
    has_ambiguous_precedence, parse_expression,
)


INTEGER = re.compile(r"[+-]?\d+\Z")
NUMBER = re.compile(r"[+-]?\d+(?:\.\d+)?\Z")


def _typed_fields(
    item: dict[str, Any], fields: tuple[str, ...], report: Any,
    context: dict[str, Any],
) -> None:
    """Ajoute une vue typée sans toucher aux textes XML historiques.

    La validation porte sur les formes entières/numériques/booléennes observées,
    sans déduire les variantes BAP autorisées ni la signification de leurs valeurs.
    """
    typed = item.setdefault("typed_attributes", {})
    for field in fields:
        raw = item.get(field)
        if raw is None or not str(raw).strip():
            typed[field] = None
            report("error", "missing_field", f"Champ {field} absent ou vide.", field=field, **context)
            continue
        value = str(raw).strip()
        try:
            if INTEGER.fullmatch(value):
                # Limite structurelle explicite, indépendante de la protection
                # Python int_max_str_digits propre à chaque environnement.
                if len(value.lstrip("+-")) > 1024:
                    raise ValueError("Entier trop long")
                typed[field] = int(value)
            elif field in {"BAPIgnoredValue", "FIPValeur", "FIPObligatoire"} and value.lower() in {"true", "false"}:
                typed[field] = value.lower() == "true"
            elif field in {"BAPIgnoredValue", "FIPValeur", "temporisationregroupement"} and NUMBER.fullmatch(value):
                typed[field] = float(value)
                if not math.isfinite(typed[field]):
                    raise ValueError("Nombre non fini")
            else:
                raise ValueError("Forme non reconnue")
        except (ValueError, OverflowError):
            typed[field] = None
            report("error", "malformed_field", f"Forme numérique/booléenne incorrecte pour {field} : {raw!r}.", field=field, **context)
            continue
        if field == "FIPObligatoire" and typed[field] not in (0, 1):
            report("error", "malformed_field", "FIPObligatoire doit être un booléen (0/1 ou true/false).", field=field, **context)


def _validate_group(group: dict[str, Any], context: dict[str, Any], report: Any) -> None:
    """Vérifie les entrées puis les références locales d'un regroupement."""
    _typed_fields(group, ("filtremodexp", "temporisationregroupement"), report, context)
    ids = [entry.get("id") for entry in group["entrees"]]
    counts = Counter(ids)
    if not ids:
        report("error", "missing_entries", "Regroupement sans entrée.", **context)
    for position, entry in enumerate(group["entrees"]):
        entry_context = {**context, "entree_id": entry["id"], "entree_index": position}
        entry_id = entry["id"]
        if not entry_id or not IDENTIFIER.fullmatch(entry_id) or entry_id in OPERATORS:
            report("error", "invalid_entry_id", "Identifiant d'entrée absent, réservé ou incorrect.", **entry_context)
        elif counts[entry_id] > 1:
            report("error", "duplicate_entry_id", "Identifiant d'entrée dupliqué dans ce regroupement.", **entry_context)
        _typed_fields(entry, ("BAPVariant", "BAPIgnoredValue", "FIPValeur", "FIPObligatoire"), report, entry_context)
        if entry["operateur"] not in OPERATORS:
            report("error", "unsupported_entry_operator", f"Opérateur d'entrée non pris en charge : {entry['operateur']!r}.", **entry_context)
        if len(entry.get("operateurs", [])) != 1:
            report("error", "entry_operator_cardinality", "Une entrée doit contenir un seul opérateur.", **entry_context)
        if not entry["valeurs"] or any(not value for value in entry["valeurs"]):
            report("error", "missing_values", "Valeurs de comparaison absentes ou vides.", **entry_context)
        if not entry["DAop"]:
            report("error", "missing_daop", "Attribut DAop absent ou vide.", **entry_context)
        if entry.get("rawStatus") not in {"O", "M"}:
            report("warning", "unknown_status", "Status non reconnu : texte original conservé.", **entry_context)

    if len(group.get("equations", [])) != 1:
        report("error", "equation_cardinality", "Un regroupement doit contenir une seule équation.", **context)
    expression = group["equation"]
    try:
        ast = parse_expression(expression)
    except EquationSyntaxError as error:
        report("error", "equation_syntax", str(error), **context)
        # Identifier les opérateurs écrits mais inconnus, sans assimiler un ID
        # d'entrée légitime à un mot-clé et sans exécuter l'expression.
        candidates = re.findall(r"(?<=[\w)])\s+([A-Za-z]+)\s+(?=[\w(])", expression)
        for operator in candidates:
            if operator not in OPERATORS and operator not in ids:
                report("error", "unsupported_equation_operator", f"Opérateur global non pris en charge : {operator!r}.", **context)
        return
    group["equation_ast"] = ast
    group["equation_references"] = expression_references(ast)
    if has_ambiguous_precedence(expression):
        report("error", "ambiguous_precedence", "Opérateurs différents sans parenthèses explicites ; priorité métier à confirmer.", **context)
    for reference in group["equation_references"]:
        if reference not in counts:
            report("error", "unknown_equation_reference", f"Référence {reference!r} absente des entrées du regroupement.", reference=reference, **context)
    for entry_id in dict.fromkeys(ids):
        if entry_id and entry_id not in group["equation_references"]:
            report("warning", "unused_entry", "Entrée déclarée mais non utilisée dans l'équation.", entree_id=entry_id, **context)


def validate_equations(document: dict[str, Any]) -> dict[str, Any]:
    """Valide le document et enrichit ses groupes avec l'AST et la vue typée."""
    diagnostics: list[dict[str, Any]] = []

    def report(severity: str, code: str, message: str, **context: Any) -> None:
        """Crée un diagnostic sérialisable, avec sa position dans le document."""
        diagnostics.append({"severity": severity, "code": code, "message": message, **context})

    metadata = document["metadata"]
    if metadata["root_element"] != "equationsregroupements":
        report("error", "unexpected_root", "Racine attendue : equationsregroupements.")
    if not metadata["numero_version"]:
        report("error", "missing_version", "numero_version absent : sélection exacte impossible.")
    if len(metadata.get("numero_version_values", [])) != 1:
        report("error", "version_cardinality", "Le document doit contenir un seul numero_version.")
    if len(metadata.get("date_modification_values", [])) > 1:
        report("error", "date_cardinality", "Le document contient plusieurs date_modification.")
    raw_date = metadata["date_modification"]
    if not raw_date:
        report("warning", "missing_date", "date_modification absente.")
    else:
        try:
            if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", raw_date):
                raise ValueError("Format date incorrect")
            date.fromisoformat(raw_date)
        except ValueError:
            report("error", "invalid_date", "date_modification doit être une date valide AAAA-MM-JJ.")
    groups = document["regroupements"]
    if not groups:
        report("error", "missing_groups", "Aucun regroupement trouvé.")
    counts = Counter(group["id"] for group in groups)
    for position, group in enumerate(groups):
        context = {"regroupement_id": group["id"], "regroupement_index": position}
        if not group["id"] or not group["id"].strip():
            report("error", "invalid_group_id", "Identifiant de regroupement absent ou vide.", **context)
        elif counts[group["id"]] > 1:
            report("error", "duplicate_group_id", "Identifiant de regroupement dupliqué.", **context)
        before = len(diagnostics)
        _validate_group(group, context, report)
        group["usable"] = not any(item["severity"] == "error" for item in diagnostics[before:])
        # Une collision d'identifiant interdit aussi l'utilisation isolée du groupe.
        if not group["id"] or not group["id"].strip() or counts[group["id"]] > 1:
            group["usable"] = False
    errors = sum(item["severity"] == "error" for item in diagnostics)
    warnings = sum(item["severity"] == "warning" for item in diagnostics)
    return {
        "valid": errors == 0, "usable": errors == 0,
        "error_count": errors, "warning_count": warnings, "diagnostics": diagnostics,
    }
