#!/usr/bin/env python
"""
Comparateur Mapping Type vs ICD - Analyse les écarts

Compare le fichier mapping_type.json avec les données extraites des ICD
pour identifier les éléments manquants.
"""

import json
from pathlib import Path
from collections import defaultdict
from typing import Any


class MappingComparator:
    """Compare le mapping normatif avec les données ICD réelles."""

    def __init__(self, data_dir: Path | None = None):
        self.data_dir = data_dir or Path(__file__).parent.parent / "data"
        self.icd_dir = self.data_dir / "icd"
        self.mapping_file = self.data_dir / "isa" / "files" / "mapping_etat_61850" / "mapping_type.json"

    def load_mapping(self) -> dict[str, Any]:
        """Charge le fichier mapping_type.json."""
        if not self.mapping_file.exists():
            raise FileNotFoundError(f"Mapping non trouvé: {self.mapping_file}")
        with open(self.mapping_file, "r", encoding="utf-8") as f:
            return json.load(f)

    def load_all_icds(self) -> list[dict[str, Any]]:
        """Charge tous les fichiers JSON ICD."""
        icds = []
        for json_file in self.icd_dir.glob("*.json"):
            if json_file.name == "index.json":
                continue
            try:
                with open(json_file, "r", encoding="utf-8") as f:
                    icds.append(json.load(f))
            except (json.JSONDecodeError, IOError):
                continue
        return icds

    def extract_from_icds(self, icds: list[dict]) -> dict[str, Any]:
        """Extrait les éléments uniques des ICD."""
        result = {
            "enum_types": {},        # EnumType ID -> {values, used_in}
            "cdc_types": set(),      # CDC uniques (SPS, DPS, INS, etc.)
            "bTypes": set(),         # Types de base utilisés
            "da_names": set(),       # Noms de DA utilisés
            "ln_classes": set(),     # Classes LN utilisées
            "do_names": defaultdict(set),  # DO name -> CDC associé
        }

        for icd in icds:
            ied_type = icd.get("ied_type", "Unknown")

            # DataTypeTemplates
            dtt = icd.get("data_type_templates", {})

            # EnumTypes
            for enum_id, enum_data in dtt.get("enum_types", {}).items():
                if enum_id not in result["enum_types"]:
                    result["enum_types"][enum_id] = {
                        "values": [v.get("value", "") for v in enum_data.get("values", [])],
                        "desc": enum_data.get("desc", ""),
                        "used_in": set()
                    }
                result["enum_types"][enum_id]["used_in"].add(ied_type)

            # DOTypes -> CDC
            for do_id, do_data in dtt.get("do_types", {}).items():
                cdc = do_data.get("cdc", "")
                if cdc:
                    result["cdc_types"].add(cdc)

                # DA bTypes
                for da in do_data.get("das", []):
                    btype = da.get("bType", "")
                    if btype:
                        result["bTypes"].add(btype)
                    da_name = da.get("name", "")
                    if da_name:
                        result["da_names"].add(da_name)

            # LNodeTypes -> LN classes et DO
            for lnt_id, lnt_data in dtt.get("lnode_types", {}).items():
                ln_class = lnt_data.get("lnClass", "")
                if ln_class:
                    result["ln_classes"].add(ln_class)

                for do_ref in lnt_data.get("dos", []):
                    do_name = do_ref.get("name", "")
                    do_type = do_ref.get("type", "")
                    if do_name and do_type:
                        # Trouver le CDC
                        do_type_data = dtt.get("do_types", {}).get(do_type, {})
                        cdc = do_type_data.get("cdc", "")
                        if cdc:
                            result["do_names"][do_name].add(cdc)

        # Convertir sets en lists pour JSON
        for enum_id in result["enum_types"]:
            result["enum_types"][enum_id]["used_in"] = list(result["enum_types"][enum_id]["used_in"])

        result["cdc_types"] = sorted(result["cdc_types"])
        result["bTypes"] = sorted(result["bTypes"])
        result["da_names"] = sorted(result["da_names"])
        result["ln_classes"] = sorted(result["ln_classes"])
        result["do_names"] = {k: sorted(v) for k, v in result["do_names"].items()}

        return result

    def compare(self) -> dict[str, Any]:
        """Compare le mapping avec les ICD et retourne les écarts."""
        mapping = self.load_mapping()
        icds = self.load_all_icds()
        icd_data = self.extract_from_icds(icds)

        # Types définis dans le mapping
        mapping_types = set(mapping.get("types", {}).keys())
        mapping_cdc = set(mapping.get("cdc", {}).keys())
        mapping_da = set(mapping.get("commonDA", {}).keys())

        # Analyse des écarts
        report = {
            "summary": {
                "icd_count": len(icds),
                "enum_types_in_icd": len(icd_data["enum_types"]),
                "cdc_in_icd": len(icd_data["cdc_types"]),
                "bTypes_in_icd": len(icd_data["bTypes"]),
                "da_names_in_icd": len(icd_data["da_names"]),
                "ln_classes_in_icd": len(icd_data["ln_classes"]),
            },
            "missing_cdc": [],
            "missing_bTypes": [],
            "missing_da": [],
            "enum_types_to_add": [],
            "covered_cdc": [],
            "covered_bTypes": [],
        }

        # CDC manquants
        for cdc in icd_data["cdc_types"]:
            if cdc in mapping_cdc:
                report["covered_cdc"].append(cdc)
            else:
                report["missing_cdc"].append(cdc)

        # bTypes manquants (mapper vers types standards)
        btype_to_mapping = {
            "BOOLEAN": "BOOLEAN",
            "INT8": "INT8",
            "INT16": "INT16",
            "INT32": "INT32",
            "INT64": "INT64",
            "INT8U": "INT8U",
            "INT16U": "INT16U",
            "INT24U": "INT24U",
            "INT32U": "INT32U",
            "FLOAT32": "FLOAT32",
            "FLOAT64": "FLOAT64",
            "VisString255": "VISIBLE_STRING",
            "VisString64": "VISIBLE_STRING",
            "VisString32": "VISIBLE_STRING",
            "Unicode255": "UNICODE_STRING",
            "Octet64": "OCTET_STRING",
            "Quality": "Quality",
            "Timestamp": "Timestamp",
            "Dbpos": "Dbpos",
            "Tcmd": "Tcmd",
            "Check": "Check",
            "Enum": "Enum",
            "Struct": "Struct",
        }

        for btype in icd_data["bTypes"]:
            mapped = btype_to_mapping.get(btype, btype)
            if mapped in mapping_types or btype in mapping_types:
                report["covered_bTypes"].append(btype)
            else:
                report["missing_bTypes"].append(btype)

        # DA manquants
        for da in icd_data["da_names"]:
            if da not in mapping_da:
                report["missing_da"].append(da)

        # EnumTypes intéressants (avec valeurs non génériques)
        for enum_id, enum_data in icd_data["enum_types"].items():
            values = enum_data.get("values", [])
            # Filtrer les enums avec des valeurs significatives
            if values and not all(v.isdigit() or v == "" for v in values if isinstance(v, str)):
                report["enum_types_to_add"].append({
                    "id": enum_id,
                    "values": values[:10],  # Limiter pour lisibilité
                    "desc": enum_data.get("desc", ""),
                    "used_in": enum_data.get("used_in", [])
                })

        # Trier les résultats
        report["missing_cdc"] = sorted(report["missing_cdc"])
        report["missing_bTypes"] = sorted(report["missing_bTypes"])
        report["missing_da"] = sorted(report["missing_da"])
        report["enum_types_to_add"] = sorted(report["enum_types_to_add"], key=lambda x: x["id"])

        return report

    def generate_report(self) -> str:
        """Génère un rapport texte de comparaison."""
        report = self.compare()

        lines = [
            "=" * 70,
            "RAPPORT COMPARAISON MAPPING TYPE vs ICD",
            "=" * 70,
            "",
            f"📊 RÉSUMÉ:",
            f"   ICD analysés: {report['summary']['icd_count']}",
            f"   EnumTypes trouvés: {report['summary']['enum_types_in_icd']}",
            f"   CDC trouvés: {report['summary']['cdc_in_icd']}",
            f"   bTypes trouvés: {report['summary']['bTypes_in_icd']}",
            f"   DA names trouvés: {report['summary']['da_names_in_icd']}",
            f"   LN classes trouvés: {report['summary']['ln_classes_in_icd']}",
            "",
        ]

        # CDC
        lines.append("📋 CDC (Common Data Classes):")
        lines.append(f"   ✅ Couverts ({len(report['covered_cdc'])}): {', '.join(report['covered_cdc'])}")
        if report["missing_cdc"]:
            lines.append(f"   ❌ Manquants ({len(report['missing_cdc'])}): {', '.join(report['missing_cdc'])}")
        else:
            lines.append("   ✅ Tous les CDC sont couverts!")
        lines.append("")

        # bTypes
        lines.append("📦 Types de base (bType):")
        if report["missing_bTypes"]:
            lines.append(f"   ❌ Manquants ({len(report['missing_bTypes'])}): {', '.join(report['missing_bTypes'])}")
        else:
            lines.append("   ✅ Tous les bTypes sont mappés!")
        lines.append("")

        # DA manquants (top 20)
        if report["missing_da"]:
            lines.append(f"📌 DA non documentés ({len(report['missing_da'])}):")
            for da in report["missing_da"][:20]:
                lines.append(f"   - {da}")
            if len(report["missing_da"]) > 20:
                lines.append(f"   ... et {len(report['missing_da']) - 20} autres")
        lines.append("")

        # EnumTypes intéressants (top 15)
        if report["enum_types_to_add"]:
            lines.append(f"🔢 EnumTypes à ajouter au mapping ({len(report['enum_types_to_add'])}):")
            for enum in report["enum_types_to_add"][:15]:
                values_str = ", ".join(str(v) for v in enum["values"][:5])
                if len(enum["values"]) > 5:
                    values_str += "..."
                lines.append(f"   - {enum['id']}")
                lines.append(f"     Valeurs: [{values_str}]")
                lines.append(f"     Utilisé dans: {', '.join(enum['used_in'])}")
            if len(report["enum_types_to_add"]) > 15:
                lines.append(f"   ... et {len(report['enum_types_to_add']) - 15} autres")
        lines.append("")

        lines.append("=" * 70)
        return "\n".join(lines)


if __name__ == "__main__":
    comparator = MappingComparator()
    print(comparator.generate_report())

    # Sauvegarder le rapport JSON
    report = comparator.compare()
    output_file = comparator.data_dir / "mapping_comparison_report.json"
    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"\n📁 Rapport JSON sauvegardé: {output_file}")
