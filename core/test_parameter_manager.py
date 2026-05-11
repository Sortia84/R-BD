from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List
import logging
import xml.etree.ElementTree as ET
from pathlib import Path

logger = logging.getLogger(__name__)


class TestParameterValidationError(ValueError):
    """Exception levee lors d'erreurs de validation du catalogue.

    Attributes:
        errors: Liste des erreurs rencontrees, chacune indexee par
                function_index, parameter_index, et contenant le champ
                et le message d'erreur correspondants.
    """
    def __init__(self, errors: List[Dict[str, Any]]):
        self.errors = errors
        message = f"Validation du catalogue echouee : {len(errors)} erreur(s)"
        super().__init__(message)


class TestParameterManager:
    """Gestion du catalogue de parametrage des essais (injections).

    Ce gestionnaire porte les responsabilites suivantes :
      - Charger et normaliser le catalogue depuis un JSON persistant
      - Importer des fichiers PAR pour prepeupler le catalogue
      - Valider l'integrite metier des donnees avant sauvegarde
      - Persister les changements en JSON de facon lisible et versionee

    Le catalogue est organise de facon hierarchique :
      - fonctions d'injection (ex : PARAM-COMMUNS, PARAM-SPECIFIQUES)
        - parametres (ex : P_VOLTAGE, P_COURANT)
          - metadata (description, type, id stable)

    Les identifiants id sont generes et preserves cote backend pour
    permettre au frontend d'y faire reference sans risque d'instabilite
    lors de renommages ou de reordres.
    """

    REQUIRED_FUNCTION_FIELDS = ("name", "ied", "ld")
    REQUIRED_PARAMETER_FIELDS = ("name",)

    def __init__(
        self,
        data_dir: str | Path | None = None,
        assets_dir: str | Path | None = None,
        ied_data_dir: str | Path | None = None,
    ):
        """Initialiser le gestionnaire de parametrage.

        Args:
            data_dir: Dossier contenant le JSON persistant (defaults to
                      apps/r_bd/data/essais).
            assets_dir: Dossier contenant les fichiers d'exemple comme les
                        PAR (defaults to apps/r_bd/assets).
            ied_data_dir: Dossier contenant les donnees IED (unused pour
                          l'instant mais conserve pour compat tests).
        """
        base = Path(__file__).resolve().parent.parent  # → apps/r_bd/
        self.data_dir = Path(data_dir) if data_dir else base / "data" / "essais"
        self.assets_dir = Path(assets_dir) if assets_dir else base / "assets"
        self.filepath = self.data_dir / "parametres_tests.json"
        self.default_par_path = self.assets_dir / "PMED_3LABAR1.par"

    def load(self) -> Dict[str, Any]:
        """Charger le catalogue JSON, avec initialisation depuis l'exemple PAR.

        Lors du tout premier demarrage (aucun JSON existant), on importe le
        fichier PAR de reference fourni avec l'application pour offrir un
        catalogue prepupule. Cet import initial est ecrit directement sur
        disque sans passer par `save()` : il peut en effet contenir des
        fonctions partiellement renseignees (ex : PARAM-COMMUNS sans IED ni
        LD) qui ne respectent pas encore les regles de validation. C'est a
        l'utilisateur de completer ces lignes dans l'IHM avant la premiere
        sauvegarde reelle.
        """
        if not self.filepath.exists() and self.default_par_path.exists():
            logger.info(
                "[JSON][ESSAIS] Initialisation parametres tests depuis %s",
                self.default_par_path,
            )
            catalog = self.import_from_path(self.default_par_path)
            normalized = self.normalize_catalog(catalog)
            normalized["updated_at"] = datetime.now().isoformat()
            # Ecriture directe : on by-passe la validation pour ne pas
            # bloquer le bootstrap sur des donnees historiques incompletes.
            self._save_json(self.filepath, normalized)
            return normalized

        data = self._load_json(self.filepath)
        if not isinstance(data, dict):
            return self.empty_catalog(source_filename="")
        return self.normalize_catalog(data)

    def save(self, catalog: Dict[str, Any]) -> Dict[str, Any]:
        """Normaliser, valider puis sauvegarder le catalogue de parametrage.

        La validation est appliquee avant ecriture disque pour eviter de
        persister un catalogue partiellement renseigne. En cas d'erreur,
        une `TestParameterValidationError` est levee : elle sera convertie
        en reponse HTTP 400 par le routeur FastAPI.
        """
        normalized = self.normalize_catalog(catalog)
        errors = self.validate_catalog(normalized)
        if errors:
            logger.warning(
                "[JSON][ESSAIS] Sauvegarde refusee : %s erreur(s) de validation",
                len(errors),
            )
            raise TestParameterValidationError(errors)
        normalized["updated_at"] = datetime.now().isoformat()
        self._save_json(self.filepath, normalized)
        return normalized

    def validate_catalog(self, catalog: Dict[str, Any]) -> List[Dict[str, Any]]:
        """Valider l'integrite metier du catalogue.

        Champs obligatoires :
          - Function: name, ied, ld
          - Parameter: name

        Returns:
            Liste des erreurs rencontrees. Vide si le catalogue est valide.
            Chaque erreur est un dictionnaire contenant:
              - function_index : position de la fonction dans la liste
              - parameter_index : position du parametre (ou None)
              - field : cle du champ defaillant
              - message : description lisible de l'erreur
        """
        errors: List[Dict[str, Any]] = []
        functions = catalog.get("functions", [])

        for func_idx, func in enumerate(functions):
            for field in self.REQUIRED_FUNCTION_FIELDS:
                value = func.get(field)
                if not value or not str(value).strip():
                    errors.append({
                        "function_index": func_idx,
                        "parameter_index": None,
                        "field": field,
                        "message": f"Champ obligatoire manquant : {field}"
                    })

            parameters = func.get("parameters", [])
            for param_idx, param in enumerate(parameters):
                for field in self.REQUIRED_PARAMETER_FIELDS:
                    value = param.get(field)
                    if not value or not str(value).strip():
                        errors.append({
                            "function_index": func_idx,
                            "parameter_index": param_idx,
                            "field": field,
                            "message": f"Champ obligatoire manquant : {field}"
                        })

        return errors

    def import_from_path(self, filepath: str | Path) -> Dict[str, Any]:
        """Importer un fichier PAR depuis le chemin fourni."""
        try:
            content = Path(filepath).read_bytes()
            return self.import_from_bytes(content, str(Path(filepath).name))
        except Exception as exc:
            logger.exception("[ESSAIS][PARAM] Import PAR impossible: %s", filepath)
            return self.empty_catalog(source_filename="")

    def import_from_bytes(self, content: bytes, filename: str = "") -> Dict[str, Any]:
        """Importer un fichier PAR depuis des octets bruts.

        Les metadonnees de tracabilite (nom du fichier, date d'import)
        ne sont pas stockees dans le catalogue : l'import n'etant pas
        immediatement persiste, ces infos n'auraient aucune utilite.
        C'est a l'utilisateur de cliquer "Sauvegarder" pour accepter
        l'import et le materialiser sur disque.
        """
        try:
            root = ET.fromstring(content)
            logger.info("[ESSAIS][PARAM] Import PAR demarre : %s", filename or "(donnees brutes)")
            return self._parse_par_xml(root)
        except Exception as exc:
            logger.exception("[ESSAIS][PARAM] Parsing PAR impossible: %s", filename)
            return self.empty_catalog(source_filename="")

    def _parse_par_xml(self, root: ET.Element) -> Dict[str, Any]:
        """Parser le XML PAR en structure de catalogue.

        Structure attendue du PAR :
          - <FONCTIONS><FONCTION Nom="..." LD="..." Equipement="...">
            - <Parametre Nom="..." Description="..." TypeParametre="...">
        """
        functions = []

        for func_elem in root.findall(".//FONCTION"):
            func_name = func_elem.get("Nom", "").strip()
            func_desc = func_elem.get("Description", "").strip()
            func_ld = func_elem.get("LD", "").strip()
            func_equipement = func_elem.get("Equipement", "").strip()

            # Extraction de l'IED depuis l'equipement si present
            func_ied = ""
            if func_equipement and func_equipement.lower() != "none":
                # Format typo : "PMED3LABAR1BCU1" → essayer extraire "PMED3LABAR1"
                func_ied = func_equipement[:len(func_equipement) - 4] if len(func_equipement) > 4 else func_equipement

            parameters = []
            for param_elem in func_elem.findall("Parametre"):
                param_name = param_elem.get("Nom", "").strip()
                param_desc = param_elem.get("Description", "").strip()
                param_type = param_elem.get("TypeParametre", "").strip()

                parameters.append({
                    "id": "",
                    "name": param_name,
                    "description": param_desc,
                    "type_parametre": param_type
                })

            if func_name or parameters:
                functions.append({
                    "id": "",
                    "name": func_name,
                    "description": func_desc,
                    "ied": func_ied,
                    "variant": "",
                    "ld": func_ld,
                    "parameters": parameters
                })

        return {
            "version": 1,
            "functions": functions
        }

    def normalize_catalog(self, catalog: Dict[str, Any]) -> Dict[str, Any]:
        """Normaliser le catalogue : structure, ids, champs par defaut.

        Cette fonction corrige les variations de structure et genere des ids
        stables pour toute fonction ou parametre qui n'en auraient pas. Elle
        est idempotente : appeler normalize deux fois de suite sur le meme
        donnees produit le meme resultat.
        """
        if not isinstance(catalog, dict):
            return self.empty_catalog(source_filename="")

        version = catalog.get("version", 1)
        functions = catalog.get("functions", [])
        if not isinstance(functions, list):
            functions = []

        # Normalisation des fonctions
        normalized_functions = []
        for idx, func in enumerate(functions):
            if not isinstance(func, dict):
                continue

            # Generation d'un id stable si absent
            func_id = func.get("id")
            if not func_id:
                func_name = str(func.get("name", f"function_{idx}")).lower().replace(" ", "_")
                func_id = f"func_{func_name}_{idx}"

            # Normalisation des parametres
            parameters = func.get("parameters", [])
            if not isinstance(parameters, list):
                parameters = []

            normalized_params = []
            for param_idx, param in enumerate(parameters):
                if not isinstance(param, dict):
                    continue

                param_id = param.get("id")
                if not param_id:
                    param_name = str(param.get("name", f"param_{param_idx}")).lower().replace(" ", "_")
                    param_id = f"param_{param_name}_{param_idx}"

                normalized_params.append({
                    "id": param_id,
                    "name": str(param.get("name", "")).strip(),
                    "description": str(param.get("description", "")).strip(),
                    "type_parametre": str(param.get("type_parametre", "")).strip()
                })

            normalized_functions.append({
                "id": func_id,
                "name": str(func.get("name", "")).strip(),
                "description": str(func.get("description", "")).strip(),
                "ied": str(func.get("ied", "")).strip(),
                "variant": str(func.get("variant", "")).strip(),
                "ld": str(func.get("ld", "")).strip(),
                "parameters": normalized_params
            })

        return {
            "version": version,
            "functions": normalized_functions
        }

    def empty_catalog(self, source_filename: str = "") -> Dict[str, Any]:
        """Retourner un catalogue vide et valide structurellement."""
        return {
            "version": 1,
            "functions": []
        }

    def _load_json(self, filepath: str | Path) -> Dict[str, Any]:
        """Charger un fichier JSON depuis le disque."""
        try:
            filepath = Path(filepath)
            if not filepath.exists():
                logger.warning("[JSON][ESSAIS] Fichier absent : %s", filepath)
                return {}
            content = filepath.read_text(encoding="utf-8")
            import json
            return json.loads(content)
        except Exception as exc:
            logger.exception("[JSON][ESSAIS] Erreur charge JSON : %s", filepath)
            return {}

    def _save_json(self, filepath: str | Path, data: Dict[str, Any]) -> None:
        """Sauvegarder un dictionnaire en JSON sur le disque."""
        try:
            filepath = Path(filepath)
            filepath.parent.mkdir(parents=True, exist_ok=True)
            import json
            content = json.dumps(data, indent=2, ensure_ascii=False)
            filepath.write_text(content, encoding="utf-8")
            logger.info("[JSON][ESSAIS] Catalogue sauvegarde : %s", filepath)
        except Exception as exc:
            logger.exception("[JSON][ESSAIS] Erreur sauvegarde JSON : %s", filepath)
