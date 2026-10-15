"""Catalogue d'équations en lecture seule pour les consommateurs R#SCD.

La version XML fait autorité. Aucun accès GET ne lance d'analyse, ne choisit le
référent ISA par défaut ni ne remplace une version absente par la plus récente.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
from typing import Any
import xml.etree.ElementTree as ET

from .isa_parsers.equation_parser import PARSER_VERSION, SCHEMA_VERSION


API_SCHEMA_VERSION = "1.0"


class EquationCatalogError(Exception):
    """Erreur métier sérialisable, sans chemin local ni détail système."""

    def __init__(self, status: int, code: str, message: str, **context: Any):
        super().__init__(message)
        self.status = status
        self.detail = {"code": code, "message": message, **context}


class EquationCatalog:
    """Expose les analyses ISA complètes dont la provenance est vérifiable."""

    def __init__(self, manager: Any):
        self.manager = manager

    def _source_path(self, entry: dict) -> Path | None:
        """Utilise le helper ISA et vérifie son confinement avant toute lecture.

        Le nom stocké et les types ne doivent pas contenir de segments de chemin.
        Le ``path`` historique du catalogue n'est jamais utilisé comme un chemin
        libre fourni par le client.
        """
        components = [entry.get("filename", ""), *entry.get("type_refs", [])]
        if any(not isinstance(value, str) or not value or
               value in {".", ".."} or re.search(r"[/\\:]", value)
               for value in components):
            return None
        candidate = self.manager._get_file_current_path(entry)
        if candidate is None:
            return None
        resolved = candidate.resolve()
        roots = (self.manager.files_dir.resolve(), self.manager.uploads_dir.resolve())
        if not any(resolved.is_relative_to(root) for root in roots):
            return None
        return resolved if resolved.is_file() else None

    def _read_analysis(self, path: Path) -> dict | None:
        """Une analyse absente, tronquée ou de structure invalide reste obsolète."""
        try:
            roots = (self.manager.files_dir.resolve(), self.manager.uploads_dir.resolve())
            if not any(path.resolve().is_relative_to(root) for root in roots):
                return None
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("metadata"), dict):
                return data
        except (OSError, ValueError, UnicodeError):
            pass
        return None

    @staticmethod
    def _current_analysis(document: dict, digest: str, version: str) -> bool:
        """Vérifie source, version XML, version du parseur et schéma publié."""
        metadata = document["metadata"]
        return (
            metadata.get("source_sha256") == digest
            and metadata.get("numero_version") == version
            and metadata.get("equation_version") == version
            and metadata.get("parser_version") == PARSER_VERSION
            and metadata.get("schema_version") == SCHEMA_VERSION
        )

    def _inspect(self, entry: dict) -> tuple[dict, dict | None]:
        """Calcule l'état d'une entrée sans modifier source, analyse ou catalogue."""
        info = {
            "id": entry.get("id"), "original_name": entry.get("original_name"),
            "equation_version": None, "date_modification": None,
            "source_sha256": None, "parser_version": None,
            "analysis_schema_version": None, "state": "source_missing",
            "validation": None,
        }
        source_path = self._source_path(entry)
        if source_path is None:
            return info, None
        try:
            source = source_path.read_bytes()
            info["source_sha256"] = hashlib.sha256(source).hexdigest()
            if re.search(br"<!\s*(?:DOCTYPE|ENTITY)\b", source.replace(b"\x00", b""), re.I):
                info["state"] = "invalid"
                return info, None
            root = ET.fromstring(source)
            # Les documents XML nommés par namespace suivent le même contrat.
            for node in root.iter():
                if isinstance(node.tag, str):
                    node.tag = node.tag.rsplit("}", 1)[-1]
            info["equation_version"] = (root.findtext("numero_version") or "").strip()
            info["date_modification"] = (root.findtext("date_modification") or "").strip()
        except OSError:
            return info, None
        except (ET.ParseError, ValueError):
            info["state"] = "invalid"
            return info, None

        # Le brut est prioritaire : l'enrichissement RISA n'est pas nécessaire
        # au calcul. Un enrichi peut servir s'il possède la même provenance.
        analyses = [self._read_analysis(source_path.with_suffix(suffix))
                    for suffix in (".analyzed.raw.json", ".analyzed.json")]
        documents = [document for document in analyses if document is not None]
        current = [document for document in documents if self._current_analysis(
            document, info["source_sha256"], info["equation_version"])]
        document = current[0] if current else (documents[0] if documents else None)
        if document is not None:
            metadata = document["metadata"]
            info["parser_version"] = metadata.get("parser_version")
            info["analysis_schema_version"] = metadata.get("schema_version")
            validation = document.get("validation")
            if isinstance(validation, dict):
                info["validation"] = {key: validation.get(key) for key in
                                      ("valid", "usable", "error_count", "warning_count")}
        if not current:
            info["state"] = "analysis_stale"
            return info, None
        validation = document.get("validation")
        if (not isinstance(validation, dict) or validation.get("usable") is not True
                or validation.get("valid") is not True
                or document["metadata"].get("usable") is not True):
            info["state"] = "invalid"
            return info, None
        info["state"] = "ready"
        return info, document

    def _entries(self) -> list[dict]:
        """Toutes les équations XML liées, indépendamment du référent ISA."""
        return sorted((entry for entry in self.manager.get_catalog()
                       if "isa_alarmes" in entry.get("type_refs", [])
                       and entry.get("format", "").lower() == "xml"),
                      key=lambda entry: str(entry.get("id", "")))

    def list_files(self) -> dict:
        """Retourne métadonnées publiques et état de chaque équation importée."""
        return {"schema_version": API_SCHEMA_VERSION,
                "files": [self._inspect(entry)[0] for entry in self._entries()]}

    def resolve(self, version: str, file_id: str | None = None) -> dict:
        """Résout une version exacte ; deux contenus distincts sont ambigus.

        Des imports identiques (même SHA-256 XML) sont dédoublés : on préfère
        une analyse exploitable, puis le plus petit identifiant lexical. Un
        ``file_id`` explicite désambiguïse, sans contourner le contrôle de version.
        """
        if not version or version != version.strip():
            raise EquationCatalogError(422, "EQUATION_VERSION_REQUIRED",
                                       "Une version XML exacte est obligatoire.")
        # Le catalogue peut contenir de nombreuses versions volumineuses. Seul
        # le document candidat reste en mémoire ; les autres analyses sont
        # libérées après vérification de leurs métadonnées. Le choix lexical
        # correspond au dédoublage déterministe appliqué ci-dessous.
        inspected = []
        selected_document = None
        selected_id = None
        for entry in self._entries():
            info, document = self._inspect(entry)
            inspected.append((info, None))
            if (info["equation_version"] == version and info["state"] == "ready"
                    and (file_id is None or info["id"] == file_id)
                    and (selected_id is None or str(info["id"]) < selected_id)):
                selected_id = str(info["id"])
                selected_document = document
            # Évite de garder le dernier document hors cible après la boucle.
            document = None
        available = sorted({info["equation_version"] for info, _ in inspected
                            if info["equation_version"]})
        if file_id is not None:
            matches = [(info, document) for info, document in inspected if info["id"] == file_id]
            if matches and matches[0][0]["state"] == "source_missing":
                raise EquationCatalogError(409, "EQUATION_SOURCE_MISSING",
                                           "Le XML source de cette équation est absent.", file_id=file_id)
            if matches and matches[0][0]["state"] == "invalid" and not matches[0][0]["equation_version"]:
                raise EquationCatalogError(422, "EQUATION_INVALID",
                                           "Le XML source est invalide.", file_id=file_id)
            if matches and matches[0][0]["equation_version"] != version:
                raise EquationCatalogError(409, "EQUATION_VERSION_MISMATCH",
                                           "La version XML du fichier ne correspond pas à la version demandée.",
                                           requested_version=version,
                                           actual_version=matches[0][0]["equation_version"])
        else:
            matches = [(info, document) for info, document in inspected
                       if info["equation_version"] == version]
        if not matches:
            raise EquationCatalogError(404, "EQUATION_NOT_FOUND",
                                       "Aucune équation importée ne correspond à cette version exacte.",
                                       requested_version=version, available_versions=available)
        if len({info["source_sha256"] for info, _ in matches}) > 1:
            raise EquationCatalogError(409, "EQUATION_AMBIGUOUS",
                                       "Plusieurs XML différents portent cette version ; préciser file_id.",
                                       file_ids=[info["id"] for info, _ in matches])
        matches.sort(key=lambda item: (item[0]["state"] != "ready", str(item[0]["id"])))
        info, _ = matches[0]
        if info["state"] == "invalid":
            raise EquationCatalogError(422, "EQUATION_INVALID",
                                       "Le XML ou son analyse présente des erreurs de validation.", file_id=info["id"])
        if info["state"] != "ready":
            raise EquationCatalogError(409, "EQUATION_ANALYSIS_STALE",
                                       "L'analyse est absente ou obsolète ; relancer son analyse dans R#BD.",
                                       file_id=info["id"])
        return {"schema_version": API_SCHEMA_VERSION,
                "file": {key: value for key, value in info.items() if key not in {"state", "validation"}},
                "document": selected_document}
