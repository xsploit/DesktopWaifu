# -*- mode: python ; coding: utf-8 -*-
from __future__ import annotations

import sys
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_dynamic_libs

project_root = Path(SPECPATH)


def safe_collect_data(package_name: str, **kwargs):
    try:
        return collect_data_files(package_name, **kwargs)
    except Exception:
        return []


def safe_collect_binaries(package_name: str):
    try:
        return collect_dynamic_libs(package_name)
    except Exception:
        return []


def collect_directory_binaries(directory: Path, destination: str) -> list[tuple[str, str]]:
    if not directory.exists():
        return []
    return [(str(path), destination) for path in directory.glob("*.dll") if path.is_file()]


datas = [
    (str(project_root / "default-model.json"), "."),
    (str(project_root / "bundled-wave-presets"), "bundled-wave-presets"),
]
binaries = []
hiddenimports = [
    "start_genie_server",
    "runtime_paths",
    "genie_tts.Server",
    "genie_tts.ModelManager",
    "huggingface_hub",
    "faster_whisper",
    "onnxruntime",
    "ctranslate2",
]

for package_name, kwargs in (
    ("genie_tts", {"excludes": ["**/Data/**"]}),
    ("pyopenjtalk", {}),
    ("pyopenjtalk_plus", {}),
    ("g2pm", {}),
    ("sudachidict_core", {}),
    ("jieba_fast", {}),
    ("nltk", {}),
):
    datas += safe_collect_data(package_name, **kwargs)

for package_name in (
    "onnxruntime",
    "ctranslate2",
    "av",
):
    binaries += safe_collect_binaries(package_name)

cudnn_bin_dir = Path(sys.prefix) / "Lib" / "site-packages" / "nvidia" / "cudnn" / "bin"
binaries += collect_directory_binaries(cudnn_bin_dir, "nvidia/cudnn/bin")

hiddenimports = sorted(set(hiddenimports))

a = Analysis(
    ["genie_compat_api.py"],
    pathex=[str(project_root)],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        "matplotlib",
        "pandas",
        "scipy",
        "sklearn",
        "tensorflow",
        "torchvision",
        "torchaudio",
        "numba",
        "pygame",
        "altair",
        "datasets",
        "transformers",
        "timm",
        "bitsandbytes",
        "hydra",
        "cv2",
        "sentry_sdk",
        "eventlet",
        "trio",
    ],
    noarchive=False,
    optimize=0,
)
pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="DesktopWaifu-GenieCompat",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="DesktopWaifu-GenieCompat",
)
