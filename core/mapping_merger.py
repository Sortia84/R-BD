#!/usr/bin/env python
"""
Fusion automatique Mapping Type + ICD EnumTypes

Fusionne les données extraites des ICD dans le fichier mapping_type.json
pour obtenir un mapping complet et à jour.
"""

import json
from pathlib import Path
from collections import defaultdict
from datetime import datetime
from typing import Any


class MappingMerger:
    """Fusionne les données ICD dans le mapping normatif."""

    def __init__(self, data_dir: Path | None = None):
        self.data_dir = data_dir or Path(__file__).parent.parent / "data"
        self.icd_dir = self.data_dir / "icd"
        self.mapping_file = self.data_dir / "isa" / "files" / "mapping_etat_61850" / "mapping_type.json"
        self.output_dir = self.data_dir / "isa" / "files" / "mapping_etat_61850"

    def load_mapping(self) -> dict[str, Any]:
        """Charge le fichier mapping_type.json existant."""
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

    def extract_enum_types(self, icds: list[dict]) -> dict[str, dict]:
        """Extrait et déduplique les EnumTypes des ICD."""
        enums = {}

        for icd in icds:
            ied_type = icd.get("ied_type", "Unknown")
            dtt = icd.get("data_type_templates", {})

            for enum_id, enum_data in dtt.get("enum_types", {}).items():
                values = [v.get("value", "") for v in enum_data.get("values", [])]
                desc = enum_data.get("desc", "")

                # Normaliser le nom (enlever suffixes numériques pour regrouper)
                base_name = self._normalize_enum_name(enum_id)

                if base_name not in enums:
                    enums[base_name] = {
                        "original_ids": set(),
                        "values": set(),
                        "desc": desc,
                        "used_in": set()
                    }

                enums[base_name]["original_ids"].add(enum_id)
                enums[base_name]["values"].update(v for v in values if v)
                enums[base_name]["used_in"].add(ied_type)
                if desc and not enums[base_name]["desc"]:
                    enums[base_name]["desc"] = desc

        # Convertir sets en lists
        for name in enums:
            enums[name]["original_ids"] = sorted(enums[name]["original_ids"])
            enums[name]["values"] = sorted(enums[name]["values"])
            enums[name]["used_in"] = sorted(enums[name]["used_in"])

        return enums

    def _normalize_enum_name(self, enum_id: str) -> str:
        """Normalise le nom d'un EnumType (enlève suffixes numériques)."""
        import re
        # Enlever les suffixes comme "123", "12", "1" à la fin
        normalized = re.sub(r'\d+$', '', enum_id)
        return normalized or enum_id

    def extract_cdc_info(self, icds: list[dict]) -> dict[str, dict]:
        """Extrait les informations sur les CDC depuis les ICD."""
        cdc_info = {}

        for icd in icds:
            dtt = icd.get("data_type_templates", {})

            for do_id, do_data in dtt.get("do_types", {}).items():
                cdc = do_data.get("cdc", "")
                if not cdc:
                    continue

                if cdc not in cdc_info:
                    cdc_info[cdc] = {
                        "das": {},  # Dict pour dédupliquer par nom
                        "desc": ""
                    }

                for da in do_data.get("das", []):
                    da_name = da.get("name", "")
                    btype = da.get("bType", "")
                    fc = da.get("fc", "")
                    if da_name and da_name not in cdc_info[cdc]["das"]:
                        cdc_info[cdc]["das"][da_name] = {
                            "name": da_name,
                            "type": btype or "unknown",
                            "fc": fc
                        }

        # Convertir dict en list triée
        for cdc in cdc_info:
            cdc_info[cdc]["das"] = sorted(
                cdc_info[cdc]["das"].values(),
                key=lambda x: x["name"]
            )

        return cdc_info

    def merge(self) -> dict[str, Any]:
        """Fusionne les données ICD dans le mapping."""
        mapping = self.load_mapping()
        icds = self.load_all_icds()

        enum_types = self.extract_enum_types(icds)
        cdc_info = self.extract_cdc_info(icds)

        # Incrémenter la version
        old_version = mapping.get("version", "1.0")
        try:
            major, minor = old_version.split(".")
            new_version = f"{major}.{int(minor) + 1}"
        except:
            new_version = "2.0"

        mapping["version"] = new_version
        mapping["last_merged"] = datetime.utcnow().isoformat() + "Z"
        mapping["merge_stats"] = {
            "icd_count": len(icds),
            "enum_types_added": 0,
            "cdc_added": 0
        }

        # === 1. Ajouter les EnumTypes manquants ===
        if "enumTypes" not in mapping:
            mapping["enumTypes"] = {}

        for enum_name, enum_data in enum_types.items():
            # Ne pas écraser les types existants dans "types"
            if enum_name in mapping.get("types", {}):
                continue

            # Ajouter seulement si valeurs significatives
            values = enum_data["values"]
            if not values or all(v.isdigit() for v in values):
                continue

            mapping["enumTypes"][enum_name] = {
                "description": enum_data["desc"] or f"EnumType {enum_name} (extrait des ICD)",
                "values": values,
                "source": "ICD",
                "used_in": enum_data["used_in"]
            }
            mapping["merge_stats"]["enum_types_added"] += 1

        # === 2. Ajouter/Mettre à jour les CDC ===
        cdc_descriptions = {
            "ACD": "Directional protection activation",
            "ACT": "Protection activation",
            "ASG": "Analogue setting",
            "BCR": "Binary counter reading",
            "CMV": "Complex measured value",
            "DEL": "Measured value with deadband",
            "DPC": "Double point control",
            "DPL": "Device name plate",
            "DPS": "Double Point Status",
            "ENC": "Controllable enumerated status",
            "ENG": "Enumerated status setting",
            "ENS": "Enumerated Status",
            "HWYE": "Harmonic value (wye)",
            "INC": "Integer controlled step position",
            "ING": "Integer setting",
            "INS": "Integer Status",
            "LPL": "Logical node name plate",
            "MV": "Measured Value",
            "ORG": "Single point (origin)",
            "SAV": "Sampled analogue value",
            "SEQ": "Sequence",
            "SPC": "Single point control",
            "SPG": "Single point setting",
            "SPS": "Single Point Status",
            "VSD": "Visible string description",
            "VSG": "Visible string setting",
            "VSS": "Visible string status",
            "WYE": "Phase to ground values"
        }

        # Convertir les CDC existants au nouveau format si nécessaire
        for cdc_name, cdc_data in mapping.get("cdc", {}).items():
            if "typicalDA" in cdc_data:
                old_das = cdc_data["typicalDA"]
                # Si c'est l'ancien format (string), convertir
                if old_das and isinstance(old_das[0], str):
                    new_das = []
                    for da_str in old_das:
                        # Parser "stVal(BOOLEAN)" -> {"name": "stVal", "type": "BOOLEAN"}
                        if "(" in da_str and da_str.endswith(")"):
                            name, type_part = da_str.rsplit("(", 1)
                            da_type = type_part.rstrip(")")
                        else:
                            name = da_str
                            da_type = "unknown"
                        new_das.append({"name": name, "type": da_type, "fc": ""})
                    cdc_data["typicalDA"] = new_das

        # Ajouter les CDC manquants depuis les ICD
        for cdc, info in cdc_info.items():
            if cdc not in mapping.get("cdc", {}):
                mapping["cdc"][cdc] = {
                    "description": cdc_descriptions.get(cdc, f"CDC {cdc}"),
                    "typicalDA": info["das"][:15],  # Limiter à 15
                    "source": "ICD"
                }
                mapping["merge_stats"]["cdc_added"] += 1
            else:
                # Enrichir les DA existants avec ceux des ICD
                existing_das = {da["name"] for da in mapping["cdc"][cdc].get("typicalDA", []) if isinstance(da, dict)}
                for da in info["das"]:
                    if da["name"] not in existing_das:
                        mapping["cdc"][cdc]["typicalDA"].append(da)

        # === 3. Ajouter les bTypes manquants ===
        if "Enum" not in mapping["types"]:
            mapping["types"]["Enum"] = {
                "description": "Type énuméré défini par EnumType SCL",
                "notes": ["Voir section enumTypes pour les valeurs"]
            }

        if "Struct" not in mapping["types"]:
            mapping["types"]["Struct"] = {
                "description": "Structure complexe (DAType SCL)",
                "notes": ["Défini par DAType dans DataTypeTemplates"]
            }

        if "ObjRef" not in mapping["types"]:
            mapping["types"]["ObjRef"] = {
                "description": "Object reference (chemin LN/DO)",
                "notes": ["Format: LDname/LNprefix.LNclass.inst/DOname.DAname"]
            }

        if "VisString129" not in mapping["types"]:
            mapping["types"]["VisString129"] = {
                "description": "Chaîne ASCII 129 caractères max",
                "maxLength": 129
            }

        # === 4. Ajouter les DA communs manquants ===
        common_da_to_add = {
            "ctlModel": {
                "meaning": "Control model",
                "type": "CtlModel",
                "expectedTypes": ["CtlModel"]
            },
            "Oper": {
                "meaning": "Operate command structure",
                "fields": ["ctlVal", "origin", "ctlNum", "T", "Test", "Check"]
            },
            "SBO": {
                "meaning": "Select Before Operate (return string)",
                "type": "VISIBLE_STRING"
            },
            "SBOw": {
                "meaning": "Select Before Operate with value",
                "fields": ["ctlVal", "origin", "ctlNum", "T", "Test", "Check"]
            },
            "Cancel": {
                "meaning": "Cancel control operation",
                "fields": ["ctlVal", "origin", "ctlNum", "T", "Test"]
            },
            "d": {
                "meaning": "Description",
                "type": "VISIBLE_STRING"
            },
            "dU": {
                "meaning": "Unicode description",
                "type": "UNICODE_STRING"
            },
            "blkEna": {
                "meaning": "Block enable",
                "type": "BOOLEAN"
            },
            "actVal": {
                "meaning": "Actual value (analogue)",
                "type": "AnalogueValue"
            },
            "mag": {
                "meaning": "Magnitude",
                "type": "AnalogueValue"
            },
            "phsA": {
                "meaning": "Phase A value",
                "type": "CMV"
            },
            "phsB": {
                "meaning": "Phase B value",
                "type": "CMV"
            },
            "phsC": {
                "meaning": "Phase C value",
                "type": "CMV"
            },
            "neut": {
                "meaning": "Neutral value",
                "type": "CMV"
            }
        }

        for da_name, da_info in common_da_to_add.items():
            if da_name not in mapping.get("commonDA", {}):
                mapping["commonDA"][da_name] = da_info

        return mapping

    def save_merged(self, mapping: dict[str, Any]) -> Path:
        """Sauvegarde le mapping fusionné."""
        # Sauvegarder avec timestamp
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        output_file = self.output_dir / f"mapping_type_complete_{timestamp}.json"

        with open(output_file, "w", encoding="utf-8") as f:
            json.dump(mapping, f, indent=4, ensure_ascii=False)

        return output_file

    def run(self) -> tuple[dict[str, Any], Path]:
        """Exécute la fusion et retourne le résultat."""
        merged = self.merge()
        output_path = self.save_merged(merged)
        return merged, output_path


if __name__ == "__main__":
    merger = MappingMerger()
    merged, output_path = merger.run()

    stats = merged.get("merge_stats", {})
    print("=" * 60)
    print("FUSION MAPPING + ICD TERMINÉE")
    print("=" * 60)
    print(f"\n📊 Statistiques:")
    print(f"   ICD analysés: {stats.get('icd_count', 0)}")
    print(f"   EnumTypes ajoutés: {stats.get('enum_types_added', 0)}")
    print(f"   CDC ajoutés: {stats.get('cdc_added', 0)}")
    print(f"\n📁 Fichier généré: {output_path}")
    print(f"   Version: {merged.get('version')}")

    # Afficher quelques EnumTypes ajoutés
    enum_types = merged.get("enumTypes", {})
    if enum_types:
        print(f"\n🔢 Exemples d'EnumTypes ajoutés ({len(enum_types)} total):")
        for name, data in list(enum_types.items())[:5]:
            values = data.get("values", [])[:5]
            print(f"   - {name}: [{', '.join(values)}...]")
