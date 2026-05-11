"""Gestion des parametres d'essais importes depuis les fichiers PAR.

Ce module porte la logique metier liee aux parametres de test R#BD :
- lecture/ecriture du catalogue JSON utilise par l'interface ;
- import d'un fichier `.par` XML RTE ;
- extraction des fonctions et noms de parametres utiles a R#BD.

Le frontend ne parse jamais le XML directement. Il consomme uniquement le JSON
normalise produit ici, ce qui garde le parsing IEC/RTE cote Python.
"""

from __future__ import annotations

import json
import logging
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from fnmatch import fnmatchcase
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger("API[r_bd]")


class TestParameterManager:
    """Manager des donnees de parametrage des essais.

    Le fichier persistant est volontairement place dans `data/essais` car ces
    parametres pilotent l'editeur d'essais et seront reutilises par R#GUIDE.
    """

    def __init__(self, data_dir: Path, assets_dir: Path, ied_data_dir: Path | None = None) -> None:
        """Initialiser le manager avec les chemins applicatifs verifies."""
        self.data_dir = data_dir
        self.assets_dir = assets_dir
        self.ied_data_dir = ied_data_dir
        self.filepath = self.data_dir / "parametres_tests.json"
        self.default_par_path = self.assets_dir / "PMED_3LABAR1.par"

    def load(self) -> Dict[str, Any]:
        """Charger le catalogue JSON, avec initialisation depuis l'exemple PAR."""
        if not self.filepath.exists() and self.default_par_path.exists():
            logger.info("[JSON][ESSAIS] Initialisation parametres tests depuis %s", self.default_par_path)
            catalog = self.import_from_path(self.default_par_path)
            self.save(catalog)
            return catalog

        data = self._load_json(self.filepath)
        if not isinstance(data, dict):
            return self.empty_catalog(source_filename="")
        return self.normalize_catalog(data)

    def save(self, catalog: Dict[str, Any]) -> Dict[str, Any]:
        """Normaliser puis sauvegarder le catalogue de parametrage."""
        normalized = self.normalize_catalog(catalog)
        normalized["updated_at"] = datetime.now().isoformat()
        self._save_json(self.filepath, normalized)
        return normalized

    def import_from_path(self, path: Path) -> Dict[str, Any]:
        """Importer un fichier PAR deja present sur disque."""
        content = path.read_bytes()
        return self.import_from_bytes(content, path.name)

    def import_from_bytes(self, content: bytes, filename: str) -> Dict[str, Any]:
        """Parser le contenu XML d'un fichier PAR et retourner un catalogue."""
        root = ET.fromstring(content)
        functions: List[Dict[str, Any]] = []

        for index, function_node in enumerate(root.findall(".//FONCTIONS/FONCTION"), start=1):
            name = self._text_attr(function_node, "Nom")
            equipment = self._resolve_equipment_reference(self._text_attr(function_node, "Equipement"))
            function = {
                "id": self._stable_id(name, index),
                "name": name,
                "description": self._text_attr(function_node, "Description"),
                "ied": equipment["ied"],
                "variant": equipment["variant"],
                "ld": self._text_attr(function_node, "LD"),
                "parameters": [],
            }

            for param_index, parameter_node in enumerate(function_node.findall("./Parametre"), start=1):
                parameter_name = self._text_attr(parameter_node, "Nom")
                function["parameters"].append({
                    "id": self._stable_id(f"{function['id']}::{parameter_name}", param_index),
                    "name": parameter_name,
                    "description": self._text_attr(parameter_node, "Description"),
                    "type_parametre": self._text_attr(parameter_node, "TypeParametre"),
                })

            functions.append(function)

        return self.normalize_catalog({
            "version": 1,
            "source": {
                "filename": filename,
                "imported_at": datetime.now().isoformat(),
            },
            "functions": functions,
        })

    def empty_catalog(self, source_filename: str = "") -> Dict[str, Any]:
        """Construire un catalogue vide au format attendu par le frontend."""
        return {
            "version": 1,
            "source": {
                "filename": source_filename,
                "imported_at": "",
            },
            "updated_at": datetime.now().isoformat(),
            "functions": [],
        }

    def normalize_catalog(self, catalog: Dict[str, Any]) -> Dict[str, Any]:
        """Assainir un catalogue avant exposition API ou sauvegarde.

        Cette normalisation permet a l'utilisateur de renommer une fonction ou
        un parametre dans l'IHM sans casser les listes deroulantes : si un id est
        absent, il est regenere a partir du nom courant.
        """
        source = catalog.get("source") if isinstance(catalog.get("source"), dict) else {}
        normalized = {
            "version": int(catalog.get("version") or 1),
            "source": {
                "filename": str(source.get("filename") or ""),
                "imported_at": str(source.get("imported_at") or ""),
            },
            "updated_at": str(catalog.get("updated_at") or datetime.now().isoformat()),
            "functions": [],
        }
        seen_function_ids: set[str] = set()

        for function_index, function in enumerate(catalog.get("functions") or [], start=1):
            if not isinstance(function, dict):
                continue
            function_name = str(function.get("name") or "").strip()
            raw_function_id = str(function.get("id") or self._stable_id(function_name, function_index)).strip()
            function_id = self._make_unique_id(raw_function_id, seen_function_ids)
            equipment = self._normalize_function_equipment(function)
            normalized_function = {
                "id": function_id,
                "name": function_name,
                "description": str(function.get("description") or "").strip(),
                "ied": equipment["ied"],
                "variant": equipment["variant"],
                "ld": str(function.get("ld") or "").strip(),
                "parameters": [],
            }
            seen_parameter_ids: set[str] = set()

            for param_index, parameter in enumerate(function.get("parameters") or [], start=1):
                if not isinstance(parameter, dict):
                    continue
                parameter_name = str(parameter.get("name") or "").strip()
                raw_parameter_id = str(
                    parameter.get("id") or self._stable_id(f"{function_id}::{parameter_name}", param_index)
                ).strip()
                parameter_id = self._make_unique_id(raw_parameter_id, seen_parameter_ids)
                normalized_function["parameters"].append({
                    "id": parameter_id,
                    "name": parameter_name,
                    "description": str(parameter.get("description") or "").strip(),
                    "type_parametre": str(parameter.get("type_parametre") or "").strip(),
                })

            normalized["functions"].append(normalized_function)

        return normalized

    def _stable_id(self, label: str, fallback_index: int) -> str:
        """Construire un identifiant lisible et stable pour le frontend."""
        normalized = re.sub(r"[^A-Za-z0-9]+", "_", str(label or "")).strip("_").lower()
        return normalized or f"item_{fallback_index}"

    def _make_unique_id(self, raw_id: str, seen: set[str]) -> str:
        """Eviter les collisions lorsque plusieurs fonctions portent le meme nom."""
        base_id = raw_id or "item"
        candidate = base_id
        index = 2
        while candidate in seen:
            candidate = f"{base_id}_{index}"
            index += 1
        seen.add(candidate)
        return candidate

    def _text_attr(self, node: ET.Element, name: str) -> str:
        """Lire un attribut XML en evitant les None dans le JSON final."""
        return str(node.attrib.get(name) or "").strip()

    def _resolve_equipment_reference(self, raw_equipment: str) -> Dict[str, str]:
        """Mapper l'attribut Equipement PAR vers IED et variante R#BD.

        Les patterns IED locaux sont la source de vérité. Les variantes sont
        testées avant les parents pour que `*SCU1` et `*SCU2` soient reconnues
        comme variantes de `SCU`, et non comme simple `SCU`.
        """
        value = str(raw_equipment or "").strip()
        if not value or value.lower() == "none":
            return {"ied": "", "variant": ""}

        patterns = self._load_ied_patterns()
        if not patterns:
            return {"ied": value, "variant": ""}

        sorted_patterns = sorted(
            patterns,
            key=lambda item: (0 if item.get("parent") else 1, -len(str(item.get("pattern") or ""))),
        )

        candidates = [value.upper(), value.upper().replace("*", "")]

        for pattern in sorted_patterns:
            glob = str(pattern.get("pattern") or "")
            if not glob or not any(fnmatchcase(candidate, glob.upper()) for candidate in candidates):
                continue

            pattern_id = str(pattern.get("id") or "").strip()
            parent_id = str(pattern.get("parent") or "").strip()
            if parent_id:
                return {"ied": parent_id, "variant": pattern_id}
            return {"ied": pattern_id, "variant": ""}

        return {"ied": value, "variant": ""}

    def _normalize_function_equipment(self, function: Dict[str, Any]) -> Dict[str, str]:
        """Normaliser les anciens champs `equipment` vers `ied`/`variant`."""
        ied = str(function.get("ied") or "").strip()
        variant = str(function.get("variant") or "").strip()
        if ied or variant:
            # Cas normal : l'utilisateur a deja choisi explicitement une
            # variante dans l'IHM, on conserve cette saisie telle quelle.
            if variant:
                return {"ied": ied, "variant": variant}

            # Cas de migration : certains catalogues intermediaires ont pu
            # stocker directement `SCU2`, `*SCU2` ou `*SCU2*` dans le champ IED.
            # On repasse alors par les patterns IED pour retrouver le parent
            # `SCU` et la variante `SCU2`.
            return self._resolve_equipment_reference(ied)

        raw_equipment = str(function.get("equipment") or "").strip()
        if not raw_equipment:
            return {"ied": "", "variant": ""}
        return self._resolve_equipment_reference(raw_equipment)

    def _load_ied_patterns(self) -> List[Dict[str, Any]]:
        """Lire les patterns IED utilises aussi par l'identification d'essai."""
        if not self.ied_data_dir:
            return []
        data = self._load_json(self.ied_data_dir / "liste_ied.json")
        patterns = data.get("ied_patterns") if isinstance(data, dict) else []
        return patterns if isinstance(patterns, list) else []

    def _load_json(self, filepath: Path) -> Any:
        """Lire un fichier JSON avec un retour stable en cas d'erreur."""
        if not filepath.exists():
            return {}
        try:
            with open(filepath, "r", encoding="utf-8") as stream:
                return json.load(stream)
        except (json.JSONDecodeError, OSError) as exc:
            logger.error("[JSON][ESSAIS] Lecture impossible %s: %s", filepath, exc)
            return {}

    def _save_json(self, filepath: Path, data: Dict[str, Any]) -> None:
        """Ecrire le catalogue JSON en creant le dossier si necessaire."""
        filepath.parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, "w", encoding="utf-8") as stream:
            json.dump(data, stream, ensure_ascii=False, indent=2)
