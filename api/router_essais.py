# router_essais.py — CRUD essais R#BD avec persistance JSON serveur
"""
Endpoints pour gérer les essais (tests) RU / CVS / MVS / MVC.
Stockage : data/essais/essais_{type}.json
Auto-save côté serveur à chaque sauvegarde d'essai.
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

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


def _normalize_test_id(value: Any) -> str:
    """Retourne un identifiant d'essai normalise pour les comparaisons."""
    return str(value or "").strip()


def _normalize_order_scope(value: Any, fallback: str) -> str:
    """
    Normalise une valeur de regroupement pour les numeros automatiques.

    Les essais anciens peuvent avoir des champs IED/LD vides ou generiques.
    On les rattache alors a un groupe lisible au lieu de laisser une cle vide
    circuler dans l'API consommee par R#GUIDE.
    """
    text = str(value or "").strip()
    if text and text != "*":
        return text
    return fallback


def _apply_automatic_order_numbers(
    ordered: List[Dict[str, Any]],
    essai_type: str = "",
) -> List[Dict[str, Any]]:
    """
    Enrichit les essais avec les numeros derives par type, IED et LD.

    L'utilisateur ne renseigne que l'ordre global du type via R#BD. Les champs
    ci-dessous sont recalcules a chaque lecture/ecriture pour offrir a R#GUIDE
    plusieurs organisations possibles sans creer une deuxieme source de verite.
    """
    ied_counters: Dict[str, int] = {}
    ld_counters: Dict[str, int] = {}

    for type_number, essai in enumerate(ordered, start=1):
        current_type = str(essai.get("type") or essai_type or "").strip().lower()
        ied_scope = _normalize_order_scope(essai.get("ied"), "GENERAL")
        ld_scope = _normalize_order_scope(essai.get("ld"), "GENERAL")

        # Le rang par IED est calcule dans le type courant. Le rang par LD est
        # calcule sous l'IED afin d'eviter de melanger deux LD portant le meme
        # nom dans des familles d'equipements differentes.
        ied_key = f"{current_type}::{ied_scope.upper()}"
        ld_key = f"{ied_key}::{ld_scope.upper()}"

        ied_counters[ied_key] = ied_counters.get(ied_key, 0) + 1
        ld_counters[ld_key] = ld_counters.get(ld_key, 0) + 1

        essai["order_type_number"] = type_number
        essai["order_ied_number"] = ied_counters[ied_key]
        essai["order_ld_number"] = ld_counters[ld_key]
        essai["order_scope"] = {
            "type": current_type,
            "ied": ied_scope,
            "ld": ld_scope,
        }

    return ordered


def _ensure_order_fields(
    essais: List[Dict[str, Any]],
    essai_type: str = "",
) -> List[Dict[str, Any]]:
    """
    Recalcule l'ordre technique d'une liste d'essais.

    La relation previous_test_id reste le champ de saisie principal. order_index
    est derive de cette chaine afin que les listes API et JSON puissent etre
    triees sans reconstruire le graphe cote client.
    """
    by_id = {
        _normalize_test_id(essai.get("id")): essai
        for essai in essais
        if _normalize_test_id(essai.get("id"))
    }
    followers: Dict[str, List[Dict[str, Any]]] = {}

    for essai in essais:
        previous_id = _normalize_test_id(essai.get("previous_test_id"))
        if previous_id and previous_id not in by_id:
            # Le precedent peut avoir ete supprime. L'essai est conserve, mais
            # la relation invalide est neutralisee pour eviter un ordre fantome.
            essai["previous_test_id"] = ""
            previous_id = ""
        followers.setdefault(previous_id, []).append(essai)

    for bucket in followers.values():
        bucket.sort(key=lambda item: (
            item.get("order_index") is None,
            item.get("order_index") if item.get("order_index") is not None else 10**9,
            str(item.get("name", "")).lower(),
            str(item.get("id", "")).lower(),
        ))

    ordered: List[Dict[str, Any]] = []
    visited: Set[str] = set()

    def append_chain(previous_id: str) -> None:
        """Ajoute recursivement les essais suivant un meme precedent."""
        for item in followers.get(previous_id, []):
            item_id = _normalize_test_id(item.get("id"))
            if not item_id or item_id in visited:
                continue
            visited.add(item_id)
            ordered.append(item)
            append_chain(item_id)

    append_chain("")

    # Les noeuds restants correspondent a des donnees anciennes ou incoherentes.
    # Ils sont conserves en fin de liste avec un precedent vide.
    for essai in essais:
        item_id = _normalize_test_id(essai.get("id"))
        if item_id and item_id not in visited:
            essai["previous_test_id"] = ""
            visited.add(item_id)
            ordered.append(essai)

    for index, essai in enumerate(ordered, start=1):
        essai["order_index"] = index * 10

    return _apply_automatic_order_numbers(ordered, essai_type)


def _would_create_cycle(essais: List[Dict[str, Any]], essai_id: str, previous_id: str) -> bool:
    """
    Verifie si une relation previous_test_id creerait un cycle.

    Le controle remonte la chaine des precedents depuis previous_id. Si l'essai
    courant est rencontre, la sauvegarde produirait une boucle A -> B -> A.
    """
    normalized_id = _normalize_test_id(essai_id)
    cursor = _normalize_test_id(previous_id)
    previous_by_id = {
        _normalize_test_id(essai.get("id")): _normalize_test_id(essai.get("previous_test_id"))
        for essai in essais
        if _normalize_test_id(essai.get("id"))
    }
    seen: Set[str] = set()

    while cursor:
        if cursor == normalized_id:
            return True
        if cursor in seen:
            return True
        seen.add(cursor)
        cursor = previous_by_id.get(cursor, "")

    return False


def _validate_previous_reference(essais: List[Dict[str, Any]], essai: Dict[str, Any]) -> None:
    """Controle la coherence minimale du test precedent avant persistance."""
    essai_id = _normalize_test_id(essai.get("id"))
    previous_id = _normalize_test_id(essai.get("previous_test_id"))
    essai["previous_test_id"] = previous_id

    if not previous_id:
        return

    if previous_id == essai_id:
        raise HTTPException(status_code=400, detail="Un essai ne peut pas se preceder lui-meme.")

    known_ids = {
        _normalize_test_id(item.get("id"))
        for item in essais
        if _normalize_test_id(item.get("id")) and _normalize_test_id(item.get("id")) != essai_id
    }
    if previous_id not in known_ids:
        raise HTTPException(status_code=400, detail=f"Test precedent introuvable: {previous_id}")

    if _would_create_cycle(essais, essai_id, previous_id):
        raise HTTPException(status_code=400, detail="Cycle detecte dans l'ordre manuel des essais.")


# ---------- endpoints ----------

@router.get("")
def list_essais(type: str = "ru") -> Dict[str, Any]:
    """Liste les essais d'un type donné."""
    essais = _ensure_order_fields(_load(type), type)
    return {"type": type, "count": len(essais), "essais": essais}


@router.get("/{essai_id}")
def get_essai(essai_id: str, type: str = "ru") -> Dict[str, Any]:
    """Récupère un essai par son ID."""
    essais = _ensure_order_fields(_load(type), type)
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
    essai_dict["type"] = essai_type
    _validate_previous_reference(essais, essai_dict)

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

    essais = _ensure_order_fields(essais, essai_type)
    _save(essai_type, essais)
    logger.info("[API][ESSAIS] Essai %s: %s (type=%s)", action, payload.id, essai_type)
    return {"success": True, "action": action, "id": payload.id}


@router.delete("/{essai_id}")
def delete_essai(essai_id: str, type: str = "ru") -> Dict[str, Any]:
    """Supprime un essai par son ID."""
    essais = _load(type)
    initial_count = len(essais)
    essais = [e for e in essais if e.get("id") != essai_id]

    if len(essais) == initial_count:
        raise HTTPException(status_code=404, detail=f"Essai {essai_id} introuvable")

    essais = _ensure_order_fields(essais, type)
    _save(type, essais)
    logger.info("[API][ESSAIS] Essai supprime: %s (type=%s)", essai_id, type)
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

        # Garde-fou de cohérence: on ne laisse pas un sync RU écrire des CVS/MVS/MVC
        # dans le fichier RU (et inversement).
        if item_type != essai_type:
            skipped_count += 1
            continue

        # Garde-fou additionnel: si l'ID suit la convention RU-/CVS-/MVS-/MVC-,
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
        if item_id.startswith("MVC-") and essai_type != "mvc":
            skipped_count += 1
            continue

        essai["type"] = essai_type
        if "updated_at" not in essai:
            essai["updated_at"] = now
        if "created_at" not in essai:
            essai["created_at"] = now

        filtered_essais.append(essai)

    for essai in filtered_essais:
        _validate_previous_reference(filtered_essais, essai)

    filtered_essais = _ensure_order_fields(filtered_essais, essai_type)
    _save(essai_type, filtered_essais)
    logger.info(
        "[API][ESSAIS] Sync %s essais (type=%s, ignores=%s)",
        len(filtered_essais),
        essai_type,
        skipped_count,
    )
    return {
        "success": True,
        "type": essai_type,
        "synced": len(filtered_essais),
        "skipped": skipped_count,
    }
