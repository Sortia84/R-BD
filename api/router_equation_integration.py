"""API d'intégration R#SCD : catalogue et résolution stricte des équations.

Ces routes bénéficient du middleware d'authentification R-CONTROL installé par
api_web. Elles ne réanalysent jamais les fichiers et n'exposent aucun chemin hôte.
"""

from fastapi import APIRouter, HTTPException, Query

from api.shared import isa_manager
from core.equation_catalog import EquationCatalog, EquationCatalogError


router = APIRouter(prefix="/api/integrations/rscd/v1/equations", tags=["Intégration R#SCD"])


@router.get("")
def list_equations() -> dict:
    """Liste toutes les versions importées et leur état d'exploitation."""
    return EquationCatalog(isa_manager).list_files()


@router.get("/resolve")
def resolve_equation(version: str = Query(..., min_length=1),
                     file_id: str | None = Query(None, min_length=1)) -> dict:
    """Livre uniquement l'analyse valide du XML de version exactement demandée."""
    try:
        return EquationCatalog(isa_manager).resolve(version, file_id)
    except EquationCatalogError as exc:
        raise HTTPException(status_code=exc.status, detail=exc.detail) from exc
