"""Tests unitaires du classement manuel des essais R#BD.

Ces tests restent volontairement proches des helpers backend : l'IHM peut
changer, mais le contrat API consomme toujours `previous_test_id` et expose un
`order_index` technique stable pour R#GUIDE.
"""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

from fastapi import HTTPException


APP_DIR = Path(__file__).resolve().parents[1]
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from api.router_essais import (  # noqa: E402
    _ensure_order_fields,
    _normalise_essai_for_storage,
    _file_for_type,
    _validate_previous_reference,
    _would_create_cycle,
)


class EssaisOrderingTests(unittest.TestCase):
    """Verifie les invariants d'ordre utilises par R#BD et R#GUIDE."""

    def test_previous_chain_recomputes_order_index(self) -> None:
        """Une chaine A -> B -> C devient une liste ordonnee et indexee."""
        essais = [
            {"id": "RU-C", "name": "C", "previous_test_id": "RU-B"},
            {"id": "RU-A", "name": "A", "previous_test_id": ""},
            {"id": "RU-B", "name": "B", "previous_test_id": "RU-A"},
        ]

        ordered = _ensure_order_fields(essais)

        self.assertEqual([item["id"] for item in ordered], ["RU-A", "RU-B", "RU-C"])
        self.assertEqual([item["order_index"] for item in ordered], [10, 20, 30])
        self.assertEqual([item["order_type_number"] for item in ordered], [1, 2, 3])

    def test_automatic_order_numbers_are_grouped_by_ied_and_ld(self) -> None:
        """R_BD calcule les rangs derives sans demander une saisie utilisateur."""
        essais = [
            {"id": "RU-A", "type": "ru", "name": "A", "ied": "BCU", "ld": "LD1"},
            {"id": "RU-B", "type": "ru", "name": "B", "ied": "BCU", "ld": "LD2", "previous_test_id": "RU-A"},
            {"id": "RU-C", "type": "ru", "name": "C", "ied": "BCU", "ld": "LD1", "previous_test_id": "RU-B"},
            {"id": "RU-D", "type": "ru", "name": "D", "ied": "GW", "ld": "LD1", "previous_test_id": "RU-C"},
        ]

        ordered = _ensure_order_fields(essais, "ru")

        self.assertEqual([item["order_type_number"] for item in ordered], [1, 2, 3, 4])
        self.assertEqual([item["order_ied_number"] for item in ordered], [1, 2, 3, 1])
        self.assertEqual([item["order_ld_number"] for item in ordered], [1, 1, 2, 1])
        self.assertEqual(ordered[2]["order_scope"], {"type": "ru", "ied": "BCU", "ld": "LD1"})

    def test_missing_previous_reference_is_neutralised(self) -> None:
        """Un precedent supprime ne doit pas bloquer la liste d'essais."""
        ordered = _ensure_order_fields([
            {"id": "RU-A", "name": "A", "previous_test_id": "RU-UNKNOWN"}
        ])

        self.assertEqual(ordered[0]["previous_test_id"], "")
        self.assertEqual(ordered[0]["order_index"], 10)

    def test_cycle_is_detected_before_persistence(self) -> None:
        """La validation refuse une boucle dans la chaine d'ordre manuel."""
        essais = [
            {"id": "RU-A", "previous_test_id": ""},
            {"id": "RU-B", "previous_test_id": "RU-A"},
            {"id": "RU-C", "previous_test_id": "RU-B"},
        ]

        self.assertTrue(_would_create_cycle(essais, "RU-A", "RU-C"))

        with self.assertRaises(HTTPException):
            _validate_previous_reference(
                essais,
                {"id": "RU-A", "previous_test_id": "RU-C"},
            )

    def test_mvc_type_is_supported_by_essais_api(self) -> None:
        """R_BD expose le type MVC attendu par les flux SCD de R#GUIDE."""
        self.assertEqual(_file_for_type("mvc").name, "essais_mvc.json")

    def test_generic_essai_is_detached_from_function_fields(self) -> None:
        """Un essai generique ne conserve pas de rattachement IED / LD / LN."""
        essai = _normalise_essai_for_storage(
            {
                "id": "RU-GEN",
                "type": "ru",
                "scope": "generique",
                "ied": "BCU",
                "variant": "BCU_V1",
                "ld": "LDCTRL",
                "ln": "LLN0",
                "lninst": "0",
                "files": [{"id": "att_1", "name": "checklist.pdf"}],
            },
            "ru",
        )

        self.assertEqual(essai["scope"], "generic")
        self.assertEqual(essai["ied"], "")
        self.assertEqual(essai["ld"], "")
        self.assertEqual(essai["ln"], "")
        self.assertEqual(essai["attachments"][0]["name"], "checklist.pdf")
        self.assertEqual(essai["files"], essai["attachments"])


if __name__ == "__main__":
    unittest.main()
