# essais_api.py — CRUD essais R#BD avec persistance JSON serveur
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
from pydantic import BaseModel

router = APIRouter(prefix="/api/essais", tags=["essais"])

# Répertoire de stockage
DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "essais"
DATA_DIR.mkdir(parents=True, exist_ok=True)

VALID_TYPES = ("ru", "cvs", "mvs")


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


# ---------- modèles ----------

class EssaiPayload(BaseModel):
    """Payload pour créer / mettre à jour un essai."""
    id: str
    name: str
    type: str = "ru"
    ied: str = ""
    variant: str = ""
    ld: str = ""
    ln: str = ""
    lninst: str = ""
    description: str = ""
    preconditions: List[Any] = []
    files: List[Any] = []
    linked_tests_ru: List[Any] = []
    linked_tests_mvs: List[Any] = []
    linked_tests_cvs: List[Any] = []
    steps: List[Any] = []
    cde: List[Any] = []
    alarmes: List[Any] = []
    tcd: List[Any] = []


class SyncPayload(BaseModel):
    """Payload pour synchroniser tous les essais d'un type depuis le localStorage."""
    type: str = "ru"
    essais: List[Dict[str, Any]]


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

    # Ajouter timestamps si absents
    for essai in payload.essais:
        if "updated_at" not in essai:
            essai["updated_at"] = now
        if "created_at" not in essai:
            essai["created_at"] = now

    _save(essai_type, payload.essais)
    print(f"🔄 Sync {len(payload.essais)} essais (type={essai_type})")
    return {
        "success": True,
        "type": essai_type,
        "synced": len(payload.essais),
    }
