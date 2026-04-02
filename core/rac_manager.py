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
  - Le fichier brut importé est copié dans uploads/rac/
  - Les métadonnées sont stockées dans data/rac/index.json
  - Les routes API (router_rac.py) délèguent le traitement à cette classe
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger("RAC[Manager]")


class RACManager:
    """
    Gestionnaire du catalogue de fichiers RAC.

    Responsabilités :
      - Stocker et charger l'index des RAC (data/rac/index.json)
      - Copier les fichiers importés (uploads/rac/)
      - Fournir les opérations CRUD (list, get, add, delete)
    """

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

        # Chemin du fichier d'index
        self.index_path = self.rac_data_dir / "index.json"

        # Charger l'index existant
        self.catalog: List[Dict[str, Any]] = self._load_index()
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
            return data if isinstance(data, list) else []
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

    # ========================================================================
    # OPÉRATIONS CRUD
    # ========================================================================

    def list_all(self) -> List[Dict[str, Any]]:
        """
        Lister tous les fichiers RAC du catalogue.

        Returns:
            Liste complète des entrées RAC
        """
        return self.catalog

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

    def add(self, filename: str, file_content: bytes) -> Dict[str, Any]:
        """
        Importer un nouveau fichier RAC dans le catalogue.

        Étapes :
        1. Générer un identifiant unique
        2. Copier le fichier dans uploads/rac/
        3. Ajouter l'entrée à l'index
        4. Persister l'index

        Args:
            filename: Nom du fichier original
            file_content: Contenu binaire du fichier

        Returns:
            Entrée RAC créée (dictionnaire)
        """
        # Générer un ID unique
        rac_id = f"rac-{uuid.uuid4().hex[:8]}"

        # Assainir le nom de fichier (sécurité — pas de path traversal)
        safe_name = Path(filename).name
        dest_path = self.rac_uploads_dir / f"{rac_id}_{safe_name}"

        # Écrire le fichier sur disque
        dest_path.write_bytes(file_content)
        logger.info("[RAC][Import] Fichier copié : %s", dest_path.name)

        # Construire l'entrée du catalogue
        entry: Dict[str, Any] = {
            "id": rac_id,
            "filename": safe_name,
            "stored_path": str(dest_path.relative_to(self.rac_uploads_dir)),
            "size_bytes": len(file_content),
            "imported_at": datetime.now().isoformat(),
            "metadata": {},
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

        # Retirer de l'index
        self.catalog = [e for e in self.catalog if e.get("id") != rac_id]
        self._save_index()

        logger.info("[RAC][Delete] RAC supprimé du catalogue : %s", rac_id)
        return True
