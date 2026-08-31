from __future__ import annotations

import argparse
import ast
import re
from pathlib import Path


SEMVER_PATTERN = re.compile(
    r"^(0|[1-9]\d*)\."
    r"(0|[1-9]\d*)\."
    r"(0|[1-9]\d*)"
    r"(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$"
)

REQUIRED_FILES = (
    "AGENTS.md",
    "VERSION",
    "CHANGELOG.md",
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
FORBIDDEN_FILE_PATTERNS = (
    "temp_*.py",
    "*_new.py",
    "*_old.py",
    "*_backup.*",
    "*_fix.*",
)
IGNORED_DIRECTORIES = {".git", ".venv", "venv", "__pycache__"}


def check_project(project_root: Path) -> list[str]:
    errors: list[str] = []

    for relative_path in REQUIRED_FILES:
        if not (project_root / relative_path).is_file():
            errors.append(f"missing required file: {relative_path}")

    version_path = project_root / "VERSION"
    if version_path.is_file():
        version = version_path.read_text(encoding="utf-8").strip()
        if not SEMVER_PATTERN.fullmatch(version):
            errors.append(f"VERSION is not valid SemVer: {version or '<empty>'}")
        else:
            changelog_path = project_root / "CHANGELOG.md"
            if changelog_path.is_file() and f"[{version}]" not in changelog_path.read_text(
                encoding="utf-8"
            ):
                errors.append(f"CHANGELOG.md does not contain project version: {version}")

    services_dir = project_root / "services"
    if services_dir.is_dir():
        for path in sorted(services_dir.glob("*.py")):
            try:
                tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
            except SyntaxError as exc:
                relative_path = path.relative_to(project_root).as_posix()
                errors.append(f"syntax error: {relative_path}:{exc.lineno}")
                continue

            imported_roots: set[str] = set()
            for node in ast.walk(tree):
                if isinstance(node, ast.Import):
                    imported_roots.update(alias.name.split(".", 1)[0] for alias in node.names)
                elif isinstance(node, ast.ImportFrom) and node.module:
                    imported_roots.add(node.module.split(".", 1)[0])

            for forbidden_import in sorted(imported_roots & {"app", "streamlit"}):
                relative_path = path.relative_to(project_root).as_posix()
                errors.append(
                    f"architecture violation: {relative_path} imports {forbidden_import}"
                )

    drift_paths: set[str] = set()
    for pattern in FORBIDDEN_FILE_PATTERNS:
        for path in project_root.rglob(pattern):
            relative_path = path.relative_to(project_root)
            if any(part in IGNORED_DIRECTORIES for part in relative_path.parts):
                continue
            drift_paths.add(relative_path.as_posix())

    for relative_path in sorted(drift_paths):
        errors.append(f"structure drift: {relative_path}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate the repository agent harness.")
    parser.add_argument("--root", type=Path, default=Path.cwd())
    args = parser.parse_args()

    errors = check_project(args.root.resolve())
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        return 1

    print("HARNESS CHECK PASSED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
