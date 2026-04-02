# api/__init__.py
"""
Package API — Routeurs FastAPI pour R#BD

Organisation :
  - shared.py           : État partagé (managers, helpers, config, Pydantic)
  - router_icd.py       : Endpoints ICD (import, catalogue, patterns)
  - router_isa.py       : Endpoints ISA (import, types, fichiers)
  - router_mapping.py   : Endpoints Mapping (consultation IEC 61850)
  - router_essais.py    : Endpoints Essais (CRUD RU/CVS/MVS)
  - router_templates.py : Endpoints Templates (CRUD)
  - router_fcs.py       : Endpoints FCS (import, catalogue)
  - router_rac.py       : Endpoints RAC (import, catalogue)
"""

from .router_icd import router as icd_router
from .router_isa import router as isa_router
from .router_mapping import router as mapping_router
from .router_essais import router as essais_router
from .router_templates import router as templates_router
from .router_fcs import router as fcs_router
from .router_rac import router as rac_router

__all__ = [
    "icd_router",
    "isa_router",
    "mapping_router",
    "essais_router",
    "templates_router",
    "fcs_router",
    "rac_router",
]
