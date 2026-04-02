# router_isa.py — API REST pour la gestion des fichiers ISA
"""
Endpoints FastAPI pour l'import, listing et gestion des fichiers ISA.
Structure de stockage :
- uploads/ISA/ : fichiers physiques
- data/isa/index.json : catalogue des fichiers
- data/isa/liste_isa.json : types ISA
"""

from typing import Any
import uuid

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Import centralisé depuis shared.py
from api.shared import isa_manager as manager, DATA_DIR, UPLOADS_DIR, logger

router = APIRouter(prefix="/api/isa", tags=["ISA"])


# ============================================================
# Fichiers ISA
# ============================================================

@router.get("/")
async def get_catalog() -> dict[str, Any]:
    """Retourne le catalogue complet des fichiers ISA."""
    files = manager.get_catalog()
    return {
        "count": len(files),
        "files": files
    }


@router.post("/upload")
async def upload_isa(
    file: UploadFile = File(...),
    type_id: str | None = Form(None)
) -> dict[str, Any]:
    """
    Upload un fichier ISA.
    Optionnellement, l'associer directement à un type.
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="Nom de fichier manquant")

    # Vérifier l'extension
    ext = Path(file.filename).suffix.lower()
    if ext not in manager.SUPPORTED_FORMATS:
        raise HTTPException(
            status_code=400,
            detail=f"Format non supporté: {ext}. Formats acceptés: {', '.join(manager.SUPPORTED_FORMATS)}"
        )

    # Sauvegarder temporairement le fichier
    temp_id = uuid.uuid4().hex[:8]
    temp_dir = UPLOADS_DIR / "temp"
    temp_dir.mkdir(parents=True, exist_ok=True)
    temp_path = temp_dir / f"{temp_id}_{file.filename}"

    try:
        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # Importer via le manager
        file_entry = manager.import_file(temp_path, file.filename, type_id)

        return {
            "success": True,
            "file": file_entry,
            "message": f"Fichier '{file.filename}' importé avec succès"
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur interne: {e}") from e
    finally:
        # Nettoyer le fichier temporaire
        if temp_path.exists():
            temp_path.unlink()


@router.delete("/{file_id}")
async def delete_file(file_id: str) -> dict[str, Any]:
    """Supprime un fichier ISA."""
    deleted = manager.delete_file(file_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")

    return {"success": True, "deleted": file_id}


# ============================================================
# Types ISA
# ============================================================

@router.get("/types")
async def get_isa_types() -> dict[str, Any]:
    """Retourne la liste des types ISA."""
    types = manager.get_types()
    return {
        "count": len(types),
        "types": types
    }


@router.get("/types/{type_id}")
async def get_isa_type(type_id: str) -> dict[str, Any]:
    """Retourne un type ISA par son ID."""
    isa_type = manager.get_type_by_id(type_id)
    if not isa_type:
        raise HTTPException(status_code=404, detail="Type non trouvé")
    return isa_type


@router.get("/types/{type_id}/files")
async def get_files_for_type(type_id: str) -> dict[str, Any]:
    """Retourne les fichiers associés à un type."""
    isa_type = manager.get_type_by_id(type_id)
    if not isa_type:
        raise HTTPException(status_code=404, detail="Type non trouvé")

    files = manager.get_files_for_type(type_id)
    return {
        "type_id": type_id,
        "type_name": isa_type.get("name"),
        "count": len(files),
        "files": files
    }


class TypeCreateRequest(BaseModel):
    """Requête de création de type ISA."""
    id: str
    name: str
    category: str = "default"
    description: str = ""
    formats: list[str] = ["xlsx", "xml", "csv"]
    icon: str = "📁"


@router.post("/types")
async def create_type(request: TypeCreateRequest) -> dict[str, Any]:
    """Crée un nouveau type ISA."""
    try:
        type_data = request.model_dump()
        new_type = manager.add_type(type_data)
        return {
            "success": True,
            "type": new_type,
            "message": f"Type '{request.name}' créé"
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e)) from e


@router.put("/types/{type_id}")
async def update_type(type_id: str, request: TypeCreateRequest) -> dict[str, Any]:
    """Met à jour un type ISA existant."""
    type_data = request.model_dump()
    updated = manager.update_type(type_id, type_data)
    if not updated:
        raise HTTPException(status_code=404, detail="Type non trouvé")

    return {
        "success": True,
        "type": updated,
        "message": f"Type '{type_id}' mis à jour"
    }


@router.delete("/types/{type_id}")
async def delete_type(type_id: str) -> dict[str, Any]:
    """Supprime un type ISA."""
    deleted = manager.delete_type(type_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Type non trouvé")

    return {"success": True, "deleted": type_id}


# ============================================================
# Liaisons fichiers <-> types
# ============================================================

class LinkRequest(BaseModel):
    """Requête de liaison fichier-type."""
    file_id: str
    type_id: str


@router.post("/link")
async def link_file_to_type(request: LinkRequest) -> dict[str, Any]:
    """Associe un fichier à un type."""
    success = manager.link_file_to_type(request.file_id, request.type_id)
    if not success:
        raise HTTPException(status_code=404, detail="Fichier ou type non trouvé")

    return {
        "success": True,
        "message": f"Fichier '{request.file_id}' associé au type '{request.type_id}'"
    }


@router.post("/unlink")
async def unlink_file_from_type(request: LinkRequest) -> dict[str, Any]:
    """Retire l'association d'un fichier avec un type."""
    success = manager.unlink_file_from_type(request.file_id, request.type_id)
    if not success:
        raise HTTPException(status_code=404, detail="Fichier ou type non trouvé")

    return {
        "success": True,
        "message": f"Fichier '{request.file_id}' retiré du type '{request.type_id}'"
    }


# ============================================================
# Analyse
# ============================================================

@router.post("/analyze/{file_id}")
async def analyze_file(file_id: str, type_id: str, enrich: bool = True) -> dict[str, Any]:
    """
    Lance l'analyse d'un fichier selon son type.

    Args:
        file_id: ID du fichier à analyser
        type_id: ID du type pour lequel analyser
        enrich: Si True (défaut), enrichit avec RISA. Si False, analyse brute sans enrichissement.
    """
    try:
        result = manager.analyze_file(file_id, type_id, enrich=enrich)
        return {
            "success": True,
            "result": result
        }
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur analyse: {e}") from e


@router.post("/reanalyze")
async def reanalyze_all() -> dict[str, Any]:
    """Relance l'analyse de tous les fichiers liés."""
    results = manager.reanalyze_all()

    success_count = len([r for r in results if r.get("status") == "success"])
    error_count = len([r for r in results if r.get("status") == "error"])

    return {
        "success": True,
        "total": len(results),
        "success_count": success_count,
        "error_count": error_count,
        "results": results
    }


@router.get("/analyzed/{file_id}")
async def get_analyzed_data(file_id: str) -> dict[str, Any]:
    """
    Récupère les données analysées d'un fichier (le JSON généré).

    Args:
        file_id: ID du fichier

    Returns:
        Données analysées ou 404 si pas encore analysé
    """
    data = manager.get_analyzed_data(file_id)
    if data is None:
        raise HTTPException(status_code=404, detail=f"Données analysées non trouvées pour {file_id}")
    return data


# ============================================================
# Orphelins
# ============================================================

@router.get("/orphans")
async def get_orphan_files() -> dict[str, Any]:
    """Retourne les fichiers non associés à aucun type."""
    orphans = manager.get_orphan_files()
    return {
        "count": len(orphans),
        "files": orphans
    }


# ============================================================
# Gestion des fichiers référents (default par type)
# ============================================================

@router.get("/default/{type_id}")
async def get_default_file_for_type(type_id: str) -> dict[str, Any]:
    """
    Retourne le fichier référent pour un type ISA.
    Endpoint principal pour les applications externes.
    """
    file_entry = manager.get_default_file(type_id)
    if not file_entry:
        raise HTTPException(
            status_code=404,
            detail=f"Aucun fichier trouvé pour le type '{type_id}'"
        )

    return {
        "success": True,
        "type_id": type_id,
        "file": file_entry
    }


@router.post("/default/{type_id}/{file_id}")
async def set_default_file_for_type(type_id: str, file_id: str) -> dict[str, Any]:
    """
    Définit un fichier comme référent pour un type ISA.
    Si un autre fichier était référent, il est remplacé.
    """
    success = manager.set_default_file(type_id, file_id)
    if not success:
        raise HTTPException(
            status_code=400,
            detail=f"Impossible de définir le fichier '{file_id}' comme référent pour '{type_id}'"
        )

    return {
        "success": True,
        "message": f"Fichier '{file_id}' défini comme référent pour '{type_id}'",
        "type_id": type_id,
        "file_id": file_id
    }


@router.delete("/default/{type_id}")
async def clear_default_file_for_type(type_id: str) -> dict[str, Any]:
    """
    Supprime le référent pour un type ISA.
    """
    success = manager.clear_default_file(type_id)
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Aucun fichier référent trouvé pour le type '{type_id}'"
        )

    return {
        "success": True,
        "message": f"Référent supprimé pour le type '{type_id}'",
        "type_id": type_id
    }


# ============================================================
# Route dynamique (doit être en dernier pour éviter les conflits)
# ============================================================

@router.get("/{file_id}")
async def get_file_details(file_id: str) -> dict[str, Any]:
    """Retourne les détails d'un fichier ISA par son ID."""
    file_entry = manager.get_file_by_id(file_id)
    if not file_entry:
        raise HTTPException(status_code=404, detail="Fichier non trouvé")
    return file_entry
