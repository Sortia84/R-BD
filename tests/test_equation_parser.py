"""Garanties du contrat équations : aucune perte et aucun calcul implicite."""

from __future__ import annotations

import hashlib
import importlib.util
from pathlib import Path
import sys
from xml.sax.saxutils import escape

import pytest


# Les applications ont plusieurs packages nommés core. Charger seulement le
# package des parseurs sous un nom propre évite de polluer les autres tests.
APP_DIR = Path(__file__).resolve().parents[1]
ROOT = APP_DIR.parents[1]
PARSERS = APP_DIR / "core/isa_parsers"
SPEC = importlib.util.spec_from_file_location(
    "_r_bd_equation_parsers_tests", PARSERS / "__init__.py",
    submodule_search_locations=[str(PARSERS)],
)
PACKAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = PACKAGE
SPEC.loader.exec_module(PACKAGE)
PARSER = sys.modules[f"{SPEC.name}.equation_parser"]
SYNTAX = sys.modules[f"{SPEC.name}.equation_syntax"]


def entry(entry_id="E1", values=("1",), operator="OR", **attributes):
    """Construit une entrée représentative sans dépendre des données métier."""
    fields = {
        "id": entry_id, "value": "source-uuid", "libellecourt": "DF.CHA.*",
        "Status": "M", "BAPIgnoredValue": "3", "BAPVariant": "8",
        "FIPValeur": "0", "FIPObligatoire": "1", **attributes,
    }
    attrs = " ".join(f'{key}="{escape(str(value))}"' for key, value in fields.items())
    vals = "".join(f"<valeur>{escape(value)}</valeur>" for value in values)
    return f"<entree {attrs}><DAop>Health</DAop><valeurs>{vals}</valeurs><operateur>{operator}</operateur></entree>"


def group(group_id="G1", entries=None, expression="E1"):
    """Construit un regroupement dont les équations peuvent être invalides."""
    entries = entry() if entries is None else entries
    return (
        f'<regroupement id="{group_id}" libellecourt="DF.CT" filtremodexp="0" '
        'temporisationregroupement="5"><entrees>' + entries + "</entrees>"
        f"<equation>{escape(expression)}</equation></regroupement>"
    )


def parse(tmp_path, groups=None, *, version="1.5.53", modified="2026-10-15", namespace=""):
    """Écrit un XML temporaire ; son nom trompeur ne doit jamais fixer sa version."""
    groups = group() if groups is None else groups
    source = (
        f'<equationsregroupements {namespace}><date_modification>{modified}</date_modification>'
        f"<numero_version>{version}</numero_version>{groups}</equationsregroupements>"
    ).encode("utf-8")
    path = tmp_path / "GRP_9.9.9.xml"
    path.write_bytes(source)
    return PARSER.parse_equation_xml(path), source


def codes(result):
    """Expose les codes stables des diagnostics, indépendamment des messages."""
    return {item["code"] for item in result["validation"]["diagnostics"]}


def test_provenance_and_complete_multivalue_contract(tmp_path):
    result, source = parse(tmp_path, group(entries=entry(values=("3", "2", "3"), operator="XOR")))
    metadata = result["metadata"]
    assert metadata["numero_version"] == metadata["equation_version"] == "1.5.53"
    assert metadata["date_modification"] == "2026-10-15"
    assert metadata["schema_version"] == "2.0"
    assert metadata["source_sha256"] == hashlib.sha256(source).hexdigest()
    assert metadata["source_size_bytes"] == len(source)
    assert result["validation"]["usable"]
    actual = result["regroupements"][0]["entrees"][0]
    assert actual["valeurs"] == ["3", "2", "3"]
    assert actual["valeur"] == "3"
    assert actual["operateur"] == "XOR"
    assert actual["Status"] == "Mandatory" and actual["rawStatus"] == "M"
    assert actual["typed_attributes"]["BAPVariant"] == 8
    assert actual["BAPIgnoredValue"] == "3"
    assert result["regroupements"][0]["equation_ast"] == {"type": "reference", "id": "E1"}


def test_repeated_ids_between_groups_do_not_lose_occurrences(tmp_path):
    result, _ = parse(tmp_path, group("G1") + group("G2") + group("G3", entry("Expr9"), "Expr9"))
    assert result["metadata"]["total_entrees"] == 3
    assert result["index_entrees"] == {"Expr9": "G3"}
    assert len(result["index_entrees_collisions"]["E1"]) == 2
    assert result["index_entrees_scoped"]["G1"]["E1"] == [{"regroupement_index": 0, "entree_index": 0}]
    assert result["index_entrees_scoped"]["G2"]["E1"] == [{"regroupement_index": 1, "entree_index": 0}]
    assert result["validation"]["usable"]


def test_duplicate_local_ids_and_groups_remain_inspectable(tmp_path):
    result, _ = parse(tmp_path, group(entries=entry() + entry()) + group())
    assert {"duplicate_entry_id", "duplicate_group_id"} <= codes(result)
    assert not result["validation"]["usable"]
    assert result["metadata"]["total_entrees"] == 3
    assert len(result["index_entrees_scoped"]["G1"]["E1"]) == 3
    assert all(not actual["usable"] for actual in result["regroupements"])


def test_ast_preserves_parentheses_and_references(tmp_path):
    entries = entry("E1") + entry("E2") + entry("E3")
    result, _ = parse(tmp_path, group(entries=entries, expression="(E1 OR E2) AND E3"))
    actual = result["regroupements"][0]
    assert actual["equation"] == "(E1 OR E2) AND E3"
    assert actual["equation_references"] == ["E1", "E2", "E3"]
    assert actual["equation_ast"]["operator"] == "AND"
    assert actual["equation_ast"]["operands"][0]["operator"] == "OR"
    assert result["validation"]["usable"]


def test_precedence_representation_is_explicit_but_not_assumed_for_simulation(tmp_path):
    expression = "E1 OR E2 XOR E3 AND E4"
    ast = SYNTAX.parse_expression(expression)
    assert ast["operator"] == "OR"
    assert ast["operands"][1]["operator"] == "XOR"
    assert ast["operands"][1]["operands"][1]["operator"] == "AND"
    entries = "".join(entry(f"E{i}") for i in range(1, 5))
    result, _ = parse(tmp_path, group(entries=entries, expression=expression))
    assert "ambiguous_precedence" in codes(result)
    assert not result["validation"]["usable"]
    assert result["regroupements"][0]["equation_ast"] == ast


@pytest.mark.parametrize("expression", ["E1 AND", "(E1 OR E2", "E1 E2", "E1 && E2", "E1)", "", "__import__('os')"])
def test_invalid_expression_is_preserved_and_never_executed(tmp_path, expression):
    result, _ = parse(tmp_path, group(expression=expression))
    assert "equation_syntax" in codes(result)
    assert result["regroupements"][0]["equation"] == expression
    assert result["regroupements"][0]["equation_ast"] is None
    assert not result["metadata"]["usable"]


def test_unknown_references_are_scoped_and_unused_entries_warn(tmp_path):
    result, _ = parse(tmp_path, group(entries=entry("E1"), expression="E2") + group("G2", entry("E2"), "E2"))
    assert "unknown_equation_reference" in codes(result)
    assert "unused_entry" in codes(result)
    assert result["regroupements"][1]["usable"]
    assert not result["regroupements"][0]["usable"]


def test_unsupported_operators_are_reported(tmp_path):
    result, _ = parse(tmp_path, group(entries=entry(operator="NOR") + entry("E2"), expression="E1 NAND E2"))
    assert {"unsupported_entry_operator", "unsupported_equation_operator"} <= codes(result)


def test_typed_malformed_fields_preserve_raw_text(tmp_path):
    result, _ = parse(tmp_path, group(entries=entry(BAPVariant="eight", FIPObligatoire="7")))
    actual = result["regroupements"][0]["entrees"][0]
    assert actual["BAPVariant"] == "eight"
    assert actual["raw_attributes"]["FIPObligatoire"] == "7"
    assert actual["typed_attributes"]["BAPVariant"] is None
    assert "malformed_field" in codes(result)


def test_missing_values_version_and_invalid_date(tmp_path):
    result, _ = parse(tmp_path, group(entries=entry(values=())), version="", modified="2026-02-30")
    assert {"missing_values", "missing_version", "invalid_date"} <= codes(result)
    assert not result["validation"]["usable"]


def test_namespace_and_uuid_group_id_are_supported(tmp_path):
    result, _ = parse(tmp_path, group("030abc30-010a-4655-b5c9-3912219715a8"), namespace='xmlns="urn:rte:grp"')
    assert result["metadata"]["total_entrees"] == 1
    assert result["validation"]["usable"]


def test_multiple_version_and_date_fields_are_never_selected_silently(tmp_path):
    result, _ = parse(tmp_path, "<numero_version>1.5.47</numero_version><date_modification>2025-11-07</date_modification>" + group())
    assert result["metadata"]["numero_version_values"] == ["1.5.53", "1.5.47"]
    assert result["metadata"]["date_modification_values"] == ["2026-10-15", "2025-11-07"]
    assert {"version_cardinality", "date_cardinality"} <= codes(result)
    assert not result["validation"]["usable"]


def test_excessive_integer_is_diagnosed_instead_of_crashing(tmp_path):
    huge_number = "9" * 4500
    result, _ = parse(tmp_path, group(entries=entry(BAPVariant=huge_number)))
    assert "malformed_field" in codes(result)
    assert result["regroupements"][0]["entrees"][0]["BAPVariant"] == huge_number
    assert not result["validation"]["usable"]


@pytest.mark.parametrize("encoding", ["utf-8", "utf-16", "utf-32"])
def test_dtd_and_entities_are_rejected_before_parsing(tmp_path, encoding):
    path = tmp_path / "unsafe.xml"
    path.write_bytes('<!DOCTYPE x [<!ENTITY local SYSTEM "file:///private.txt">]><x>&local;</x>'.encode(encoding))
    with pytest.raises(ValueError, match="DTD"):
        PARSER.parse_equation_xml(path)


def test_excessive_parentheses_are_bounded():
    with pytest.raises(SYNTAX.EquationSyntaxError, match="imbriquée"):
        SYNTAX.parse_expression("(" * 70 + "E1" + ")" * 70)


def test_wildcard_historical_semantics_are_preserved():
    assert PARSER.match_wildcard("DF.CHA.*", "df.cha.12")
    assert not PARSER.match_wildcard("DF.CHA.*", "DF.CHA.")
    assert PARSER.match_wildcard("DF.?", "df.1")
    assert not PARSER.match_wildcard("DF.?", "DF.12")
    assert PARSER.match_wildcard("DF.[A]", "df.[a]")
    assert not PARSER.match_wildcard("DF.[A]", "DF.A")


def test_available_xml_has_exact_counts_and_known_unused_entry():
    source = ROOT / "apps/r_bd/data/isa/files/isa_alarmes/56270aeefe42_GRP_1.5.47_modif.xml"
    if not source.exists():
        pytest.skip("XML historique non distribué dans cet environnement")
    result = PARSER.parse_equation_xml(source)
    assert result["metadata"]["numero_version"] == "1.5.47"
    assert result["metadata"]["total_regroupements"] == 120
    assert result["metadata"]["total_entrees"] == 318
    assert sum(len(item["valeurs"]) > 1 for group_ in result["regroupements"] for item in group_["entrees"]) == 41
    assert result["validation"]["error_count"] == 0
    assert any(item.get("entree_id") == "Expr275" and item["code"] == "unused_entry" for item in result["validation"]["diagnostics"])
