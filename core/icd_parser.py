# icd_parser.py - Parser ICD IEC 61850 pour R#BD
"""
Module de parsing des fichiers ICD (XML IEC 61850).
Extrait les informations clés : IED, LD, LN, LNinst.

Structure de stockage (1 JSON par ICD) :
  data/icd/{ied_type}/{manufacturer}/{version}.json
  data/icd/index.json  # Index global avec références
"""

from pathlib import Path
from typing import Any
from lxml import etree
import json
import re
from datetime import datetime

SCL_NS = "http://www.iec.ch/61850/2003/SCL"
NSMAP = {"scl": SCL_NS}


def sanitize_path(value: str) -> str:
    """Nettoie une chaîne pour l'utiliser comme nom de fichier/dossier."""
    sanitized = re.sub(r'[<>:"/\\|?*\s]+', '_', str(value or 'unknown'))
    sanitized = re.sub(r'_+', '_', sanitized).strip('_')
    return sanitized[:50] or 'unknown'  # Limite longueur


class ICDParser:
    """Parser de fichiers ICD IEC 61850 avec stockage 1 JSON par ICD."""

    def __init__(self, data_dir: Path | None = None):
        self.data_dir = data_dir or Path(__file__).parent.parent / "data"
        self.icd_dir = self.data_dir / "icd"
        self.index_file = self.icd_dir / "index.json"  # Renommé pour clarté
        self.icd_dir.mkdir(parents=True, exist_ok=True)

    def parse_file(self, file_path: Path) -> list[dict[str, Any]]:
        """Parse un fichier ICD et retourne la liste des IED extraits."""
        try:
            tree = etree.parse(str(file_path))
            root = tree.getroot()
        except etree.XMLSyntaxError as e:
            raise ValueError(f"XML invalide: {e}") from e

        ied_nodes = root.xpath("//scl:IED", namespaces=NSMAP)
        if not ied_nodes:
            raise ValueError("Aucun IED trouvé dans le fichier")

        results = []
        for ied_node in ied_nodes:
            entry = self._parse_ied_node(ied_node, file_path.name)
            results.append(entry)
        return results

    def _parse_ied_node(self, ied_node: etree._Element, filename: str) -> dict[str, Any]:
        """Parse un noeud IED et extrait les informations."""
        manufacturer = ied_node.get("manufacturer", "Inconnu")
        ied_type_attr = ied_node.get("type", "UNKNOWN")
        config_version = ied_node.get("configVersion", "")
        desc = ied_node.get("desc", "")
        version_display = desc or config_version or "Version inconnue"
        ied_name = ied_node.get("name", "IED")

        # Extraire COMPAS-IEDType pour la catégorie (SCU-ORG, BCU, etc.)
        compas_type = self._extract_compas_type(ied_node)
        ied_type_attr = ied_node.get("type", "UNKNOWN")
        ied_type = compas_type or ied_type_attr

        # Extraire LDevices et LN
        ldevices = self._extract_ldevices(ied_node)

        ld_count = len(ldevices)
        ln_count = sum(len(ld.get("lns", [])) for ld in ldevices)

        # Construire l'identifiant unique avec type + manufacturer + configVersion + desc
        icd_id = self._build_icd_id(ied_type_attr, manufacturer, config_version, desc)

        return {
            "icd_id": icd_id,
            "ied_type": ied_type,
            "ied_type_attr": ied_type_attr,
            "manufacturer": manufacturer,
            "config_version": config_version,
            "desc": desc,
            "version": version_display,
            "filename": filename,
            "imported_at": datetime.utcnow().isoformat() + "Z",
            "ieds": [
                {
                    "name": ied_name,
                    "lds": ldevices
                }
            ],
            "ld_count": ld_count,
            "ln_count": ln_count
        }

    def _extract_compas_type(self, ied_node: etree._Element) -> str:
        """Extrait le type COMPAS-IEDType depuis les Private."""
        private_nodes = ied_node.xpath(".//scl:Private[@type='COMPAS-IEDType']", namespaces=NSMAP)
        if private_nodes:
            return (private_nodes[0].text or "").strip()
        return ""

    def _extract_ldevices(self, ied_node: etree._Element) -> list[dict[str, Any]]:
        """Extrait les LDevices avec leurs LN."""
        ldevices = []
        ld_nodes = ied_node.xpath(".//scl:LDevice", namespaces=NSMAP)

        for ld_node in ld_nodes:
            inst = ld_node.get("inst", "")
            lns = []

            # LN0 (souvent LLN0)
            ln0_nodes = ld_node.xpath("scl:LN0", namespaces=NSMAP)
            for ln0 in ln0_nodes:
                lns.append({
                    "ln_class": ln0.get("lnClass", "LLN0"),
                    "lninst": ln0.get("inst", "")
                })

            # LN classiques
            ln_nodes = ld_node.xpath("scl:LN", namespaces=NSMAP)
            for ln in ln_nodes:
                lns.append({
                    "ln_class": ln.get("lnClass", ""),
                    "lninst": ln.get("inst", "")
                })

            ldevices.append({
                "name": inst,
                "lns": lns
            })

        return ldevices

    def _build_icd_id(self, ied_type: str, manufacturer: str, config_version: str, desc: str) -> str:
        """Construit un identifiant ICD unique basé sur type + manufacturer + configVersion + desc.

        Exemple: type="Protection", manufacturer="Efacec", configVersion="1.47", desc="SAMUA1"
        => ICD_PROTECTION_EFACEC_1_47_SAMUA1
        """
        # Combiner les 4 attributs
        combined = f"{ied_type}_{manufacturer}_{config_version}_{desc}"
        # Sanitize pour créer un ID valide
        sanitized = re.sub(r"[^A-Z0-9]+", "_", combined.upper().strip()).strip("_")
        # Éviter les underscores multiples
        sanitized = re.sub(r"_+", "_", sanitized)
        return f"ICD_{sanitized}" if sanitized else "ICD_UNKNOWN"

    def _get_icd_path(self, filename: str) -> Path:
        """Retourne le chemin du fichier JSON basé sur le filename (unique).

        Structure: data/icd/{filename_sanitized}.json
        """
        # Utiliser le stem du filename (sans extension) comme base
        base_name = Path(filename).stem
        sanitized = sanitize_path(base_name) + ".json"
        return self.icd_dir / sanitized

    # --- Gestion de l'index global ---

    def load_index(self) -> dict[str, Any]:
        """Charge l'index global JSON."""
        if not self.index_file.exists():
            return {"icd_list": [], "last_updated": None}
        try:
            with open(self.index_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Migration ancien format
                if isinstance(data, dict) and "icd_list" not in data:
                    return {"icd_list": list(data.values()), "last_updated": None}
                return data
        except (json.JSONDecodeError, IOError):
            return {"icd_list": [], "last_updated": None}

    def save_index(self, index: dict[str, Any]) -> None:
        """Sauvegarde l'index global JSON."""
        index["last_updated"] = datetime.utcnow().isoformat() + "Z"
        with open(self.index_file, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=2, ensure_ascii=False)

    def save_icd_file(self, entry: dict[str, Any]) -> Path:
        """Sauvegarde un ICD dans son fichier JSON dédié."""
        icd_path = self._get_icd_path(entry["filename"])
        icd_path.parent.mkdir(parents=True, exist_ok=True)
        with open(icd_path, "w", encoding="utf-8") as f:
            json.dump(entry, f, indent=2, ensure_ascii=False)
        return icd_path

    def load_icd_file(self, filename: str) -> dict[str, Any] | None:
        """Charge un fichier ICD spécifique par son filename."""
        icd_path = self._get_icd_path(filename)
        if not icd_path.exists():
            return None
        try:
            with open(icd_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            return None

    def upsert_entry(self, entry: dict[str, Any]) -> dict[str, Any]:
        """Sauvegarde un ICD et met à jour l'index global."""
        # 1. Sauvegarder le fichier JSON dédié
        icd_path = self.save_icd_file(entry)
        relative_path = str(icd_path.relative_to(self.icd_dir))

        # 2. Mettre à jour l'index global
        index = self.load_index()

        index_entry = {
            "icd_id": entry["icd_id"],
            "ied_type": entry["ied_type"],
            "ied_type_attr": entry.get("ied_type_attr", ""),  # Attribut type original de l'IED
            "manufacturer": entry["manufacturer"],
            "version": entry["version"],
            "filename": entry["filename"],
            "path": relative_path,
            "ld_count": entry["ld_count"],
            "ln_count": entry["ln_count"],
            "imported_at": entry["imported_at"]
        }

        # Chercher si existe déjà (même icd_id = même filename)
        existing_idx = next(
            (i for i, x in enumerate(index["icd_list"])
             if x["icd_id"] == entry["icd_id"]),
            None
        )

        if existing_idx is not None:
            index["icd_list"][existing_idx] = index_entry
        else:
            index["icd_list"].append(index_entry)

        self.save_index(index)
        return index_entry

    def import_icd(self, file_path: Path) -> list[dict[str, Any]]:
        """Importe un fichier ICD : parse, sauvegarde JSON individuel, met à jour l'index."""
        entries = self.parse_file(file_path)
        results = []
        for entry in entries:
            index_entry = self.upsert_entry(entry)
            results.append(index_entry)
            print(f"📁 ICD sauvegardé: {index_entry['path']}")
        return results

    def get_catalog(self) -> list[dict[str, Any]]:
        """Retourne le catalogue complet (index global)."""
        index = self.load_index()
        return index.get("icd_list", [])

    def get_icd_details(self, filename: str) -> dict[str, Any] | None:
        """Charge les détails complets d'un ICD depuis son fichier."""
        return self.load_icd_file(filename)

    def get_icd_details_by_id(self, icd_id: str) -> dict[str, Any] | None:
        """Charge les détails d'un ICD par son icd_id (cherche dans l'index puis charge)."""
        catalog = self.get_catalog()
        entry = next((x for x in catalog if x["icd_id"] == icd_id), None)
        if entry:
            return self.load_icd_file(entry["filename"])
        return None

    def get_ied_types(self) -> list[str]:
        """Retourne la liste des types d'IED dans le catalogue."""
        catalog = self.get_catalog()
        return sorted(set(entry["ied_type"] for entry in catalog))

    def get_manufacturers(self) -> list[str]:
        """Retourne la liste des constructeurs dans le catalogue."""
        catalog = self.get_catalog()
        return sorted(set(entry["manufacturer"] for entry in catalog))

    def delete_icd(self, icd_id: str) -> bool:
        """Supprime un ICD par son icd_id (fichier + entrée dans l'index)."""
        # Trouver l'entrée dans l'index
        index = self.load_index()
        entry = next((x for x in index["icd_list"] if x["icd_id"] == icd_id), None)

        if not entry:
            return False

        # Supprimer le fichier
        icd_path = self._get_icd_path(entry["filename"])
        if icd_path.exists():
            icd_path.unlink()

        # Supprimer de l'index
        original_count = len(index["icd_list"])
        index["icd_list"] = [x for x in index["icd_list"] if x["icd_id"] != icd_id]

        if len(index["icd_list"]) < original_count:
            self.save_index(index)
            return True
        return False

    def get_versions_for_type(self, ied_type: str, manufacturer: str) -> list[dict[str, Any]]:
        """Retourne toutes les versions pour un type/manufacturer donné."""
        catalog = self.get_catalog()
        return [
            entry for entry in catalog
            if entry["ied_type"] == ied_type and entry["manufacturer"] == manufacturer
        ]


# --- Utilitaire CLI ---

if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python icd_parser.py <fichier.icd>")
        sys.exit(1)

    parser = ICDParser()
    file_path = Path(sys.argv[1])

    if not file_path.exists():
        print(f"❌ Fichier introuvable: {file_path}")
        sys.exit(1)

    try:
        results = parser.import_icd(file_path)
        print(f"✅ {len(results)} ICD importé(s)")
        for card in results:
            print(f"   - {card['icd_id']} ({len(card['versions'])} version(s))")
    except ValueError as e:
        print(f"❌ Erreur: {e}")
        sys.exit(1)
