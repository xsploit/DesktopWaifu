from __future__ import annotations

import argparse
import json
import os
import subprocess
from datetime import datetime
from pathlib import Path

from build_windows_onedir import main as build_onedir

ROOT = Path(__file__).resolve().parent
DIST_SOURCE_DIR = ROOT / "build" / "windows-onedir" / "DesktopWaifu-GenieCompat"
INSTALLER_OUTPUT_DIR = ROOT / "build" / "windows-installer"
INSTALLER_SCRIPT_PATH = ROOT / "installer" / "windows" / "desktopwaifu-genie-compat.iss"
ROOT_PACKAGE_JSON_PATH = ROOT.parent / "package.json"
LOCAL_PACKAGE_JSON_PATH = ROOT / "package.json"


def fail(message: str) -> None:
    raise SystemExit(f"[genie-installer] {message}")


def resolve_version() -> str:
    tag = str(os.environ.get("DESKTOPWAIFU_VERSION") or os.environ.get("GITHUB_REF_NAME") or "").strip()
    if tag:
        return tag[1:] if tag.startswith("v") else tag

    for package_json_path in (ROOT_PACKAGE_JSON_PATH, LOCAL_PACKAGE_JSON_PATH):
        if not package_json_path.exists():
            continue
        payload = json.loads(package_json_path.read_text("utf-8"))
        version = str(payload.get("version") or "").strip()
        if version:
            return version

    return "0.0.1"


def resolve_iscc_path() -> Path:
    candidates = [
        os.environ.get("INNO_SETUP_COMPILER"),
        str(Path(os.environ.get("LOCALAPPDATA") or "") / "Programs" / "Inno Setup 6" / "ISCC.exe"),
        r"C:\Program Files (x86)\Inno Setup 6\ISCC.exe",
        r"C:\Program Files\Inno Setup 6\ISCC.exe",
    ]

    for candidate in candidates:
        if candidate and Path(candidate).exists():
            return Path(candidate)

    fail("Inno Setup compiler not found. Install Inno Setup 6 or set INNO_SETUP_COMPILER.")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Build the DesktopWaifu Genie Windows installer.")
    parser.add_argument(
        "--rebuild-onedir",
        action="store_true",
        help="Rebuild the PyInstaller onedir payload before running Inno Setup.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.rebuild_onedir or not DIST_SOURCE_DIR.exists():
        build_onedir()

    if not DIST_SOURCE_DIR.exists():
        fail(f"Compiled onedir payload not found at {DIST_SOURCE_DIR}")
    if not INSTALLER_SCRIPT_PATH.exists():
        fail(f"Inno Setup script not found at {INSTALLER_SCRIPT_PATH}")

    INSTALLER_OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    version = resolve_version()
    output_base_filename = "DesktopWaifu-GenieCompat-Setup"
    iscc_path = resolve_iscc_path()

    existing_installer = INSTALLER_OUTPUT_DIR / f"{output_base_filename}.exe"
    if existing_installer.exists():
        try:
            existing_installer.unlink()
        except PermissionError:
            timestamp_suffix = datetime.now().strftime("%Y%m%d-%H%M%S")
            output_base_filename = f"{output_base_filename}-{timestamp_suffix}"

    proc = subprocess.run(
        [
            str(iscc_path),
            f"/DMyAppVersion={version}",
            f"/DSourceDir={DIST_SOURCE_DIR}",
            f"/DOutputDir={INSTALLER_OUTPUT_DIR}",
            f"/DOutputBaseFilename={output_base_filename}",
            str(INSTALLER_SCRIPT_PATH),
        ],
        cwd=str(ROOT),
        check=False,
    )
    if proc.returncode != 0:
        fail(f"Inno Setup failed with exit code {proc.returncode}")

    built_installer = INSTALLER_OUTPUT_DIR / f"{output_base_filename}.exe"
    if not built_installer.exists():
        fail(f"Expected installer was not created at {built_installer}")

    print(f"Built DesktopWaifu Genie installer to: {built_installer}")


if __name__ == "__main__":
    main()
