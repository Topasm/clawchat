from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from scripts.verify_tauri_data_import import VerificationError, verify_import


class VerifyTauriDataImportTests(unittest.TestCase):
    def make_fixture(self) -> tuple[tempfile.TemporaryDirectory[str], tempfile.TemporaryDirectory[str]]:
        source = tempfile.TemporaryDirectory()
        destination = tempfile.TemporaryDirectory()
        source_path = Path(source.name)
        destination_path = Path(destination.name)
        source_config = {"port": 8123, "pin": "654321"}
        destination_config = {
            "appMode": "host",
            "port": 8123,
            "pin": "654321",
            "obsidianVaultPath": "",
            "hostServerUrl": "",
            "autoStartHost": True,
        }
        (source_path / "server-config.json").write_text(
            json.dumps(source_config), encoding="utf-8"
        )
        (destination_path / "server-config.json").write_text(
            json.dumps(destination_config), encoding="utf-8"
        )
        for root in (source_path, destination_path):
            data = root / "server-data" / "data"
            (data / "uploads").mkdir(parents=True)
            (data / "clawchat.db").write_bytes(b"SQLite fixture")
            (data / "uploads" / "paper.txt").write_text("keep", encoding="utf-8")
        (destination_path / "electron-import-v1.json").write_text(
            json.dumps(
                {
                    "version": 1,
                    "source": str(source_path),
                    "configImported": True,
                    "dataImported": True,
                }
            ),
            encoding="utf-8",
        )
        return source, destination

    def test_accepts_semantically_equal_config_and_identical_data(self) -> None:
        source, destination = self.make_fixture()
        self.addCleanup(source.cleanup)
        self.addCleanup(destination.cleanup)

        report = verify_import(Path(source.name), Path(destination.name))

        self.assertTrue(report["configImported"])
        self.assertTrue(report["dataImported"])
        self.assertEqual(report["verifiedFiles"], 2)

    def test_reports_changed_imported_files(self) -> None:
        source, destination = self.make_fixture()
        self.addCleanup(source.cleanup)
        self.addCleanup(destination.cleanup)
        changed = Path(destination.name) / "server-data" / "data" / "clawchat.db"
        changed.write_bytes(b"changed")

        with self.assertRaisesRegex(VerificationError, "changed=.*clawchat.db"):
            verify_import(Path(source.name), Path(destination.name))

    def test_rejects_marker_for_another_source(self) -> None:
        source, destination = self.make_fixture()
        self.addCleanup(source.cleanup)
        self.addCleanup(destination.cleanup)
        marker = Path(destination.name) / "electron-import-v1.json"
        value = json.loads(marker.read_text(encoding="utf-8"))
        value["source"] = str(Path(destination.name) / "wrong")
        marker.write_text(json.dumps(value), encoding="utf-8")

        with self.assertRaisesRegex(VerificationError, "marker source"):
            verify_import(Path(source.name), Path(destination.name))


if __name__ == "__main__":
    unittest.main()
