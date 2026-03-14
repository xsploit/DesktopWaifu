from __future__ import annotations

import argparse
import ctypes
import hashlib
import json
import os
import site
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Sequence

import uvicorn

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL_MANIFEST_PATH = ROOT / "default-model.json"
DEFAULT_MODEL_REQUIRED_FILES = (
    "prompt_encoder_fp32.onnx",
    "prompt_encoder_fp16.bin",
    "t2s_encoder_fp32.bin",
    "t2s_encoder_fp32.onnx",
    "t2s_first_stage_decoder_fp32.onnx",
    "t2s_shared_fp16.bin",
    "t2s_stage_decoder_fp32.onnx",
    "vits_fp16.bin",
    "vits_fp32.onnx",
)


def configure_console() -> None:
    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")


def ensure_genie_data(genie_data_dir: Path) -> None:
    if genie_data_dir.exists():
        return

    print(f"GenieData not found at: {genie_data_dir}")
    choice = input("Download GenieData from Hugging Face now? (y/N): ").strip().lower()
    if choice != "y":
        raise SystemExit("GenieData is required to start Genie-TTS.")

    from huggingface_hub import snapshot_download

    genie_data_dir.parent.mkdir(parents=True, exist_ok=True)
    print("Downloading GenieData...")
    snapshot_download(
        repo_id="High-Logic/Genie",
        repo_type="model",
        allow_patterns="GenieData/*",
        local_dir=str(genie_data_dir.parent),
        local_dir_use_symlinks=False,
    )
    print("GenieData download complete.")


def load_default_model_manifest(manifest_path: Path = DEFAULT_MODEL_MANIFEST_PATH) -> dict[str, Any] | None:
    if not manifest_path.exists():
        return None
    return json.loads(manifest_path.read_text("utf-8"))


def default_model_target_dir(manifest: dict[str, Any]) -> Path:
    target_dir = str(manifest.get("target_dir") or "").strip()
    if not target_dir:
        raise SystemExit("default-model.json is missing target_dir.")
    return (ROOT / target_dir).resolve()


def is_complete_default_model_dir(target_dir: Path) -> bool:
    return all((target_dir / file_name).exists() for file_name in DEFAULT_MODEL_REQUIRED_FILES)


def verify_sha256(file_path: Path, expected_hash: str | None) -> bool:
    normalized_expected = str(expected_hash or "").strip().lower()
    if not normalized_expected:
        return True

    digest = hashlib.sha256()
    with file_path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().lower() == normalized_expected


def validate_zip_members(archive: zipfile.ZipFile) -> None:
    for member in archive.namelist():
        member_path = Path(member)
        if member_path.is_absolute() or ".." in member_path.parts:
            raise SystemExit(f"Unsafe path found in default model archive: {member}")


def download_default_model_archive(manifest: dict[str, Any]) -> Path:
    asset_url = str(manifest.get("url") or "").strip()
    if not asset_url:
        raise SystemExit("default-model.json is missing url.")

    asset_name = str(manifest.get("asset_name") or "").strip() or Path(asset_url).name or "DesktopWaifu-Genie-Default.zip"
    downloads_dir = ROOT / ".cache" / "downloads"
    downloads_dir.mkdir(parents=True, exist_ok=True)
    archive_path = downloads_dir / asset_name
    expected_hash = str(manifest.get("sha256") or "").strip()

    if archive_path.exists() and verify_sha256(archive_path, expected_hash):
        return archive_path

    if archive_path.exists():
        archive_path.unlink()

    print(f"Downloading DesktopWaifu default Genie model from: {asset_url}")
    request = urllib.request.Request(
        asset_url,
        headers={
            "User-Agent": "DesktopWaifu-GenieTTS/1.0",
            "Accept": "application/octet-stream",
        },
    )

    with urllib.request.urlopen(request) as response, tempfile.NamedTemporaryFile(
        dir=downloads_dir,
        delete=False,
        suffix=".tmp",
    ) as temp_file:
        while True:
            chunk = response.read(1024 * 1024)
            if not chunk:
                break
            temp_file.write(chunk)
        temp_path = Path(temp_file.name)

    if not verify_sha256(temp_path, expected_hash):
        temp_path.unlink(missing_ok=True)
        raise SystemExit("Downloaded default model archive failed SHA256 verification.")

    temp_path.replace(archive_path)
    print(f"Saved default model archive to: {archive_path}")
    return archive_path


def extract_default_model_archive(archive_path: Path, target_dir: Path) -> None:
    cache_root = ROOT / ".cache"
    cache_root.mkdir(parents=True, exist_ok=True)
    temp_extract_dir = Path(tempfile.mkdtemp(prefix="genie-default-model-", dir=cache_root))
    try:
        with zipfile.ZipFile(archive_path, "r") as archive:
            validate_zip_members(archive)
            archive.extractall(temp_extract_dir)

        candidate_dir = temp_extract_dir / target_dir.name
        if not is_complete_default_model_dir(candidate_dir):
            direct_children = [child for child in temp_extract_dir.iterdir()]
            if is_complete_default_model_dir(temp_extract_dir):
                candidate_dir = temp_extract_dir
            elif len(direct_children) == 1 and direct_children[0].is_dir() and is_complete_default_model_dir(direct_children[0]):
                candidate_dir = direct_children[0]
            else:
                raise SystemExit(
                    f"Extracted default model archive is missing required files for {target_dir.name}."
                )

        target_dir.parent.mkdir(parents=True, exist_ok=True)
        if target_dir.exists():
            import shutil

            shutil.rmtree(target_dir)

        if candidate_dir == temp_extract_dir:
            target_dir.mkdir(parents=True, exist_ok=True)
            for child in temp_extract_dir.iterdir():
                if child == target_dir:
                    continue
                child.rename(target_dir / child.name)
        else:
            candidate_dir.rename(target_dir)
    finally:
        import shutil

        shutil.rmtree(temp_extract_dir, ignore_errors=True)


def ensure_default_model(download_if_missing: bool, skip_if_missing: bool) -> Path | None:
    manifest = load_default_model_manifest()
    if manifest is None:
        return None

    target_dir = default_model_target_dir(manifest)
    if is_complete_default_model_dir(target_dir):
        return target_dir

    print(f"DesktopWaifu default Genie model not found at: {target_dir}")
    if skip_if_missing:
        print("Skipping default model bootstrap because --skip-default-model was used.")
        return None

    auto_download = download_if_missing or str(os.environ.get("GENIE_AUTO_DOWNLOAD_DEFAULT_MODEL") or "").strip().lower() in {
        "1",
        "true",
        "yes",
        "on",
    }

    if not auto_download:
        choice = input("Download the DesktopWaifu default clone model now? (Y/n): ").strip().lower()
        auto_download = choice in {"", "y", "yes"}

    if not auto_download:
        raise SystemExit("The DesktopWaifu default Genie model is required for the intended clone flow.")

    archive_path = download_default_model_archive(manifest)
    extract_default_model_archive(archive_path, target_dir)

    if not is_complete_default_model_dir(target_dir):
        raise SystemExit(f"Default Genie model extraction did not produce a complete model folder: {target_dir}")

    print(f"DesktopWaifu default Genie model is ready at: {target_dir}")
    return target_dir


def format_provider_list(providers: Sequence[Any]) -> str:
    labels: list[str] = []
    for provider in providers:
        if isinstance(provider, tuple):
            name, options = provider
            if options:
                labels.append(f"{name} {options}")
            else:
                labels.append(str(name))
        else:
            labels.append(str(provider))
    return ", ".join(labels) if labels else "(none)"


def build_cuda_provider_options(
    device_id: int,
    enable_tf32: bool,
    max_workspace: bool,
    enable_conv1d_pad_to_nc1d: bool,
) -> dict[str, str]:
    return {
        "device_id": str(device_id),
        "arena_extend_strategy": "kNextPowerOfTwo",
        "cudnn_conv_use_max_workspace": "1" if max_workspace else "0",
        "cudnn_conv1d_pad_to_nc1d": "1" if enable_conv1d_pad_to_nc1d else "0",
        "do_copy_in_default_stream": "1",
        "use_tf32": "1" if enable_tf32 else "0",
    }


def build_tensorrt_provider_options(
    device_id: int,
    cache_dir: Path,
    enable_fp16: bool,
) -> dict[str, str]:
    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path = str(cache_dir)
    return {
        "device_id": str(device_id),
        "trt_engine_cache_enable": "True",
        "trt_engine_cache_path": cache_path,
        "trt_timing_cache_enable": "True",
        "trt_timing_cache_path": cache_path,
        "trt_fp16_enable": "True" if enable_fp16 else "False",
        "trt_builder_optimization_level": "3",
        "trt_cuda_graph_enable": "True",
    }


def resolve_execution_providers(
    provider_mode: str,
    cache_dir: Path,
    device_id: int,
    enable_tf32: bool,
    max_workspace: bool,
    enable_conv1d_pad_to_nc1d: bool,
    enable_trt_fp16: bool,
) -> tuple[list[Any], list[str], str]:
    import onnxruntime as ort

    if hasattr(ort, "preload_dlls"):
        ort.preload_dlls()

    available = list(ort.get_available_providers())
    cuda_options = build_cuda_provider_options(device_id, enable_tf32, max_workspace, enable_conv1d_pad_to_nc1d)
    trt_options = build_tensorrt_provider_options(device_id, cache_dir, enable_trt_fp16)

    if provider_mode == "cpu":
        return ["CPUExecutionProvider"], available, ort.__version__

    if provider_mode == "cuda":
        if "CUDAExecutionProvider" not in available:
            raise SystemExit(
                f"CUDAExecutionProvider is not available in this Python environment. Available providers: {available}"
            )
        return [("CUDAExecutionProvider", cuda_options), "CPUExecutionProvider"], available, ort.__version__

    if provider_mode == "tensorrt":
        if "TensorrtExecutionProvider" not in available:
            raise SystemExit(
                f"TensorrtExecutionProvider is not available in this Python environment. Available providers: {available}"
            )
        if "CUDAExecutionProvider" not in available:
            raise SystemExit(
                "TensorRT in ONNX Runtime requires CUDAExecutionProvider to be available as a fallback."
            )
        return [
            ("TensorrtExecutionProvider", trt_options),
            ("CUDAExecutionProvider", cuda_options),
            "CPUExecutionProvider",
        ], available, ort.__version__

    if "CUDAExecutionProvider" in available:
        return [("CUDAExecutionProvider", cuda_options), "CPUExecutionProvider"], available, ort.__version__

    return ["CPUExecutionProvider"], available, ort.__version__


def build_session_options(ort: Any, existing: Any | None = None) -> Any:
    options = existing if existing is not None else ort.SessionOptions()
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    return options


def validate_tensorrt_runtime() -> None:
    if os.name != "nt":
        return

    ensure_tensorrt_runtime_search_path()

    required_dlls = (
        "nvinfer_10.dll",
        "nvinfer_plugin_10.dll",
    )
    missing = []
    for dll_name in required_dlls:
        try:
            ctypes.WinDLL(dll_name)
        except OSError:
            missing.append(dll_name)

    if missing:
        raise SystemExit(
            "TensorRT execution was requested, but the TensorRT runtime DLLs are not available on PATH: "
            + ", ".join(missing)
        )


def ensure_tensorrt_runtime_search_path() -> None:
    if os.name != "nt":
        return

    try:
        ctypes.WinDLL("nvinfer_10.dll")
        ctypes.WinDLL("nvinfer_plugin_10.dll")
        return
    except OSError:
        pass

    candidate_dirs: list[Path] = []
    for site_root in site.getsitepackages():
        candidate = Path(site_root) / "tensorrt_libs"
        if candidate.exists():
            candidate_dirs.append(candidate.resolve())

    user_site = site.getusersitepackages()
    if user_site:
        candidate = Path(user_site) / "tensorrt_libs"
        if candidate.exists():
            candidate_dirs.append(candidate.resolve())

    seen: set[str] = set()
    for dll_dir in candidate_dirs:
        normalized = str(dll_dir)
        if normalized.lower() in seen:
            continue
        seen.add(normalized.lower())

        try:
            os.add_dll_directory(normalized)
        except (AttributeError, FileNotFoundError, OSError):
            pass

        current_path = os.environ.get("PATH", "")
        path_entries = current_path.split(os.pathsep) if current_path else []
        if not any(entry.lower() == normalized.lower() for entry in path_entries):
            os.environ["PATH"] = normalized + os.pathsep + current_path if current_path else normalized


def install_onnxruntime_tuning(ort: Any, model_manager_module: Any, provider_chain: Sequence[Any]) -> None:
    original_inference_session = ort.InferenceSession

    def tuned_inference_session(*args: Any, **kwargs: Any):
        kwargs["providers"] = kwargs.get("providers") or list(provider_chain)
        kwargs["sess_options"] = build_session_options(ort, kwargs.get("sess_options"))
        return original_inference_session(*args, **kwargs)

    ort.InferenceSession = tuned_inference_session
    model_manager_module.onnxruntime.InferenceSession = tuned_inference_session
    model_manager_module.InferenceSession = tuned_inference_session


def main() -> None:
    configure_console()

    default_genie_data_candidates = [
        *([Path(os.environ["GENIE_DATA_DIR"]).expanduser()] if os.environ.get("GENIE_DATA_DIR") else []),
        ROOT / "GenieData",
    ]
    default_genie_data_dir = next(
        (str(candidate) for candidate in default_genie_data_candidates if candidate.exists()),
        str(default_genie_data_candidates[-1]),
    )

    parser = argparse.ArgumentParser(description="Start the DesktopWaifu Genie-TTS compat server.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--workers", type=int, default=1)
    parser.add_argument("--genie-data-dir", default=default_genie_data_dir)
    parser.add_argument("--provider", choices=("auto", "cuda", "tensorrt", "cpu"), default="auto")
    parser.add_argument("--gpu-device-id", type=int, default=0)
    parser.add_argument("--trt-cache-dir", default=str(ROOT / ".cache" / "tensorrt"))
    parser.add_argument("--disable-tf32", action="store_true")
    parser.add_argument("--disable-cudnn-max-workspace", action="store_true")
    parser.add_argument("--enable-cudnn-conv1d-pad-to-nc1d", action="store_true")
    parser.add_argument("--disable-trt-fp16", action="store_true")
    parser.add_argument("--download-default-model", action="store_true")
    parser.add_argument("--skip-default-model", action="store_true")
    args = parser.parse_args()

    genie_data_dir = Path(args.genie_data_dir).resolve()
    trt_cache_dir = Path(args.trt_cache_dir).resolve()
    ensure_genie_data(genie_data_dir)
    ensure_default_model(
        download_if_missing=args.download_default_model,
        skip_if_missing=args.skip_default_model,
    )

    os.environ["PYTHONUTF8"] = "1"
    os.environ["PYTHONIOENCODING"] = "utf-8"
    os.environ["GENIE_DATA_DIR"] = str(genie_data_dir)
    os.environ.setdefault("NUMEXPR_MAX_THREADS", "8")

    if args.provider == "tensorrt":
        validate_tensorrt_runtime()

    selected_providers, available_providers, ort_version = resolve_execution_providers(
        provider_mode=args.provider,
        cache_dir=trt_cache_dir,
        device_id=args.gpu_device_id,
        enable_tf32=not args.disable_tf32,
        max_workspace=not args.disable_cudnn_max_workspace,
        enable_conv1d_pad_to_nc1d=args.enable_cudnn_conv1d_pad_to_nc1d,
        enable_trt_fp16=not args.disable_trt_fp16,
    )

    from genie_compat_api import register_compat_api
    import genie_tts as genie
    import genie_tts.ModelManager as genie_model_manager_module
    from genie_tts.ModelManager import model_manager
    from genie_tts.Server import app as genie_app

    install_onnxruntime_tuning(ort=genie_model_manager_module.onnxruntime, model_manager_module=genie_model_manager_module, provider_chain=selected_providers)

    model_manager.providers = selected_providers
    register_compat_api(genie_app)

    print(f"Starting Genie-TTS on http://{args.host}:{args.port}")
    print(f"GENIE_DATA_DIR={genie_data_dir}")
    print(f"ONNX Runtime {ort_version}")
    print(f"Available execution providers: {format_provider_list(available_providers)}")
    print(f"Selected execution providers: {format_provider_list(selected_providers)}")
    if args.provider == "tensorrt":
        print(f"TensorRT cache dir: {trt_cache_dir}")
    uvicorn.run(genie_app, host=args.host, port=args.port, workers=args.workers)


if __name__ == "__main__":
    main()
