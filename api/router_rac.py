# api/router_rac.py
"""
Routeur FastAPI — Endpoints RAC (Raccordements)

Endpoints :
  GET    /api/rac/list        → Lister les RAC du catalogue
  GET    /api/rac/{rac_id}    → Détails d'un RAC
  POST   /api/rac/import      → Importer un fichier RAC
  DELETE /api/rac/{rac_id}    → Supprimer un RAC

Toute la logique métier est déléguée au RACManager (core/rac_manager.py).
Les instances partagées sont importées depuis api/shared.py.
"""

from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, HTTPException

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


@router.post("/import")
async def import_rac(file: UploadFile = File(...)):
    """
    Importer un fichier RAC dans le catalogue.

    Le fichier est copié dans uploads/rac/ et indexé dans data/rac/index.json.

    Args:
        file: Fichier RAC uploadé (multipart)

    Returns:
        Entrée RAC créée
    """
    logger.info("[RAC][API] POST /api/rac/import — fichier: %s", file.filename)

    # Lire le contenu du fichier
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")

    # Déléguer au manager
    entry = rac_manager.add(filename=file.filename, file_content=content)

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
