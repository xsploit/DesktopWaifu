from __future__ import annotations

import hashlib
import io
import json
import os
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from runtime_paths import RESOURCE_ROOT, STATE_ROOT, state_path

ROOT = RESOURCE_ROOT
TMP_DIR = state_path("tmp")
DATA_DIR = state_path("data")
VOICE_PRESETS_FILE = DATA_DIR / "genie-voice-presets.json"
VOICE_UPLOADS_DIR = DATA_DIR / "voices"
GENIE_SAMPLE_RATE = 32000
GENIE_CHANNELS = 1
GENIE_BITS_PER_SAMPLE = 16
DEFAULT_REFERENCE_LANGUAGE = "English"
WINDOWS_DEFAULT_GENIE_PROPLUS_DIR = Path(r"C:\Python27\Lib\site-packages\genie_tts\Data\v2ProPlus\Models")


def split_env_paths(name: str) -> list[Path]:
    raw = str(os.environ.get(name) or "").strip()
    if not raw:
        return []
    return [Path(part).expanduser() for part in raw.split(os.pathsep) if part.strip()]


DEFAULT_GENIE_PROPLUS_CANDIDATES = [
    *split_env_paths("GENIE_PROPLUS_MODELS_DIR"),
    STATE_ROOT / "models" / "High-Logic-Genie" / "Data" / "v2ProPlus" / "Models",
    ROOT / "models" / "High-Logic-Genie" / "Data" / "v2ProPlus" / "Models",
    WINDOWS_DEFAULT_GENIE_PROPLUS_DIR,
]
DEFAULT_GENIE_PROPLUS_DIR = next(
    (candidate for candidate in DEFAULT_GENIE_PROPLUS_CANDIDATES if candidate.exists()),
    DEFAULT_GENIE_PROPLUS_CANDIDATES[0],
)
DEFAULT_GENIE_CHARACTER_ROOT_CANDIDATES = [
    *split_env_paths("GENIE_CHARACTER_ROOTS"),
    STATE_ROOT / "models" / "High-Logic-Genie" / "CharacterModels" / "v2ProPlus",
    ROOT / "models" / "High-Logic-Genie" / "CharacterModels" / "v2ProPlus",
]
DEFAULT_BUNDLED_WAVE_PRESET_ROOT_CANDIDATES = [
    STATE_ROOT / "bundled-wave-presets",
    ROOT / "bundled-wave-presets",
]
DEFAULT_CONVERTED_V2PRO_CHARACTER_CANDIDATES = [
    STATE_ROOT / "models" / "converted" / "gpt-sovits-v2proplus-default",
    ROOT / "models" / "converted" / "gpt-sovits-v2proplus-default",
]
PREFERRED_GENIE_CHARACTER_IDS = ("mika", "thirtyseven", "feibi")
GENIE_CHARACTER_LABELS = {
    "mika": "Mika",
    "thirtyseven": "ThirtySeven",
    "feibi": "Feibi",
}
REQUIRED_GENIE_V2_FILES = (
    "t2s_encoder_fp32.onnx",
    "t2s_encoder_fp32.bin",
    "t2s_first_stage_decoder_fp32.onnx",
    "t2s_stage_decoder_fp32.onnx",
    "t2s_shared_fp16.bin",
    "vits_fp32.onnx",
    "vits_fp16.bin",
)
REQUIRED_GENIE_V2PROPLUS_FILES = REQUIRED_GENIE_V2_FILES + (
    "prompt_encoder_fp32.onnx",
    "prompt_encoder_fp16.bin",
)
REQUIRED_PROPLUS_OVERLAY_FILES = (
    "prompt_encoder_fp32.onnx",
    "prompt_encoder_fp16.bin",
)


def _bootstrap_runtime() -> None:
    os.environ.setdefault("PYTHONUTF8", "1")
    os.environ.setdefault("PYTHONIOENCODING", "utf-8")

    for stream_name in ("stdout", "stderr"):
        stream = getattr(sys, stream_name, None)
        if stream and hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8", errors="replace")

    if not os.environ.get("GENIE_DATA_DIR"):
        genie_data_candidates = [
            *split_env_paths("GENIE_DATA_DIR"),
            STATE_ROOT / "GenieData",
            ROOT / "GenieData",
        ]
        for candidate in genie_data_candidates:
            if candidate.exists():
                os.environ["GENIE_DATA_DIR"] = str(candidate.resolve())
                break


_bootstrap_runtime()

genie_server: Any | None = None
model_manager: Any | None = None


def ensure_genie_runtime() -> tuple[Any, Any]:
    global genie_server, model_manager
    if genie_server is None or model_manager is None:
        from genie_tts import Server as imported_genie_server
        from genie_tts.ModelManager import model_manager as imported_model_manager

        genie_server = imported_genie_server
        model_manager = imported_model_manager

    return genie_server, model_manager

voice_preset_state: dict[str, Any] | None = None
current_prepared_voice = {
    "voice_id": "",
    "target_language": "",
    "reference_fingerprint": "",
}
whisper_model_cache: dict[tuple[str, str, str], Any] = {}


class RegisterPathPayload(BaseModel):
    name: str
    ref_audio: str
    ref_text: str | None = None
    voice_id: str | None = None
    base_voice_id: str | None = None
    activate: bool | str | int | None = True
    character_name: str | None = None
    model_dir: str | None = None
    pro_plus_model_dir: str | None = None
    use_v2_proplus: bool | str | int | None = None


class SelectVoicePayload(BaseModel):
    voice_id: str


class ClonePresetPayload(BaseModel):
    name: str
    source_voice_id: str
    base_voice_id: str | None = None
    voice_id: str | None = None
    activate: bool | str | int | None = True


class TtsStreamPayload(BaseModel):
    text: str
    voice_id: str | None = None
    base_voice_id: str | None = None
    wave_source_id: str | None = None
    language: str | None = "English"
    split_sentence: bool | str | int | None = False


def register_compat_api(app: FastAPI) -> None:
    ensure_genie_runtime()

    if any(route.path == "/v1/health" for route in app.routes):
        return

    @app.get("/v1/health")
    async def compat_health() -> dict[str, Any]:
        state = await load_voice_preset_state()
        return {
            "ok": True,
            "server_url": "http://127.0.0.1:8000",
            "active_voice_id": state.get("activeVoiceId") or "",
            "default_voice_id": "mika",
            "default_clone_base_id": "gpt-sovits-v2pro-default",
            "voice_count": len(state.get("items", [])),
            "last_error": None,
        }

    @app.get("/v1/voices")
    async def compat_list_voices() -> dict[str, Any]:
        state = await load_voice_preset_state()
        items = list(state["items"])
        active_voice_id = state.get("activeVoiceId") or ""
        items.sort(
            key=lambda item: (
                -(10 if item["id"] == active_voice_id else 0) - (5 if item.get("builtIn") else 0),
                item["name"].lower(),
            )
        )
        return {
            "ok": True,
            "items": [get_voice_response(item, active_voice_id) for item in items],
            "active_voice_id": active_voice_id,
        }

    @app.post("/v1/voices/select")
    async def compat_select_voice(payload: SelectVoicePayload) -> dict[str, Any]:
        state = await load_voice_preset_state()
        preset = await get_voice_preset_by_id(payload.voice_id)
        state["activeVoiceId"] = preset["id"]
        await save_voice_preset_state()
        return {
            "ok": True,
            "voice": get_voice_response(preset, state["activeVoiceId"]),
            "active_voice_id": state["activeVoiceId"],
        }

    @app.delete("/v1/voices/{voice_id}")
    async def compat_delete_voice(voice_id: str) -> dict[str, Any]:
        await delete_voice_preset_by_id(voice_id)
        state = await load_voice_preset_state()
        return {
            "ok": True,
            "active_voice_id": state.get("activeVoiceId") or "",
        }

    @app.post("/v1/voices/upload")
    async def compat_upload_voice(
        name: str = Form(...),
        audio_file: UploadFile = File(...),
        ref_text: str = Form(""),
        voice_id: str = Form(""),
        base_voice_id: str = Form(""),
        activate: str = Form("true"),
    ) -> dict[str, Any]:
        cleaned_name = name.strip()
        if not cleaned_name:
            raise create_error(400, "Voice name is required.")

        state = await load_voice_preset_state()
        requested_id = voice_id.strip() or cleaned_name
        unique_voice_id = ensure_voice_id_unique(requested_id, state["items"])
        should_activate = parse_boolean_field(activate, True)
        base_preset = await get_clone_base_preset(base_voice_id)

        extension = Path(audio_file.filename or "reference.wav").suffix.lower() or ".wav"
        voice_dir = VOICE_UPLOADS_DIR / unique_voice_id
        await ensure_dir(voice_dir)
        saved_audio_path = voice_dir / f"reference{extension}"

        contents = await audio_file.read()
        saved_audio_path.write_bytes(contents)

        reference_text = ref_text.strip()
        reference_language = infer_language_from_text(reference_text, DEFAULT_REFERENCE_LANGUAGE)
        if not reference_text:
            transcription = transcribe_reference_audio(saved_audio_path)
            reference_text = transcription["text"]
            reference_language = transcription["language"]

        preset = await upsert_voice_preset(
            {
                "id": unique_voice_id,
                "name": cleaned_name,
                "characterName": base_preset["characterName"],
                "modelDir": base_preset["modelDir"],
                "proPlusModelDir": base_preset.get("proPlusModelDir"),
                "useV2ProPlus": base_preset.get("useV2ProPlus", True),
                "referenceAudioPath": str(saved_audio_path),
                "referenceText": reference_text,
                "referenceLanguage": reference_language,
                "uploadedFilePath": str(saved_audio_path),
                "source": "upload",
            },
            activate=should_activate,
        )

        updated_state = await load_voice_preset_state()
        return {
            "ok": True,
            "voice": get_voice_response(preset, updated_state.get("activeVoiceId") or ""),
            "active_voice_id": updated_state.get("activeVoiceId") or "",
        }

    @app.post("/v1/voices/register-path")
    async def compat_register_path_voice(payload: RegisterPathPayload) -> dict[str, Any]:
        cleaned_name = payload.name.strip()
        reference_audio_path = Path(payload.ref_audio.strip()).resolve()
        if not cleaned_name:
            raise create_error(400, "Voice name is required.")
        if not str(reference_audio_path):
            raise create_error(400, "ref_audio is required.")
        if not reference_audio_path.exists():
            raise create_error(400, f"Reference audio path does not exist: {reference_audio_path}")

        state = await load_voice_preset_state()
        requested_id = (payload.voice_id or "").strip() or cleaned_name
        unique_voice_id = ensure_voice_id_unique(requested_id, state["items"])
        should_activate = parse_boolean_field(payload.activate, True)
        base_preset = await get_clone_base_preset(payload.base_voice_id)

        reference_text = (payload.ref_text or "").strip()
        reference_language = infer_language_from_text(reference_text, DEFAULT_REFERENCE_LANGUAGE)
        if not reference_text:
            transcription = transcribe_reference_audio(reference_audio_path)
            reference_text = transcription["text"]
            reference_language = transcription["language"]

        preset = await upsert_voice_preset(
            {
                "id": unique_voice_id,
                "name": cleaned_name,
                "characterName": (payload.character_name or base_preset["characterName"]).strip() or base_preset["characterName"],
                "modelDir": (payload.model_dir or base_preset["modelDir"]).strip() or base_preset["modelDir"],
                "proPlusModelDir": (
                    (payload.pro_plus_model_dir or "").strip()
                    or base_preset.get("proPlusModelDir")
                    or str(DEFAULT_GENIE_PROPLUS_DIR)
                ),
                "useV2ProPlus": (
                    base_preset.get("useV2ProPlus", True)
                    if payload.use_v2_proplus is None
                    else parse_boolean_field(payload.use_v2_proplus, base_preset.get("useV2ProPlus", True))
                ),
                "referenceAudioPath": str(reference_audio_path),
                "referenceText": reference_text,
                "referenceLanguage": reference_language,
                "source": "path",
            },
            activate=should_activate,
        )

        updated_state = await load_voice_preset_state()
        return {
            "ok": True,
            "voice": get_voice_response(preset, updated_state.get("activeVoiceId") or ""),
            "active_voice_id": updated_state.get("activeVoiceId") or "",
        }

    @app.post("/v1/voices/clone-preset")
    async def compat_clone_preset_voice(payload: ClonePresetPayload) -> dict[str, Any]:
        cleaned_name = payload.name.strip()
        if not cleaned_name:
            raise create_error(400, "Voice name is required.")

        source_preset = await get_voice_preset_by_id(payload.source_voice_id)
        base_preset = await get_clone_base_preset(payload.base_voice_id)
        state = await load_voice_preset_state()
        requested_id = (payload.voice_id or "").strip() or cleaned_name
        unique_voice_id = ensure_voice_id_unique(requested_id, state["items"])
        should_activate = parse_boolean_field(payload.activate, True)

        preset = await upsert_voice_preset(
            {
                "id": unique_voice_id,
                "name": cleaned_name,
                "characterName": base_preset["characterName"],
                "modelDir": base_preset["modelDir"],
                "proPlusModelDir": base_preset.get("proPlusModelDir"),
                "useV2ProPlus": base_preset.get("useV2ProPlus", True),
                "referenceAudioPath": source_preset["referenceAudioPath"],
                "referenceText": source_preset["referenceText"],
                "referenceLanguage": source_preset["referenceLanguage"],
                "source": "preset-clone",
            },
            activate=should_activate,
        )

        updated_state = await load_voice_preset_state()
        return {
            "ok": True,
            "voice": get_voice_response(preset, updated_state.get("activeVoiceId") or ""),
            "active_voice_id": updated_state.get("activeVoiceId") or "",
        }

    @app.post("/v1/tts/stream")
    async def compat_tts_stream(payload: TtsStreamPayload) -> Response:
        text = payload.text.strip()
        if not text:
            raise create_error(400, "text is required.")

        target_language = (payload.language or "English").strip() or "English"
        if str(payload.voice_id or "").strip():
            preset = await get_voice_preset_by_id(payload.voice_id)
        elif str(payload.base_voice_id or "").strip() or str(payload.wave_source_id or "").strip():
            base_preset = await get_clone_base_preset(payload.base_voice_id)
            source_preset = await get_voice_preset_by_id(payload.wave_source_id or "mika")
            preset = {
                "id": f"runtime-mix:{base_preset['id']}:{source_preset['id']}",
                "name": f"{base_preset['name']} + {source_preset['name']}",
                "characterName": base_preset["characterName"],
                "modelDir": base_preset["modelDir"],
                "proPlusModelDir": base_preset.get("proPlusModelDir"),
                "useV2ProPlus": base_preset.get("useV2ProPlus", True),
                "referenceAudioPath": source_preset["referenceAudioPath"],
                "referenceText": source_preset["referenceText"],
                "referenceLanguage": source_preset["referenceLanguage"],
                "builtIn": False,
                "source": "runtime-mix",
            }
        else:
            preset = await get_active_voice_preset()
        reference_audio_path = Path(preset["referenceAudioPath"])
        if not reference_audio_path.exists():
            raise create_error(400, f'Reference audio is missing for voice preset "{preset["name"]}".')

        await ensure_voice_ready(preset, target_language)
        synthesis = await synthesize_genie_audio(
            preset["characterName"],
            text,
            parse_boolean_field(payload.split_sentence, False),
        )
        channels, sample_rate, bits_per_sample, pcm_data = parse_wave_data(synthesis["buffer"])
        if bits_per_sample != 16:
            raise create_error(500, f"Unsupported Genie output bit depth: {bits_per_sample}")

        float_buffer = pcm16_to_float32_le_buffer(pcm_data, channels)
        return Response(
            content=float_buffer,
            media_type="application/octet-stream",
            headers={
                "Cache-Control": "no-store",
                "X-Qwen-Sample-Rate": str(sample_rate),
                "X-Genie-Voice-Id": preset["id"],
                "X-Genie-Elapsed-Ms": str(synthesis["elapsedMs"]),
            },
        )


def create_error(status_code: int, message: str) -> HTTPException:
    return HTTPException(status_code=status_code, detail=message)


def exists(path_value: Path | str | None) -> bool:
    if not path_value:
        return False
    try:
        return Path(path_value).exists()
    except OSError:
        return False


async def ensure_dir(dir_path: Path) -> None:
    dir_path.mkdir(parents=True, exist_ok=True)


def is_valid_genie_v2_dir(dir_path: Path) -> bool:
    return all((dir_path / file_name).exists() for file_name in REQUIRED_GENIE_V2_FILES)


def is_valid_genie_v2proplus_dir(dir_path: Path) -> bool:
    return all((dir_path / file_name).exists() for file_name in REQUIRED_GENIE_V2PROPLUS_FILES)


def is_valid_genie_proplus_overlay_dir(dir_path: Path) -> bool:
    return all((dir_path / file_name).exists() for file_name in REQUIRED_PROPLUS_OVERLAY_FILES)


async def copy_dir_contents(source_dir: Path, target_dir: Path) -> None:
    for child in source_dir.iterdir():
        destination = target_dir / child.name
        if child.is_dir():
            destination.mkdir(parents=True, exist_ok=True)
            await copy_dir_contents(child, destination)
        elif child.is_file():
            shutil.copy2(child, destination)


async def prepare_runtime_model_dir(base_model_dir: str | Path, proplus_model_dir: str | Path | None, use_v2_proplus: bool) -> dict[str, str]:
    normalized_base = Path(base_model_dir).resolve()
    base_is_v2 = is_valid_genie_v2_dir(normalized_base)
    base_is_v2proplus = is_valid_genie_v2proplus_dir(normalized_base)

    if not base_is_v2 and not base_is_v2proplus:
        raise create_error(
            400,
            f"Model folder is invalid or incomplete: {normalized_base}. A working Genie folder needs the ONNX files and bin sidecars, for example a full CharacterModels/v2ProPlus/*/tts_models bundle.",
        )

    if not use_v2_proplus or base_is_v2proplus:
        return {
            "runtimeModelDir": str(normalized_base),
            "mode": "v2ProPlus" if base_is_v2proplus else "v2",
        }

    normalized_proplus = Path(proplus_model_dir or DEFAULT_GENIE_PROPLUS_DIR).resolve()
    if not is_valid_genie_proplus_overlay_dir(normalized_proplus):
        raise create_error(
            400,
            f"v2ProPlus add-on folder is invalid or incomplete: {normalized_proplus}. It needs prompt_encoder_fp32.onnx and prompt_encoder_fp16.bin.",
        )

    merge_key = hashlib.sha1(f"{normalized_base}::{normalized_proplus}".encode("utf-8")).hexdigest()[:12]
    runtime_model_dir = TMP_DIR / "genie-runtime-models" / merge_key

    if not runtime_model_dir.exists():
        runtime_model_dir.mkdir(parents=True, exist_ok=True)
        await copy_dir_contents(normalized_base, runtime_model_dir)
        await copy_dir_contents(normalized_proplus, runtime_model_dir)

    return {
        "runtimeModelDir": str(runtime_model_dir),
        "mode": "v2ProPlus",
    }


async def safe_read_json(file_path: Path, fallback: Any) -> Any:
    try:
        return json.loads(file_path.read_text("utf-8"))
    except Exception:
        return fallback


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sanitize_voice_id(raw_value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", str(raw_value or "").strip().lower()).strip("-")
    return normalized or "voice"


def ensure_voice_id_unique(desired_id: str, items: list[dict[str, Any]], exclude_id: str | None = None) -> str:
    used = {
        str(item.get("id") or "").strip().lower()
        for item in items
        if str(item.get("id") or "").strip()
    }
    exclude = str(exclude_id or "").strip().lower()
    if exclude:
        used.discard(exclude)

    base = sanitize_voice_id(desired_id)
    if base not in used:
        return base

    suffix = 2
    while f"{base}-{suffix}" in used:
        suffix += 1
    return f"{base}-{suffix}"


def normalize_stored_path(raw_value: str | Path | None) -> str:
    value = str(raw_value or "").strip()
    return str(Path(value).resolve()) if value else ""


def infer_language_from_text(text: str, fallback: str = DEFAULT_REFERENCE_LANGUAGE) -> str:
    value = str(text or "").strip()
    if not value:
        return fallback
    if re.search(r"[\u3040-\u30ff]", value):
        return "Japanese"
    if re.search(r"[\uac00-\ud7af]", value):
        return "Korean"
    if re.search(r"[\u4e00-\u9fff]", value):
        return "Chinese"
    if re.search(r"[àâçéèêëîïôûùüÿœæ]", value, re.IGNORECASE):
        return "French"
    if re.search(r"[äöüß]", value, re.IGNORECASE):
        return "German"
    if re.search(r"[áéíóúñ¿¡]", value, re.IGNORECASE):
        return "Spanish"
    if re.search(r"[ãõç]", value, re.IGNORECASE):
        return "Portuguese"
    return "English"


def map_whisper_language_to_label(code: str | None, fallback: str = DEFAULT_REFERENCE_LANGUAGE) -> str:
    mapping = {
        "en": "English",
        "english": "English",
        "ja": "Japanese",
        "japanese": "Japanese",
        "zh": "Chinese",
        "chinese": "Chinese",
        "ko": "Korean",
        "korean": "Korean",
        "fr": "French",
        "french": "French",
        "de": "German",
        "german": "German",
        "es": "Spanish",
        "spanish": "Spanish",
        "pt": "Portuguese",
        "portuguese": "Portuguese",
        "it": "Italian",
        "italian": "Italian",
        "ru": "Russian",
        "russian": "Russian",
    }
    normalized = str(code or "").strip().lower()
    return mapping.get(normalized, fallback)


def transcribe_reference_audio(audio_path: Path, model_name: str = "small", language: str = "") -> dict[str, str]:
    from faster_whisper import WhisperModel

    key = (model_name, "cpu", "int8")
    whisper_model = whisper_model_cache.get(key)
    if whisper_model is None:
        whisper_model = WhisperModel(model_name, device="cpu", compute_type="int8")
        whisper_model_cache[key] = whisper_model

    segments, info = whisper_model.transcribe(
        str(audio_path),
        language=language or None,
        vad_filter=True,
        beam_size=5,
    )
    text = " ".join(segment.text.strip() for segment in segments if segment.text.strip()).strip()
    if not text:
        raise create_error(500, "Reference transcription returned empty text.")

    return {
        "text": text,
        "language": map_whisper_language_to_label(getattr(info, "language", ""), infer_language_from_text(text)),
    }


def parse_boolean_field(value: Any, fallback: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value != 0
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"1", "true", "yes", "on"}:
            return True
        if normalized in {"0", "false", "no", "off"}:
            return False
    return fallback


def normalize_voice_preset(raw_preset: dict[str, Any], existing_preset: dict[str, Any] | None = None) -> dict[str, Any]:
    existing = existing_preset or {}
    reference_text = raw_preset.get("referenceText") or existing.get("referenceText") or ""
    return {
        "id": str(raw_preset.get("id") or existing.get("id") or "").strip(),
        "name": str(raw_preset.get("name") or existing.get("name") or "").strip(),
        "characterName": str(raw_preset.get("characterName") or existing.get("characterName") or "").strip(),
        "modelDir": normalize_stored_path(raw_preset.get("modelDir") or existing.get("modelDir")),
        "proPlusModelDir": normalize_stored_path(raw_preset.get("proPlusModelDir") or existing.get("proPlusModelDir")) or None,
        "useV2ProPlus": bool(raw_preset.get("useV2ProPlus", existing.get("useV2ProPlus", True))),
        "referenceAudioPath": normalize_stored_path(raw_preset.get("referenceAudioPath") or existing.get("referenceAudioPath")),
        "referenceText": str(reference_text).strip(),
        "referenceLanguage": str(
            raw_preset.get("referenceLanguage")
            or existing.get("referenceLanguage")
            or infer_language_from_text(str(reference_text))
        ).strip()
        or DEFAULT_REFERENCE_LANGUAGE,
        "builtIn": bool(raw_preset.get("builtIn", existing.get("builtIn", False))),
        "source": str(raw_preset.get("source") or existing.get("source") or "custom").strip(),
        "uploadedFilePath": raw_preset.get("uploadedFilePath") or existing.get("uploadedFilePath") or None,
        "createdAt": existing.get("createdAt") or raw_preset.get("createdAt") or now_iso(),
        "updatedAt": now_iso(),
    }


async def resolve_character_reference_prompt(character_dir: Path) -> dict[str, str] | None:
    normalized_character_dir = character_dir.resolve()
    prompt_json_path = normalized_character_dir / "prompt_wav.json"
    prompt_dir = normalized_character_dir / "prompt_wav"
    if not prompt_json_path.exists():
        return None

    prompt_json = await safe_read_json(prompt_json_path, {})
    normal_prompt = prompt_json.get("Normal") if isinstance(prompt_json, dict) else None
    if normal_prompt is None and isinstance(prompt_json, dict):
        normal_prompt = next(iter(prompt_json.values()), None)

    prompt_wave_name = str((normal_prompt or {}).get("wav") or "").strip() if isinstance(normal_prompt, dict) else ""
    reference_audio_path = prompt_dir / prompt_wave_name if prompt_wave_name else Path()
    reference_text = str((normal_prompt or {}).get("text") or "").strip() if isinstance(normal_prompt, dict) else ""

    if not reference_audio_path.exists() or not reference_text:
        return None

    return {
        "referenceAudioPath": str(reference_audio_path),
        "referenceText": reference_text,
        "referenceLanguage": infer_language_from_text(reference_text, DEFAULT_REFERENCE_LANGUAGE),
    }


async def resolve_builtin_character_presets() -> list[dict[str, Any]]:
    discovered_character_dirs: dict[str, Path] = {}
    for root_dir in DEFAULT_GENIE_CHARACTER_ROOT_CANDIDATES:
        if not root_dir.exists():
            continue
        for child in root_dir.iterdir():
            if not child.is_dir():
                continue
            voice_id = child.name.strip().lower()
            if voice_id and voice_id not in discovered_character_dirs:
                discovered_character_dirs[voice_id] = child.resolve()

    ordered_ids = [
        *[voice_id for voice_id in PREFERRED_GENIE_CHARACTER_IDS if voice_id in discovered_character_dirs],
        *sorted(voice_id for voice_id in discovered_character_dirs if voice_id not in PREFERRED_GENIE_CHARACTER_IDS),
    ]

    presets: list[dict[str, Any]] = []
    for voice_id in ordered_ids:
        character_dir = discovered_character_dirs[voice_id]
        model_dir = character_dir / "tts_models"
        if not is_valid_genie_v2proplus_dir(model_dir) and not is_valid_genie_v2_dir(model_dir):
            continue

        reference_prompt = await resolve_character_reference_prompt(character_dir)
        if reference_prompt is None:
            continue

        presets.append(
            normalize_voice_preset(
                {
                    "id": voice_id,
                    "name": GENIE_CHARACTER_LABELS.get(voice_id, voice_id.replace("-", " ").title()),
                    "characterName": voice_id,
                    "modelDir": str(model_dir),
                    "proPlusModelDir": str(DEFAULT_GENIE_PROPLUS_DIR) if DEFAULT_GENIE_PROPLUS_DIR.exists() else None,
                    "useV2ProPlus": is_valid_genie_v2proplus_dir(model_dir),
                    "referenceAudioPath": reference_prompt["referenceAudioPath"],
                    "referenceText": reference_prompt["referenceText"],
                    "referenceLanguage": reference_prompt["referenceLanguage"],
                    "builtIn": True,
                    "source": "builtin",
                }
            )
        )

    return presets


async def resolve_default_converted_v2pro_preset() -> dict[str, Any] | None:
    for model_dir in DEFAULT_CONVERTED_V2PRO_CHARACTER_CANDIDATES:
        normalized_model_dir = model_dir.resolve()
        if not is_valid_genie_v2proplus_dir(normalized_model_dir) and not is_valid_genie_v2_dir(normalized_model_dir):
            continue

        reference_prompt = None
        builtin_presets = await resolve_builtin_character_presets()
        mika_preset = next((preset for preset in builtin_presets if preset["id"] == "mika"), None)
        if mika_preset:
            reference_prompt = {
                "referenceAudioPath": mika_preset["referenceAudioPath"],
                "referenceText": mika_preset["referenceText"],
                "referenceLanguage": mika_preset["referenceLanguage"],
            }

        return normalize_voice_preset(
            {
                "id": "gpt-sovits-v2pro-default",
                "name": "GPT-SoVITS v2ProPlus Default",
                "characterName": "gpt_sovits_v2pro_default",
                "modelDir": str(normalized_model_dir),
                "proPlusModelDir": str(DEFAULT_GENIE_PROPLUS_DIR) if DEFAULT_GENIE_PROPLUS_DIR.exists() else None,
                "useV2ProPlus": is_valid_genie_v2proplus_dir(normalized_model_dir),
                "referenceAudioPath": reference_prompt["referenceAudioPath"] if reference_prompt else "",
                "referenceText": reference_prompt["referenceText"] if reference_prompt else "",
                "referenceLanguage": reference_prompt["referenceLanguage"] if reference_prompt else DEFAULT_REFERENCE_LANGUAGE,
                "builtIn": True,
                "source": "builtin",
            }
        )

    return None


async def resolve_bundled_wave_presets() -> list[dict[str, Any]]:
    base_model_by_id: dict[str, dict[str, Any]] = {}
    default_base_preset = await resolve_default_converted_v2pro_preset()
    if default_base_preset:
        base_model_by_id[default_base_preset["id"]] = default_base_preset

    for builtin_preset in await resolve_builtin_character_presets():
        base_model_by_id[builtin_preset["id"]] = builtin_preset

    discovered_dirs: dict[str, Path] = {}
    for root_dir in DEFAULT_BUNDLED_WAVE_PRESET_ROOT_CANDIDATES:
        if not root_dir.exists():
            continue
        for child in root_dir.iterdir():
            if child.is_dir() and child.name.strip().lower() not in discovered_dirs:
                discovered_dirs[child.name.strip().lower()] = child.resolve()

    presets: list[dict[str, Any]] = []
    for preset_id in sorted(discovered_dirs):
        preset_dir = discovered_dirs[preset_id]
        metadata_path = preset_dir / "metadata.json"
        if not metadata_path.exists():
            continue

        metadata = await safe_read_json(metadata_path, {})
        audio_file_name = str(metadata.get("audioFile") or "reference.wav").strip()
        reference_audio_path = (preset_dir / audio_file_name).resolve()
        if not reference_audio_path.exists():
            continue

        base_voice_id = str(metadata.get("baseVoiceId") or "gpt-sovits-v2pro-default").strip() or "gpt-sovits-v2pro-default"
        base_preset = base_model_by_id.get(base_voice_id) or default_base_preset
        if not base_preset:
            continue

        reference_text = str(metadata.get("referenceText") or "").strip()
        reference_language = str(metadata.get("referenceLanguage") or "").strip() or infer_language_from_text(reference_text, DEFAULT_REFERENCE_LANGUAGE)
        presets.append(
            normalize_voice_preset(
                {
                    "id": str(metadata.get("id") or preset_id).strip() or preset_id,
                    "name": str(metadata.get("name") or preset_id.replace("-", " ").title()).strip() or preset_id,
                    "characterName": base_preset["characterName"],
                    "modelDir": base_preset["modelDir"],
                    "proPlusModelDir": base_preset.get("proPlusModelDir"),
                    "useV2ProPlus": bool(base_preset.get("useV2ProPlus", True)),
                    "referenceAudioPath": str(reference_audio_path),
                    "referenceText": reference_text,
                    "referenceLanguage": reference_language,
                    "builtIn": True,
                    "source": "bundled-wave",
                }
            )
        )

    return presets


async def save_voice_preset_state() -> None:
    if voice_preset_state is None:
        return
    await ensure_dir(DATA_DIR)
    VOICE_PRESETS_FILE.write_text(json.dumps(voice_preset_state, indent=2), encoding="utf-8")


async def load_voice_preset_state() -> dict[str, Any]:
    global voice_preset_state
    if voice_preset_state is not None:
        return voice_preset_state

    await ensure_dir(DATA_DIR)
    await ensure_dir(VOICE_UPLOADS_DIR)

    file_state = await safe_read_json(VOICE_PRESETS_FILE, {})
    items = file_state.get("items") if isinstance(file_state, dict) else []
    normalized_items = [
        normalize_voice_preset(item)
        for item in (items if isinstance(items, list) else [])
    ]
    normalized_items = [
        item
        for item in normalized_items
        if item["id"]
        and item["name"]
        and item["characterName"]
        and item["modelDir"]
        and (item["referenceAudioPath"] or item["id"] == "gpt-sovits-v2pro-default")
    ]

    builtin_presets = [
        preset
        for preset in (
            await resolve_default_converted_v2pro_preset(),
            *await resolve_builtin_character_presets(),
            *await resolve_bundled_wave_presets(),
        )
        if preset
    ]
    did_change = False

    for builtin_preset in reversed(builtin_presets):
        existing_index = next((index for index, item in enumerate(normalized_items) if item["id"] == builtin_preset["id"]), -1)
        if existing_index >= 0:
            normalized_items[existing_index] = normalize_voice_preset(builtin_preset, normalized_items[existing_index])
        else:
            normalized_items.insert(0, builtin_preset)
        did_change = True

    active_voice_id = str((file_state or {}).get("activeVoiceId") or "").strip() if isinstance(file_state, dict) else ""
    if not any(item["id"] == active_voice_id for item in normalized_items):
        preferred_default = next((item["id"] for item in builtin_presets if item["id"] == "mika"), "")
        first_reference_voice_id = next((item["id"] for item in normalized_items if item.get("referenceAudioPath")), "")
        active_voice_id = preferred_default or first_reference_voice_id or ""
        did_change = True

    voice_preset_state = {
        "version": 1,
        "activeVoiceId": active_voice_id,
        "items": normalized_items,
    }

    if did_change or not VOICE_PRESETS_FILE.exists():
        await save_voice_preset_state()

    return voice_preset_state


def get_voice_response(preset: dict[str, Any], active_voice_id: str) -> dict[str, Any]:
    source = str(preset.get("source") or "custom").strip() or "custom"
    is_base_model = source == "builtin" or preset["id"] == "gpt-sovits-v2pro-default"
    return {
        "id": preset["id"],
        "name": preset["name"],
        "active": preset["id"] == active_voice_id,
        "language": preset.get("referenceLanguage") or DEFAULT_REFERENCE_LANGUAGE,
        "has_ref_text": bool(preset.get("referenceText")),
        "built_in": bool(preset.get("builtIn")),
        "source": source,
        "can_be_base_model": is_base_model,
        "can_be_wave_source": bool(preset.get("referenceAudioPath")) and preset["id"] != "gpt-sovits-v2pro-default",
        "created_at": preset.get("createdAt"),
        "updated_at": preset.get("updatedAt"),
    }


async def get_active_voice_preset() -> dict[str, Any]:
    state = await load_voice_preset_state()
    preset = next((item for item in state["items"] if item["id"] == state.get("activeVoiceId")), None) or (state["items"][0] if state["items"] else None)
    if not preset:
        raise create_error(404, "No Genie voice presets are available.")
    return preset


async def get_voice_preset_by_id(voice_id: str | None) -> dict[str, Any]:
    normalized_id = str(voice_id or "").strip()
    state = await load_voice_preset_state()
    preset = next((item for item in state["items"] if item["id"] == normalized_id), None)
    if not preset:
        raise create_error(404, f"Voice preset not found: {normalized_id or '(empty id)'}")
    return preset


async def get_default_clone_base_preset() -> dict[str, Any]:
    try:
        return await get_voice_preset_by_id("gpt-sovits-v2pro-default")
    except HTTPException:
        pass

    try:
        return await get_voice_preset_by_id("mika")
    except HTTPException:
        return await get_active_voice_preset()


async def get_clone_base_preset(base_voice_id: str | None = None) -> dict[str, Any]:
    normalized_id = str(base_voice_id or "").strip()
    if normalized_id:
        return await get_voice_preset_by_id(normalized_id)
    return await get_default_clone_base_preset()


async def upsert_voice_preset(raw_preset: dict[str, Any], activate: bool = False) -> dict[str, Any]:
    state = await load_voice_preset_state()
    existing_index = next((index for index, item in enumerate(state["items"]) if item["id"] == raw_preset["id"]), -1)
    existing_preset = state["items"][existing_index] if existing_index >= 0 else None
    normalized = normalize_voice_preset(raw_preset, existing_preset)

    if existing_index >= 0:
        state["items"][existing_index] = normalized
    else:
        state["items"].append(normalized)

    if activate or not state.get("activeVoiceId"):
        state["activeVoiceId"] = normalized["id"]

    await save_voice_preset_state()
    return normalized


async def delete_voice_preset_by_id(voice_id: str) -> None:
    state = await load_voice_preset_state()
    normalized_id = str(voice_id or "").strip()
    index = next((idx for idx, item in enumerate(state["items"]) if item["id"] == normalized_id), -1)
    if index < 0:
        raise create_error(404, f"Voice preset not found: {normalized_id or '(empty id)'}")

    preset = state["items"][index]
    if preset.get("builtIn"):
        raise create_error(400, "Built-in Genie presets cannot be deleted.")

    state["items"].pop(index)
    if state.get("activeVoiceId") == normalized_id:
        state["activeVoiceId"] = state["items"][0]["id"] if state["items"] else ""

    uploaded_file_path = preset.get("uploadedFilePath")
    if uploaded_file_path:
        shutil.rmtree(Path(uploaded_file_path).resolve().parent, ignore_errors=True)

    await save_voice_preset_state()


def build_reference_fingerprint(preset: dict[str, Any]) -> str:
    return json.dumps(
        [
            preset.get("id"),
            preset.get("referenceAudioPath"),
            preset.get("referenceText"),
            preset.get("referenceLanguage"),
            preset.get("updatedAt"),
        ]
    )


async def ensure_voice_ready(preset: dict[str, Any], target_language: str) -> dict[str, str]:
    runtime = await prepare_runtime_model_dir(
        preset["modelDir"],
        preset.get("proPlusModelDir") or DEFAULT_GENIE_PROPLUS_DIR,
        bool(preset.get("useV2ProPlus", True)),
    )

    should_reload_character = (
        current_prepared_voice["voice_id"] != preset["id"]
        or current_prepared_voice["target_language"] != target_language
    )

    if should_reload_character:
        model_manager.load_character(
            character_name=preset["characterName"],
            model_dir=runtime["runtimeModelDir"],
            language=genie_server.normalize_language(target_language),
        )
        current_prepared_voice["voice_id"] = preset["id"]
        current_prepared_voice["target_language"] = target_language
        current_prepared_voice["reference_fingerprint"] = ""

    reference_fingerprint = build_reference_fingerprint(preset)
    if current_prepared_voice["reference_fingerprint"] != reference_fingerprint:
        ext = Path(preset["referenceAudioPath"]).suffix.lower()
        if ext not in genie_server.SUPPORTED_AUDIO_EXTS:
            raise create_error(400, f"Audio format '{ext}' is not supported. Supported formats: {genie_server.SUPPORTED_AUDIO_EXTS}")
        genie_server._reference_audios[preset["characterName"]] = {
            "audio_path": preset["referenceAudioPath"],
            "audio_text": preset["referenceText"],
            "language": genie_server.normalize_language(preset.get("referenceLanguage") or DEFAULT_REFERENCE_LANGUAGE),
        }
        current_prepared_voice["reference_fingerprint"] = reference_fingerprint

    return runtime


def is_riff_wav(buffer: bytes) -> bool:
    return len(buffer) >= 12 and buffer[:4] == b"RIFF" and buffer[8:12] == b"WAVE"


def wrap_pcm16_le_as_wav(
    pcm_buffer: bytes,
    sample_rate: int = GENIE_SAMPLE_RATE,
    channels: int = GENIE_CHANNELS,
    bits_per_sample: int = GENIE_BITS_PER_SAMPLE,
) -> bytes:
    byte_rate = sample_rate * channels * (bits_per_sample // 8)
    block_align = channels * (bits_per_sample // 8)
    header = io.BytesIO()
    header.write(b"RIFF")
    header.write((36 + len(pcm_buffer)).to_bytes(4, "little"))
    header.write(b"WAVE")
    header.write(b"fmt ")
    header.write((16).to_bytes(4, "little"))
    header.write((1).to_bytes(2, "little"))
    header.write(channels.to_bytes(2, "little"))
    header.write(sample_rate.to_bytes(4, "little"))
    header.write(byte_rate.to_bytes(4, "little"))
    header.write(block_align.to_bytes(2, "little"))
    header.write(bits_per_sample.to_bytes(2, "little"))
    header.write(b"data")
    header.write(len(pcm_buffer).to_bytes(4, "little"))
    return header.getvalue() + pcm_buffer


def parse_wave_data(buffer: bytes) -> tuple[int, int, int, bytes]:
    offset = 12
    channels = 1
    sample_rate = GENIE_SAMPLE_RATE
    bits_per_sample = GENIE_BITS_PER_SAMPLE
    data_offset = -1
    data_size = 0

    while offset + 8 <= len(buffer):
        chunk_id = buffer[offset:offset + 4]
        chunk_size = int.from_bytes(buffer[offset + 4:offset + 8], "little")
        chunk_data_offset = offset + 8

        if chunk_id == b"fmt " and chunk_size >= 16:
            channels = int.from_bytes(buffer[chunk_data_offset + 2:chunk_data_offset + 4], "little")
            sample_rate = int.from_bytes(buffer[chunk_data_offset + 4:chunk_data_offset + 8], "little")
            bits_per_sample = int.from_bytes(buffer[chunk_data_offset + 14:chunk_data_offset + 16], "little")
        elif chunk_id == b"data":
            data_offset = chunk_data_offset
            data_size = chunk_size
            break

        offset += 8 + chunk_size + (chunk_size % 2)

    if data_offset < 0:
        raise create_error(500, "Generated WAV is missing a data chunk.")

    pcm_data = buffer[data_offset:min(len(buffer), data_offset + data_size)]
    return channels, sample_rate, bits_per_sample, pcm_data


def pcm16_to_float32_le_buffer(pcm_data: bytes, channels: int = 1) -> bytes:
    import array

    samples = array.array("f")
    if channels <= 1:
        for index in range(0, len(pcm_data) - 1, 2):
            sample = int.from_bytes(pcm_data[index:index + 2], "little", signed=True)
            samples.append(sample / 32768.0)
        return samples.tobytes()

    frame_width = channels * 2
    for frame_offset in range(0, len(pcm_data) - (frame_width - 1), frame_width):
        values = []
        for channel_index in range(channels):
            start = frame_offset + channel_index * 2
            sample = int.from_bytes(pcm_data[start:start + 2], "little", signed=True)
            values.append(sample / 32768.0)
        samples.append(sum(values) / len(values))
    return samples.tobytes()


async def synthesize_genie_audio(character_name: str, text: str, split_sentence: bool = False) -> dict[str, Any]:
    started_at = datetime.now(timezone.utc)
    streaming_response = await genie_server.tts_endpoint(
        genie_server.TTSPayload(
            character_name=character_name,
            text=text,
            split_sentence=split_sentence,
            save_path=None,
        )
    )

    chunks: list[bytes] = []
    async for chunk in streaming_response.body_iterator:
        chunks.append(chunk)

    buffer = b"".join(chunks)
    if not is_riff_wav(buffer):
        buffer = wrap_pcm16_le_as_wav(buffer)

    elapsed_ms = int((datetime.now(timezone.utc) - started_at).total_seconds() * 1000)
    return {"buffer": buffer, "elapsedMs": elapsed_ms}


def main() -> None:
    import sys

    # Reuse this already-loaded module when start_genie_server imports genie_compat_api.
    sys.modules.setdefault("genie_compat_api", sys.modules[__name__])

    from start_genie_server import main as start_genie_server_main

    start_genie_server_main()


if __name__ == "__main__":
    main()
