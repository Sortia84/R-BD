# api/shared.py
"""
État partagé entre les routeurs API de R#BD.

Contient :
  - Les instances singleton des managers métier (ICDParser, ISAManager, etc.)
  - La configuration commune (chemins, logger)
  - Les modèles Pydantic partagés entre routeurs

Tous les routeurs importent depuis ce module pour éviter la duplication
de chemins, d'instances et de modèles.
"""

from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


# ============================================================================
# CONFIGURATION ET CHEMINS
# ============================================================================

# Répertoire racine de l'application R#BD
BASE_DIR = Path(__file__).resolve().parent.parent          # → apps/r_bd/


def resolve_ui_kit_dir(base_dir: Path = BASE_DIR) -> Path:
    """Résoudre le UI Kit partagé selon le contrat R-CONTROL."""
    candidates = []
    env_value = os.getenv("RCONTROL_UI_KIT_DIR")
    if env_value:
        candidates.append(Path(env_value))
    candidates.extend([base_dir / "ui_kit", Path("/_ui_kit")])

    for parent in [base_dir, *base_dir.parents]:
        shared_candidate = parent / "shared" / "ui_kit"
        if (parent / ".gitmodules").exists() and shared_candidate.exists():
            candidates.append(shared_candidate)
            break

    for candidate in candidates:
        if (candidate / "css" / "tokens.css").exists():
            return candidate

    raise RuntimeError("UI Kit introuvable: définissez RCONTROL_UI_KIT_DIR ou montez shared/ui_kit.")

# Répertoires de travail
WEB_DIR = BASE_DIR / "web"                                 # Interface SPA
ASSETS_DIR = BASE_DIR / "assets"                           # Logo et ressources
UI_KIT_DIR = resolve_ui_kit_dir()
DATA_DIR = BASE_DIR / "data"                               # Persistance JSON
UPLOADS_DIR = BASE_DIR / "uploads"                         # Fichiers importés

# Sous-répertoires de données
ICD_DATA_DIR = DATA_DIR / "icd"                            # Analyses ICD
IED_DATA_DIR = DATA_DIR / "ied"                            # Patterns IED
ISA_DATA_DIR = DATA_DIR / "isa"                            # Fichiers ISA
ESSAIS_DATA_DIR = DATA_DIR / "essais"                      # Essais RU/CVS/MVS
TEMPLATES_DATA_DIR = DATA_DIR / "templates"                # Templates
RAC_DATA_DIR = DATA_DIR / "rac"                            # Fichiers RAC

# S'assurer que les répertoires critiques existent
for _dir in [DATA_DIR, UPLOADS_DIR, ICD_DATA_DIR, IED_DATA_DIR,
             ISA_DATA_DIR, ESSAIS_DATA_DIR, TEMPLATES_DATA_DIR,
             RAC_DATA_DIR]:
    _dir.mkdir(parents=True, exist_ok=True)


# ============================================================================
# LOGGER COMMUN
# ============================================================================
logger = logging.getLogger("API[r_bd]")


# ============================================================================
# IMPORTS MÉTIER — core/ inviolable
# ============================================================================
from core.icd_parser import ICDParserV2 as ICDParser
from core.ied_pattern_manager import IEDPatternManager
from core.isa_manager import ISAManager
from core.mapping_comparator import MappingComparator
from core.mapping_merger import MappingMerger
from core.rac_manager import RACManager
from core.test_parameter_manager import TestParameterManager


# ============================================================================
# MANAGERS GLOBAUX (singletons partagés)
# ============================================================================

# Parser ICD (analyse les fichiers .icd XML IEC 61850)
icd_parser = ICDParser(data_dir=DATA_DIR)

# Gestionnaire de patterns IED (association IED ↔ ICD)
ied_pattern_manager = IEDPatternManager(data_dir=DATA_DIR)

# Gestionnaire ISA (import, catalogue, types, fichiers référents)
isa_manager = ISAManager(data_dir=DATA_DIR, uploads_dir=UPLOADS_DIR)

# Comparateur mapping IEC 61850 vs ICD importés
mapping_comparator = MappingComparator()

# Fusion automatique ICD → mapping
mapping_merger = MappingMerger()

# Gestionnaire RAC (Raccordements)
rac_manager = RACManager(data_dir=DATA_DIR, uploads_dir=UPLOADS_DIR)

# Gestionnaire des parametres d'essais importes depuis les fichiers PAR
test_parameter_manager = TestParameterManager(
    data_dir=ESSAIS_DATA_DIR,
    assets_dir=ASSETS_DIR,
    ied_data_dir=IED_DATA_DIR,
)


# ============================================================================
# CONSTANTES MÉTIER PARTAGÉES
# ============================================================================

# Types d'essais valides.
#
# R#GUIDE expose deja un flux MVC. R#BD doit donc accepter ce type au niveau
# du referentiel d'essais pour que l'API reste coherente avec les guides SCD.
VALID_ESSAI_TYPES = ("ru", "cvs", "mvs", "mvc")

# Types de templates valides
VALID_TEMPLATE_TYPES = ("ru", "cvs", "mvs")


# ============================================================================
# MODÈLES PYDANTIC PARTAGÉS
# ============================================================================

class EssaiPayload(BaseModel):
    """Payload pour la création/mise à jour d'un essai."""
    id: str = ""
    name: str = ""
    type: str = "ru"
    scope: str = "function"
    ied: str = ""
    variant: str = ""
    ld: str = ""
    ln: str = ""
    lninst: str = ""
    previous_test_id: str = ""
    order_index: Optional[int] = None
    order_type_number: Optional[int] = None
    order_ied_number: Optional[int] = None
    order_ld_number: Optional[int] = None
    order_scope: Dict[str, str] = Field(default_factory=dict)
    description: str = ""
    steps: List[Dict[str, Any]] = []
    preconditions: List[Any] = []
    attachments: List[Any] = []
    files: List[Any] = []
    linked_tests_ru: List[Any] = []
    linked_tests_cvs: List[Any] = []
    linked_tests_mvs: List[Any] = []
    cde: List[Any] = []
    alarmes: List[Any] = []
    tcd: List[Any] = []


class SyncPayload(BaseModel):
    """Payload pour la synchronisation d'essais (localStorage → serveur)."""
    type: str = "ru"
    essais: List[Dict[str, Any]]


class TemplateStep(BaseModel):
    """Étape d'un test (pré-condition, action, post-condition)."""
    id: str = ""
    type: str = ""           # "setup", "test", "verify", "cleanup"
    description: str = ""
    expected_result: str = ""

    class Config:
        extra = "allow"


class TemplateFile(BaseModel):
    """Fichier attaché au test (SCD, ICD, config, data, other)."""
    id: str = ""
    name: str = ""
    path: str = ""
    type: str = ""           # "scd", "icd", "config", "data", "other"


class TemplateAlarm(BaseModel):
    """Alarme déclenchée durant le test."""
    id: str = ""
    source: str = ""         # IED/LD/LN path
    severity: str = "info"   # "info", "warning", "error", "critical"
    message: str = ""


class TemplateCreateRequest(BaseModel):
    """Requête de création d'un template complet."""
    name: str
    type: str = "ru"
    ied: str = ""
    ld: str = ""
    ln: str = ""
    lninst: str = ""
    description: str = ""

    class Config:
        extra = "allow"


class TemplateModel(BaseModel):
    """Modèle complet d'un template (lecture/écriture)."""
    id: str = ""
    name: str = ""
    type: str = "ru"
    description: str = ""
    ied: str = ""
    ld: str = ""
    ln: str = ""
    lninst: str = ""
    preconditions: List[TemplateStep] = []
    steps: List[TemplateStep] = []
    expected_alarms: List[TemplateAlarm] = []
    files: List[TemplateFile] = []
    linked_templates: Dict[str, List[str]] = {}
    created_at: str = ""
    updated_at: str = ""
    created_by: str = "system"

    class Config:
        extra = "allow"


# ============================================================================
# HELPERS PARTAGÉS
# ============================================================================

def load_json(filepath: Path) -> Any:
    """
    Charger un fichier JSON de manière sûre.

    Args:
        filepath: Chemin du fichier JSON à charger.

    Returns:
        Le contenu désérialisé du fichier, ou une liste vide si le fichier
        n'existe pas ou est invalide.
    """
    if not filepath.exists():
        logger.warning("[JSON] Fichier introuvable : %s", filepath)
        return []
    try:
        with open(filepath, "r", encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError) as exc:
        logger.error("[JSON] Erreur lecture %s : %s", filepath, exc)
        return []


def save_json(filepath: Path, data: Any) -> bool:
    """
    Sauvegarder des données au format JSON.

    Args:
        filepath: Chemin du fichier JSON à écrire.
        data: Données à sérialiser.

    Returns:
        True si la sauvegarde a réussi, False sinon.
    """
    try:
        filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        return True
    except OSError as exc:
        logger.error("[JSON] Erreur écriture %s : %s", filepath, exc)
        return False
