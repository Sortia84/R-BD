"""Contrat d'intégration des équations : version exacte, provenance et lecture seule."""

from __future__ import annotations

import importlib
import json
from pathlib import Path
import sys
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient


APP_DIR = Path(__file__).resolve().parents[1]
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

from core.equation_catalog import EquationCatalog, EquationCatalogError  # noqa: E402
from core.isa_manager import ISAManager, _publish_json_atomically  # noqa: E402


def equation_xml(version: str = "1.5.53", label: str = "DF.AIVO", expression: str = "E1") -> str:
    """XML minimal complet, sans règle métier BAP ajoutée par les tests."""
    return f'''<equationsregroupements>
      <numero_version>{version}</numero_version><date_modification>2026-10-15</date_modification>
      <regroupement id="G1" libellecourt="{label}" filtremodexp="0" temporisationregroupement="0">
        <entrees><entree id="E1" libellecourt="DF.ENTREE" Status="M"
          BAPVariant="1" BAPIgnoredValue="3" FIPValeur="1" FIPObligatoire="0">
          <DAop>Health</DAop><valeurs><valeur>2</valeur><valeur>3</valeur></valeurs>
          <operateur>OR</operateur>
        </entree></entrees><equation>{expression}</equation>
      </regroupement>
    </equationsregroupements>'''


class EquationFixture(unittest.TestCase):
    """Crée uniquement des catalogues temporaires, indépendants des données métier."""

    def setUp(self) -> None:
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.manager = ISAManager(self.root / "data", self.root / "uploads")
        self.manager.add_type({"id": "isa_alarmes", "name": "Équations", "category": "reference"})
        self.catalog = EquationCatalog(self.manager)

    def add_equation(self, **options) -> tuple[dict, Path]:
        """Importe le XML et exerce aussi le pipeline réel d'analyse."""
        source = self.root / "source.xml"
        source.write_text(equation_xml(**options), encoding="utf-8")
        entry = self.manager.import_file(source, "nom_sans_version.xml", "isa_alarmes")
        return entry, self.manager._get_file_current_path(entry)

    def assert_error(self, code: str, version: str = "1.5.53", file_id: str | None = None) -> None:
        with self.assertRaises(EquationCatalogError) as caught:
            self.catalog.resolve(version, file_id)
        self.assertEqual(caught.exception.detail["code"], code)


class EquationCatalogTests(EquationFixture):
    """Vérifie les sélections autorisées et les refus explicites."""

    def test_resolve_uses_xml_version_and_complete_raw_document(self) -> None:
        entry, source = self.add_equation()
        source.with_suffix(".analyzed.json").unlink()
        result = self.catalog.resolve("1.5.53")
        self.assertEqual(result["file"]["id"], entry["id"])
        self.assertEqual(result["schema_version"], "1.0")
        self.assertEqual(result["file"]["analysis_schema_version"], "2.0")
        self.assertEqual(result["document"]["regroupements"][0]["entrees"][0]["valeurs"], ["2", "3"])
        self.assertEqual(result["document"]["metadata"]["analysis_mode"], "raw")
        self.assertNotIn(str(self.root), json.dumps(result))

    def test_no_default_or_latest_fallback(self) -> None:
        entry, _ = self.add_equation()
        self.manager.set_default_file("isa_alarmes", entry["id"])
        with self.assertRaises(EquationCatalogError) as caught:
            self.catalog.resolve("1.5.54")
        self.assertEqual(caught.exception.status, 404)
        self.assertEqual(caught.exception.detail["available_versions"], ["1.5.53"])

    def test_two_contents_same_version_require_explicit_file(self) -> None:
        first, _ = self.add_equation(label="DF.A")
        second, _ = self.add_equation(label="DF.B")
        self.assert_error("EQUATION_AMBIGUOUS")
        resolved = self.catalog.resolve("1.5.53", second["id"])
        self.assertEqual(resolved["file"]["id"], second["id"])
        self.assertEqual(resolved["document"]["regroupements"][0]["libellecourt"], "DF.B")
        self.assert_error("EQUATION_VERSION_MISMATCH", "1.5.54", first["id"])

    def test_identical_imports_are_deduplicated_deterministically(self) -> None:
        first, _ = self.add_equation()
        second, _ = self.add_equation()
        expected = min(first["id"], second["id"])
        resolved = self.catalog.resolve("1.5.53")
        self.assertEqual(resolved["file"]["id"], expected)
        self.assertTrue(resolved["document"]["metadata"]["source_file"].startswith(expected))

    def test_changed_xml_invalidates_analysis_digest(self) -> None:
        _, source = self.add_equation()
        source.write_text(source.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        self.assert_error("EQUATION_ANALYSIS_STALE")
        self.assertEqual(self.catalog.list_files()["files"][0]["state"], "analysis_stale")

    def test_old_parser_or_schema_is_stale(self) -> None:
        _, source = self.add_equation()
        for suffix in (".analyzed.raw.json", ".analyzed.json"):
            path = source.with_suffix(suffix)
            document = json.loads(path.read_text(encoding="utf-8"))
            document["metadata"]["parser_version"] = "1.0.0"
            document["metadata"]["schema_version"] = "1.0"
            path.write_text(json.dumps(document), encoding="utf-8")
        self.assert_error("EQUATION_ANALYSIS_STALE")

    def test_enriched_fallback_requires_same_provenance(self) -> None:
        _, source = self.add_equation()
        source.with_suffix(".analyzed.raw.json").unlink()
        self.assertEqual(self.catalog.resolve("1.5.53")["document"]["metadata"]["analysis_mode"], "enriched")
        source.write_text(source.read_text(encoding="utf-8") + "\n", encoding="utf-8")
        self.assert_error("EQUATION_ANALYSIS_STALE")

    def test_invalid_analysis_is_inspectable_but_not_served_for_calculation(self) -> None:
        entry, source = self.add_equation(expression="E99")
        analysis = self.manager.analyze_file(entry["id"], "isa_alarmes", enrich=False)
        self.assertEqual(analysis["status"], "invalid")
        self.assertGreater(analysis["validation"]["error_count"], 0)
        self.assertTrue(source.with_suffix(".analyzed.raw.json").exists())
        self.assert_error("EQUATION_INVALID")

    def test_missing_source_and_traversal_are_explicit(self) -> None:
        entry, source = self.add_equation()
        source.unlink()
        self.assert_error("EQUATION_SOURCE_MISSING", file_id=entry["id"])
        self.assertIsNone(self.catalog._source_path({"filename": "../source.xml", "type_refs": ["isa_alarmes"]}))

    def test_atomic_failure_preserves_existing_analysis(self) -> None:
        target = self.root / "previous.json"
        target.write_text('{"old":true}', encoding="utf-8")
        with patch("core.isa_manager.os.replace", side_effect=OSError("publication impossible")):
            with self.assertRaises(OSError):
                _publish_json_atomically(target, {"new": True})
        self.assertEqual(target.read_text(encoding="utf-8"), '{"old":true}')
        self.assertFalse(list(self.root.glob(".*.tmp")))

    def test_raw_reanalysis_remains_visible_in_legacy_ui(self) -> None:
        entry, source = self.add_equation()
        source.write_text(equation_xml(label="DF.NEW"), encoding="utf-8")
        self.manager.analyze_file(entry["id"], "isa_alarmes", enrich=False)
        displayed = self.manager.get_analyzed_data(entry["id"])
        self.assertEqual(displayed["regroupements"][0]["libellecourt"], "DF.NEW")

    def test_risa_enrichment_preserves_equation_and_all_values(self) -> None:
        self.manager.add_type({"id": "risa", "name": "RISA", "category": "reference"})
        risa_source = self.root / "risa.json"
        risa_source.write_text(json.dumps({"index": {"DF.ENTREE": {
            "UniqueID": "U1", "Libelle8": "DF.ENTREE",
            "InfosISA": {"ISA.Libellé 16 caractères": "ENTREE ENRICHIE"},
        }}}), encoding="utf-8")
        self.manager.import_file(risa_source, "risa.json", "risa")
        _, source = self.add_equation()
        raw = json.loads(source.with_suffix(".analyzed.raw.json").read_text(encoding="utf-8"))
        enriched = json.loads(source.with_suffix(".analyzed.json").read_text(encoding="utf-8"))
        raw_group, enriched_group = raw["regroupements"][0], enriched["regroupements"][0]
        for field in ("equation", "equation_ast", "equation_references"):
            self.assertEqual(raw_group[field], enriched_group[field])
        self.assertEqual(enriched_group["entrees"][0]["valeurs"], ["2", "3"])
        self.assertEqual(raw_group["entrees"][0]["risa_matches"], [])
        self.assertEqual(enriched_group["entrees"][0]["risa_match_count"], 1)
        self.assertEqual(raw["metadata"]["source_sha256"], enriched["metadata"]["source_sha256"])


class EquationIntegrationTests(EquationFixture):
    """Exerce le contrat HTTP sur une application isolée et un stockage temporaire."""

    def setUp(self) -> None:
        super().setUp()
        self.routes = importlib.import_module("api.router_equation_integration")
        self.patcher = patch.object(self.routes, "isa_manager", self.manager)
        self.patcher.start()
        self.addCleanup(self.patcher.stop)
        app = FastAPI()
        app.include_router(self.routes.router)
        isa_routes = importlib.import_module("api.router_isa")
        for name, value in (("manager", self.manager), ("UPLOADS_DIR", self.root / "uploads")):
            patcher = patch.object(isa_routes, name, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        app.include_router(isa_routes.router)
        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def test_get_resolve_and_catalog_never_write(self) -> None:
        entry, _ = self.add_equation()
        before = {str(path): (path.stat().st_mtime_ns, path.read_bytes())
                  for path in self.root.rglob("*") if path.is_file()}
        with patch.object(self.manager, "analyze_file", side_effect=AssertionError("GET réanalyse")):
            listing = self.client.get("/api/integrations/rscd/v1/equations")
            resolved = self.client.get("/api/integrations/rscd/v1/equations/resolve", params={"version": "1.5.53"})
        self.assertEqual(listing.status_code, 200)
        self.assertEqual(listing.json()["files"][0]["state"], "ready")
        self.assertEqual(resolved.status_code, 200)
        self.assertEqual(resolved.json()["file"]["id"], entry["id"])
        after = {str(path): (path.stat().st_mtime_ns, path.read_bytes())
                 for path in self.root.rglob("*") if path.is_file()}
        self.assertEqual(before, after)

    def test_version_is_required_and_unknown_version_has_structured_error(self) -> None:
        self.add_equation()
        endpoint = "/api/integrations/rscd/v1/equations/resolve"
        self.assertEqual(self.client.get(endpoint).status_code, 422)
        response = self.client.get(endpoint, params={"version": "1.5.54"})
        self.assertEqual(response.status_code, 404)
        self.assertEqual(response.json()["detail"]["code"], "EQUATION_NOT_FOUND")

    def test_upload_xml_handles_browser_path_and_invalid_analysis_status(self) -> None:
        response = self.client.post("/api/isa/upload", data={"type_id": "isa_alarmes"},
                                    files={"file": ("C:\\fakepath\\equations.xml", equation_xml(), "text/xml")})
        self.assertEqual(response.status_code, 200)
        entry = response.json()["file"]
        self.assertEqual(entry["original_name"], "equations.xml")
        self.assertTrue(entry["analysis_result"]["analysis"]["usable"])
        source = self.manager._get_file_current_path(entry)
        source.write_text(equation_xml(expression="E99"), encoding="utf-8")
        response = self.client.post(f"/api/isa/analyze/{entry['id']}", params={"type_id": "isa_alarmes"})
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.json()["success"])
        self.assertEqual(response.json()["result"]["status"], "invalid")
        blocked = self.client.get("/api/integrations/rscd/v1/equations/resolve", params={"version": "1.5.53"})
        self.assertEqual(blocked.status_code, 422)
        self.assertEqual(blocked.json()["detail"]["code"], "EQUATION_INVALID")

    def test_upload_rejects_unknown_type_before_writing(self) -> None:
        response = self.client.post("/api/isa/upload", data={"type_id": "../../outside"},
                                    files={"file": ("equations.xml", equation_xml(), "text/xml")})
        self.assertEqual(response.status_code, 400)
        self.assertFalse((self.root / "uploads" / "temp").exists())


if __name__ == "__main__":
    unittest.main()
