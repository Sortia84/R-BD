# router_essais.py — CRUD essais R#BD avec persistance JSON serveur
"""
Endpoints pour gérer les essais (tests) RU / CVS / MVS.
Stockage : data/essais/essais_{type}.json
Auto-save côté serveur à chaque sauvegarde d'essai.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException

# Import centralisé depuis shared.py
from api.shared import (
    ESSAIS_DATA_DIR as DATA_DIR,
    VALID_ESSAI_TYPES as VALID_TYPES,
    EssaiPayload,
    SyncPayload,
    logger,
)

router = APIRouter(prefix="/api/essais", tags=["essais"])


# ---------- helpers ----------

def _file_for_type(essai_type: str) -> Path:
    """Retourne le chemin du fichier JSON pour un type donné."""
    t = essai_type.lower()
    if t not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Type invalide: {essai_type}. Types valides: {VALID_TYPES}")
    return DATA_DIR / f"essais_{t}.json"


def _load(essai_type: str) -> List[Dict[str, Any]]:
    path = _file_for_type(essai_type)
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save(essai_type: str, essais: List[Dict[str, Any]]) -> None:
    path = _file_for_type(essai_type)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(essais, f, indent=2, ensure_ascii=False)


# ---------- endpoints ----------

@router.get("")
def list_essais(type: str = "ru") -> Dict[str, Any]:
    """Liste les essais d'un type donné."""
    essais = _load(type)
    return {"type": type, "count": len(essais), "essais": essais}


@router.get("/{essai_id}")
def get_essai(essai_id: str, type: str = "ru") -> Dict[str, Any]:
    """Récupère un essai par son ID."""
    essais = _load(type)
    for e in essais:
        if e.get("id") == essai_id:
            return e
    raise HTTPException(status_code=404, detail=f"Essai {essai_id} introuvable")


@router.post("")
def create_or_update_essai(payload: EssaiPayload) -> Dict[str, Any]:
    """Crée ou met à jour un essai (upsert par ID)."""
    essai_type = payload.type.lower()
    essais = _load(essai_type)

    essai_dict = payload.model_dump()
    essai_dict["updated_at"] = datetime.now().isoformat()

    # Upsert
    existing_idx = next((i for i, e in enumerate(essais) if e.get("id") == payload.id), None)
    if existing_idx is not None:
        essai_dict["created_at"] = essais[existing_idx].get("created_at", essai_dict["updated_at"])
        essais[existing_idx] = essai_dict
        action = "updated"
    else:
        essai_dict["created_at"] = essai_dict["updated_at"]
        essais.append(essai_dict)
        action = "created"

    _save(essai_type, essais)
    print(f"✅ Essai {action}: {payload.id} (type={essai_type})")
    return {"success": True, "action": action, "id": payload.id}


@router.delete("/{essai_id}")
def delete_essai(essai_id: str, type: str = "ru") -> Dict[str, Any]:
    """Supprime un essai par son ID."""
    essais = _load(type)
    initial_count = len(essais)
    essais = [e for e in essais if e.get("id") != essai_id]

    if len(essais) == initial_count:
        raise HTTPException(status_code=404, detail=f"Essai {essai_id} introuvable")

    _save(type, essais)
    print(f"🗑️ Essai supprimé: {essai_id} (type={type})")
    return {"success": True, "deleted": essai_id}


@router.post("/sync")
def sync_essais(payload: SyncPayload) -> Dict[str, Any]:
    """
    Synchronise les essais depuis le localStorage vers le serveur (bulk).
    Remplace intégralement le fichier pour le type donné.
    """
    essai_type = payload.type.lower()
    now = datetime.now().isoformat()
    filtered_essais: List[Dict[str, Any]] = []
    skipped_count = 0

    # Ajouter timestamps si absents
    for essai in payload.essais:
        item_type = str(essai.get("type", essai_type)).lower()
        item_id = str(essai.get("id", "")).strip().upper()

        # Garde-fou de cohérence: on ne laisse pas un sync RU écrire des CVS/MVS
        # dans le fichier RU (et inversement).
        if item_type != essai_type:
            skipped_count += 1
            continue

        # Garde-fou additionnel: si l'ID suit la convention RU-/CVS-/MVS-,
        # il doit être cohérent avec le type de sync cible.
        if item_id.startswith("RU-") and essai_type != "ru":
            skipped_count += 1
            continue
        if item_id.startswith("CVS-") and essai_type != "cvs":
            skipped_count += 1
            continue
        if item_id.startswith("MVS-") and essai_type != "mvs":
            skipped_count += 1
            continue

        essai["type"] = essai_type
        if "updated_at" not in essai:
            essai["updated_at"] = now
        if "created_at" not in essai:
            essai["created_at"] = now

        filtered_essais.append(essai)

    _save(essai_type, filtered_essais)
    print(f"🔄 Sync {len(filtered_essais)} essais (type={essai_type}, ignorés={skipped_count})")
    return {
        "success": True,
        "type": essai_type,
        "synced": len(filtered_essais),
        "skipped": skipped_count,
    }
