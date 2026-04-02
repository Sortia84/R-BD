# core/__init__.py
"""
Package Core — Logique métier R#BD

Contient les modules d'analyse, de parsing et de gestion des données
IEC 61850 pour l'application R#BD.

Organisation :
  - icd_parser.py          : Parser ICD V2 (extraction complète DO/DA/CB/DS)
  - ied_pattern_manager.py : Gestion des patterns IED et liaisons
  - isa_manager.py         : Gestionnaire fichiers ISA (import, catalogue)
  - mapping_comparator.py  : Comparaison mapping IEC 61850 vs ICD
  - mapping_merger.py      : Fusion automatique ICD → mapping
  - fcs_manager.py         : Gestionnaire fichiers FCS (import, catalogue)
  - rac_manager.py         : Gestionnaire fichiers RAC (import, catalogue)
  - isa_parsers/           : Parsers spécialisés (équations, enrichissement)
"""

from .icd_parser import ICDParserV2
from .ied_pattern_manager import IEDPatternManager
from .isa_manager import ISAManager
from .mapping_comparator import MappingComparator
from .mapping_merger import MappingMerger
from .fcs_manager import FCSManager
from .rac_manager import RACManager

__all__ = [
    "ICDParserV2",
    "IEDPatternManager",
    "ISAManager",
    "MappingComparator",
    "MappingMerger",
    "FCSManager",
    "RACManager",
]
