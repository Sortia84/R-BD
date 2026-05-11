"""router_essais_parameters.py - Parametrage des essais R#BD.

Ce routeur expose le catalogue "Injections" utilise par l'editeur d'essais :
- fonctions issues des fichiers PAR ;
- parametres disponibles par fonction ;
- valeurs et bornes utiles pour R#GUIDE.
"""

from __future__ import annotations

from typing import Any, Dict

from fastapi import APIRouter, File, HTTPException, UploadFile

from api.shared import logger, test_parameter_manager


router = APIRouter(prefix="/api/essais/parameters", tags=["essais-parameters"])


@router.get("")
def get_test_parameters() -> Dict[str, Any]:
    """Retourner le catalogue courant de parametrage des essais."""
    return test_parameter_manager.load()


@router.put("")
def save_test_parameters(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Sauvegarder les fonctions et parametres modifies depuis l'IHM."""
    saved = test_parameter_manager.save(payload)
    logger.info(
        "[API][ESSAIS][PARAM] Catalogue sauvegarde (%s fonction(s))",
        len(saved.get("functions", [])),
    )
    return saved


@router.post("/import")
async def import_test_parameters(file: UploadFile = File(...)) -> Dict[str, Any]:
    """Importer un fichier PAR et remplacer le catalogue de parametrage."""
    filename = file.filename or ""
    if not filename.lower().endswith((".par", ".xml")):
        raise HTTPException(status_code=400, detail="Le fichier doit etre un .par ou .xml")

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="Fichier PAR vide")

    try:
        catalog = test_parameter_manager.import_from_bytes(content, filename)
    except Exception as exc:  # pragma: no cover - garde-fou FastAPI
        logger.exception("[API][ESSAIS][PARAM] Import PAR impossible: %s", filename)
        raise HTTPException(status_code=400, detail=f"Import PAR impossible: {exc}") from exc

    saved = test_parameter_manager.save(catalog)
    logger.info(
        "[API][ESSAIS][PARAM] Import PAR %s (%s fonction(s))",
        filename,
        len(saved.get("functions", [])),
    )
    return saved
