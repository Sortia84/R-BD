# core/fcs_manager.py
"""
Gestionnaire de fichiers FCS (Fiches de Configuration Système).

Rôle :
  - Importer des fichiers FCS (XML ou JSON) dans le catalogue R#BD
  - Indexer les FCS importés (métadonnées, IED concernés, date d'import)
  - Fournir les opérations CRUD sur le catalogue FCS
  - Persister les données dans FCS_DATA_DIR / index.json

Un fichier FCS contient généralement les configurations système
appliquées aux équipements IED d'un poste IEC 61850.

Architecture :
  - Le fichier brut importé est copié dans uploads/fcs/
  - Les métadonnées sont extraites et stockées dans data/fcs/index.json
  - Les routes API (router_fcs.py) délèguent le traitement à cette classe
"""

from __future__ import annotations

import json
import logging
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("FCS[Manager]")


class FCSManager:
    """
    Gestionnaire du catalogue de fichiers FCS.

    Responsabilités :
      - Stocker et charger l'index des FCS (data/fcs/index.json)
      - Copier les fichiers importés (uploads/fcs/)
      - Fournir les opérations CRUD (list, get, add, delete)
    """

    def __init__(self, data_dir: Path, uploads_dir: Path) -> None:
        """
        Initialiser le gestionnaire FCS.

        Args:
            data_dir: Répertoire de persistance (contient data/fcs/)
            uploads_dir: Répertoire des fichiers uploadés
        """
        # Répertoire de l'index et des métadonnées
        self.fcs_data_dir = data_dir / "fcs"
        self.fcs_data_dir.mkdir(parents=True, exist_ok=True)

        # Répertoire de stockage des fichiers bruts importés
        self.fcs_uploads_dir = uploads_dir / "fcs"
        self.fcs_uploads_dir.mkdir(parents=True, exist_ok=True)

        # Chemin du fichier d'index
        self.index_path = self.fcs_data_dir / "index.json"

        # Charger l'index existant
        self.catalog: List[Dict[str, Any]] = self._load_index()
        logger.info("[FCS][Init] %d fichier(s) FCS dans le catalogue", len(self.catalog))

    # ========================================================================
    # PERSISTANCE — Lecture / écriture de l'index
    # ========================================================================

    def _load_index(self) -> List[Dict[str, Any]]:
        """
        Charger l'index des FCS depuis le fichier JSON.

        Returns:
            Liste des entrées FCS (dictionnaires)
        """
        if not self.index_path.exists():
            return []

        try:
            content = self.index_path.read_text(encoding="utf-8")
            data = json.loads(content)
            return data if isinstance(data, list) else []
        except (json.JSONDecodeError, IOError) as exc:
            logger.error("[FCS][Index] Erreur lecture index : %s", exc)
            return []

    def _save_index(self) -> None:
        """
        Sauvegarder l'index des FCS dans le fichier JSON.
        """
        try:
            self.index_path.write_text(
                json.dumps(self.catalog, indent=2, ensure_ascii=False),
                encoding="utf-8"
            )
            logger.info("[FCS][Index] Index sauvegardé (%d entrées)", len(self.catalog))
        except IOError as exc:
            logger.error("[FCS][Index] Erreur écriture index : %s", exc)

    # ========================================================================
    # OPÉRATIONS CRUD
    # ========================================================================

    def list_all(self) -> List[Dict[str, Any]]:
        """
        Lister tous les fichiers FCS du catalogue.

        Returns:
            Liste complète des entrées FCS
        """
        return self.catalog

    def get_by_id(self, fcs_id: str) -> Optional[Dict[str, Any]]:
        """
        Récupérer un fichier FCS par son identifiant.

        Args:
            fcs_id: Identifiant unique du FCS

        Returns:
            Entrée FCS ou None si introuvable
        """
        for entry in self.catalog:
            if entry.get("id") == fcs_id:
                return entry
        return None

    def add(self, filename: str, file_content: bytes) -> Dict[str, Any]:
        """
        Importer un nouveau fichier FCS dans le catalogue.

        Étapes :
        1. Générer un identifiant unique
        2. Copier le fichier dans uploads/fcs/
        3. Extraire les métadonnées de base
        4. Ajouter l'entrée à l'index
        5. Persister l'index

        Args:
            filename: Nom du fichier original
            file_content: Contenu binaire du fichier

        Returns:
            Entrée FCS créée (dictionnaire)
        """
        # Générer un ID unique
        fcs_id = f"fcs-{uuid.uuid4().hex[:8]}"

        # Assainir le nom de fichier (sécurité — pas de path traversal)
        safe_name = Path(filename).name
        dest_path = self.fcs_uploads_dir / f"{fcs_id}_{safe_name}"

        # Écrire le fichier sur disque
        dest_path.write_bytes(file_content)
        logger.info("[FCS][Import] Fichier copié : %s", dest_path.name)

        # Construire l'entrée du catalogue
        entry: Dict[str, Any] = {
            "id": fcs_id,
            "filename": safe_name,
            "stored_path": str(dest_path.relative_to(self.fcs_uploads_dir)),
            "size_bytes": len(file_content),
            "imported_at": datetime.now().isoformat(),
            "metadata": {},
        }

        # Ajouter au catalogue et persister
        self.catalog.append(entry)
        self._save_index()

        logger.info("[FCS][Import] FCS ajouté au catalogue : %s (%s)", fcs_id, safe_name)
        return entry

    def delete(self, fcs_id: str) -> bool:
        """
        Supprimer un fichier FCS du catalogue et du disque.

        Args:
            fcs_id: Identifiant du FCS à supprimer

        Returns:
            True si supprimé, False si introuvable
        """
        entry = self.get_by_id(fcs_id)
        if not entry:
            logger.warning("[FCS][Delete] FCS introuvable : %s", fcs_id)
            return False

        # Supprimer le fichier physique
        stored_path = self.fcs_uploads_dir / entry.get("stored_path", "")
        if stored_path.exists():
            stored_path.unlink()
            logger.info("[FCS][Delete] Fichier supprimé : %s", stored_path.name)

        # Retirer de l'index
        self.catalog = [e for e in self.catalog if e.get("id") != fcs_id]
        self._save_index()

        logger.info("[FCS][Delete] FCS supprimé du catalogue : %s", fcs_id)
        return True
