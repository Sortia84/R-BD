"""
templates_api.py — API REST pour les templates d'essais (RU, CVS, MVS)

PHASE 1 FIX (27 mars 2026):
  Endpoint requis par R#GUIDE pour débloquer workflow d'essais.
  
Endpoints:
  GET  /api/v1/templates/ru       → Liste templates RU
  GET  /api/v1/templates/cvs      → Liste templates CVS
  GET  /api/v1/templates/mvs      → Liste templates MVS
  GET  /api/v1/templates/{type}/{template_id}  → Récupère 1 template
  POST /api/v1/templates/{type}   → Crée un template
  PUT  /api/v1/templates/{type}/{template_id}  → Met à jour
  
Stockage: data/templates/{type}_templates.json
"""

from __future__ import annotations

import json
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional
from uuid import uuid4

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter(prefix="/api/v1/templates", tags=["templates"])

# Configuration des répertoires
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data"
TEMPLATES_DIR = DATA_DIR / "templates"
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)

# Types valides
VALID_TYPES = ("ru", "cvs", "mvs")


# ============================================================================
# MODÈLES PYDANTIC
# ============================================================================

class TemplateStep(BaseModel):
    """Étape d'un test (pré-condition, action, post-condition)."""
    id: str = ""
    type: str    # "setup", "test", "verify", "cleanup"
    description: str
    expected_result: str = ""
    
    class Config:
        extra = "allow"  # Accepter champs additionnels


class TemplateFile(BaseModel):
    """Fichier attaché au test (SCD, ICD, config, etc)."""
    id: str = ""
    name: str
    path: str
    type: str  # "scd", "icd", "config", "data", "other"


class TemplateAlarm(BaseModel):
    """Alarme déclenchée durant le test."""
    id: str = ""
    source: str  # IED/LD/LN path
    severity: str = "info"  # "info", "warning", "error", "critical"
    message: str


class TemplateModel(BaseModel):
    """Modèle complet d'un template d'essai."""
    id: str = ""
    name: str
    type: str  # "ru", "cvs", "mvs"
    description: str = ""
    
    # Contexte IEC 61850
    ied: str = ""
    ld: str = ""
    ln: str = ""
    lninst: str = ""
    
    # Contenu technique
    preconditions: List[TemplateStep] = []
    steps: List[TemplateStep] = []
    expected_alarms: List[TemplateAlarm] = []
    files: List[TemplateFile] = []
    
    # Liaisons croisées
    linked_templates: Dict[str, List[str]] = {}  # {"ru": [...], "cvs": [...], "mvs": [...]}
    
    # Métadonnées
    created_at: str = ""
    updated_at: str = ""
    created_by: str = "system"
    
    class Config:
        extra = "allow"


class TemplateCreateRequest(BaseModel):
    """Request pour créer un template."""
    name: str
    type: str  # "ru", "cvs", "mvs"
    description: str = ""
    ied: str = ""
    ld: str = ""
    ln: str = ""
    lninst: str = ""
    
    class Config:
        extra = "allow"


# ============================================================================
# HELPERS — Persistance et gestion fichiers
# ============================================================================

def _get_templates_file(template_type: str) -> Path:
    """
    Retourne le chemin du fichier JSON pour un type de template.
    
    Args:
        template_type: "ru", "cvs", ou "mvs"
    
    Returns:
        Path: Chemin du fichier JSON
    
    Raises:
        HTTPException: Si type invalide
    """
    t = template_type.lower()
    if t not in VALID_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Type invalide: {template_type}. Valides: {', '.join(VALID_TYPES)}"
        )
    return TEMPLATES_DIR / f"{t}_templates.json"


def _load_templates(template_type: str) -> List[Dict[str, Any]]:
    """
    Charge tous les templates d'un type donné.
    
    Args:
        template_type: "ru", "cvs", ou "mvs"
    
    Returns:
        List: Liste des templates (vide si fichier inexistant)
    """
    try:
        path = _get_templates_file(template_type)
        if not path.exists():
            return []
        
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        return data if isinstance(data, list) else []
    except Exception as e:
        print(f"⚠️ Erreur chargement templates {template_type}: {e}")
        return []


def _save_templates(template_type: str, templates: List[Dict[str, Any]]) -> None:
    """
    Persiste les templates dans un fichier JSON.
    
    Args:
        template_type: "ru", "cvs", ou "mvs"
        templates: Liste des templates à sauvegarder
    """
    path = _get_templates_file(template_type)
    path.parent.mkdir(parents=True, exist_ok=True)
    
    with open(path, "w", encoding="utf-8") as f:
        json.dump(templates, f, indent=2, ensure_ascii=False)


def _create_template_dict(req: TemplateCreateRequest) -> Dict[str, Any]:
    """
    Crée un dictionnaire template à partir d'une requête.
    
    Args:
        req: TemplateCreateRequest
    
    Returns:
        Dict: Template complet avec ID, timestamps, etc.
    """
    now = datetime.utcnow().isoformat() + "Z"
    
    return {
        "id": str(uuid4()),
        "name": req.name,
        "type": req.type.lower(),
        "description": req.description,
        "ied": req.ied,
        "ld": req.ld,
        "ln": req.ln,
        "lninst": req.lninst,
        "preconditions": [],
        "steps": [],
        "expected_alarms": [],
        "files": [],
        "linked_templates": {"ru": [], "cvs": [], "mvs": []},
        "created_at": now,
        "updated_at": now,
        "created_by": "system"
    }


# ============================================================================
# ENDPOINTS
# ============================================================================

@router.get("/{template_type}")
async def list_templates(template_type: str) -> Dict[str, Any]:
    """
    Liste tous les templates d'un type donné.
    
    Args:
        template_type: "ru", "cvs", ou "mvs"
    
    Returns:
        Dict: {"type": ..., "count": ..., "templates": [...]}
    """
    templates = _load_templates(template_type)
    
    return {
        "type": template_type.lower(),
        "count": len(templates),
        "templates": templates
    }


@router.get("/{template_type}/{template_id}")
async def get_template(template_type: str, template_id: str) -> Dict[str, Any]:
    """
    Récupère un template spécifique par son ID.
    
    Args:
        template_type: "ru", "cvs", ou "mvs"
        template_id: UUID du template
    
    Returns:
        Dict: Template complet
    
    Raises:
        HTTPException 404: Template non trouvé
    """
    templates = _load_templates(template_type)
    
    for template in templates:
        if template.get("id") == template_id:
            return template
    
    raise HTTPException(
        status_code=404,
        detail=f"Template non trouvé: {template_type}/{template_id}"
    )


@router.post("/{template_type}")
async def create_template(
    template_type: str,
    request: TemplateCreateRequest
) -> Dict[str, Any]:
    """
    Crée un nouveau template.
    
    Args:
        template_type: "ru", "cvs", ou "mvs"
        request: Données du template
    
    Returns:
        Dict: Template créé avec ID généré
    """
    # Valider le type
    _get_templates_file(template_type)
    
    # Charger templates existants
    templates = _load_templates(template_type)
    
    # Créer nouveau template
    new_template = _create_template_dict(request)
    
    # Sauvegarder
    templates.append(new_template)
    _save_templates(template_type, templates)
    
    return {
        "status": "created",
        "template": new_template
    }


@router.put("/{template_type}/{template_id}")
async def update_template(
    template_type: str,
    template_id: str,
    request: TemplateModel
) -> Dict[str, Any]:
    """
    Met à jour un template existant.
    
    Args:
        template_type: "ru", "cvs", ou "mvs"
        template_id: UUID du template
        request: Données mises à jour
    
    Returns:
        Dict: Template mis à jour
    
    Raises:
        HTTPException 404: Template non trouvé
    """
    templates = _load_templates(template_type)
    
    for i, template in enumerate(templates):
        if template.get("id") == template_id:
            # Mettre à jour timestamp
            template["updated_at"] = datetime.utcnow().isoformat() + "Z"
            
            # Merger données
            template.update(request.dict(exclude_unset=True))
            
            # Sauvegarder
            _save_templates(template_type, templates)
            
            return {
                "status": "updated",
                "template": template
            }
    
    raise HTTPException(
        status_code=404,
        detail=f"Template non trouvé: {template_type}/{template_id}"
    )


@router.delete("/{template_type}/{template_id}")
async def delete_template(template_type: str, template_id: str) -> Dict[str, Any]:
    """
    Supprime un template.
    
    Args:
        template_type: "ru", "cvs", ou "mvs"
        template_id: UUID du template
    
    Returns:
        Dict: Statut de la suppression
    
    Raises:
        HTTPException 404: Template non trouvé
    """
    templates = _load_templates(template_type)
    
    for i, template in enumerate(templates):
        if template.get("id") == template_id:
            templates.pop(i)
            _save_templates(template_type, templates)
            
            return {
                "status": "deleted",
                "template_id": template_id
            }
    
    raise HTTPException(
        status_code=404,
        detail=f"Template non trouvé: {template_type}/{template_id}"
    )


@router.post("/{template_type}/{template_id}/link/{linked_type}/{linked_id}")
async def link_templates(
    template_type: str,
    template_id: str,
    linked_type: str,
    linked_id: str
) -> Dict[str, Any]:
    """
    Lie deux templates ensemble (ex: RU → CVS).
    
    Args:
        template_type: "ru", "cvs", ou "mvs"
        template_id: UUID du template principal
        linked_type: Type du template à lier
        linked_id: ID du template à lier
    
    Returns:
        Dict: Statut de la liaison
    """
    linked_type = linked_type.lower()
    if linked_type not in VALID_TYPES:
        raise HTTPException(status_code=400, detail=f"Type invalide: {linked_type}")
    
    templates = _load_templates(template_type)
    
    for template in templates:
        if template.get("id") == template_id:
            if "linked_templates" not in template:
                template["linked_templates"] = {"ru": [], "cvs": [], "mvs": []}
            
            linked = template["linked_templates"][linked_type]
            if linked_id not in linked:
                linked.append(linked_id)
            
            _save_templates(template_type, templates)
            
            return {
                "status": "linked",
                "main": template_id,
                "linked": linked_id
            }
    
    raise HTTPException(
        status_code=404,
        detail=f"Template non trouvé: {template_type}/{template_id}"
    )


@router.get("/health")
async def health() -> Dict[str, str]:
    """
    Endpoint de santé pour R#GUIDE (déblocage Phase 1).
    
    Returns:
        Dict: {"status": "ok"}
    """
    return {"status": "ok", "component": "templates_api"}
