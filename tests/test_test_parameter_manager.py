"""Tests du parsing PAR utilise par les parametres d'essais R#BD."""

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from core.test_parameter_manager import TestParameterManager


class TestParameterManagerTest(unittest.TestCase):
    """Controle les extractions critiques du fichier PAR d'exemple."""

    def test_import_par_extracts_functions_and_parameter_names_only(self) -> None:
        """R_BD ne doit garder que les fonctions et noms de parametres."""
        base_dir = Path(__file__).resolve().parents[1]
        asset_dir = base_dir / "assets"
        ied_dir = base_dir / "data" / "ied"

        with TemporaryDirectory() as tmp_dir:
            manager = TestParameterManager(data_dir=Path(tmp_dir), assets_dir=asset_dir, ied_data_dir=ied_dir)
            catalog = manager.import_from_path(asset_dir / "PMED_3LABAR1.par")

        param_communs = next(
            function
            for function in catalog["functions"]
            if function["name"] == "PARAM-COMMUNS"
        )
        angle_param = next(
            parameter
            for parameter in param_communs["parameters"]
            if parameter["name"] == "ANG-Z-LIGNE"
        )

        self.assertEqual(angle_param["type_parametre"], "Numerique")
        self.assertNotIn("values", angle_param)
        self.assertNotIn("allowed_values", angle_param)

    def test_import_par_extracts_temporisation_parameter(self) -> None:
        """Les temporisations doivent rester disponibles pour le mode Auto."""
        base_dir = Path(__file__).resolve().parents[1]
        asset_dir = base_dir / "assets"
        ied_dir = base_dir / "data" / "ied"

        with TemporaryDirectory() as tmp_dir:
            manager = TestParameterManager(data_dir=Path(tmp_dir), assets_dir=asset_dir, ied_data_dir=ied_dir)
            catalog = manager.import_from_path(asset_dir / "PMED_3LABAR1.par")

        function = next(
            item
            for item in catalog["functions"]
            if item["name"] == "ARS - DMU RMU_LDAMU"
        )
        parameter_names = {parameter["name"] for parameter in function["parameters"]}

        self.assertIn("T-RVB-RMU", parameter_names)

    def test_import_par_maps_scu_equipment_to_parent_and_variant(self) -> None:
        """Les equipements SCU1/SCU2 doivent etre des variantes du type SCU."""
        base_dir = Path(__file__).resolve().parents[1]
        asset_dir = base_dir / "assets"
        ied_dir = base_dir / "data" / "ied"

        with TemporaryDirectory() as tmp_dir:
            manager = TestParameterManager(data_dir=Path(tmp_dir), assets_dir=asset_dir, ied_data_dir=ied_dir)
            catalog = manager.import_from_path(asset_dir / "PMED_3LABAR1.par")

        scu_function = next(
            item
            for item in catalog["functions"]
            if item["name"] == "DJ_LDDJ" and item["variant"] == "SCU2"
        )

        self.assertEqual(scu_function["ied"], "SCU")
        self.assertEqual(scu_function["variant"], "SCU2")


if __name__ == "__main__":
    unittest.main()
