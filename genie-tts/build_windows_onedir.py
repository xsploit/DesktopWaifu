from __future__ import annotations

import os
import shutil
from pathlib import Path

import PyInstaller.__main__

ROOT = Path(__file__).resolve().parent
BUILD_ROOT = ROOT / "build"
DIST_PATH = BUILD_ROOT / "windows-onedir"
WORK_PATH = BUILD_ROOT / "pyinstaller-work"


def ensure_build_env() -> None:
    if os.environ.get("GENIE_DATA_DIR"):
        return

    candidates = (
        ROOT / "GenieData",
        Path(r"C:\Users\SUBSECT\Downloads\Genie-TTS GUI\Genie-TTS GUI\GenieData"),
        Path(r"C:\Python27\Lib\site-packages\genie_tts\Data"),
    )
    for candidate in candidates:
        if candidate.exists():
            os.environ["GENIE_DATA_DIR"] = str(candidate)
            return


def main() -> None:
    ensure_build_env()

    for path in (DIST_PATH, WORK_PATH):
        shutil.rmtree(path, ignore_errors=True)

    PyInstaller.__main__.run(
        [
            str(ROOT / "genie_compat_onedir.spec"),
            "--noconfirm",
            "--clean",
            "--distpath",
            str(DIST_PATH),
            "--workpath",
            str(WORK_PATH),
        ]
    )

    output_dir = DIST_PATH / "DesktopWaifu-GenieCompat"
    print(f"Built DesktopWaifu Genie compat server to: {output_dir}")


if __name__ == "__main__":
    main()
