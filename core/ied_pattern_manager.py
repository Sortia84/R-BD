# ied_pattern_manager.py - Gestionnaire des patterns IED et liaisons ICD
"""
Gère la correspondance entre :
- Patterns IED (ex: *TGSCU1-2, *SCU*)
- ICD analysés (fichiers JSON dans data/icd/)

Permet de :
- Lier un ICD à un ou plusieurs patterns IED
- Rechercher les ICD correspondant à un pattern
- Matcher un nom d'IED du SCD avec les patterns
"""

from pathlib import Path
from typing import Any
import json
import re
import fnmatch


class IEDPatternManager:
    """Gestionnaire des patterns IED et liaisons ICD."""

    def __init__(self, data_dir: Path | None = None):
        self.data_dir = data_dir or Path(__file__).parent.parent / "data"
        self.ied_file = self.data_dir / "ied" / "liste_ied.json"
        self.icd_dir = self.data_dir / "icd"
        self._cache = None

    def load_patterns(self) -> dict[str, Any]:
        """Charge la liste des patterns IED."""
        if self._cache is not None:
            return self._cache

        if not self.ied_file.exists():
            return {"version": "2.0", "ied_patterns": []}

        try:
            with open(self.ied_file, "r", encoding="utf-8") as f:
                data = json.load(f)
                # Migration ancien format (liste simple)
                if isinstance(data, list):
                    data = self._migrate_old_format(data)
                self._cache = data
                return data
        except (json.JSONDecodeError, IOError):
            return {"version": "2.0", "ied_patterns": []}

    def _migrate_old_format(self, old_list: list) -> dict:
        """Migre l'ancien format (liste de strings) vers le nouveau."""
        patterns = []
        for item in old_list:
            if isinstance(item, str):
                # Gérer les exclusions (ex: "*BCU*, !*CBO*BCU*")
                parts = [p.strip() for p in item.split(",")]
                main_pattern = parts[0]
                exclusions = [p[1:] for p in parts[1:] if p.startswith("!")]

                pattern_id = self._extract_id(main_pattern)
                patterns.append({
                    "id": pattern_id,
                    "pattern": main_pattern,
                    "exclusions": exclusions,
                    "display_name": pattern_id,
                    "description": "",
                    "icd_refs": [],
                    "variants": []
                })

        return {"version": "2.0", "ied_patterns": patterns}

    def _extract_id(self, pattern: str) -> str:
        """Extrait un ID à partir d'un pattern."""
        # Enlever les wildcards et nettoyer
        clean = re.sub(r"[*!]+", "", pattern).strip()
        return clean.replace("-", "_") or "UNKNOWN"

    def save_patterns(self, data: dict) -> None:
        """Sauvegarde les patterns IED."""
        self.ied_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.ied_file, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=4, ensure_ascii=False)
        self._cache = data

    def get_pattern_by_id(self, pattern_id: str) -> dict | None:
        """Récupère un pattern par son ID."""
        data = self.load_patterns()
        return next((p for p in data["ied_patterns"] if p["id"] == pattern_id), None)

    def get_all_patterns(self) -> list[dict]:
        """Retourne tous les patterns."""
        return self.load_patterns().get("ied_patterns", [])

    # --- Liaison ICD ↔ Pattern ---

    def link_icd_to_pattern(self, pattern_id: str, icd_ref: str) -> bool:
        """Lie un ICD à un pattern IED et propage aux variants (enfants)."""
        data = self.load_patterns()
        pattern = next((p for p in data["ied_patterns"] if p["id"] == pattern_id), None)

        if not pattern:
            return False

        # Ajouter l'ICD au pattern principal
        if "icd_refs" not in pattern:
            pattern["icd_refs"] = []

        modified = False
        if icd_ref not in pattern["icd_refs"]:
            pattern["icd_refs"].append(icd_ref)
            modified = True

        # Propager aux variants (patterns enfants qui ont parent = pattern_id)
        for child in data["ied_patterns"]:
            if child.get("parent") == pattern_id:
                if "icd_refs" not in child:
                    child["icd_refs"] = []
                if icd_ref not in child["icd_refs"]:
                    child["icd_refs"].append(icd_ref)
                    modified = True

        if modified:
            self.save_patterns(data)

        return True

    def unlink_icd_from_pattern(self, pattern_id: str, icd_ref: str) -> bool:
        """Supprime la liaison ICD d'un pattern et de ses variants."""
        data = self.load_patterns()
        pattern = next((p for p in data["ied_patterns"] if p["id"] == pattern_id), None)

        if not pattern:
            return False

        modified = False

        # Retirer du pattern principal
        if "icd_refs" in pattern and icd_ref in pattern["icd_refs"]:
            pattern["icd_refs"].remove(icd_ref)
            modified = True

        # Propager aux variants (patterns enfants)
        for child in data["ied_patterns"]:
            if child.get("parent") == pattern_id:
                if "icd_refs" in child and icd_ref in child["icd_refs"]:
                    child["icd_refs"].remove(icd_ref)
                    modified = True

        if modified:
            self.save_patterns(data)
            return True

        return False

    def get_icds_for_pattern(self, pattern_id: str) -> list[str]:
        """Retourne les chemins ICD liés à un pattern."""
        pattern = self.get_pattern_by_id(pattern_id)
        return pattern.get("icd_refs", []) if pattern else []

    def get_patterns_for_icd(self, icd_path: str) -> list[dict]:
        """Retourne les patterns liés à un ICD."""
        data = self.load_patterns()
        return [p for p in data["ied_patterns"] if icd_path in p.get("icd_refs", [])]

    # --- Matching SCD IED names ---

    def match_ied_name(self, ied_name: str) -> list[dict]:
        """
        Trouve les patterns qui matchent un nom d'IED du SCD.
        Retourne les patterns triés par spécificité (plus spécifique en premier).
        """
        matches = []
        data = self.load_patterns()

        for pattern_info in data["ied_patterns"]:
            pattern = pattern_info["pattern"]
            exclusions = pattern_info.get("exclusions", [])

            # Vérifier le pattern principal
            if self._fnmatch_pattern(ied_name, pattern):
                # Vérifier les exclusions
                excluded = any(self._fnmatch_pattern(ied_name, exc) for exc in exclusions)
                if not excluded:
                    matches.append(pattern_info)

        # Trier par spécificité (moins de wildcards = plus spécifique)
        matches.sort(key=lambda p: p["pattern"].count("*"))

        return matches

    def _fnmatch_pattern(self, name: str, pattern: str) -> bool:
        """Match un nom avec un pattern (case insensitive)."""
        return fnmatch.fnmatch(name.upper(), pattern.upper())

    def find_best_match(self, ied_name: str) -> dict | None:
        """Trouve le pattern le plus spécifique pour un nom d'IED."""
        matches = self.match_ied_name(ied_name)
        return matches[0] if matches else None

    # --- Suggestions automatiques ---

    def suggest_pattern_for_icd(self, icd_type: str) -> list[dict]:
        """
        Suggère des patterns IED qui pourraient correspondre à un type ICD.
        Basé sur la correspondance du type ICD avec les IDs de patterns.
        """
        suggestions = []
        icd_type_upper = icd_type.upper()
        data = self.load_patterns()

        for pattern_info in data["ied_patterns"]:
            pattern_id = pattern_info["id"].upper()
            # Match si le type ICD contient l'ID du pattern ou vice versa
            if pattern_id in icd_type_upper or icd_type_upper in pattern_id:
                suggestions.append(pattern_info)

        return suggestions

    # ============================================================
    # Gestion des ICD référents par pattern ET par manufacturer
    # ============================================================
    # Structure: pattern["default_icds"] = { "manufacturer": "icd_id", ... }

    def set_default_icd(self, pattern_id: str, manufacturer: str, icd_id: str) -> bool:
        """
        Définit un ICD comme référent pour un pattern et un manufacturer.

        Args:
            pattern_id: ID du pattern (ex: "SCU", "BCU")
            manufacturer: Constructeur (ex: "SCLE SFE", "Efacec")
            icd_id: ID de l'ICD à définir comme référent

        Returns:
            True si succès
        """
        data = self.load_patterns()
        pattern = next((p for p in data["ied_patterns"] if p["id"] == pattern_id), None)

        if not pattern:
            return False

        # Initialiser default_icds si absent
        if "default_icds" not in pattern:
            pattern["default_icds"] = {}

        # Définir le référent pour ce manufacturer
        pattern["default_icds"][manufacturer] = icd_id

        self.save_patterns(data)
        return True

    def get_default_icd(self, pattern_id: str, manufacturer: str | None = None) -> str | dict | None:
        """
        Récupère l'ICD référent pour un pattern.

        Args:
            pattern_id: ID du pattern
            manufacturer: Si fourni, retourne l'ICD pour ce manufacturer spécifique
                         Sinon, retourne le dict complet {manufacturer: icd_id}

        Returns:
            - Si manufacturer: l'icd_id ou None
            - Sinon: dict {manufacturer: icd_id} ou {}
        """
        pattern = self.get_pattern_by_id(pattern_id)
        if not pattern:
            return None if manufacturer else {}

        defaults = pattern.get("default_icds", {})

        if manufacturer:
            return defaults.get(manufacturer)
        return defaults

    def clear_default_icd(self, pattern_id: str, manufacturer: str) -> bool:
        """
        Supprime le référent pour un pattern et un manufacturer.

        Returns:
            True si un référent a été supprimé
        """
        data = self.load_patterns()
        pattern = next((p for p in data["ied_patterns"] if p["id"] == pattern_id), None)

        if not pattern or "default_icds" not in pattern:
            return False

        if manufacturer not in pattern["default_icds"]:
            return False

        del pattern["default_icds"][manufacturer]
        self.save_patterns(data)
        return True

    def get_all_defaults(self) -> dict[str, dict[str, str]]:
        """
        Retourne tous les référents de tous les patterns.

        Returns:
            Dict {pattern_id: {manufacturer: icd_id, ...}, ...}
        """
        data = self.load_patterns()
        result = {}

        for pattern in data["ied_patterns"]:
            defaults = pattern.get("default_icds", {})
            if defaults:
                result[pattern["id"]] = defaults

        return result

    def is_default_icd(self, pattern_id: str, manufacturer: str, icd_id: str) -> bool:
        """Vérifie si un ICD est le référent pour un pattern/manufacturer."""
        default = self.get_default_icd(pattern_id, manufacturer)
        return default == icd_id


# --- CLI utilitaire ---
if __name__ == "__main__":
    manager = IEDPatternManager()
    patterns = manager.get_all_patterns()
    print(f"📋 {len(patterns)} patterns IED chargés")

    # Test matching
    test_names = ["POSTE_TGSCU1", "POSTE_TGSCU2", "SITE_BCU1", "TEST_PIU"]
    for name in test_names:
        matches = manager.match_ied_name(name)
        if matches:
            print(f"  {name} → {[m['id'] for m in matches]}")
        else:
            print(f"  {name} → Aucun match")
