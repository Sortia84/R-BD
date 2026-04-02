# api/router_fcs.py
"""
Routeur FastAPI — Endpoints FCS (Fiches de Configuration Système)

Endpoints :
  GET    /api/fcs/list        → Lister les FCS du catalogue
  GET    /api/fcs/{fcs_id}    → Détails d'un FCS
  POST   /api/fcs/import      → Importer un fichier FCS
  DELETE /api/fcs/{fcs_id}    → Supprimer un FCS

Toute la logique métier est déléguée au FCSManager (core/fcs_manager.py).
Les instances partagées sont importées depuis api/shared.py.
"""

from __future__ import annotations

from fastapi import APIRouter, File, UploadFile, HTTPException

from api.shared import fcs_manager, logger


# ============================================================================
# ROUTEUR
# ============================================================================
router = APIRouter(
    prefix="/api/fcs",
    tags=["FCS"],
)


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/list")
async def list_fcs():
    """
    Lister tous les fichiers FCS du catalogue.

    Returns:
        Liste des entrées FCS avec leurs métadonnées
    """
    logger.info("[FCS][API] GET /api/fcs/list")
    catalog = fcs_manager.list_all()
    return {"fcs_list": catalog, "count": len(catalog)}


@router.get("/{fcs_id}")
async def get_fcs(fcs_id: str):
    """
    Récupérer les détails d'un fichier FCS.

    Args:
        fcs_id: Identifiant unique du FCS

    Returns:
        Détails du FCS
    """
    logger.info("[FCS][API] GET /api/fcs/%s", fcs_id)
    entry = fcs_manager.get_by_id(fcs_id)
    if not entry:
        raise HTTPException(status_code=404, detail=f"FCS introuvable : {fcs_id}")
    return entry


@router.post("/import")
async def import_fcs(file: UploadFile = File(...)):
    """
    Importer un fichier FCS dans le catalogue.

    Le fichier est copié dans uploads/fcs/ et indexé dans data/fcs/index.json.

    Args:
        file: Fichier FCS uploadé (multipart)

    Returns:
        Entrée FCS créée
    """
    logger.info("[FCS][API] POST /api/fcs/import — fichier: %s", file.filename)

    # Lire le contenu du fichier
    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier vide")

    # Déléguer au manager
    entry = fcs_manager.add(filename=file.filename, file_content=content)

    return {"status": "ok", "message": f"FCS importé : {file.filename}", "entry": entry}


@router.delete("/{fcs_id}")
async def delete_fcs(fcs_id: str):
    """
    Supprimer un fichier FCS du catalogue.

    Args:
        fcs_id: Identifiant du FCS à supprimer

    Returns:
        Confirmation de suppression
    """
    logger.info("[FCS][API] DELETE /api/fcs/%s", fcs_id)
    deleted = fcs_manager.delete(fcs_id)
    if not deleted:
        raise HTTPException(status_code=404, detail=f"FCS introuvable : {fcs_id}")
    return {"status": "ok", "message": f"FCS supprimé : {fcs_id}"}
