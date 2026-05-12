# router_essais.py — CRUD essais R#BD avec persistance JSON serveur
"""
Endpoints pour gérer les essais (tests) RU / CVS / MVS / MVC.
Stockage : data/essais/essais_{type}.json
Auto-save côté serveur à chaque sauvegarde d'essai.
"""

from __future__ import annotations

import json
import re
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

# Import centralisé depuis shared.py
from api.shared import (
    ESSAIS_DATA_DIR as DATA_DIR,
    UPLOADS_DIR,
    VALID_ESSAI_TYPES as VALID_TYPES,
    EssaiPayload,
    SyncPayload,
    logger,
)

router = APIRouter(prefix="/api/essais", tags=["essais"])

ESSAIS_UPLOADS_DIR = UPLOADS_DIR / "essais"
ESSAIS_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


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


def _normalise_scope(value: Any) -> str:
    """
    Normalise le perimetre de rattachement d'un essai.

    `function` garde le comportement historique : l'essai est rapproche d'un
    IED / LD / LN du SCD par R#GUIDE. `generic` indique un essai global qui ne
    doit jamais entrer dans le matching SCD classique.
    """
    text = str(value or "function").strip().lower()
    if text in {"generic", "generique", "global", "general"}:
        return "generic"
    return "function"


def _safe_path_part(value: Any, fallback: str = "item") -> str:
    """
    Nettoie une portion de chemin stockee sous `uploads/essais`.

    Les identifiants metier peuvent contenir des espaces ou caracteres Windows
    interdits. On conserve uniquement une forme portable pour le stockage disque.
    """
    text = str(value or "").strip()
    cleaned = re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("._-")
    return cleaned or fallback


def _safe_filename(filename: Any) -> str:
    """
    Nettoie un nom de fichier sans imposer d'extension.

    Le besoin utilisateur est d'accepter tout type de piece jointe. On ne filtre
    donc pas les extensions ; on neutralise seulement les separateurs de chemin.
    """
    raw_name = Path(str(filename or "piece_jointe")).name
    cleaned = re.sub(r"[^A-Za-z0-9_.() -]+", "_", raw_name).strip(" .")
    return cleaned or "piece_jointe"


def _attachment_list(essai: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Retourne la liste canonique des pieces jointes d'un essai.

    `attachments` devient le champ cible. `files` reste synchronise pour les
    ecrans existants et pour R#GUIDE qui sait deja afficher `test.files`.
    """
    raw_items = essai.get("attachments")
    if not isinstance(raw_items, list):
        raw_items = essai.get("files") if isinstance(essai.get("files"), list) else []

    attachments: List[Dict[str, Any]] = []
    for index, item in enumerate(raw_items):
        if isinstance(item, dict):
            file_id = str(item.get("id") or f"att_legacy_{index}").strip()
            name = str(item.get("name") or item.get("filename") or item.get("original_name") or file_id).strip()
            attachments.append({
                **item,
                "id": file_id,
                "name": name,
                "filename": str(item.get("filename") or name),
            })

    return attachments


def _sync_attachment_aliases(essai: Dict[str, Any]) -> Dict[str, Any]:
    """
    Aligne `attachments` et `files` sur une meme liste de metadonnees.

    Cette compatibilite evite de casser les anciennes vues tout en donnant un
    nom metier plus clair au nouveau contrat API.
    """
    attachments = _attachment_list(essai)
    essai["attachments"] = attachments
    essai["files"] = attachments
    return essai


def _normalise_essai_for_storage(essai: Dict[str, Any], essai_type: str) -> Dict[str, Any]:
    """
    Prepare un essai avant exposition ou persistance JSON.

    Les essais generiques sont volontairement detaches des champs IEC 61850 afin
    que R#GUIDE ne puisse pas les confondre avec des essais fonctionnels.
    """
    essai["type"] = str(essai.get("type") or essai_type).lower()
    essai["scope"] = _normalise_scope(essai.get("scope"))

    if essai["scope"] == "generic":
        essai["ied"] = ""
        essai["variant"] = ""
        essai["ld"] = ""
        essai["ln"] = ""
        essai["lninst"] = ""

    return _sync_attachment_aliases(essai)


def _attachment_dir(essai_type: str, essai_id: str, attachment_id: str) -> Path:
    """Construit le dossier de stockage d'une piece jointe."""
    return (
        ESSAIS_UPLOADS_DIR
        / _safe_path_part(essai_type, "type")
        / _safe_path_part(essai_id, "essai")
        / _safe_path_part(attachment_id, "attachment")
    )


def _find_essai(essais: List[Dict[str, Any]], essai_id: str) -> Optional[Dict[str, Any]]:
    """Retrouve un essai dans une liste chargee depuis le JSON."""
    target_id = _normalize_test_id(essai_id)
    for essai in essais:
        if _normalize_test_id(essai.get("id")) == target_id:
            return essai
    return None


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
    essais = [
        _normalise_essai_for_storage(essai, type)
        for essai in _ensure_order_fields(_load(type), type)
    ]
    return {"type": type, "count": len(essais), "essais": essais}


@router.get("/{essai_id}")
def get_essai(essai_id: str, type: str = "ru") -> Dict[str, Any]:
    """Récupère un essai par son ID."""
    essais = [
        _normalise_essai_for_storage(essai, type)
        for essai in _ensure_order_fields(_load(type), type)
    ]
    for e in essais:
        if e.get("id") == essai_id:
            return e
    raise HTTPException(status_code=404, detail=f"Essai {essai_id} introuvable")


@router.post("")
def create_or_update_essai(payload: EssaiPayload) -> Dict[str, Any]:
    """Crée ou met à jour un essai (upsert par ID)."""
    essai_type = payload.type.lower()
    essais = _load(essai_type)

    essai_dict = _normalise_essai_for_storage(payload.model_dump(), essai_type)
    essai_dict["updated_at"] = datetime.now().isoformat()
    essai_dict["type"] = essai_type
    _validate_previous_reference(essais, essai_dict)

    # Upsert
    existing_idx = next((i for i, e in enumerate(essais) if e.get("id") == payload.id), None)
    if existing_idx is not None:
        existing_attachments = _attachment_list(essais[existing_idx])
        if existing_attachments and not _attachment_list(essai_dict):
            essai_dict["attachments"] = existing_attachments
            essai_dict["files"] = existing_attachments
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


@router.post("/{essai_id}/attachments")
async def upload_essai_attachment(
    essai_id: str,
    type: str = "ru",
    file: UploadFile = File(...),
) -> Dict[str, Any]:
    """
    Ajoute une piece jointe a un essai R#BD, sans restriction d'extension.

    Le fichier binaire est stocke sous `uploads/essais`, tandis que le JSON
    d'essai conserve seulement les metadonnees utiles a R#GUIDE.
    """
    essai_type = type.lower()
    _file_for_type(essai_type)

    if not _normalize_test_id(essai_id):
        raise HTTPException(status_code=400, detail="Identifiant d'essai requis")
    if not file.filename:
        raise HTTPException(status_code=400, detail="Nom de fichier manquant")

    essais = _load(essai_type)
    essai = _find_essai(essais, essai_id)
    now = datetime.now().isoformat()

    # Un utilisateur peut ajouter une piece jointe avant la premiere sauvegarde
    # complete du formulaire. On cree alors une fiche minimale qui sera enrichie
    # par le POST /api/essais au moment de la sauvegarde.
    if essai is None:
        essai = {
            "id": essai_id,
            "type": essai_type,
            "scope": "function",
            "name": "",
            "created_at": now,
            "updated_at": now,
            "attachments": [],
            "files": [],
        }
        essais.append(essai)

    attachment_id = f"att_{uuid.uuid4().hex[:12]}"
    safe_name = _safe_filename(file.filename)
    target_dir = _attachment_dir(essai_type, essai_id, attachment_id)
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / safe_name

    raw_content = await file.read()
    with open(target_path, "wb") as output:
        output.write(raw_content)

    metadata = {
        "id": attachment_id,
        "name": file.filename,
        "filename": file.filename,
        "stored_filename": safe_name,
        "content_type": file.content_type or "application/octet-stream",
        "size": len(raw_content),
        "uploaded_at": now,
        "download_url": f"/api/essais/{essai_id}/attachments/{attachment_id}?type={essai_type}",
    }

    attachments = _attachment_list(essai)
    attachments.append(metadata)
    essai["attachments"] = attachments
    essai["files"] = attachments
    essai["updated_at"] = now

    essais = _ensure_order_fields(essais, essai_type)
    _save(essai_type, essais)
    logger.info("[API][ESSAIS] Piece jointe ajoutee: %s (essai=%s, type=%s)", attachment_id, essai_id, essai_type)
    return {"success": True, "attachment": metadata}


@router.get("/{essai_id}/attachments/{attachment_id}")
def download_essai_attachment(
    essai_id: str,
    attachment_id: str,
    type: str = "ru",
) -> FileResponse:
    """Telecharge une piece jointe d'essai sans exposer le chemin disque."""
    essai_type = type.lower()
    essais = _load(essai_type)
    essai = _find_essai(essais, essai_id)
    if not essai:
        raise HTTPException(status_code=404, detail=f"Essai {essai_id} introuvable")

    attachment = next(
        (item for item in _attachment_list(essai) if str(item.get("id") or "") == attachment_id),
        None,
    )
    if not attachment:
        raise HTTPException(status_code=404, detail=f"Piece jointe {attachment_id} introuvable")

    stored_filename = _safe_filename(
        attachment.get("stored_filename")
        or attachment.get("filename")
        or attachment.get("name")
    )
    file_path = _attachment_dir(essai_type, essai_id, attachment_id) / stored_filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="Fichier physique introuvable")

    return FileResponse(
        file_path,
        media_type=attachment.get("content_type") or "application/octet-stream",
        filename=attachment.get("filename") or attachment.get("name") or stored_filename,
    )


@router.delete("/{essai_id}/attachments/{attachment_id}")
def delete_essai_attachment(
    essai_id: str,
    attachment_id: str,
    type: str = "ru",
) -> Dict[str, Any]:
    """Supprime une piece jointe d'essai et son fichier physique."""
    essai_type = type.lower()
    essais = _load(essai_type)
    essai = _find_essai(essais, essai_id)
    if not essai:
        raise HTTPException(status_code=404, detail=f"Essai {essai_id} introuvable")

    attachments = _attachment_list(essai)
    kept = [item for item in attachments if str(item.get("id") or "") != attachment_id]
    if len(kept) == len(attachments):
        raise HTTPException(status_code=404, detail=f"Piece jointe {attachment_id} introuvable")

    essai["attachments"] = kept
    essai["files"] = kept
    essai["updated_at"] = datetime.now().isoformat()

    attachment_folder = _attachment_dir(essai_type, essai_id, attachment_id)
    if attachment_folder.exists():
        shutil.rmtree(attachment_folder)

    essais = _ensure_order_fields(essais, essai_type)
    _save(essai_type, essais)
    logger.info("[API][ESSAIS] Piece jointe supprimee: %s (essai=%s, type=%s)", attachment_id, essai_id, essai_type)
    return {"success": True, "deleted": attachment_id}


@router.delete("/{essai_id}")
def delete_essai(essai_id: str, type: str = "ru") -> Dict[str, Any]:
    """Supprime un essai par son ID."""
    essai_type = type.lower()
    essais = _load(essai_type)
    initial_count = len(essais)
    essais = [e for e in essais if e.get("id") != essai_id]

    if len(essais) == initial_count:
        raise HTTPException(status_code=404, detail=f"Essai {essai_id} introuvable")

    attachment_root = ESSAIS_UPLOADS_DIR / _safe_path_part(essai_type, "type") / _safe_path_part(essai_id, "essai")
    if attachment_root.exists():
        shutil.rmtree(attachment_root)

    essais = _ensure_order_fields(essais, essai_type)
    _save(essai_type, essais)
    logger.info("[API][ESSAIS] Essai supprime: %s (type=%s)", essai_id, essai_type)
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
    existing_by_id = {
        _normalize_test_id(item.get("id")): item
        for item in _load(essai_type)
        if _normalize_test_id(item.get("id"))
    }

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

        essai = _normalise_essai_for_storage(dict(essai), essai_type)
        existing_attachments = _attachment_list(existing_by_id.get(_normalize_test_id(essai.get("id")), {}))
        if existing_attachments and not _attachment_list(essai):
            # Protection importante : un ancien localStorage sans pieces jointes
            # ne doit pas effacer silencieusement les fichiers deja uploades.
            essai["attachments"] = existing_attachments
            essai["files"] = existing_attachments

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
