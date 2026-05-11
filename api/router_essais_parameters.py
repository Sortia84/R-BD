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
from core.test_parameter_manager import TestParameterValidationError


router = APIRouter(prefix="/api/essais/parameters", tags=["essais-parameters"])


@router.get("")
def get_test_parameters() -> Dict[str, Any]:
    """Retourner le catalogue courant de parametrage des essais."""
    return test_parameter_manager.load()


@router.put("")
def save_test_parameters(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Sauvegarder les fonctions et parametres modifies depuis l'IHM.

    En cas d'echec de validation metier (champ obligatoire manquant, etc.),
    une reponse HTTP 400 detaillee est retournee. Le frontend exploite la
    structure de `detail` pour mettre en evidence les cellules concernees
    dans le tableau d'edition.
    """
    try:
        saved = test_parameter_manager.save(payload)
    except TestParameterValidationError as exc:
        # Conversion explicite en 400 : les erreurs metier ne doivent jamais
        # remonter en 500. La liste `errors` est exposee telle quelle pour
        # permettre un affichage cellule par cellule cote IHM.
        logger.warning(
            "[API][ESSAIS][PARAM] Sauvegarde refusee : %s erreur(s)",
            len(exc.errors),
        )
        raise HTTPException(
            status_code=400,
            detail={
                "message": "Catalogue invalide",
                "errors": exc.errors,
            },
        ) from exc

    logger.info(
        "[API][ESSAIS][PARAM] Catalogue sauvegarde (%s fonction(s))",
        len(saved.get("functions", [])),
    )
    return saved


@router.post("/import")
async def import_test_parameters(file: UploadFile = File(...)) -> Dict[str, Any]:
    """Importer un fichier PAR et remplacer le catalogue de parametrage.

    Le fichier PAR sert uniquement a accelerer la saisie du tableau : aucune
    metadonnee de tracabilite (nom du fichier, date d'import) n'est stockee
    dans le catalogue final.
    """
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

    # On retourne le catalogue importe SANS le persister : la sauvegarde
    # definitive reste a la charge de l'utilisateur (bouton Sauvegarder),
    # ce qui evite d'ecraser un catalogue existant tant que la saisie n'a
    # pas ete validee dans le tableau.
    logger.info(
        "[API][ESSAIS][PARAM] Import PAR %s (%s fonction(s)) - non persiste",
        filename,
        len(catalog.get("functions", [])),
    )
    return catalog
