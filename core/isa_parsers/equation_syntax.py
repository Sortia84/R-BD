"""Lecture sûre des expressions GRP, sans exécution de code ni règle BAP.

L'AST utilise AND > XOR > OR pour sa représentation. Les expressions mélangeant
ces opérateurs sans parenthèses sont signalées comme ambiguës par la validation :
aucune priorité métier non documentée ne doit être imposée au simulateur.
"""

from __future__ import annotations

import re
from typing import Any


OPERATORS = frozenset({"AND", "OR", "XOR"})
IDENTIFIER = re.compile(r"[A-Za-z_][A-Za-z0-9_.:-]*\Z")
TOKEN = re.compile(r"\s*([A-Za-z_][A-Za-z0-9_.:-]*|[()])")


class EquationSyntaxError(ValueError):
    """Expression non conforme à la grammaire des équations prise en charge."""


def parse_expression(expression: str) -> dict[str, Any]:
    """Retourne un AST JSON pour une expression de références AND/OR/XOR.

    Les identifiants restent sensibles à la casse. Les opérateurs sont reconnus
    en majuscules, comme dans le référentiel XML. Des limites explicites évitent
    qu'une saisie excessivement imbriquée épuise la pile du serveur.
    """
    tokens: list[str] = []
    position = 0
    while position < len(expression):
        if not expression[position:].strip():
            break
        match = TOKEN.match(expression, position)
        if not match:
            raise EquationSyntaxError(f"Caractère non reconnu à la position {position}.")
        tokens.append(match.group(1))
        position = match.end()
        if len(tokens) > 4096:
            raise EquationSyntaxError("Expression trop longue (4096 jetons maximum).")
    if not tokens:
        raise EquationSyntaxError("Expression vide.")
    cursor = 0

    def atom(depth: int) -> dict[str, Any]:
        """Lit une référence ou une sous-expression explicitement parenthésée."""
        nonlocal cursor
        if depth > 64:
            raise EquationSyntaxError("Expression trop imbriquée (64 niveaux maximum).")
        if cursor >= len(tokens):
            raise EquationSyntaxError("Référence attendue en fin d'expression.")
        token = tokens[cursor]
        cursor += 1
        if token == "(":
            node = operation(0, depth + 1)
            if cursor >= len(tokens) or tokens[cursor] != ")":
                raise EquationSyntaxError("Parenthèse fermante manquante.")
            cursor += 1
            return node
        if token == ")" or token in OPERATORS:
            raise EquationSyntaxError(f"Référence attendue, reçu {token!r}.")
        return {"type": "reference", "id": token}

    def operation(level: int, depth: int) -> dict[str, Any]:
        """Lit un niveau de priorité et regroupe les opérateurs associatifs."""
        nonlocal cursor
        if level == 3:
            return atom(depth)
        operator = ("OR", "XOR", "AND")[level]
        operands = [operation(level + 1, depth)]
        while cursor < len(tokens) and tokens[cursor] == operator:
            cursor += 1
            operands.append(operation(level + 1, depth))
        if len(operands) == 1:
            return operands[0]
        return {"type": "operator", "operator": operator, "operands": operands}

    ast = operation(0, 0)
    if cursor != len(tokens):
        raise EquationSyntaxError(f"Jeton inattendu : {tokens[cursor]!r}.")
    return ast


def expression_references(ast: dict[str, Any]) -> list[str]:
    """Liste les références dans leur ordre d'apparition, sans doublons."""
    if ast["type"] == "reference":
        return [ast["id"]]
    return list(dict.fromkeys(
        reference
        for operand in ast["operands"]
        for reference in expression_references(operand)
    ))


def has_ambiguous_precedence(expression: str) -> bool:
    """Détecte plusieurs opérateurs différents au même niveau de parenthèses."""
    levels: list[set[str]] = [set()]
    for token in re.findall(r"[A-Za-z_][A-Za-z0-9_.:-]*|[()]", expression):
        if token == "(":
            levels.append(set())
        elif token == ")":
            if len(levels) > 1 and len(levels.pop()) > 1:
                return True
        elif token in OPERATORS:
            levels[-1].add(token)
    return any(len(level) > 1 for level in levels)
