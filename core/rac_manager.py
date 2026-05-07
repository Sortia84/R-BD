# core/rac_manager.py
"""
Gestionnaire de fichiers RAC (Raccordements).

Rôle :
  - Importer des fichiers RAC dans le catalogue R#BD
  - Indexer les fichiers RAC importés (métadonnées, date d'import)
  - Fournir les opérations CRUD sur le catalogue RAC
  - Persister les données dans RAC_DATA_DIR / index.json

Un fichier RAC contient généralement les informations de raccordement
entre les équipements IED et les tranches d'un poste IEC 61850.

Architecture :
    - Le classeur RAC est d'abord validé (onglet 'RAC' requis)
    - Le fichier brut importé est copié dans uploads/rac/
    - Le JSON normalisé est stocké dans data/rac/files/
    - Les métadonnées/synthèses sont stockées dans data/rac/index.json
  - Les routes API (router_rac.py) délèguent le traitement à cette classe
"""

from __future__ import annotations

import json
import logging
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from core.rac_excel_parser import RACExcelParser

logger = logging.getLogger("RAC[Manager]")


class RACManager:
    """
    Gestionnaire du catalogue de fichiers RAC.

    Responsabilités :
      - Stocker et charger l'index des RAC (data/rac/index.json)
      - Gérer des catégories RAC métier (Ligne/CBO/TG)
      - Gérer le versioning par groupe RAC (rac_key)
      - Copier les fichiers importés (uploads/rac/)
      - Exposer des données de liaison câblage pour R#SCD (bayview)
      - Fournir les opérations CRUD (list, get, add, delete)
    """

    DEFAULT_CATEGORY_ID = "rac_ligne_d"
    DEFAULT_CATEGORIES: List[Dict[str, str]] = [
        {
            "id": "rac_ligne_d",
            "name": "RAC Ligne \"d\"",
            "description": "Cablage theorique RAC pour lignes d'alimentation et depart.",
        },
        {
            "id": "rac_cbo_d",
            "name": "RAC CBO \"d\"",
            "description": "Cablage theorique RAC pour armoires CBO.",
        },
        {
            "id": "rac_tg_d",
            "name": "RAC TG \"d\"",
            "description": "Cablage theorique RAC pour armoires TG.",
        },
    ]

    def __init__(self, data_dir: Path, uploads_dir: Path) -> None:
        """
        Initialiser le gestionnaire RAC.

        Args:
            data_dir: Répertoire de persistance (contient data/rac/)
            uploads_dir: Répertoire des fichiers uploadés
        """
        # Répertoire de l'index et des métadonnées
        self.rac_data_dir = data_dir / "rac"
        self.rac_data_dir.mkdir(parents=True, exist_ok=True)

        # Répertoire de stockage des fichiers bruts importés
        self.rac_uploads_dir = uploads_dir / "rac"
        self.rac_uploads_dir.mkdir(parents=True, exist_ok=True)

        # Répertoire de stockage des JSON normalisés issus du parsing RAC
        self.rac_files_dir = self.rac_data_dir / "files"
        self.rac_files_dir.mkdir(parents=True, exist_ok=True)

        # Chemin du fichier d'index
        self.index_path = self.rac_data_dir / "index.json"
        self.categories_path = self.rac_data_dir / "categories.json"

        # Initialiser les catégories standard si absentes
        self._init_categories()

        # Charger l'index existant
        self.catalog: List[Dict[str, Any]] = self._load_index()
        self.parser = RACExcelParser()
        logger.info("[RAC][Init] %d fichier(s) RAC dans le catalogue", len(self.catalog))

    # ========================================================================
    # PERSISTANCE — Lecture / écriture de l'index
    # ========================================================================

    def _load_index(self) -> List[Dict[str, Any]]:
        """
        Charger l'index des RAC depuis le fichier JSON.

        Returns:
            Liste des entrées RAC (dictionnaires)
        """
        if not self.index_path.exists():
            return []

        try:
            content = self.index_path.read_text(encoding="utf-8")
            data = json.loads(content)
            if not isinstance(data, list):
                return []

            # Migration douce: normaliser les anciennes entrées RAC
            normalized: List[Dict[str, Any]] = []
            for entry in data:
                if isinstance(entry, dict):
                    normalized.append(self._normalize_catalog_entry(entry))
            return normalized
        except (json.JSONDecodeError, IOError) as exc:
            logger.error("[RAC][Index] Erreur lecture index : %s", exc)
            return []

    def _save_index(self) -> None:
        """
        Sauvegarder l'index des RAC dans le fichier JSON.
        """
        try:
            self.index_path.write_text(
                json.dumps(self.catalog, indent=2, ensure_ascii=False),
                encoding="utf-8"
            )
            logger.info("[RAC][Index] Index sauvegardé (%d entrées)", len(self.catalog))
        except IOError as exc:
            logger.error("[RAC][Index] Erreur écriture index : %s", exc)

    def _init_categories(self) -> None:
        """Créer le fichier categories.json avec les catégories métier par défaut."""
        if self.categories_path.exists():
            return

        payload = {
            "version": "1.0",
            "updated_at": datetime.now().isoformat(),
            "categories": self.DEFAULT_CATEGORIES,
        }
        self.categories_path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )

    def _load_categories(self) -> List[Dict[str, str]]:
        """Charger les catégories RAC depuis categories.json."""
        try:
            content = self.categories_path.read_text(encoding="utf-8")
            data = json.loads(content)
            categories = data.get("categories", []) if isinstance(data, dict) else []
            return [c for c in categories if isinstance(c, dict) and c.get("id")]
        except (IOError, json.JSONDecodeError):
            # Fallback robuste
            return self.DEFAULT_CATEGORIES

    def _normalize_catalog_entry(self, entry: Dict[str, Any]) -> Dict[str, Any]:
        """
        Garantir les champs standards sur une entrée de catalogue RAC.

        Utile pour la rétrocompatibilité des imports historiques.
        """
        metadata = entry.get("metadata", {}) if isinstance(entry.get("metadata", {}), dict) else {}
        filename = str(entry.get("filename", ""))

        category_id = str(entry.get("category_id") or metadata.get("category_id") or "").strip()
        if not category_id:
            category_id = self._infer_category_from_filename(filename)

        rac_key = str(entry.get("rac_key") or metadata.get("rac_key") or "").strip()
        if not rac_key:
            rac_key = self._build_rac_key(filename)

        version_label = str(entry.get("version") or metadata.get("version") or "").strip()
        if not version_label:
            version_label = self._extract_version_from_filename(filename)

        version_rank = entry.get("version_rank", metadata.get("version_rank", 0))
        try:
            version_rank_int = int(version_rank)
        except (TypeError, ValueError):
            version_rank_int = 0

        entry["category_id"] = category_id
        entry["rac_key"] = rac_key
        entry["version"] = version_label
        entry["version_rank"] = version_rank_int

        metadata["category_id"] = category_id
        metadata["rac_key"] = rac_key
        metadata["version"] = version_label
        metadata["version_rank"] = version_rank_int
        entry["metadata"] = metadata

        return entry

    def _build_rac_key(self, filename: str) -> str:
        """Construire une clé logique stable pour grouper les versions RAC."""
        stem = Path(filename).stem
        lowered = stem.lower()

        # Nettoyage de versions explicites: v15, version_12, rev3, r02...
        lowered = re.sub(r"(?:^|[ _\-])(version|ver|v)[ _\-]*\d+[a-z]?", "", lowered)
        lowered = re.sub(r"(?:^|[ _\-])(revision|rev|r)[ _\-]*\d+[a-z]?", "", lowered)
        lowered = re.sub(r"[^a-z0-9]+", "_", lowered)
        lowered = re.sub(r"_+", "_", lowered).strip("_")

        return lowered or "rac_unknown"

    def _extract_version_from_filename(self, filename: str) -> str:
        """Déduire un libellé de version depuis le nom de fichier."""
        stem = Path(filename).stem
        match = re.search(r"(?i)(?:version|ver|v)[ _\-]*(\d+[a-z]?)", stem)
        if match:
            return f"v{match.group(1).upper()}"

        match_rev = re.search(r"(?i)(?:revision|rev|r)[ _\-]*(\d+[a-z]?)", stem)
        if match_rev:
            return f"rev{match_rev.group(1).upper()}"

        return "vNA"

    def _extract_version_rank(self, version_label: str) -> int:
        """Créer un rang numérique pour trier rapidement les versions."""
        nums = re.findall(r"\d+", version_label)
        if not nums:
            return 0
        try:
            return int(nums[0])
        except ValueError:
            return 0

    def _infer_category_from_filename(self, filename: str) -> str:
        """Déduire une catégorie RAC par nom de fichier (fallback rétrocompat)."""
        name = filename.lower()
        if "cbo" in name:
            return "rac_cbo_d"
        if re.search(r"\btg\b", name):
            return "rac_tg_d"
        return self.DEFAULT_CATEGORY_ID

    def _get_category_name(self, category_id: str) -> str:
        """Retourner le libellé de catégorie depuis son identifiant."""
        for category in self._load_categories():
            if category.get("id") == category_id:
                return str(category.get("name", category_id))
        return category_id

    # ========================================================================
    # OPÉRATIONS CRUD
    # ========================================================================

    def list_all(self) -> List[Dict[str, Any]]:
        """
        Lister tous les fichiers RAC du catalogue.

        Returns:
            Liste complète des entrées RAC
        """
        return sorted(self.catalog, key=lambda x: x.get("imported_at", ""), reverse=True)

    def list_grouped(self, category_id: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Lister les RAC groupés par clé logique (rac_key) et catégorie.

        Returns:
            Liste de groupes avec leurs versions triées (plus récente d'abord).
        """
        grouped: Dict[str, Dict[str, Any]] = {}

        for entry in self.list_all():
            entry_cat = str(entry.get("category_id", ""))
            if category_id and entry_cat != category_id:
                continue

            group_id = f"{entry_cat}:{entry.get('rac_key', '')}"
            if group_id not in grouped:
                grouped[group_id] = {
                    "group_id": group_id,
                    "category_id": entry_cat,
                    "category_name": self._get_category_name(entry_cat),
                    "rac_key": entry.get("rac_key", ""),
                    "versions": [],
                }

            grouped[group_id]["versions"].append(entry)

        groups = list(grouped.values())
        for group in groups:
            group["versions"] = sorted(
                group["versions"],
                key=lambda x: (x.get("version_rank", 0), x.get("imported_at", "")),
                reverse=True,
            )
            group["latest"] = group["versions"][0] if group["versions"] else None
            group["version_count"] = len(group["versions"])

        groups.sort(key=lambda g: g.get("group_id", ""))
        return groups

    def get_by_id(self, rac_id: str) -> Optional[Dict[str, Any]]:
        """
        Récupérer un fichier RAC par son identifiant.

        Args:
            rac_id: Identifiant unique du RAC

        Returns:
            Entrée RAC ou None si introuvable
        """
        for entry in self.catalog:
            if entry.get("id") == rac_id:
                return entry
        return None

    def get_versions(self, category_id: str, rac_key: str) -> List[Dict[str, Any]]:
        """Retourner les versions disponibles pour un groupe RAC donné."""
        versions = [
            entry
            for entry in self.catalog
            if entry.get("category_id") == category_id and entry.get("rac_key") == rac_key
        ]
        return sorted(
            versions,
            key=lambda x: (x.get("version_rank", 0), x.get("imported_at", "")),
            reverse=True,
        )

    def get_categories(self) -> List[Dict[str, str]]:
        """Retourner les catégories RAC configurées."""
        return self._load_categories()

    def get_parsed_payload(self, rac_id: str) -> Optional[Dict[str, Any]]:
        """
        Charger le JSON parsé d'un RAC à partir de son rac_id.

        Compatibilité:
        - Si l'entrée est historique (avant parser RAC), on tente un parsing
          à la volée depuis uploads/rac puis on persiste le JSON normalisé.
        """
        entry = self.get_by_id(rac_id)
        if not entry:
            return None

        parsed_rel = entry.get("metadata", {}).get("parsed_json_path", "")
        if parsed_rel:
            parsed_path = self.rac_data_dir / parsed_rel
            if parsed_path.exists():
                try:
                    content = parsed_path.read_text(encoding="utf-8")
                    parsed_payload = json.loads(content)
                    if parsed_payload.get("parser_version") == self.parser.PARSER_VERSION:
                        return parsed_payload
                    logger.info(
                        "[RAC][Parsed] Regeneration requise pour %s (version parser %s -> %s)",
                        rac_id,
                        parsed_payload.get("parser_version", "inconnue"),
                        self.parser.PARSER_VERSION,
                    )
                except (IOError, json.JSONDecodeError):
                    # On retentera via fallback plus bas.
                    pass

        # Fallback rétrocompatibilité: parser à la volée depuis le fichier upload.
        stored_rel = entry.get("stored_path", "")
        if not stored_rel:
            return None

        upload_path = self.rac_uploads_dir / stored_rel
        if not upload_path.exists():
            return None

        try:
            file_content = upload_path.read_bytes()
            parsed_payload = self.parser.parse(
                filename=str(entry.get("filename", upload_path.name)),
                file_content=file_content,
            )

            parsed_json_path = self.rac_files_dir / f"{entry.get('id', rac_id)}.json"
            parsed_json_path.write_text(
                json.dumps(parsed_payload, indent=2, ensure_ascii=False),
                encoding="utf-8",
            )

            summary = parsed_payload.get("summary", {})
            source = parsed_payload.get("source", {})

            metadata = entry.get("metadata", {}) if isinstance(entry.get("metadata", {}), dict) else {}
            metadata["parsed_json_path"] = str(parsed_json_path.relative_to(self.rac_data_dir))
            metadata["sheet_name"] = source.get("sheet_name", metadata.get("sheet_name", ""))
            metadata["rows_parsed"] = summary.get("rows_parsed", metadata.get("rows_parsed", 0))
            metadata["rows_skipped"] = summary.get("rows_skipped", metadata.get("rows_skipped", 0))
            metadata["equipment_group_count"] = summary.get(
                "equipment_group_count",
                metadata.get("equipment_group_count", 0),
            )
            entry["metadata"] = metadata

            # Persister mise à jour index pour ne pas re-parser à chaque appel.
            self._save_index()

            logger.info("[RAC][Parsed] Fallback parsing réussi pour %s", rac_id)
            return parsed_payload
        except Exception as exc:
            logger.error("[RAC][Parsed] Echec fallback parsing pour %s: %s", rac_id, exc)
            return None

    def _find_latest(
        self,
        category_id: Optional[str] = None,
        rac_key: Optional[str] = None,
    ) -> Optional[Dict[str, Any]]:
        """Trouver la version la plus récente selon catégorie/groupe."""
        candidates = self.catalog
        if category_id:
            candidates = [e for e in candidates if e.get("category_id") == category_id]
        if rac_key:
            candidates = [e for e in candidates if e.get("rac_key") == rac_key]

        if not candidates:
            return None

        candidates = sorted(
            candidates,
            key=lambda x: (x.get("version_rank", 0), x.get("imported_at", "")),
            reverse=True,
        )
        return candidates[0]

    def get_link_map(
        self,
        rac_id: Optional[str] = None,
        category_id: Optional[str] = None,
        rac_key: Optional[str] = None,
        latest: bool = True,
        signal_label: Optional[str] = None,
        signal_type: Optional[str] = None,
        terminal_name: Optional[str] = None,
        equipment_type: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Construire un index de liens câblage exploitable par R#SCD/BayView.

        Le payload expose chaque record RAC en forme "flat" pour faciliter
        les rapprochements I/O configurés dans le SCD avec le câblage théorique.
        """
        target_entry: Optional[Dict[str, Any]] = None

        if rac_id:
            target_entry = self.get_by_id(rac_id)
        elif latest:
            target_entry = self._find_latest(category_id=category_id, rac_key=rac_key)

        if not target_entry:
            return {
                "source": None,
                "count": 0,
                "links": [],
            }

        parsed = self.get_parsed_payload(str(target_entry.get("id", "")))
        if not parsed:
            return {
                "source": target_entry,
                "count": 0,
                "links": [],
            }

        records = parsed.get("records", []) if isinstance(parsed, dict) else []
        links: List[Dict[str, Any]] = []

        for record in records:
            if not isinstance(record, dict):
                continue

            terminal_board = record.get("terminal_board", {})
            intermediate = record.get("intermediate_path", {})
            connections = record.get("equipment_connections", [])

            base_link = {
                "rac_id": target_entry.get("id", ""),
                "category_id": target_entry.get("category_id", ""),
                "category_name": self._get_category_name(str(target_entry.get("category_id", ""))),
                "rac_key": target_entry.get("rac_key", ""),
                "version": target_entry.get("version", ""),
                "excel_row": record.get("excel_row"),
                "terminal_board_name": terminal_board.get("name", ""),
                "terminal_board_terminal": terminal_board.get("terminal", ""),
                "signal_label": terminal_board.get("signal_label", ""),
                "signal_type": terminal_board.get("signal_type", ""),
                "polarity_name": terminal_board.get("polarity_name", ""),
                "source": intermediate.get("source", ""),
                "polarity_origin": intermediate.get("polarity_origin", ""),
                "female_socket": intermediate.get("female_socket", ""),
                "socket_index": intermediate.get("socket_index", ""),
                "socket_terminal": intermediate.get("socket_terminal", ""),
                "target_equipment_types": record.get("target_equipment_types", []),
            }

            if not connections:
                links.append(base_link)
                continue

            for conn in connections:
                item = dict(base_link)
                item.update(
                    {
                        "equipment_header": conn.get("equipment_header", ""),
                        "equipment_type": conn.get("equipment_type", ""),
                        "equipment_vendor": conn.get("vendor", ""),
                        "card_number": conn.get("card_number", ""),
                        "card_terminal": conn.get("card_terminal", ""),
                    }
                )
                links.append(item)

        # Filtres de recherche rapides (usage fréquent côté BayView)
        def _contains(value: str, needle: Optional[str]) -> bool:
            if not needle:
                return True
            return needle.lower() in str(value).lower()

        filtered = [
            link
            for link in links
            if _contains(link.get("signal_label", ""), signal_label)
            and _contains(link.get("signal_type", ""), signal_type)
            and _contains(link.get("terminal_board_name", ""), terminal_name)
            and _contains(link.get("equipment_type", ""), equipment_type)
        ]

        return {
            "source": {
                "rac_id": target_entry.get("id", ""),
                "category_id": target_entry.get("category_id", ""),
                "rac_key": target_entry.get("rac_key", ""),
                "version": target_entry.get("version", ""),
                "sheet_name": target_entry.get("metadata", {}).get("sheet_name", ""),
            },
            "count": len(filtered),
            "links": filtered,
        }

    def _extract_equipment_family(
        self,
        target_equipment_types: List[str],
        equipment_connections: List[Dict[str, Any]],
    ) -> str:
        """
        Déduire une famille d'équipement métier stable pour la vue RAC.

        La vue frontend a besoin d'un premier niveau de regroupement lisible.
        On privilégie les connexions équipements réellement résolues, puis la
        colonne AE (`target_equipment_types`) si aucune connexion détaillée
        n'est disponible.
        """
        for connection in equipment_connections:
            equipment_type = str(connection.get("equipment_type", "")).strip()
            if equipment_type:
                return equipment_type.upper()

        for target in target_equipment_types:
            normalized = str(target).strip().upper()
            if not normalized:
                continue

            family = re.sub(r"\d+$", "", normalized).strip()
            if family:
                return family

        return "SANS_EQUIPEMENT"

    def _build_inspection_status(
        self,
        target_equipment_types: List[str],
        equipment_connections: List[Dict[str, Any]],
        intermediate_path: Dict[str, Any],
    ) -> Dict[str, str]:
        """
        Calculer un statut métier lisible pour l'inspection d'un record RAC.

        Ce statut ne cherche pas à "corriger" la donnée. Il vise uniquement à
        aider l'utilisateur à distinguer :
        - une liaison complète ;
        - une liaison partielle à vérifier ;
        - une terminaison explicitement marquée "non traité" ;
        - une ligne sans terminaison exploitable.
        """
        has_targets = bool(target_equipment_types)
        has_connections = bool(equipment_connections)
        has_intermediate = any(
            [
                intermediate_path.get("source", ""),
                intermediate_path.get("female_socket", ""),
                intermediate_path.get("socket_terminal", ""),
                intermediate_path.get("embases", []),
            ]
        )

        has_non_treated = any(
            str(connection.get(field, "")).strip().lower() == "non traité"
            for connection in equipment_connections
            for field in ("card_number", "card_type", "card_terminal")
        )

        if has_non_treated:
            return {
                "code": "non_traite",
                "label": "Non traité",
                "tone": "warning",
                "reason": "Une terminaison équipement est présente mais marquée non traité.",
            }

        if has_connections:
            return {
                "code": "complet",
                "label": "Complet",
                "tone": "success",
                "reason": "Le chemin intermédiaire et la terminaison équipement sont disponibles.",
            }

        if has_targets or has_intermediate:
            return {
                "code": "a_verifier",
                "label": "À vérifier",
                "tone": "warning",
                "reason": "La liaison porte une cible ou un chemin intermédiaire, mais sans terminaison détaillée.",
            }

        return {
            "code": "sans_terminaison",
            "label": "Sans terminaison",
            "tone": "neutral",
            "reason": "La ligne est parsée mais ne contient pas de terminaison exploitable côté équipement.",
        }

    def _safe_numeric_sort_value(self, raw_value: Any) -> int:
        """Extraire une valeur numérique de tri depuis une chaîne métier."""
        text = str(raw_value or "").strip()
        match = re.search(r"\d+", text)
        if not match:
            return 999999
        try:
            return int(match.group(0))
        except ValueError:
            return 999999

    def _build_inspection_record(
        self,
        record: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Normaliser un record RAC pour la vue d'inspection.

        On conserve les blocs métier originaux (`terminal_board`,
        `intermediate_path`, `equipment_connections`, `raw`), tout en ajoutant
        des champs de navigation pour l'IHM : regroupement, tri, statut,
        libellés synthétiques et compteurs.
        """
        excel_row = int(record.get("excel_row", 0) or 0)
        track_id = f"row-{excel_row}"

        terminal_board = record.get("terminal_board", {}) if isinstance(record.get("terminal_board", {}), dict) else {}
        intermediate_path = record.get("intermediate_path", {}) if isinstance(record.get("intermediate_path", {}), dict) else {}
        target_equipment_types = [str(item) for item in record.get("target_equipment_types", []) if str(item).strip()]
        equipment_connections = [
            item for item in record.get("equipment_connections", [])
            if isinstance(item, dict)
        ]

        equipment_family = self._extract_equipment_family(target_equipment_types, equipment_connections)
        block_label = (
            str(intermediate_path.get("female_socket", "")).strip()
            or str(intermediate_path.get("source", "")).strip()
            or "Sans chemin intermédiaire"
        )
        board_name = str(terminal_board.get("name", "")).strip() or "Sans bornier"
        terminal_number = str(terminal_board.get("terminal", "")).strip()
        status = self._build_inspection_status(
            target_equipment_types=target_equipment_types,
            equipment_connections=equipment_connections,
            intermediate_path=intermediate_path,
        )

        # La ligne de suivi synthétique sert à la fois à la vue tableau et à
        # la mise en forme type "borniers" inspirée de R#SCD.
        return {
            "track_id": track_id,
            "excel_row": excel_row,
            "equipment_family": equipment_family,
            "block_label": block_label,
            "board_name": board_name,
            "board_key": f"{equipment_family}|{block_label}|{board_name}",
            "terminal_sort": self._safe_numeric_sort_value(terminal_number),
            "terminal_board": terminal_board,
            "intermediate_path": intermediate_path,
            "target_equipment_types": target_equipment_types,
            "equipment_connections": equipment_connections,
            "options": record.get("options", []),
            "revision_tag": str(record.get("revision_tag", "")).strip(),
            "raw": record.get("raw", {}),
            "signal_label": str(terminal_board.get("signal_label", "")).strip(),
            "signal_type": str(terminal_board.get("signal_type", "")).strip(),
            "polarity_name": str(terminal_board.get("polarity_name", "")).strip(),
            "terminal_number": terminal_number,
            "source_label": str(intermediate_path.get("source", "")).strip(),
            "female_socket": str(intermediate_path.get("female_socket", "")).strip(),
            "socket_terminal": str(intermediate_path.get("socket_terminal", "")).strip(),
            "socket_index": str(intermediate_path.get("socket_index", "")).strip(),
            "embase_count": len(intermediate_path.get("embases", []) or []),
            "connection_count": len(equipment_connections),
            "status": status,
        }

    def get_inspection_payload(self, rac_id: str) -> Optional[Dict[str, Any]]:
        """
        Construire un payload d'inspection orienté IHM pour un RAC.

        Le payload est volontairement plus structuré que le JSON parsé brut.
        Il conserve les données normalisées, puis ajoute :
        - des enregistrements enrichis pour la navigation ;
        - une vue hiérarchique de type "borniers" ;
        - des compteurs de qualité utiles à la vérification du parser.
        """
        entry = self.get_by_id(rac_id)
        if not entry:
            return None

        parsed = self.get_parsed_payload(rac_id)
        if not parsed or not isinstance(parsed, dict):
            return None

        source = parsed.get("source", {}) if isinstance(parsed.get("source", {}), dict) else {}
        summary = parsed.get("summary", {}) if isinstance(parsed.get("summary", {}), dict) else {}
        headers = parsed.get("headers", {}) if isinstance(parsed.get("headers", {}), dict) else {}
        equipment_groups = parsed.get("equipment_groups", []) if isinstance(parsed.get("equipment_groups", []), list) else []
        parsed_records = parsed.get("records", []) if isinstance(parsed.get("records", []), list) else []

        inspection_records = [
            self._build_inspection_record(record)
            for record in parsed_records
            if isinstance(record, dict)
        ]

        groups_map: Dict[str, Dict[str, Any]] = {}
        complete_count = 0
        to_check_count = 0
        non_treated_count = 0
        without_connection_count = 0

        for record in inspection_records:
            status_code = record.get("status", {}).get("code", "")
            if status_code == "complet":
                complete_count += 1
            elif status_code == "non_traite":
                non_treated_count += 1
            elif status_code == "a_verifier":
                to_check_count += 1
            else:
                without_connection_count += 1

            group_key = str(record.get("equipment_family", "SANS_EQUIPEMENT"))
            block_key = str(record.get("block_label", "Sans chemin intermédiaire"))
            board_key = str(record.get("board_key", ""))

            if group_key not in groups_map:
                groups_map[group_key] = {
                    "group_key": group_key,
                    "group_label": group_key.replace("_", " "),
                    "record_count": 0,
                    "blocks": {},
                }

            group_entry = groups_map[group_key]
            group_entry["record_count"] += 1

            if block_key not in group_entry["blocks"]:
                group_entry["blocks"][block_key] = {
                    "block_key": block_key,
                    "block_label": block_key,
                    "record_count": 0,
                    "boards": {},
                }

            block_entry = group_entry["blocks"][block_key]
            block_entry["record_count"] += 1

            if board_key not in block_entry["boards"]:
                block_entry["boards"][board_key] = {
                    "board_key": board_key,
                    "board_name": record.get("board_name", "Sans bornier"),
                    "record_count": 0,
                    "entries": [],
                }

            board_entry = block_entry["boards"][board_key]
            board_entry["record_count"] += 1
            board_entry["entries"].append(
                {
                    "track_id": record.get("track_id", ""),
                    "excel_row": record.get("excel_row", 0),
                    "terminal_number": record.get("terminal_number", ""),
                    "terminal_sort": record.get("terminal_sort", 999999),
                    "signal_label": record.get("signal_label", ""),
                    "signal_type": record.get("signal_type", ""),
                    "ref_label": record.get("socket_terminal", "") or record.get("signal_type", "") or "—",
                    "info_label": record.get("signal_label", "") or "—",
                    "status": record.get("status", {}),
                    "connection_count": record.get("connection_count", 0),
                }
            )

        groups: List[Dict[str, Any]] = []
        for group_key in sorted(groups_map.keys()):
            group_entry = groups_map[group_key]
            block_values: List[Dict[str, Any]] = []

            for block_key in sorted(group_entry["blocks"].keys(), key=lambda value: str(value).lower()):
                block_entry = group_entry["blocks"][block_key]
                board_values: List[Dict[str, Any]] = []

                for board_key in sorted(block_entry["boards"].keys(), key=lambda value: str(block_entry["boards"][value]["board_name"]).lower()):
                    board_entry = block_entry["boards"][board_key]
                    board_entry["entries"] = sorted(
                        board_entry["entries"],
                        key=lambda item: (item.get("terminal_sort", 999999), item.get("excel_row", 0)),
                    )
                    board_values.append(board_entry)

                block_entry["boards"] = board_values
                block_entry["board_count"] = len(board_values)
                block_values.append(block_entry)

            group_entry["blocks"] = block_values
            group_entry["block_count"] = len(block_values)
            group_entry["board_count"] = sum(block.get("board_count", 0) for block in block_values)
            groups.append(group_entry)

        return {
            "source": {
                "rac_id": entry.get("id", ""),
                "category_id": entry.get("category_id", ""),
                "category_name": self._get_category_name(str(entry.get("category_id", ""))),
                "rac_key": entry.get("rac_key", ""),
                "version": entry.get("version", ""),
                "filename": entry.get("filename", ""),
                "imported_at": entry.get("imported_at", ""),
                "sheet_name": source.get("sheet_name", entry.get("metadata", {}).get("sheet_name", "")),
            },
            "summary": summary,
            "headers": headers,
            "equipment_groups": equipment_groups,
            "inspection_summary": {
                "record_count": len(inspection_records),
                "group_count": len(groups),
                "board_count": sum(group.get("board_count", 0) for group in groups),
                "complete_count": complete_count,
                "to_check_count": to_check_count,
                "non_treated_count": non_treated_count,
                "without_connection_count": without_connection_count,
            },
            "board_schema": {
                "groups": groups,
            },
            "records": inspection_records,
        }

    def add(self, filename: str, file_content: bytes, category_id: str) -> Dict[str, Any]:
        """
        Importer un nouveau fichier RAC dans le catalogue.

        Étapes :
        1. Valider le classeur RAC (onglet contenant 'RAC' obligatoire)
        2. Parser et normaliser les données en JSON métier
        3. Générer un identifiant unique
        4. Copier le fichier dans uploads/rac/
        5. Sauvegarder le JSON normalisé dans data/rac/files/
        6. Ajouter l'entrée à l'index
        7. Persister l'index

        Args:
            filename: Nom du fichier original
            file_content: Contenu binaire du fichier

        Returns:
            Entrée RAC créée (dictionnaire)
        """
        # IMPORTANT:
        # La validation/parsing est volontairement réalisée AVANT écriture disque.
        # Ainsi, un fichier sans onglet RAC n'est ni copié dans uploads/rac/,
        # ni indexé dans data/rac/index.json.
        # Validation catégorie
        valid_ids = {c.get("id", "") for c in self.get_categories()}
        if category_id not in valid_ids:
            raise ValueError(f"Categorie RAC invalide: {category_id}")

        parsed_payload = self.parser.parse(filename=filename, file_content=file_content)

        # Générer un ID unique
        rac_id = f"rac-{uuid.uuid4().hex[:8]}"

        # Assainir le nom de fichier (sécurité — pas de path traversal)
        safe_name = Path(filename).name
        dest_path = self.rac_uploads_dir / f"{rac_id}_{safe_name}"

        # Écrire le fichier sur disque
        dest_path.write_bytes(file_content)
        logger.info("[RAC][Import] Fichier copié : %s", dest_path.name)

        # Sauvegarder le JSON normalisé du RAC.
        parsed_json_path = self.rac_files_dir / f"{rac_id}.json"
        parsed_json_path.write_text(
            json.dumps(parsed_payload, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info("[RAC][Import] JSON parsé sauvegardé : %s", parsed_json_path.name)

        summary = parsed_payload.get("summary", {})
        source = parsed_payload.get("source", {})

        rac_key = self._build_rac_key(safe_name)
        version_label = self._extract_version_from_filename(safe_name)
        version_rank = self._extract_version_rank(version_label)

        # Construire l'entrée du catalogue
        entry: Dict[str, Any] = {
            "id": rac_id,
            "filename": safe_name,
            "stored_path": str(dest_path.relative_to(self.rac_uploads_dir)),
            "size_bytes": len(file_content),
            "imported_at": datetime.now().isoformat(),
            "category_id": category_id,
            "rac_key": rac_key,
            "version": version_label,
            "version_rank": version_rank,
            "metadata": {
                "sheet_name": source.get("sheet_name", ""),
                "rows_parsed": summary.get("rows_parsed", 0),
                "rows_skipped": summary.get("rows_skipped", 0),
                "equipment_group_count": summary.get("equipment_group_count", 0),
                "parsed_json_path": str(parsed_json_path.relative_to(self.rac_data_dir)),
                "revision_saved": True,
                "category_id": category_id,
                "rac_key": rac_key,
                "version": version_label,
                "version_rank": version_rank,
            },
        }

        # Ajouter au catalogue et persister
        self.catalog.append(entry)
        self._save_index()

        logger.info("[RAC][Import] RAC ajouté au catalogue : %s (%s)", rac_id, safe_name)
        return entry

    def delete(self, rac_id: str) -> bool:
        """
        Supprimer un fichier RAC du catalogue et du disque.

        Args:
            rac_id: Identifiant du RAC à supprimer

        Returns:
            True si supprimé, False si introuvable
        """
        entry = self.get_by_id(rac_id)
        if not entry:
            logger.warning("[RAC][Delete] RAC introuvable : %s", rac_id)
            return False

        # Supprimer le fichier physique
        stored_path = self.rac_uploads_dir / entry.get("stored_path", "")
        if stored_path.exists():
            stored_path.unlink()
            logger.info("[RAC][Delete] Fichier supprimé : %s", stored_path.name)

        # Supprimer le JSON parsé associé (si présent)
        parsed_rel = entry.get("metadata", {}).get("parsed_json_path", "")
        if parsed_rel:
            parsed_path = self.rac_data_dir / parsed_rel
            if parsed_path.exists():
                parsed_path.unlink()
                logger.info("[RAC][Delete] JSON parsé supprimé : %s", parsed_path.name)

        # Retirer de l'index
        self.catalog = [e for e in self.catalog if e.get("id") != rac_id]
        self._save_index()

        logger.info("[RAC][Delete] RAC supprimé du catalogue : %s", rac_id)
        return True
