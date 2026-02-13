# isa_manager.py - Gestionnaire de fichiers ISA
"""
Gère les fichiers ISA (xlsx, xml, csv, json...) :
- Import et stockage dans uploads/ISA/
- Catalogue des fichiers dans data/isa/index.json
- Types ISA dans data/isa/liste_isa.json
- Liaison fichiers <-> types
"""

import json
import os
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any


class ISAManager:
    """Gestionnaire des fichiers ISA."""

    # Extensions supportées
    SUPPORTED_FORMATS = {'.xlsx', '.xls', '.xml', '.csv', '.json', '.txt', '.icd'}

    def __init__(self, data_dir: Path, uploads_dir: Path):
        """
        Initialise le gestionnaire ISA.

        Args:
            data_dir: Dossier data/ contenant les index JSON
            uploads_dir: Dossier uploads/ pour stocker les fichiers
        """
        self.data_dir = Path(data_dir)
        self.uploads_dir = Path(uploads_dir) / "ISA"
        self.isa_data_dir = self.data_dir / "isa"
        self.files_dir = self.isa_data_dir / "files"  # Fichiers classés par type

        # Créer les dossiers si nécessaire
        self.uploads_dir.mkdir(parents=True, exist_ok=True)
        self.isa_data_dir.mkdir(parents=True, exist_ok=True)
        self.files_dir.mkdir(parents=True, exist_ok=True)

        # Fichiers JSON
        self.index_file = self.isa_data_dir / "index.json"
        self.types_file = self.isa_data_dir / "liste_isa.json"

        # Initialiser les fichiers JSON si absents
        self._init_files()

    def _init_files(self):
        """Initialise les fichiers JSON s'ils n'existent pas."""
        if not self.index_file.exists():
            self._save_index({"files": [], "last_updated": None})

        if not self.types_file.exists():
            self._save_types(self._default_types())

    def _default_types(self) -> dict:
        """Structure par défaut des types ISA."""
        return {
            "version": "1.0",
            "description": "Types de fichiers ISA pour R#BD",
            "types": [
                {
                    "id": "config_materiel",
                    "name": "Configuration Matériel",
                    "category": "config",
                    "description": "Fichiers de configuration matérielle",
                    "formats": ["xlsx", "xml"],
                    "icon": "⚙️"
                },
                {
                    "id": "mapping_signaux",
                    "name": "Mapping Signaux",
                    "category": "mapping",
                    "description": "Tables de correspondance des signaux",
                    "formats": ["xlsx", "csv"],
                    "icon": "🗺️"
                },
                {
                    "id": "parametres_reseau",
                    "name": "Paramètres Réseau",
                    "category": "config",
                    "description": "Configuration réseau et adresses",
                    "formats": ["xml", "json"],
                    "icon": "🌐"
                },
                {
                    "id": "donnees_reference",
                    "name": "Données de Référence",
                    "category": "reference",
                    "description": "Tables de référence et nomenclatures",
                    "formats": ["xlsx", "csv"],
                    "icon": "📖"
                },
                {
                    "id": "export_scada",
                    "name": "Export SCADA",
                    "category": "export",
                    "description": "Fichiers d'export pour systèmes SCADA",
                    "formats": ["xml", "csv"],
                    "icon": "📤"
                },
                {
                    "id": "modele_donnees",
                    "name": "Modèle de Données",
                    "category": "data",
                    "description": "Définition du modèle de données IEC 61850",
                    "formats": ["xml", "json"],
                    "icon": "📊"
                }
            ]
        }

    # ============================================================
    # Chargement / Sauvegarde
    # ============================================================

    def _load_index(self) -> dict:
        """Charge l'index des fichiers ISA."""
        try:
            with open(self.index_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return {"files": [], "last_updated": None}

    def _save_index(self, data: dict):
        """Sauvegarde l'index des fichiers ISA."""
        data["last_updated"] = datetime.now().isoformat()
        with open(self.index_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    def _load_types(self) -> dict:
        """Charge la liste des types ISA."""
        try:
            with open(self.types_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return self._default_types()

    def _save_types(self, data: dict):
        """Sauvegarde la liste des types ISA."""
        with open(self.types_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)

    # ============================================================
    # Types ISA
    # ============================================================

    def get_types(self) -> list[dict]:
        """Retourne la liste des types ISA."""
        data = self._load_types()
        return data.get("types", [])

    def get_type_by_id(self, type_id: str) -> dict | None:
        """Retourne un type par son ID."""
        types = self.get_types()
        for t in types:
            if t.get("id") == type_id:
                return t
        return None

    def add_type(self, type_data: dict) -> dict:
        """Ajoute un nouveau type ISA."""
        data = self._load_types()
        types = data.get("types", [])

        # Vérifier unicité ID
        type_id = type_data.get("id")
        if any(t.get("id") == type_id for t in types):
            raise ValueError(f"Type avec ID '{type_id}' existe déjà")

        types.append(type_data)
        data["types"] = types
        self._save_types(data)
        return type_data

    def update_type(self, type_id: str, type_data: dict) -> dict | None:
        """Met à jour un type existant."""
        data = self._load_types()
        types = data.get("types", [])

        for i, t in enumerate(types):
            if t.get("id") == type_id:
                types[i] = {**t, **type_data, "id": type_id}
                data["types"] = types
                self._save_types(data)
                return types[i]
        return None

    def delete_type(self, type_id: str) -> bool:
        """Supprime un type ISA."""
        data = self._load_types()
        types = data.get("types", [])

        original_len = len(types)
        types = [t for t in types if t.get("id") != type_id]

        if len(types) < original_len:
            data["types"] = types
            self._save_types(data)
            return True
        return False

    # ============================================================
    # Fichiers ISA
    # ============================================================

    def get_catalog(self) -> list[dict]:
        """Retourne le catalogue complet des fichiers ISA."""
        data = self._load_index()
        return data.get("files", [])

    def get_file_by_id(self, file_id: str) -> dict | None:
        """Retourne un fichier par son ID."""
        files = self.get_catalog()
        for f in files:
            if f.get("id") == file_id:
                return f
        return None

    def import_file(self, file_path: Path, original_name: str, type_id: str | None = None) -> dict:
        """
        Importe un fichier ISA.

        Args:
            file_path: Chemin du fichier temporaire uploadé
            original_name: Nom original du fichier
            type_id: ID du type à associer (optionnel)

        Returns:
            Entrée du fichier créée
        """
        # Vérifier extension
        ext = Path(original_name).suffix.lower()
        if ext not in self.SUPPORTED_FORMATS:
            raise ValueError(f"Format non supporté: {ext}")

        # Générer ID unique
        file_id = uuid.uuid4().hex[:12]

        # Nom de stockage
        stored_name = f"{file_id}_{original_name}"

        # Déterminer le dossier de destination selon le type
        if type_id:
            # Fichier lié : stocker dans data/isa/files/{type_id}/
            dest_dir = self.files_dir / type_id
            dest_dir.mkdir(parents=True, exist_ok=True)
            stored_path = dest_dir / stored_name
        else:
            # Fichier orphelin : stocker dans uploads/ISA/
            stored_path = self.uploads_dir / stored_name

        # Copier le fichier
        shutil.copy2(file_path, stored_path)

        # Créer l'entrée
        file_entry = {
            "id": file_id,
            "original_name": original_name,
            "filename": stored_name,
            "format": ext.lstrip('.'),
            "size": stored_path.stat().st_size,
            "imported_at": datetime.now().isoformat(),
            "type_refs": [type_id] if type_id else [],
            "path": str(stored_path.relative_to(self.data_dir.parent))
        }

        # Ajouter au catalogue
        data = self._load_index()
        files = data.get("files", [])
        files.append(file_entry)
        data["files"] = files
        self._save_index(data)

        # Analyse automatique pour certains types
        if type_id and self._should_auto_analyze(type_id, ext):
            try:
                analysis_result = self.analyze_file(file_id, type_id)
                file_entry["analysis_result"] = analysis_result
            except Exception as e:
                file_entry["analysis_error"] = str(e)

        return file_entry

    def _should_auto_analyze(self, type_id: str, ext: str) -> bool:
        """Détermine si un type de fichier doit être analysé automatiquement."""
        # Types nécessitant une analyse automatique
        auto_analyze_types = {
            "isa_alarmes": [".xml"],      # Équations XML → JSON enrichi RISA
            "isa_cde": [".xml", ".json"], # Données CDE
            "isa_tcd": [".xml", ".json"], # Données TCD
        }

        if type_id in auto_analyze_types:
            return ext.lower() in auto_analyze_types[type_id]
        return False

    def delete_file(self, file_id: str) -> bool:
        """Supprime un fichier ISA (depuis uploads ou data/files)."""
        file_entry = self.get_file_by_id(file_id)
        if not file_entry:
            return False

        # Trouver et supprimer le fichier physique
        current_path = self._get_file_current_path(file_entry)
        if current_path and current_path.exists():
            current_path.unlink()

        # Retirer du catalogue
        data = self._load_index()
        files = data.get("files", [])
        files = [f for f in files if f.get("id") != file_id]
        data["files"] = files
        self._save_index(data)

        return True

    def _get_file_current_path(self, file_entry: dict) -> Path | None:
        """Retourne le chemin actuel d'un fichier (uploads ou data/files)."""
        filename = file_entry.get("filename", "")

        # Vérifier d'abord dans uploads (orphelin)
        uploads_path = self.uploads_dir / filename
        if uploads_path.exists():
            return uploads_path

        # Sinon chercher dans data/isa/files/{type_id}/
        for type_id in file_entry.get("type_refs", []):
            type_path = self.files_dir / type_id / filename
            if type_path.exists():
                return type_path

        return None

    def _move_file_to_type(self, file_entry: dict, type_id: str) -> str | None:
        """
        Déplace un fichier vers data/isa/files/{type_id}/.
        Retourne le nouveau chemin relatif ou None si échec.
        """
        current_path = self._get_file_current_path(file_entry)
        if not current_path or not current_path.exists():
            return None

        # Créer le dossier du type
        type_dir = self.files_dir / type_id
        type_dir.mkdir(parents=True, exist_ok=True)

        # Nouveau chemin
        new_path = type_dir / file_entry.get("filename", "")

        # Déplacer le fichier (si pas déjà là)
        if current_path != new_path:
            shutil.move(str(current_path), str(new_path))

        return str(new_path.relative_to(self.data_dir.parent))

    def _move_file_to_uploads(self, file_entry: dict) -> str | None:
        """
        Déplace un fichier orphelin vers uploads/ISA/.
        Retourne le nouveau chemin relatif ou None si échec.
        """
        current_path = self._get_file_current_path(file_entry)
        if not current_path or not current_path.exists():
            return None

        # Nouveau chemin dans uploads
        new_path = self.uploads_dir / file_entry.get("filename", "")

        # Déplacer le fichier (si pas déjà là)
        if current_path != new_path:
            shutil.move(str(current_path), str(new_path))

        return str(new_path.relative_to(self.uploads_dir.parent.parent))

    def link_file_to_type(self, file_id: str, type_id: str) -> bool:
        """Associe un fichier à un type et le déplace vers data/isa/files/{type_id}/."""
        data = self._load_index()
        files = data.get("files", [])

        for f in files:
            if f.get("id") == file_id:
                type_refs = f.get("type_refs", [])
                if type_id not in type_refs:
                    # Déplacer le fichier vers le dossier du type
                    new_path = self._move_file_to_type(f, type_id)
                    if new_path:
                        f["path"] = new_path

                    type_refs.append(type_id)
                    f["type_refs"] = type_refs
                data["files"] = files
                self._save_index(data)
                return True
        return False

    def unlink_file_from_type(self, file_id: str, type_id: str) -> bool:
        """Retire l'association d'un fichier avec un type. Si orphelin, le remet dans uploads/."""
        data = self._load_index()
        files = data.get("files", [])

        for f in files:
            if f.get("id") == file_id:
                type_refs = f.get("type_refs", [])
                if type_id in type_refs:
                    type_refs.remove(type_id)
                    f["type_refs"] = type_refs

                    # Si plus aucun type, remettre dans uploads
                    if not type_refs:
                        new_path = self._move_file_to_uploads(f)
                        if new_path:
                            f["path"] = new_path
                    # Sinon, déplacer vers le premier type restant
                    elif type_refs:
                        new_path = self._move_file_to_type(f, type_refs[0])
                        if new_path:
                            f["path"] = new_path

                data["files"] = files
                self._save_index(data)
                return True
        return False

    def get_files_for_type(self, type_id: str) -> list[dict]:
        """Retourne tous les fichiers associés à un type."""
        files = self.get_catalog()
        return [f for f in files if type_id in f.get("type_refs", [])]

    def get_orphan_files(self) -> list[dict]:
        """Retourne les fichiers non associés à aucun type."""
        files = self.get_catalog()
        return [f for f in files if not f.get("type_refs")]

    # ============================================================
    # Gestion des fichiers référents (par défaut)
    # ============================================================

    def set_default_file(self, type_id: str, file_id: str) -> bool:
        """
        Définit un fichier comme référent pour un type donné.
        Un seul fichier peut être référent par type.

        Args:
            type_id: ID du type ISA
            file_id: ID du fichier à définir comme référent

        Returns:
            True si succès, False sinon
        """
        data = self._load_index()
        files = data.get("files", [])

        # Vérifier que le fichier existe et est lié au type
        target_file = None
        for f in files:
            if f.get("id") == file_id:
                if type_id not in f.get("type_refs", []):
                    return False  # Fichier non lié à ce type
                target_file = f
                break

        if not target_file:
            return False

        # Retirer is_default des autres fichiers du même type
        for f in files:
            if type_id in f.get("type_refs", []):
                defaults = f.get("is_default_for", [])
                if type_id in defaults:
                    defaults.remove(type_id)
                    f["is_default_for"] = defaults

        # Définir ce fichier comme référent
        defaults = target_file.get("is_default_for", [])
        if type_id not in defaults:
            defaults.append(type_id)
        target_file["is_default_for"] = defaults

        data["files"] = files
        self._save_index(data)
        return True

    def get_default_file(self, type_id: str) -> dict | None:
        """
        Retourne le fichier référent pour un type donné.

        Args:
            type_id: ID du type ISA

        Returns:
            Le fichier référent ou None si aucun défini
        """
        files = self.get_catalog()
        for f in files:
            if type_id in f.get("is_default_for", []):
                return f

        # Fallback: retourner le premier fichier du type s'il n'y a pas de référent
        type_files = self.get_files_for_type(type_id)
        if type_files:
            return type_files[0]

        return None

    def clear_default_file(self, type_id: str) -> bool:
        """
        Supprime le fichier référent pour un type.

        Args:
            type_id: ID du type ISA

        Returns:
            True si un référent a été supprimé, False sinon
        """
        data = self._load_index()
        files = data.get("files", [])
        cleared = False

        for f in files:
            defaults = f.get("is_default_for", [])
            if type_id in defaults:
                defaults.remove(type_id)
                f["is_default_for"] = defaults
                cleared = True

        if cleared:
            data["files"] = files
            self._save_index(data)

        return cleared

    def is_default_file(self, file_id: str, type_id: str) -> bool:
        """Vérifie si un fichier est le référent pour un type."""
        file_entry = self.get_file_by_id(file_id)
        if not file_entry:
            return False
        return type_id in file_entry.get("is_default_for", [])

    # ============================================================
    # Analyse selon le type
    # ============================================================

    def analyze_file(self, file_id: str, type_id: str, enrich: bool = True) -> dict:
        """
        Analyse un fichier selon son type.

        Types supportés :
        - isa_alarmes (XML) : Parse équations + enrichissement RISA si dispo
        - risa (JSON) : Stockage direct, pas d'analyse
        - Autres : Métadonnées de base

        Args:
            file_id: ID du fichier à analyser
            type_id: ID du type pour lequel analyser
            enrich: Si True, enrichit avec RISA. Si False, analyse brute sans enrichissement.

        Returns:
            Résultats d'analyse
        """
        file_entry = self.get_file_by_id(file_id)
        if not file_entry:
            raise ValueError(f"Fichier non trouvé: {file_id}")

        file_type = self.get_type_by_id(type_id)
        if not file_type:
            raise ValueError(f"Type non trouvé: {type_id}")

        file_format = file_entry.get("format", "").lower()
        file_path = self._get_file_current_path(file_entry)

        if not file_path or not file_path.exists():
            raise ValueError(f"Fichier physique non trouvé: {file_entry.get('filename')}")

        result = {
            "file_id": file_id,
            "type_id": type_id,
            "analyzed_at": datetime.now().isoformat(),
            "status": "success",
            "file_info": {
                "name": file_entry.get("original_name"),
                "format": file_format,
                "size": file_entry.get("size")
            },
            "type_info": {
                "name": file_type.get("name"),
                "category": file_type.get("category")
            }
        }

        # Analyse spécifique selon le type
        try:
            if type_id == "isa_alarmes" and file_format == "xml":
                result["analysis"] = self._analyze_equation_xml(file_path, file_id, enrich=enrich)
            elif type_id == "risa" and file_format == "json":
                result["analysis"] = {"type": "risa", "status": "stored", "message": "Fichier RISA stocké"}
            else:
                result["analysis"] = {"type": "basic", "message": "Pas d'analyse spécifique"}
        except Exception as e:
            result["status"] = "error"
            result["error"] = str(e)

        return result

    def _analyze_equation_xml(self, file_path: Path, file_id: str, enrich: bool = True) -> dict:
        """
        Analyse un fichier XML d'équations/alarmes.
        Enrichit avec RISA si disponible et si enrich=True.

        Args:
            file_path: Chemin du fichier XML
            file_id: ID du fichier pour nommer le JSON résultat
            enrich: Si True, enrichit avec RISA. Si False, analyse brute.

        Returns:
            Résultats d'analyse
        """
        from core.isa_parsers.equation_parser import parse_equation_xml
        from core.isa_parsers.risa_enricher import enrich_with_risa

        # 1. Parser le XML
        equation_data = parse_equation_xml(file_path)

        # 2. Enrichissement RISA uniquement si demandé
        if enrich:
            # Chercher un fichier RISA disponible pour enrichissement
            risa_files = self.get_files_for_type("risa")
            risa_json_files = [f for f in risa_files if f.get("format") == "json"]

            if risa_json_files:
                # Prendre le plus récent
                risa_file = max(risa_json_files, key=lambda x: x.get("imported_at", ""))
                risa_path = self._get_file_current_path(risa_file)

                if risa_path and risa_path.exists():
                    try:
                        with open(risa_path, "r", encoding="utf-8") as f:
                            risa_data = json.load(f)

                        # 3. Enrichir avec RISA
                        equation_data = enrich_with_risa(equation_data, risa_data)
                        equation_data["metadata"]["risa_source"] = risa_file.get("original_name")
                    except Exception as e:
                        equation_data["metadata"]["risa_error"] = str(e)
            else:
                equation_data["metadata"]["risa_source"] = None
                equation_data["metadata"]["enriched"] = False
        else:
            # Mode sans enrichissement
            equation_data["metadata"]["enriched"] = False
            equation_data["metadata"]["risa_source"] = None
            equation_data["metadata"]["analysis_mode"] = "raw"

        # 4. Sauvegarder le JSON analysé - suffixe différent si sans enrichissement
        if enrich:
            output_path = file_path.with_suffix(".analyzed.json")
        else:
            output_path = file_path.with_suffix(".analyzed.raw.json")

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(equation_data, f, indent=2, ensure_ascii=False)

        return {
            "type": "equation_xml",
            "output_file": output_path.name,
            "regroupements_count": equation_data["metadata"]["total_regroupements"],
            "entrees_count": equation_data["metadata"]["total_entrees"],
            "wildcards_count": equation_data["metadata"]["wildcards_count"],
            "enriched": equation_data["metadata"].get("enriched", False),
            "risa_source": equation_data["metadata"].get("risa_source"),
            "enrichment_stats": equation_data["metadata"].get("enrichment_stats", {}),
            "analysis_mode": "enriched" if enrich else "raw"
        }

    def get_analyzed_data(self, file_id: str) -> dict | list | None:
        """
        Récupère les données analysées d'un fichier.

        - Pour les XML : retourne le contenu du .analyzed.json
        - Pour les JSON : retourne directement le contenu du fichier

        Args:
            file_id: ID du fichier

        Returns:
            Données analysées ou None si pas disponible
        """
        file_entry = self.get_file_by_id(file_id)
        if not file_entry:
            return None

        file_path = self._get_file_current_path(file_entry)
        if not file_path:
            return None

        file_format = file_entry.get("format", "").lower()

        # Pour les fichiers XML, chercher le .analyzed.json
        if file_format == "xml":
            analyzed_path = file_path.with_suffix(".analyzed.json")
            if analyzed_path.exists():
                with open(analyzed_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            return None

        # Pour les fichiers JSON, retourner directement le contenu
        if file_format == "json" and file_path.exists():
            with open(file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Si c'est une liste, l'encapsuler pour uniformiser
                if isinstance(data, list):
                    return {"entries": data, "metadata": {"source_file": file_path.name, "format": "json_list"}}
                return data

        return None

    def reanalyze_all(self) -> list[dict]:
        """Relance l'analyse de tous les fichiers liés."""
        results = []
        files = self.get_catalog()

        for f in files:
            type_refs = f.get("type_refs", [])
            for type_id in type_refs:
                try:
                    result = self.analyze_file(f["id"], type_id)
                    results.append(result)
                except Exception as e:
                    results.append({
                        "file_id": f["id"],
                        "type_id": type_id,
                        "status": "error",
                        "error": str(e)
                    })

        return results
