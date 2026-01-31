# icd_api.py - API REST pour la gestion des ICD
"""
Endpoints FastAPI pour l'import, listing et gestion des ICD.
Structure de stockage : data/icd/{type}/{manufacturer}/{version}.json

Inclut aussi la gestion des patterns IED et leurs liaisons.
"""

from pathlib import Path
from typing import Any
import shutil
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from core.icd_parser import ICDParser
from core.ied_pattern_manager import IEDPatternManager

router = APIRouter(prefix="/api/icd", tags=["ICD"])

# Parser et managers partagés
BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
UPLOADS_DIR = BASE_DIR / "uploads" / "ICD"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

parser = ICDParser(data_dir=DATA_DIR)
pattern_manager = IEDPatternManager(data_dir=DATA_DIR)


@router.get("/")
async def get_catalog() -> dict[str, Any]:
    """Retourne le catalogue complet des ICD (index global)."""
    catalog = parser.get_catalog()
    index = parser.load_index()
    return {
        "count": len(catalog),
        "icds": catalog,
        "last_updated": index.get("last_updated")
    }


@router.get("/types")
async def get_ied_types() -> list[str]:
    """Retourne la liste des types d'IED disponibles."""
    return parser.get_ied_types()


@router.get("/manufacturers")
async def get_manufacturers() -> list[str]:
    """Retourne la liste des constructeurs disponibles."""
    return parser.get_manufacturers()


@router.get("/details/{ied_type}/{manufacturer}/{version}")
async def get_icd_details(ied_type: str, manufacturer: str, version: str) -> dict[str, Any]:
    """Retourne les détails complets d'un ICD depuis son fichier JSON dédié."""
    details = parser.get_icd_details(ied_type, manufacturer, version)
    if not details:
        raise HTTPException(status_code=404, detail="ICD non trouvé")
    return details


@router.get("/versions/{ied_type}/{manufacturer}")
async def get_versions(ied_type: str, manufacturer: str) -> list[dict[str, Any]]:
    """Retourne toutes les versions pour un type/manufacturer donné."""
    return parser.get_versions_for_type(ied_type, manufacturer)


@router.post("/upload")
async def upload_icd(file: UploadFile = File(...)) -> dict[str, Any]:
    """
    Upload et parse un fichier ICD.
    Sauvegarde chaque ICD dans data/icd/{type}/{manufacturer}/{version}.json
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Nom de fichier manquant")

    # Vérifier l'extension
    ext = Path(file.filename).suffix.lower()
    if ext not in (".icd", ".xml"):
        raise HTTPException(status_code=400, detail="Extension non supportée (attendu: .icd ou .xml)")

    # Sauvegarder temporairement le fichier
    temp_id = uuid.uuid4().hex[:8]
    temp_path = UPLOADS_DIR / f"{temp_id}_{file.filename}"

    try:
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Parser et sauvegarder (1 JSON par ICD)
        results = parser.import_icd(temp_path)

        return {
            "success": True,
            "filename": file.filename,
            "entries": results,
            "message": f"{len(results)} ICD importé(s) et sauvegardé(s)"
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur interne: {e}") from e


@router.post("/parse-existing")
async def parse_existing_files() -> dict[str, Any]:
    """
    Parse tous les fichiers ICD présents dans le dossier uploads/ICD.
    Utile pour réimporter en masse.
    """
    if not UPLOADS_DIR.exists():
        return {"success": True, "parsed": 0, "entries": []}

    all_entries = []
    errors = []

    for file_path in list(UPLOADS_DIR.glob("*.icd")) + list(UPLOADS_DIR.glob("*.xml")):
        try:
            results = parser.import_icd(file_path)
            all_entries.extend(results)
        except ValueError as e:
            errors.append({"file": file_path.name, "error": str(e)})

    return {
        "success": True,
        "parsed": len(all_entries),
        "entries": all_entries,
        "errors": errors
    }


@router.delete("/{ied_type}/{manufacturer}/{version}")
async def delete_icd(ied_type: str, manufacturer: str, version: str) -> dict[str, Any]:
    """Supprime un ICD (fichier JSON + entrée index)."""
    deleted = parser.delete_icd(ied_type, manufacturer, version)
    if not deleted:
        raise HTTPException(status_code=404, detail="ICD non trouvé")

    return {"success": True, "deleted": f"{ied_type}/{manufacturer}/{version}"}


@router.post("/reanalyze/{ied_type}/{manufacturer}/{version}")
async def reanalyze_icd(ied_type: str, manufacturer: str, version: str) -> dict[str, Any]:
    """
    Relance l'analyse d'un ICD existant à partir du fichier source.
    Recherche le fichier original dans uploads/ICD.
    """
    # Chercher le fichier source correspondant
    details = parser.get_icd_details(ied_type, manufacturer, version)
    if not details:
        raise HTTPException(status_code=404, detail="ICD non trouvé")

    filename = details.get("filename", "")
    source_files = list(UPLOADS_DIR.glob(f"*{filename}")) if filename else []

    if not source_files:
        raise HTTPException(status_code=404, detail=f"Fichier source non trouvé: {filename}")

    # Réimporter
    try:
        results = parser.import_icd(source_files[0])
        return {
            "success": True,
            "message": "ICD ré-analysé avec succès",
            "entries": results
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.post("/reanalyze-all")
async def reanalyze_all() -> dict[str, Any]:
    """Relance l'analyse de tous les fichiers ICD dans uploads/ICD."""
    if not UPLOADS_DIR.exists():
        return {"success": True, "reanalyzed": 0, "entries": []}

    all_entries = []
    errors = []

    for file_path in list(UPLOADS_DIR.glob("*.icd")) + list(UPLOADS_DIR.glob("*.xml")):
        try:
            results = parser.import_icd(file_path)
            all_entries.extend(results)
        except ValueError as e:
            errors.append({"file": file_path.name, "error": str(e)})

    return {
        "success": True,
        "reanalyzed": len(all_entries),
        "entries": all_entries,
        "errors": errors
    }


# ============================================================
# Endpoints Patterns IED
# ============================================================

@router.get("/patterns")
async def get_ied_patterns() -> dict[str, Any]:
    """Retourne la liste des patterns IED."""
    data = pattern_manager.load_patterns()
    return {
        "version": data.get("version", "1.0"),
        "count": len(data.get("ied_patterns", [])),
        "patterns": data.get("ied_patterns", [])
    }


@router.get("/patterns/{pattern_id}")
async def get_pattern(pattern_id: str) -> dict[str, Any]:
    """Retourne un pattern IED par son ID."""
    pattern = pattern_manager.get_pattern_by_id(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail="Pattern non trouvé")
    return pattern


@router.get("/patterns/{pattern_id}/icds")
async def get_pattern_icds(pattern_id: str) -> dict[str, Any]:
    """Retourne les ICD liés à un pattern."""
    pattern = pattern_manager.get_pattern_by_id(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail="Pattern non trouvé")

    icd_refs = pattern.get("icd_refs", [])
    return {
        "pattern_id": pattern_id,
        "icd_count": len(icd_refs),
        "icd_refs": icd_refs
    }


class LinkRequest(BaseModel):
    """Requête de liaison ICD-Pattern."""
    icd_path: str


@router.post("/patterns/{pattern_id}/link")
async def link_icd_to_pattern(pattern_id: str, request: LinkRequest) -> dict[str, Any]:
    """Lie un ICD à un pattern IED."""
    success = pattern_manager.link_icd_to_pattern(pattern_id, request.icd_path)
    if not success:
        raise HTTPException(status_code=404, detail="Pattern non trouvé")

    return {"success": True, "pattern_id": pattern_id, "icd_path": request.icd_path}


@router.post("/patterns/{pattern_id}/unlink")
async def unlink_icd_from_pattern(pattern_id: str, request: LinkRequest) -> dict[str, Any]:
    """Supprime la liaison entre un ICD et un pattern IED."""
    success = pattern_manager.unlink_icd_from_pattern(pattern_id, request.icd_path)
    if not success:
        raise HTTPException(status_code=404, detail="Pattern ou liaison non trouvé")

    return {"success": True, "pattern_id": pattern_id, "icd_path": request.icd_path, "unlinked": True}


@router.get("/match/{ied_name}")
async def match_ied_name(ied_name: str) -> dict[str, Any]:
    """
    Trouve les patterns qui matchent un nom d'IED du SCD.
    Utile pour l'intégration avec R#SCD.
    """
    matches = pattern_manager.match_ied_name(ied_name)
    best_match = matches[0] if matches else None

    return {
        "ied_name": ied_name,
        "match_count": len(matches),
        "best_match": best_match,
        "all_matches": matches
    }


@router.get("/suggest/{icd_type}")
async def suggest_patterns_for_icd(icd_type: str) -> dict[str, Any]:
    """
    Suggère des patterns IED pour un type d'ICD.
    Aide à la liaison automatique.
    """
    suggestions = pattern_manager.suggest_pattern_for_icd(icd_type)
    return {
        "icd_type": icd_type,
        "suggestion_count": len(suggestions),
        "suggestions": suggestions
    }

