# api/router_rac.py
"""
Routeur FastAPI — Endpoints RAC (Raccordements)

Endpoints :
    GET    /api/rac/categories           → Lister les catégories RAC
  GET    /api/rac/list        → Lister les RAC du catalogue
    GET    /api/rac/grouped             → Lister les RAC groupés (catégorie + rac_key)
    GET    /api/rac/versions/{category_id}/{rac_key} → Historique des versions d'un groupe
    GET    /api/rac/links               → Index de liens câblage (usage R#SCD BayView)
  GET    /api/rac/{rac_id}    → Détails d'un RAC
    GET    /api/rac/{rac_id}/parsed     → JSON RAC normalisé
  POST   /api/rac/import      → Importer un fichier RAC
  DELETE /api/rac/{rac_id}    → Supprimer un RAC

Toute la logique métier est déléguée au RACManager (core/rac_manager.py).
Les instances partagées sont importées depuis api/shared.py.
"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, File, Form, UploadFile, HTTPException, Query

from api.shared import rac_manager, logger


# ============================================================================
# ROUTEUR
# ============================================================================
router = APIRouter(
    prefix="/api/rac",
    tags=["RAC"],
)


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/categories")
async def list_rac_categories():
    """Retourner les catégories RAC disponibles."""
    logger.info("[RAC][API] GET /api/rac/categories")
    categories = rac_manager.get_categories()
    return {"categories": categories, "count": len(categories)}

@router.get("/list")
async def list_rac():
    """
    Lister tous les fichiers RAC du catalogue.

    Returns:
        Liste des entrées RAC avec leurs métadonnées
    """
    logger.info("[RAC][API] GET /api/rac/list")
    catalog = rac_manager.list_all()
    return {"rac_list": catalog, "count": len(catalog)}


@router.get("/grouped")
async def list_rac_grouped(category_id: Optional[str] = Query(default=None)):
    """
    Lister les RAC groupés par catégorie + clé logique (rac_key),
    avec les versions triées par récence.
    """
    logger.info("[RAC][API] GET /api/rac/grouped?category_id=%s", category_id)
    groups = rac_manager.list_grouped(category_id=category_id)
    return {"groups": groups, "count": len(groups)}


@router.get("/versions/{category_id}/{rac_key}")
async def get_rac_versions(category_id: str, rac_key: str):
    """Retourner l'historique des versions pour un groupe RAC."""
    logger.info("[RAC][API] GET /api/rac/versions/%s/%s", category_id, rac_key)
    versions = rac_manager.get_versions(category_id=category_id, rac_key=rac_key)
    return {
        "category_id": category_id,
        "rac_key": rac_key,
        "versions": versions,
        "count": len(versions),
    }


@router.get("/links")
async def get_rac_links(
    rac_id: Optional[str] = Query(default=None),
    category_id: Optional[str] = Query(default=None),
    rac_key: Optional[str] = Query(default=None),
    latest: bool = Query(default=True),
    signal_label: Optional[str] = Query(default=None),
    signal_type: Optional[str] = Query(default=None),
    terminal_name: Optional[str] = Query(default=None),
    equipment_type: Optional[str] = Query(default=None),
):
    """
    Retourner un index de liens câblage RAC (flat), destiné à l'intégration R#SCD.

    Cas d'usage principal : BayView, corrélation entre I/O SCD et câblage théorique.
    """
    logger.info(
        "[RAC][API] GET /api/rac/links rac_id=%s category_id=%s rac_key=%s latest=%s",
        rac_id,
        category_id,
        rac_key,
        latest,
    )

    payload = rac_manager.get_link_map(
        rac_id=rac_id,
        category_id=category_id,
        rac_key=rac_key,
        latest=latest,
        signal_label=signal_label,
        signal_type=signal_type,
        terminal_name=terminal_name,
        equipment_type=equipment_type,
    )
    return payload


@router.get("/{rac_id}")
async def get_rac(rac_id: str):
    """
    Récupérer les détails d'un fichier RAC.

    Args:
        rac_id: Identifiant unique du RAC

    Returns:
        Détails du RAC
    """
    logger.info("[RAC][API] GET /api/rac/%s", rac_id)
    entry = rac_manager.get_by_id(rac_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"RAC introuvable : {rac_id}")
    return entry


@router.get("/{rac_id}/parsed")
async def get_rac_parsed(rac_id: str):
    """Retourner le JSON RAC normalisé (records de câblage)."""
    logger.info("[RAC][API] GET /api/rac/%s/parsed", rac_id)
    payload = rac_manager.get_parsed_payload(rac_id)
    if not payload:
        raise HTTPException(status_code=404, detail=f"JSON RAC introuvable : {rac_id}")
    return payload


@router.post("/import")
async def import_rac(
    file: UploadFile = File(...),
    category_id: str = Form(...),
):
    """
    Importer un fichier RAC dans le catalogue.

    Le fichier est validé (onglet contenant 'RAC' obligatoire), puis:
    - copié dans uploads/rac/
    - parsé en JSON normalisé dans data/rac/files/
    - indexé dans data/rac/index.json

    Args:
        file: Fichier RAC uploadé (multipart)
        category_id: Catégorie RAC (rac_ligne_d / rac_cbo_d / rac_tg_d)

    Returns:
        Entrée RAC créée
    """
    logger.info(
        "[RAC][API] POST /api/rac/import — fichier: %s, category: %s",
        file.filename,
        category_id,
    )

    # Lire le contenu du fichier
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")

    # Déléguer au manager.
    # En cas d'erreur de validation métier (ex: onglet RAC absent),
    # on renvoie une 422 explicite côté API.
    try:
        entry = rac_manager.add(
            filename=file.filename,
            file_content=content,
            category_id=category_id,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    return {"status": "ok", "message": f"RAC importé : {file.filename}", "entry": entry}


@router.delete("/{rac_id}")
async def delete_rac(rac_id: str):
    """
    Supprimer un fichier RAC du catalogue.

    Args:
        rac_id: Identifiant du RAC à supprimer

    Returns:
        Confirmation de suppression
    """
    logger.info("[RAC][API] DELETE /api/rac/%s", rac_id)
    deleted = rac_manager.delete(rac_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"RAC introuvable : {rac_id}")
    return {"status": "ok", "message": f"RAC supprimé : {rac_id}"}
