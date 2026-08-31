from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
HARNESS_SCRIPT = REPOSITORY_ROOT / "scripts" / "check_harness.py"
REQUIRED_KNOWLEDGE_FILES = (
    "services/AGENTS.md",
    "tests/AGENTS.md",
    "docs/HARNESS.md",
    "docs/AGENT_WORKLOG.md",
    "docs/decisions/001-agent-harness.md",
    "docs/decisions/002-vercel-deployment-target.md",
    "docs/conventions/agent-workflow.md",
    "docs/conventions/deployment.md",
    "docs/domain/glossary.md",
    "docs/domain/workflows.md",
    "docs/failures/README.md",
    ".github/workflows/harness.yml",
)


def _create_valid_project(project_root: Path) -> None:
    (project_root / "AGENTS.md").write_text(
        "Harness-Version: `1.0.0`\n",
        encoding="utf-8",
    )
    (project_root / "VERSION").write_text("0.3.0-dev.0\n", encoding="utf-8")
    (project_root / "CHANGELOG.md").write_text(
        "## [0.3.0-dev.0]\n",
        encoding="utf-8",
    )
    for relative_path in REQUIRED_KNOWLEDGE_FILES:
        path = project_root / relative_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(f"# {path.stem}\n", encoding="utf-8")


class HarnessCheckCliTests(unittest.TestCase):
    def test_valid_minimal_project_passes(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            _create_valid_project(project_root)

            result = subprocess.run(
                [sys.executable, str(HARNESS_SCRIPT), "--root", str(project_root)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("HARNESS CHECK PASSED", result.stdout)

    def test_missing_knowledge_document_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            _create_valid_project(project_root)
            (project_root / "docs" / "HARNESS.md").unlink()

            result = subprocess.run(
                [sys.executable, str(HARNESS_SCRIPT), "--root", str(project_root)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn("missing required file: docs/HARNESS.md", result.stdout)

    def test_service_importing_ui_framework_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            _create_valid_project(project_root)
            service_path = project_root / "services" / "unsafe_service.py"
            service_path.parent.mkdir(parents=True, exist_ok=True)
            service_path.write_text("import streamlit\n", encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(HARNESS_SCRIPT), "--root", str(project_root)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "architecture violation: services/unsafe_service.py imports streamlit",
                result.stdout,
            )

    def test_temporary_drift_file_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            _create_valid_project(project_root)
            (project_root / "temp_experiment.py").write_text("pass\n", encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(HARNESS_SCRIPT), "--root", str(project_root)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn("structure drift: temp_experiment.py", result.stdout)

    def test_invalid_project_version_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            _create_valid_project(project_root)
            (project_root / "VERSION").write_text("release-next\n", encoding="utf-8")

            result = subprocess.run(
                [sys.executable, str(HARNESS_SCRIPT), "--root", str(project_root)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn("VERSION is not valid SemVer: release-next", result.stdout)

    def test_version_missing_from_changelog_fails(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            project_root = Path(temp_dir)
            _create_valid_project(project_root)
            (project_root / "CHANGELOG.md").write_text(
                "## [Unreleased]\n",
                encoding="utf-8",
            )

            result = subprocess.run(
                [sys.executable, str(HARNESS_SCRIPT), "--root", str(project_root)],
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn(
                "CHANGELOG.md does not contain project version: 0.3.0-dev.0",
                result.stdout,
            )


if __name__ == "__main__":
    unittest.main()
