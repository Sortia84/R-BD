# mapping_api.py - API REST pour le mapping IEC 61850
"""
Endpoints FastAPI pour la gestion du mapping normatif IEC 61850.
- Comparaison mapping vs ICD
- Fusion automatique
- Consultation du mapping
"""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from core.mapping_comparator import MappingComparator
from core.mapping_merger import MappingMerger

router = APIRouter(prefix="/api/mapping", tags=["Mapping IEC 61850"])

BASE_DIR = Path(__file__).parent.parent
DATA_DIR = BASE_DIR / "data"
MAPPING_DIR = DATA_DIR / "isa" / "files" / "mapping_etat_61850"


@router.get("/")
async def get_mapping() -> dict[str, Any]:
    """Retourne le mapping complet."""
    mapping_file = MAPPING_DIR / "mapping_type.json"
    if not mapping_file.exists():
        raise HTTPException(status_code=404, detail="Mapping non trouvé")

    import json
    with open(mapping_file, "r", encoding="utf-8") as f:
        mapping = json.load(f)

    return {
        "version": mapping.get("version"),
        "last_merged": mapping.get("last_merged"),
        "stats": {
            "types": len(mapping.get("types", {})),
            "enumTypes": len(mapping.get("enumTypes", {})),
            "cdc": len(mapping.get("cdc", {})),
            "commonDA": len(mapping.get("commonDA", {}))
        },
        "mapping": mapping
    }


@router.get("/types")
async def get_types() -> dict[str, Any]:
    """Retourne les types de base du mapping."""
    mapping_file = MAPPING_DIR / "mapping_type.json"
    if not mapping_file.exists():
        raise HTTPException(status_code=404, detail="Mapping non trouvé")

    import json
    with open(mapping_file, "r", encoding="utf-8") as f:
        mapping = json.load(f)

    return {
        "count": len(mapping.get("types", {})),
        "types": mapping.get("types", {})
    }


@router.get("/enums")
async def get_enum_types() -> dict[str, Any]:
    """Retourne les EnumTypes du mapping."""
    mapping_file = MAPPING_DIR / "mapping_type.json"
    if not mapping_file.exists():
        raise HTTPException(status_code=404, detail="Mapping non trouvé")

    import json
    with open(mapping_file, "r", encoding="utf-8") as f:
        mapping = json.load(f)

    return {
        "count": len(mapping.get("enumTypes", {})),
        "enumTypes": mapping.get("enumTypes", {})
    }


@router.get("/cdc")
async def get_cdc() -> dict[str, Any]:
    """Retourne les CDC (Common Data Classes) du mapping."""
    mapping_file = MAPPING_DIR / "mapping_type.json"
    if not mapping_file.exists():
        raise HTTPException(status_code=404, detail="Mapping non trouvé")

    import json
    with open(mapping_file, "r", encoding="utf-8") as f:
        mapping = json.load(f)

    return {
        "count": len(mapping.get("cdc", {})),
        "cdc": mapping.get("cdc", {})
    }


@router.get("/cdc/{cdc_name}")
async def get_cdc_details(cdc_name: str) -> dict[str, Any]:
    """Retourne les détails d'un CDC spécifique."""
    mapping_file = MAPPING_DIR / "mapping_type.json"
    if not mapping_file.exists():
        raise HTTPException(status_code=404, detail="Mapping non trouvé")

    import json
    with open(mapping_file, "r", encoding="utf-8") as f:
        mapping = json.load(f)

    cdc = mapping.get("cdc", {}).get(cdc_name.upper())
    if not cdc:
        raise HTTPException(status_code=404, detail=f"CDC '{cdc_name}' non trouvé")

    return {
        "name": cdc_name.upper(),
        **cdc
    }


@router.get("/da/{da_name}")
async def get_da_info(da_name: str) -> dict[str, Any]:
    """Retourne les informations sur un DA (Data Attribute)."""
    mapping_file = MAPPING_DIR / "mapping_type.json"
    if not mapping_file.exists():
        raise HTTPException(status_code=404, detail="Mapping non trouvé")

    import json
    with open(mapping_file, "r", encoding="utf-8") as f:
        mapping = json.load(f)

    # Chercher dans commonDA
    common_da = mapping.get("commonDA", {}).get(da_name)

    # Chercher dans les CDC
    found_in_cdc = []
    for cdc_name, cdc_data in mapping.get("cdc", {}).items():
        for da in cdc_data.get("typicalDA", []):
            if isinstance(da, dict) and da.get("name") == da_name:
                found_in_cdc.append({
                    "cdc": cdc_name,
                    "type": da.get("type"),
                    "fc": da.get("fc")
                })

    if not common_da and not found_in_cdc:
        raise HTTPException(status_code=404, detail=f"DA '{da_name}' non trouvé")

    return {
        "name": da_name,
        "commonDA": common_da,
        "found_in_cdc": found_in_cdc
    }


@router.get("/compare")
async def compare_mapping() -> dict[str, Any]:
    """Compare le mapping actuel avec les données ICD."""
    try:
        comparator = MappingComparator(data_dir=DATA_DIR)
        report = comparator.compare()
        return report
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {e}")


@router.post("/merge")
async def merge_mapping() -> dict[str, Any]:
    """
    Fusionne les données des ICD dans le mapping.
    Ajoute les EnumTypes, CDC et DA manquants.
    """
    try:
        merger = MappingMerger(data_dir=DATA_DIR)
        merged, output_path = merger.run()

        # Copier comme mapping principal
        import shutil
        main_mapping = MAPPING_DIR / "mapping_type.json"
        shutil.copy(output_path, main_mapping)

        # Supprimer le fichier temporaire
        if output_path != main_mapping:
            output_path.unlink()

        stats = merged.get("merge_stats", {})
        return {
            "success": True,
            "message": "Mapping fusionné avec succès",
            "version": merged.get("version"),
            "stats": {
                "icd_count": stats.get("icd_count", 0),
                "enum_types_added": stats.get("enum_types_added", 0),
                "cdc_added": stats.get("cdc_added", 0),
                "total_types": len(merged.get("types", {})),
                "total_enum_types": len(merged.get("enumTypes", {})),
                "total_cdc": len(merged.get("cdc", {})),
                "total_common_da": len(merged.get("commonDA", {}))
            }
        }
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur: {e}")


@router.get("/enum/{enum_name}")
async def get_enum_values(enum_name: str) -> dict[str, Any]:
    """Retourne les valeurs d'un EnumType spécifique."""
    mapping_file = MAPPING_DIR / "mapping_type.json"
    if not mapping_file.exists():
        raise HTTPException(status_code=404, detail="Mapping non trouvé")

    import json
    with open(mapping_file, "r", encoding="utf-8") as f:
        mapping = json.load(f)

    # Chercher dans enumTypes (priorité)
    enum_data = mapping.get("enumTypes", {}).get(enum_name)

    # Sinon chercher dans types
    if not enum_data:
        enum_data = mapping.get("types", {}).get(enum_name)

    if not enum_data:
        raise HTTPException(status_code=404, detail=f"EnumType '{enum_name}' non trouvé")

    return {
        "name": enum_name,
        **enum_data
    }


@router.get("/search/{query}")
async def search_mapping(query: str) -> dict[str, Any]:
    """Recherche dans le mapping (types, enums, CDC, DA)."""
    mapping_file = MAPPING_DIR / "mapping_type.json"
    if not mapping_file.exists():
        raise HTTPException(status_code=404, detail="Mapping non trouvé")

    import json
    with open(mapping_file, "r", encoding="utf-8") as f:
        mapping = json.load(f)

    query_lower = query.lower()
    results = {
        "types": [],
        "enumTypes": [],
        "cdc": [],
        "commonDA": []
    }

    # Recherche dans types
    for name, data in mapping.get("types", {}).items():
        if query_lower in name.lower():
            results["types"].append({"name": name, "data": data})

    # Recherche dans enumTypes
    for name, data in mapping.get("enumTypes", {}).items():
        if query_lower in name.lower():
            results["enumTypes"].append({"name": name, "values": data.get("values", [])})

    # Recherche dans CDC
    for name, data in mapping.get("cdc", {}).items():
        if query_lower in name.lower():
            results["cdc"].append({"name": name, "description": data.get("description", "")})

    # Recherche dans commonDA
    for name, data in mapping.get("commonDA", {}).items():
        if query_lower in name.lower():
            results["commonDA"].append({"name": name, "data": data})

    total = sum(len(v) for v in results.values())
    return {
        "query": query,
        "total_results": total,
        "results": results
    }
