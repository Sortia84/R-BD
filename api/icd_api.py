# icd_api.py - API REST pour la gestion des ICD
"""
Endpoints FastAPI pour l'import, listing et gestion des ICD.
Structure de stockage : data/icd/{filename}.json (1 fichier par ICD)

Parser complet IEC 61850 avec extraction :
- DO/DA avec résolution depuis DataTypeTemplates
- Private elements (COMPAS-IEDType, SCLE_IDPACK, firmware, etc.)
- Control Blocks (GOOSE, Report, SV)
- DataSets avec FCDA
- Inputs/ExtRef (abonnements)

Inclut aussi la gestion des patterns IED et leurs liaisons.
"""

from pathlib import Path
from typing import Any
import shutil
import uuid

from fastapi import APIRouter, File, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from core.icd_parser import ICDParserV2 as ICDParser
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


@router.get("/details/{icd_id}")
async def get_icd_details(icd_id: str) -> dict[str, Any]:
    """Retourne les détails complets d'un ICD par son icd_id."""
    details = parser.get_icd_details_by_id(icd_id)
    if not details:
        raise HTTPException(status_code=404, detail="ICD non trouvé")
    return details


@router.get("/full/{icd_id}")
async def get_icd_full(icd_id: str, include_types: bool = False) -> dict[str, Any]:
    """
    Retourne les détails COMPLETS d'un ICD incluant :
    - IED avec tous les LD, LN, DO, DA résolus
    - Privates (COMPAS-IEDType, SCLE_IDPACK, firmware, etc.)
    - DataSets avec FCDA
    - Control Blocks (GOOSE, Report, SV)
    - Inputs/ExtRef
    - DataTypeTemplates (si include_types=true)

    Args:
        icd_id: Identifiant unique de l'ICD
        include_types: Si True, inclut les DataTypeTemplates complets
    """
    details = parser.get_icd_details_by_id(icd_id)
    if not details:
        raise HTTPException(status_code=404, detail="ICD non trouvé")

    # Par défaut, ne pas inclure DataTypeTemplates (lourd)
    if not include_types and "data_type_templates" in details:
        # Garder juste les stats
        dtt = details.get("data_type_templates", {})
        details["data_type_templates"] = {
            "lnode_types_count": len(dtt.get("lnode_types", {})),
            "do_types_count": len(dtt.get("do_types", {})),
            "da_types_count": len(dtt.get("da_types", {})),
            "enum_types_count": len(dtt.get("enum_types", {})),
            "_note": "Ajouter ?include_types=true pour les types complets"
        }

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


@router.delete("/{icd_id}")
async def delete_icd(icd_id: str) -> dict[str, Any]:
    """Supprime un ICD par son icd_id (fichier JSON + entrée index)."""
    deleted = parser.delete_icd(icd_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="ICD non trouvé")

    return {"success": True, "deleted": icd_id}


@router.post("/reanalyze/{icd_id}")
async def reanalyze_icd(icd_id: str) -> dict[str, Any]:
    """
    Relance l'analyse d'un ICD existant à partir du fichier source.
    Recherche le fichier original dans uploads/ICD.
    """
    # Chercher le fichier source correspondant
    details = parser.get_icd_details_by_id(icd_id)
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
    icd_path: str | None = None
    icd_id: str | None = None


@router.post("/patterns/{pattern_id}/link")
async def link_icd_to_pattern(pattern_id: str, request: LinkRequest) -> dict[str, Any]:
    """Lie un ICD à un pattern IED."""
    # Utiliser icd_id en priorité, sinon icd_path pour rétrocompatibilité
    ref = request.icd_id or request.icd_path
    if not ref:
        raise HTTPException(status_code=400, detail="icd_id ou icd_path requis")

    success = pattern_manager.link_icd_to_pattern(pattern_id, ref)
    if not success:
        raise HTTPException(status_code=404, detail="Pattern non trouvé")

    return {"success": True, "pattern_id": pattern_id, "icd_ref": ref}


@router.post("/patterns/{pattern_id}/unlink")
async def unlink_icd_from_pattern(pattern_id: str, request: LinkRequest) -> dict[str, Any]:
    """Supprime la liaison entre un ICD et un pattern IED."""
    # Utiliser icd_id en priorité, sinon icd_path
    ref = request.icd_id or request.icd_path
    if not ref:
        raise HTTPException(status_code=400, detail="icd_id ou icd_path requis")

    print(f"🔓 UNLINK: pattern_id={pattern_id}, ref={ref}")

    # Récupérer le pattern pour debug
    pattern = pattern_manager.get_pattern_by_id(pattern_id)
    if pattern:
        print(f"   Pattern trouvé: {pattern.get('id')}, icd_refs: {pattern.get('icd_refs', [])}")
    else:
        print(f"   ❌ Pattern '{pattern_id}' non trouvé!")

    success = pattern_manager.unlink_icd_from_pattern(pattern_id, ref)
    if not success:
        raise HTTPException(status_code=404, detail=f"Pattern '{pattern_id}' non trouvé ou ref '{ref}' non lié")

    return {"success": True, "pattern_id": pattern_id, "icd_ref": ref, "unlinked": True}


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


# ═══════════════════════════════════════════════════════════════════════════
# GESTION DES ICD RÉFÉRENTS (par pattern_id ET manufacturer)
# ═══════════════════════════════════════════════════════════════════════════
# Structure: { pattern_id: { manufacturer: icd_id, ... }, ... }
# Permet d'avoir un référent différent par constructeur pour chaque pattern

@router.get("/default")
async def list_default_icds() -> dict[str, Any]:
    """
    Liste tous les ICD référents par pattern et manufacturer.
    Retourne: { pattern_id: { manufacturer: icd_id, ... }, ... }
    """
    defaults = pattern_manager.get_all_defaults()
    return {
        "success": True,
        "defaults": defaults,
        "count": sum(len(v) for v in defaults.values())
    }


@router.get("/default/{pattern_id}")
async def get_default_icds_for_pattern(pattern_id: str) -> dict[str, Any]:
    """
    Retourne les ICD référents pour un pattern (tous manufacturers).
    """
    pattern = pattern_manager.get_pattern_by_id(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail=f"Pattern '{pattern_id}' non trouvé")

    # Récupérer le dict {manufacturer: icd_id} directement du pattern
    defaults = pattern.get("default_icds", {})

    # Enrichir avec les détails des ICD
    enriched = {}
    for manufacturer, icd_id in defaults.items():
        icd_details = parser.get_icd_details_by_id(str(icd_id))
        enriched[manufacturer] = {
            "icd_id": icd_id,
            "details": icd_details
        }

    return {
        "success": True,
        "pattern_id": pattern_id,
        "pattern_name": pattern.get("display_name", pattern_id),
        "defaults": enriched
    }


@router.get("/default/{pattern_id}/{manufacturer}")
async def get_default_icd_for_pattern_manufacturer(pattern_id: str, manufacturer: str) -> dict[str, Any]:
    """
    Retourne l'ICD référent pour un pattern et un manufacturer spécifique.
    Endpoint principal pour les applications externes (R#SCD, etc.).
    """
    default_result = pattern_manager.get_default_icd(pattern_id, manufacturer)
    if not default_result or not isinstance(default_result, str):
        raise HTTPException(
            status_code=404,
            detail=f"Aucun ICD référent pour pattern='{pattern_id}', manufacturer='{manufacturer}'"
        )

    icd_details = parser.get_icd_details_by_id(default_result)

    return {
        "success": True,
        "pattern_id": pattern_id,
        "manufacturer": manufacturer,
        "icd_id": default_result,
        "icd": icd_details
    }


@router.post("/default/{pattern_id}/{manufacturer}/{icd_id}")
async def set_default_icd_for_pattern(pattern_id: str, manufacturer: str, icd_id: str) -> dict[str, Any]:
    """
    Définit un ICD comme référent pour un pattern et un manufacturer.
    Si un autre ICD était référent pour cette combinaison, il est remplacé.
    """
    # Vérifier que le pattern existe
    pattern = pattern_manager.get_pattern_by_id(pattern_id)
    if not pattern:
        raise HTTPException(status_code=404, detail=f"Pattern '{pattern_id}' non trouvé")

    # Vérifier que l'ICD existe
    icd_details = parser.get_icd_details_by_id(icd_id)
    if not icd_details:
        raise HTTPException(status_code=404, detail=f"ICD '{icd_id}' non trouvé")

    success = pattern_manager.set_default_icd(pattern_id, manufacturer, icd_id)
    if not success:
        raise HTTPException(
            status_code=400,
            detail=f"Impossible de définir le référent"
        )

    return {
        "success": True,
        "message": f"ICD '{icd_id}' défini comme référent pour {pattern_id}/{manufacturer}",
        "pattern_id": pattern_id,
        "manufacturer": manufacturer,
        "icd_id": icd_id
    }


@router.delete("/default/{pattern_id}/{manufacturer}")
async def clear_default_icd_for_pattern(pattern_id: str, manufacturer: str) -> dict[str, Any]:
    """
    Supprime le référent pour un pattern et un manufacturer.
    """
    success = pattern_manager.clear_default_icd(pattern_id, manufacturer)
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Aucun ICD référent pour pattern='{pattern_id}', manufacturer='{manufacturer}'"
        )

    return {
        "success": True,
        "message": f"Référent supprimé pour {pattern_id}/{manufacturer}",
        "pattern_id": pattern_id,
        "manufacturer": manufacturer
    }



