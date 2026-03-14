from __future__ import annotations

import os
import sys
from pathlib import Path

SOURCE_ROOT = Path(__file__).resolve().parent
RESOURCE_ROOT = Path(getattr(sys, "_MEIPASS", SOURCE_ROOT)).resolve()

if getattr(sys, "frozen", False):
    _default_local_root = Path(os.environ.get("LOCALAPPDATA") or (Path.home() / "AppData" / "Local")).resolve()
    DEFAULT_STATE_ROOT = _default_local_root / "DesktopWaifu" / "genie-tts"
    APP_ROOT = Path(sys.executable).resolve().parent
else:
    DEFAULT_STATE_ROOT = SOURCE_ROOT
    APP_ROOT = SOURCE_ROOT

_custom_state_root = str(os.environ.get("DESKTOPWAIFU_GENIE_HOME") or "").strip()
STATE_ROOT = Path(_custom_state_root).expanduser().resolve() if _custom_state_root else DEFAULT_STATE_ROOT.resolve()


def resource_path(*parts: str) -> Path:
    return RESOURCE_ROOT.joinpath(*parts)


def state_path(*parts: str) -> Path:
    return STATE_ROOT.joinpath(*parts)


def ensure_windows_dll_search_paths(required_dlls: tuple[str, ...] | None = None) -> list[Path]:
    if os.name != "nt":
        return []

    dll_names = required_dlls or (
        "cudart64_12.dll",
        "cudnn64_9.dll",
        "cudnn_adv64_9.dll",
        "cudnn_cnn64_9.dll",
        "cudnn_engines_precompiled64_9.dll",
        "cudnn_engines_runtime_compiled64_9.dll",
        "cudnn_graph64_9.dll",
        "cudnn_heuristic64_9.dll",
        "cudnn_ops64_9.dll",
        "nvinfer_10.dll",
        "nvinfer_plugin_10.dll",
    )
    discovered_dirs: list[Path] = []
    seen_dirs: set[str] = set()

    search_roots = [RESOURCE_ROOT]
    if APP_ROOT != RESOURCE_ROOT:
        search_roots.append(APP_ROOT)

    for root in search_roots:
        if not root.exists():
            continue
        for dll_name in dll_names:
            for dll_path in root.rglob(dll_name):
                dll_dir = dll_path.parent.resolve()
                normalized = str(dll_dir).lower()
                if normalized in seen_dirs:
                    continue
                seen_dirs.add(normalized)
                discovered_dirs.append(dll_dir)

    for dll_dir in discovered_dirs:
        try:
            os.add_dll_directory(str(dll_dir))
        except (AttributeError, FileNotFoundError, OSError):
            pass

    current_path = os.environ.get("PATH", "")
    path_entries = current_path.split(os.pathsep) if current_path else []
    lower_entries = {entry.lower() for entry in path_entries if entry}
    extra_entries = [str(path) for path in discovered_dirs if str(path).lower() not in lower_entries]
    if extra_entries:
        os.environ["PATH"] = os.pathsep.join(extra_entries + ([current_path] if current_path else []))

    return discovered_dirs
