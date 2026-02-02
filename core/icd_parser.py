# icd_parser_v2.py - Parser ICD IEC 61850 COMPLET pour R#BD
"""
Module de parsing complet des fichiers ICD (XML IEC 61850).
Extrait TOUTES les informations : IED, LD, LN, DO, DA, DataSets, Controls, Inputs.

Structure de stockage (1 JSON par ICD) :
  data/icd/{filename_sanitized}.json
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
    return sanitized[:50] or 'unknown'


class ICDParserV2:
    """Parser complet de fichiers ICD IEC 61850."""

    # Mapping des types Private connus par constructeur
    PRIVATE_TYPE_MAPPINGS = {
        # SCLE SFE
        "COMPAS-IEDType": {"category": "ied_type", "desc": "Type IED COMPAS"},
        "SCLE_IDPACK": {"category": "pack_id", "desc": "ID Pack SCLE SFE"},
        # EFACEC
        "Efacec-FirmwareVersion": {"category": "firmware", "desc": "Version firmware Efacec"},
        "Efacec-HardwareVersion": {"category": "hardware", "desc": "Version hardware Efacec"},
        "Efacec-ProductCode": {"category": "product_code", "desc": "Code produit Efacec"},
        # GE / Alstom
        "GE-ProductVersion": {"category": "firmware", "desc": "Version produit GE"},
        "Alstom-ConfigVersion": {"category": "config", "desc": "Version config Alstom"},
        # Siemens
        "Siemens-FirmwareVersion": {"category": "firmware", "desc": "Version firmware Siemens"},
        "Siemens-OrderNumber": {"category": "product_code", "desc": "Numéro commande Siemens"},
        # ABB
        "ABB-ProductVersion": {"category": "firmware", "desc": "Version produit ABB"},
        "ABB-OrderCode": {"category": "product_code", "desc": "Code commande ABB"},
        # Schneider
        "Schneider-FirmwareVersion": {"category": "firmware", "desc": "Version firmware Schneider"},
        # SEL
        "SEL-FirmwareID": {"category": "firmware", "desc": "ID Firmware SEL"},
        # Génériques
        "IEC_61850_EDITION": {"category": "standard", "desc": "Edition IEC 61850"},
    }

    def __init__(self, data_dir: Path | None = None):
        self.data_dir = data_dir or Path(__file__).parent.parent / "data"
        self.icd_dir = self.data_dir / "icd"
        self.index_file = self.icd_dir / "index.json"
        self.icd_dir.mkdir(parents=True, exist_ok=True)

        # Cache pour DataTypeTemplates (rempli lors du parsing)
        self._lnode_types: dict[str, dict] = {}
        self._do_types: dict[str, dict] = {}
        self._da_types: dict[str, dict] = {}
        self._enum_types: dict[str, dict] = {}

    def parse_file(self, file_path: Path) -> list[dict[str, Any]]:
        """Parse un fichier ICD complet et retourne la liste des IED extraits."""
        try:
            tree = etree.parse(str(file_path))
            root = tree.getroot()
        except etree.XMLSyntaxError as e:
            raise ValueError(f"XML invalide: {e}") from e

        # 1. Parser les DataTypeTemplates d'abord (pour résoudre les types)
        self._parse_data_type_templates(root)

        # 2. Parser les IED
        ied_nodes = root.xpath("//scl:IED", namespaces=NSMAP)
        if not ied_nodes:
            raise ValueError("Aucun IED trouvé dans le fichier")

        results = []
        for ied_node in ied_nodes:
            entry = self._parse_ied_node(ied_node, file_path.name)
            # Ajouter les DataTypeTemplates au résultat
            entry["data_type_templates"] = {
                "lnode_types": self._lnode_types,
                "do_types": self._do_types,
                "da_types": self._da_types,
                "enum_types": self._enum_types
            }
            results.append(entry)

        return results

    # ============================================================
    # Parsing DataTypeTemplates
    # ============================================================

    def _parse_data_type_templates(self, root: etree._Element) -> None:
        """Parse la section DataTypeTemplates pour mapper les types."""
        dtt = root.find(".//scl:DataTypeTemplates", namespaces=NSMAP)
        if dtt is None:
            return

        # LNodeType
        for lnt in dtt.findall("scl:LNodeType", namespaces=NSMAP):
            lnt_id = lnt.get("id", "")
            self._lnode_types[lnt_id] = {
                "id": lnt_id,
                "lnClass": lnt.get("lnClass", ""),
                "desc": lnt.get("desc", ""),
                "dos": self._parse_dos_from_lnode_type(lnt)
            }

        # DOType
        for dot in dtt.findall("scl:DOType", namespaces=NSMAP):
            dot_id = dot.get("id", "")
            self._do_types[dot_id] = {
                "id": dot_id,
                "cdc": dot.get("cdc", ""),
                "desc": dot.get("desc", ""),
                "das": self._parse_das_from_do_type(dot),
                "sdos": self._parse_sdos_from_do_type(dot)
            }

        # DAType
        for dat in dtt.findall("scl:DAType", namespaces=NSMAP):
            dat_id = dat.get("id", "")
            self._da_types[dat_id] = {
                "id": dat_id,
                "desc": dat.get("desc", ""),
                "bdas": self._parse_bdas_from_da_type(dat)
            }

        # EnumType
        for ent in dtt.findall("scl:EnumType", namespaces=NSMAP):
            ent_id = ent.get("id", "")
            self._enum_types[ent_id] = {
                "id": ent_id,
                "desc": ent.get("desc", ""),
                "values": self._parse_enum_values(ent)
            }

    def _parse_dos_from_lnode_type(self, lnt: etree._Element) -> list[dict]:
        """Extrait les DO d'un LNodeType."""
        dos = []
        for do_node in lnt.findall("scl:DO", namespaces=NSMAP):
            dos.append({
                "name": do_node.get("name", ""),
                "type": do_node.get("type", ""),
                "desc": do_node.get("desc", ""),
                "transient": do_node.get("transient", "false") == "true"
            })
        return dos

    def _parse_das_from_do_type(self, dot: etree._Element) -> list[dict]:
        """Extrait les DA d'un DOType."""
        das = []
        for da_node in dot.findall("scl:DA", namespaces=NSMAP):
            da = {
                "name": da_node.get("name", ""),
                "bType": da_node.get("bType", ""),
                "fc": da_node.get("fc", ""),
                "type": da_node.get("type", ""),
                "desc": da_node.get("desc", ""),
                "dchg": da_node.get("dchg", "false") == "true",
                "qchg": da_node.get("qchg", "false") == "true",
                "dupd": da_node.get("dupd", "false") == "true",
                "valKind": da_node.get("valKind", ""),
                "valImport": da_node.get("valImport", "false") == "true"
            }
            # Valeur par défaut si présente
            val_node = da_node.find("scl:Val", namespaces=NSMAP)
            if val_node is not None and val_node.text:
                da["defaultVal"] = val_node.text.strip()
            das.append(da)
        return das

    def _parse_sdos_from_do_type(self, dot: etree._Element) -> list[dict]:
        """Extrait les SDO (Sub Data Objects) d'un DOType."""
        sdos = []
        for sdo_node in dot.findall("scl:SDO", namespaces=NSMAP):
            sdos.append({
                "name": sdo_node.get("name", ""),
                "type": sdo_node.get("type", ""),
                "desc": sdo_node.get("desc", ""),
                "count": sdo_node.get("count", "")
            })
        return sdos

    def _parse_bdas_from_da_type(self, dat: etree._Element) -> list[dict]:
        """Extrait les BDA d'un DAType."""
        bdas = []
        for bda_node in dat.findall("scl:BDA", namespaces=NSMAP):
            bda = {
                "name": bda_node.get("name", ""),
                "bType": bda_node.get("bType", ""),
                "type": bda_node.get("type", ""),
                "desc": bda_node.get("desc", ""),
                "valKind": bda_node.get("valKind", "")
            }
            val_node = bda_node.find("scl:Val", namespaces=NSMAP)
            if val_node is not None and val_node.text:
                bda["defaultVal"] = val_node.text.strip()
            bdas.append(bda)
        return bdas

    def _parse_enum_values(self, ent: etree._Element) -> list[dict]:
        """Extrait les valeurs d'un EnumType."""
        values = []
        for ev in ent.findall("scl:EnumVal", namespaces=NSMAP):
            values.append({
                "ord": int(ev.get("ord", "0")),
                "value": (ev.text or "").strip(),
                "desc": ev.get("desc", "")
            })
        return sorted(values, key=lambda x: x["ord"])

    # ============================================================
    # Parsing IED
    # ============================================================

    def _parse_ied_node(self, ied_node: etree._Element, filename: str) -> dict[str, Any]:
        """Parse un noeud IED complet."""
        # Attributs de base
        manufacturer = ied_node.get("manufacturer", "Inconnu")
        ied_type_attr = ied_node.get("type", "UNKNOWN")
        config_version = ied_node.get("configVersion", "")
        desc = ied_node.get("desc", "")
        ied_name = ied_node.get("name", "IED")
        original_scl_version = ied_node.get("originalSclVersion", "")
        original_scl_revision = ied_node.get("originalSclRevision", "")
        original_scl_release = ied_node.get("originalSclRelease", "")

        # Extraire tous les Private
        privates = self._extract_privates(ied_node)

        # Type IED (depuis COMPAS-IEDType ou attribut type)
        compas_type = privates.get("ied_type", {}).get("value", "")
        ied_type = compas_type or ied_type_attr

        # Version display
        version_display = desc or config_version or "Version inconnue"

        # Extraire LDevices complets
        ldevices = self._extract_ldevices(ied_node)

        # Stats
        ld_count = len(ldevices)
        ln_count = sum(len(ld.get("lns", [])) for ld in ldevices)
        do_count = sum(
            sum(len(ln.get("dos", [])) for ln in ld.get("lns", []))
            for ld in ldevices
        )

        # ID unique
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
            # SCL version info
            "scl_info": {
                "original_version": original_scl_version,
                "original_revision": original_scl_revision,
                "original_release": original_scl_release
            },
            # Private elements (firmware, pack, etc.)
            "privates": privates,
            # Structure IED
            "ieds": [{
                "name": ied_name,
                "lds": ldevices
            }],
            # Stats
            "stats": {
                "ld_count": ld_count,
                "ln_count": ln_count,
                "do_count": do_count
            },
            # Legacy (pour compatibilité)
            "ld_count": ld_count,
            "ln_count": ln_count
        }

    def _extract_privates(self, ied_node: etree._Element) -> dict[str, Any]:
        """
        Extrait tous les éléments Private de l'IED.
        Classifie automatiquement selon le type connu ou en 'other'.
        """
        privates: dict[str, Any] = {
            "ied_type": {},
            "pack_id": {},
            "firmware": {},
            "hardware": {},
            "product_code": {},
            "config": {},
            "standard": {},
            "other": []  # Pour les types inconnus
        }

        for private in ied_node.findall("scl:Private", namespaces=NSMAP):
            p_type = private.get("type", "")
            p_value = (private.text or "").strip()

            # Chercher dans le mapping connu
            mapping = self.PRIVATE_TYPE_MAPPINGS.get(p_type)

            if mapping:
                category = mapping["category"]
                privates[category] = {
                    "type": p_type,
                    "value": p_value,
                    "desc": mapping["desc"]
                }
            else:
                # Type inconnu -> ajouter à "other" avec parsing intelligent
                parsed = self._parse_unknown_private(p_type, p_value)
                privates["other"].append(parsed)

        return privates

    def _parse_unknown_private(self, p_type: str, p_value: str) -> dict[str, Any]:
        """
        Parse un Private de type inconnu et tente d'en extraire des infos.
        Détecte les patterns courants (versions, IDs, etc.)
        """
        result = {
            "type": p_type,
            "value": p_value,
            "parsed": {}
        }

        # Détection de patterns dans le type
        type_lower = p_type.lower()

        if "firmware" in type_lower or "fw" in type_lower:
            result["parsed"]["category"] = "firmware"
        elif "hardware" in type_lower or "hw" in type_lower:
            result["parsed"]["category"] = "hardware"
        elif "version" in type_lower:
            result["parsed"]["category"] = "version"
        elif "pack" in type_lower or "idpack" in type_lower:
            result["parsed"]["category"] = "pack_id"
        elif "product" in type_lower or "order" in type_lower:
            result["parsed"]["category"] = "product_code"

        # Parser les valeurs structurées (ex: "3815#SCU-ORG#LIGNE#2.2a#1")
        if "#" in p_value:
            parts = p_value.split("#")
            result["parsed"]["parts"] = parts
            # Essayer d'identifier les parties
            if len(parts) >= 4:
                result["parsed"]["pack_number"] = parts[0]
                result["parsed"]["ied_type"] = parts[1]
                result["parsed"]["variant"] = parts[2]
                result["parsed"]["version"] = parts[3]
                if len(parts) > 4:
                    result["parsed"]["revision"] = parts[4]

        # Détecter les patterns de version (X.Y.Z)
        version_match = re.search(r'(\d+\.\d+(?:\.\d+)?[a-zA-Z]?)', p_value)
        if version_match:
            result["parsed"]["version_detected"] = version_match.group(1)

        return result

    # ============================================================
    # Parsing LDevice
    # ============================================================

    def _extract_ldevices(self, ied_node: etree._Element) -> list[dict[str, Any]]:
        """Extrait les LDevices avec LN, DataSets, Controls, Inputs."""
        ldevices = []

        access_point = ied_node.find(".//scl:AccessPoint/scl:Server", namespaces=NSMAP)
        if access_point is None:
            access_point = ied_node

        ld_nodes = access_point.findall(".//scl:LDevice", namespaces=NSMAP)

        for ld_node in ld_nodes:
            inst = ld_node.get("inst", "")
            desc = ld_node.get("desc", "")

            ld = {
                "name": inst,
                "desc": desc,
                "lns": self._extract_lns(ld_node),
                "datasets": self._extract_datasets(ld_node),
                "gse_controls": self._extract_gse_controls(ld_node),
                "report_controls": self._extract_report_controls(ld_node),
                "sv_controls": self._extract_sv_controls(ld_node),
                "inputs": self._extract_inputs(ld_node)
            }
            ldevices.append(ld)

        return ldevices

    def _extract_lns(self, ld_node: etree._Element) -> list[dict[str, Any]]:
        """Extrait les LN0 et LN avec leurs DO résolus."""
        lns = []

        # LN0
        for ln0 in ld_node.findall("scl:LN0", namespaces=NSMAP):
            ln_entry = self._parse_ln_node(ln0, is_ln0=True)
            lns.append(ln_entry)

        # LN
        for ln in ld_node.findall("scl:LN", namespaces=NSMAP):
            ln_entry = self._parse_ln_node(ln, is_ln0=False)
            lns.append(ln_entry)

        return lns

    def _parse_ln_node(self, ln_node: etree._Element, is_ln0: bool = False) -> dict[str, Any]:
        """Parse un noeud LN ou LN0."""
        ln_class = ln_node.get("lnClass", "LLN0" if is_ln0 else "")
        ln_inst = ln_node.get("inst", "")
        ln_type = ln_node.get("lnType", "")
        prefix = ln_node.get("prefix", "")
        desc = ln_node.get("desc", "")

        # Résoudre les DO depuis LNodeType
        dos = self._resolve_dos_for_ln(ln_type)

        return {
            "ln_class": ln_class,
            "lninst": ln_inst,
            "lnType": ln_type,
            "prefix": prefix,
            "desc": desc,
            "is_ln0": is_ln0,
            "dos": dos
        }

    def _resolve_dos_for_ln(self, ln_type: str) -> list[dict[str, Any]]:
        """Résout les DO pour un LN depuis les DataTypeTemplates."""
        if not ln_type or ln_type not in self._lnode_types:
            return []

        lnt = self._lnode_types[ln_type]
        dos = []

        for do_ref in lnt.get("dos", []):
            do_type_id = do_ref.get("type", "")
            do_type = self._do_types.get(do_type_id, {})

            do_entry = {
                "name": do_ref.get("name", ""),
                "type": do_type_id,
                "desc": do_ref.get("desc", "") or do_type.get("desc", ""),
                "cdc": do_type.get("cdc", ""),
                "transient": do_ref.get("transient", False),
                "das": do_type.get("das", []),
                "sdos": self._resolve_sdos(do_type.get("sdos", []))
            }
            dos.append(do_entry)

        return dos

    def _resolve_sdos(self, sdos: list[dict]) -> list[dict[str, Any]]:
        """Résout récursivement les SDO."""
        resolved = []
        for sdo in sdos:
            sdo_type_id = sdo.get("type", "")
            sdo_type = self._do_types.get(sdo_type_id, {})

            resolved.append({
                "name": sdo.get("name", ""),
                "type": sdo_type_id,
                "desc": sdo.get("desc", "") or sdo_type.get("desc", ""),
                "cdc": sdo_type.get("cdc", ""),
                "das": sdo_type.get("das", []),
                "sdos": self._resolve_sdos(sdo_type.get("sdos", []))  # Récursif
            })
        return resolved

    # ============================================================
    # Parsing DataSets
    # ============================================================

    def _extract_datasets(self, ld_node: etree._Element) -> list[dict[str, Any]]:
        """Extrait les DataSets avec leurs FCDA."""
        datasets = []

        # Les DataSets sont dans LN0
        for ln0 in ld_node.findall("scl:LN0", namespaces=NSMAP):
            for ds in ln0.findall("scl:DataSet", namespaces=NSMAP):
                ds_entry = {
                    "name": ds.get("name", ""),
                    "desc": ds.get("desc", ""),
                    "fcdas": []
                }

                for fcda in ds.findall("scl:FCDA", namespaces=NSMAP):
                    ds_entry["fcdas"].append({
                        "ldInst": fcda.get("ldInst", ""),
                        "prefix": fcda.get("prefix", ""),
                        "lnClass": fcda.get("lnClass", ""),
                        "lnInst": fcda.get("lnInst", ""),
                        "doName": fcda.get("doName", ""),
                        "daName": fcda.get("daName", ""),
                        "fc": fcda.get("fc", ""),
                        "ix": fcda.get("ix", "")
                    })

                datasets.append(ds_entry)

        return datasets

    # ============================================================
    # Parsing Control Blocks
    # ============================================================

    def _extract_gse_controls(self, ld_node: etree._Element) -> list[dict[str, Any]]:
        """Extrait les GSEControl (GOOSE)."""
        controls = []

        for ln0 in ld_node.findall("scl:LN0", namespaces=NSMAP):
            for gse in ln0.findall("scl:GSEControl", namespaces=NSMAP):
                controls.append({
                    "name": gse.get("name", ""),
                    "desc": gse.get("desc", ""),
                    "datSet": gse.get("datSet", ""),
                    "appID": gse.get("appID", ""),
                    "confRev": gse.get("confRev", ""),
                    "type": gse.get("type", "GOOSE"),
                    "fixedOffs": gse.get("fixedOffs", "false") == "true"
                })

        return controls

    def _extract_report_controls(self, ld_node: etree._Element) -> list[dict[str, Any]]:
        """Extrait les ReportControl."""
        controls = []

        for ln0 in ld_node.findall("scl:LN0", namespaces=NSMAP):
            for rpt in ln0.findall("scl:ReportControl", namespaces=NSMAP):
                # TrgOps
                trg_ops = rpt.find("scl:TrgOps", namespaces=NSMAP)
                trg_ops_dict = {}
                if trg_ops is not None:
                    trg_ops_dict = {
                        "dchg": trg_ops.get("dchg", "false") == "true",
                        "qchg": trg_ops.get("qchg", "false") == "true",
                        "dupd": trg_ops.get("dupd", "false") == "true",
                        "period": trg_ops.get("period", "false") == "true",
                        "gi": trg_ops.get("gi", "false") == "true"
                    }

                controls.append({
                    "name": rpt.get("name", ""),
                    "desc": rpt.get("desc", ""),
                    "datSet": rpt.get("datSet", ""),
                    "rptID": rpt.get("rptID", ""),
                    "confRev": rpt.get("confRev", ""),
                    "buffered": rpt.get("buffered", "false") == "true",
                    "bufTime": rpt.get("bufTime", ""),
                    "intgPd": rpt.get("intgPd", ""),
                    "trgOps": trg_ops_dict
                })

        return controls

    def _extract_sv_controls(self, ld_node: etree._Element) -> list[dict[str, Any]]:
        """Extrait les SampledValueControl."""
        controls = []

        for ln0 in ld_node.findall("scl:LN0", namespaces=NSMAP):
            for svc in ln0.findall("scl:SampledValueControl", namespaces=NSMAP):
                controls.append({
                    "name": svc.get("name", ""),
                    "desc": svc.get("desc", ""),
                    "datSet": svc.get("datSet", ""),
                    "smvID": svc.get("smvID", ""),
                    "confRev": svc.get("confRev", ""),
                    "smpRate": svc.get("smpRate", ""),
                    "nofASDU": svc.get("nofASDU", ""),
                    "multicast": svc.get("multicast", "true") == "true"
                })

        return controls

    # ============================================================
    # Parsing Inputs (ExtRef - abonnements GOOSE)
    # ============================================================

    def _extract_inputs(self, ld_node: etree._Element) -> list[dict[str, Any]]:
        """Extrait les Inputs/ExtRef (abonnements)."""
        inputs = []

        # Chercher dans tous les LN
        for ln in ld_node.findall(".//scl:Inputs", namespaces=NSMAP):
            for extref in ln.findall("scl:ExtRef", namespaces=NSMAP):
                inputs.append({
                    "iedName": extref.get("iedName", ""),
                    "ldInst": extref.get("ldInst", ""),
                    "prefix": extref.get("prefix", ""),
                    "lnClass": extref.get("lnClass", ""),
                    "lnInst": extref.get("lnInst", ""),
                    "doName": extref.get("doName", ""),
                    "daName": extref.get("daName", ""),
                    "intAddr": extref.get("intAddr", ""),
                    "serviceType": extref.get("serviceType", ""),
                    "srcLDInst": extref.get("srcLDInst", ""),
                    "srcPrefix": extref.get("srcPrefix", ""),
                    "srcLNClass": extref.get("srcLNClass", ""),
                    "srcLNInst": extref.get("srcLNInst", ""),
                    "srcCBName": extref.get("srcCBName", ""),
                    "desc": extref.get("desc", "")
                })

        return inputs

    # ============================================================
    # Utilitaires
    # ============================================================

    def _build_icd_id(self, ied_type: str, manufacturer: str, config_version: str, desc: str) -> str:
        """Construit un identifiant ICD unique."""
        combined = f"{ied_type}_{manufacturer}_{config_version}_{desc}"
        sanitized = re.sub(r"[^A-Z0-9]+", "_", combined.upper().strip()).strip("_")
        sanitized = re.sub(r"_+", "_", sanitized)
        return f"ICD_{sanitized}" if sanitized else "ICD_UNKNOWN"

    def _get_icd_path(self, filename: str) -> Path:
        """Retourne le chemin du fichier JSON."""
        base_name = Path(filename).stem
        sanitized = sanitize_path(base_name) + ".json"
        return self.icd_dir / sanitized

    # ============================================================
    # Gestion Index et Sauvegarde
    # ============================================================

    def load_index(self) -> dict[str, Any]:
        """Charge l'index global JSON."""
        if not self.index_file.exists():
            return {"icd_list": [], "last_updated": None}
        try:
            with open(self.index_file, "r", encoding="utf-8") as f:
                data = json.load(f)
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
        """Charge un fichier ICD spécifique."""
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
        icd_path = self.save_icd_file(entry)
        relative_path = str(icd_path.relative_to(self.icd_dir))

        index = self.load_index()

        # Extraire les infos importantes des privates pour l'index
        pack_info = entry.get("privates", {}).get("pack_id", {}).get("value", "")
        firmware = entry.get("privates", {}).get("firmware", {}).get("value", "")

        index_entry = {
            "icd_id": entry["icd_id"],
            "ied_type": entry["ied_type"],
            "ied_type_attr": entry.get("ied_type_attr", ""),
            "manufacturer": entry["manufacturer"],
            "version": entry["version"],
            "config_version": entry.get("config_version", ""),
            "filename": entry["filename"],
            "path": relative_path,
            "pack_id": pack_info,
            "firmware": firmware,
            "ld_count": entry.get("stats", {}).get("ld_count", entry.get("ld_count", 0)),
            "ln_count": entry.get("stats", {}).get("ln_count", entry.get("ln_count", 0)),
            "do_count": entry.get("stats", {}).get("do_count", 0),
            "imported_at": entry["imported_at"]
        }

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
        """Importe un fichier ICD complet."""
        entries = self.parse_file(file_path)
        results = []
        for entry in entries:
            index_entry = self.upsert_entry(entry)
            results.append(index_entry)
            print(f"📁 ICD sauvegardé: {index_entry['path']}")
        return results

    def get_catalog(self) -> list[dict[str, Any]]:
        """Retourne le catalogue complet."""
        index = self.load_index()
        return index.get("icd_list", [])

    def get_ied_types(self) -> list[str]:
        """Retourne la liste des types IED uniques."""
        catalog = self.get_catalog()
        types = set()
        for entry in catalog:
            ied_type = entry.get("ied_type", "")
            if ied_type:
                types.add(ied_type)
        return sorted(types)

    def get_manufacturers(self) -> list[str]:
        """Retourne la liste des constructeurs uniques."""
        catalog = self.get_catalog()
        manufacturers = set()
        for entry in catalog:
            manufacturer = entry.get("manufacturer", "")
            if manufacturer:
                manufacturers.add(manufacturer)
        return sorted(manufacturers)

    def get_versions_for_type(self, ied_type: str, manufacturer: str) -> list[dict[str, Any]]:
        """Retourne toutes les versions pour un type IED et constructeur donnés."""
        catalog = self.get_catalog()
        versions = []
        for entry in catalog:
            if (entry.get("ied_type", "").lower() == ied_type.lower() and
                entry.get("manufacturer", "").lower() == manufacturer.lower()):
                versions.append({
                    "icd_id": entry.get("icd_id", ""),
                    "version": entry.get("version", ""),
                    "config_version": entry.get("config_version", ""),
                    "filename": entry.get("filename", ""),
                    "imported_at": entry.get("imported_at", "")
                })
        return sorted(versions, key=lambda x: x.get("version", ""))

    def get_icd_details(self, filename: str) -> dict[str, Any] | None:
        """Charge les détails complets d'un ICD."""
        return self.load_icd_file(filename)

    def get_icd_details_by_id(self, icd_id: str) -> dict[str, Any] | None:
        """Charge les détails d'un ICD par son icd_id."""
        catalog = self.get_catalog()
        entry = next((x for x in catalog if x["icd_id"] == icd_id), None)
        if entry:
            return self.load_icd_file(entry["filename"])
        return None

    def delete_icd(self, icd_id: str) -> bool:
        """Supprime un ICD."""
        index = self.load_index()
        entry = next((x for x in index["icd_list"] if x["icd_id"] == icd_id), None)

        if not entry:
            return False

        icd_path = self._get_icd_path(entry["filename"])
        if icd_path.exists():
            icd_path.unlink()

        original_count = len(index["icd_list"])
        index["icd_list"] = [x for x in index["icd_list"] if x["icd_id"] != icd_id]

        if len(index["icd_list"]) < original_count:
            self.save_index(index)
            return True
        return False

    # ============================================================
    # Gestion des ICD référents (par défaut par type)
    # ============================================================

    def set_default_icd(self, ied_type: str, icd_id: str) -> bool:
        """
        Définit un ICD comme référent pour un type d'IED.
        Un seul ICD peut être référent par type.

        Args:
            ied_type: Type d'IED (ex: "SCU-ORG", "BCU", "SAMU")
            icd_id: ID de l'ICD à définir comme référent

        Returns:
            True si succès, False sinon
        """
        index = self.load_index()

        # Vérifier que l'ICD existe et correspond au type
        target_entry = None
        for entry in index["icd_list"]:
            if entry["icd_id"] == icd_id:
                if entry.get("ied_type") != ied_type:
                    return False  # Type ne correspond pas
                target_entry = entry
                break

        if not target_entry:
            return False

        # Retirer is_default des autres ICD du même type
        for entry in index["icd_list"]:
            if entry.get("ied_type") == ied_type:
                entry["is_default"] = False

        # Définir cet ICD comme référent
        target_entry["is_default"] = True

        self.save_index(index)
        return True

    def get_default_icd(self, ied_type: str) -> dict[str, Any] | None:
        """
        Retourne l'ICD référent pour un type d'IED.

        Args:
            ied_type: Type d'IED (ex: "SCU-ORG", "BCU", "SAMU")

        Returns:
            Les détails complets de l'ICD référent ou None
        """
        index = self.load_index()

        # Chercher l'ICD marqué comme default
        for entry in index["icd_list"]:
            if entry.get("ied_type") == ied_type and entry.get("is_default"):
                return self.get_icd_details_by_id(entry["icd_id"])

        # Fallback: retourner le premier ICD du type
        for entry in index["icd_list"]:
            if entry.get("ied_type") == ied_type:
                return self.get_icd_details_by_id(entry["icd_id"])

        return None

    def get_default_icd_summary(self, ied_type: str) -> dict[str, Any] | None:
        """
        Retourne le résumé (sans détails complets) de l'ICD référent.

        Args:
            ied_type: Type d'IED

        Returns:
            L'entrée index de l'ICD référent ou None
        """
        index = self.load_index()

        for entry in index["icd_list"]:
            if entry.get("ied_type") == ied_type and entry.get("is_default"):
                return entry

        # Fallback
        for entry in index["icd_list"]:
            if entry.get("ied_type") == ied_type:
                return entry

        return None

    def clear_default_icd(self, ied_type: str) -> bool:
        """
        Supprime le marqueur référent pour un type d'IED.

        Args:
            ied_type: Type d'IED

        Returns:
            True si un référent a été supprimé
        """
        index = self.load_index()
        cleared = False

        for entry in index["icd_list"]:
            if entry.get("ied_type") == ied_type and entry.get("is_default"):
                entry["is_default"] = False
                cleared = True

        if cleared:
            self.save_index(index)

        return cleared

    def is_default_icd(self, icd_id: str) -> bool:
        """Vérifie si un ICD est le référent pour son type."""
        index = self.load_index()
        for entry in index["icd_list"]:
            if entry["icd_id"] == icd_id:
                return entry.get("is_default", False)
        return False

    def get_all_defaults(self) -> dict[str, dict]:
        """
        Retourne tous les ICD référents, indexés par type.

        Returns:
            Dict {ied_type: icd_entry}
        """
        index = self.load_index()
        defaults = {}

        for entry in index["icd_list"]:
            ied_type = entry.get("ied_type", "")
            if entry.get("is_default") and ied_type:
                defaults[ied_type] = entry

        return defaults


# Alias pour compatibilité
ICDParser = ICDParserV2


# --- CLI ---
if __name__ == "__main__":
    import sys

    if len(sys.argv) < 2:
        print("Usage: python icd_parser_v2.py <fichier.icd>")
        sys.exit(1)

    parser = ICDParserV2()
    file_path = Path(sys.argv[1])

    if not file_path.exists():
        print(f"❌ Fichier introuvable: {file_path}")
        sys.exit(1)

    try:
        results = parser.import_icd(file_path)
        print(f"✅ {len(results)} ICD importé(s)")
        for card in results:
            print(f"   - {card['icd_id']}")
            print(f"     LDs: {card['ld_count']}, LNs: {card['ln_count']}, DOs: {card['do_count']}")
    except ValueError as e:
        print(f"❌ Erreur: {e}")
        sys.exit(1)
