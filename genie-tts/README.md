# Genie-TTS

Standalone Genie-TTS harness for the DesktopWaifu/ElectroWaifu workspace.

## What it is

- Separate from the main desktop app
- Vanilla HTML/CSS/JS frontend
- Tiny Node bridge for file upload and local temp-path handling
- Talks to a local Genie-TTS FastAPI server
- Source-only in git. Downloaded models, GenieData, caches, temp files, and voice uploads stay local.

## Folder layout

- `start_genie_server.py`: helper to start Genie-TTS locally and download `GenieData` if missing
- `server.js`: local upload/proxy bridge + static web server
- `transcribe_reference.py`: local `faster-whisper` helper for reference text
- `public/`: standalone UI
- `models/`: local-only model drop area, ignored by git
- `data/`: local voice preset state, ignored by git

## Setup

### 1. Python side

Create a venv if you want:

```bash
python -m venv .venv
```

Activate it, then:

```bash
pip install -r requirements.txt
python start_genie_server.py
```

The helper defaults to:

- host: `127.0.0.1`
- port: `8000`
- GenieData: `./GenieData`

Optional environment variables:

- `GENIE_DATA_DIR`
- `GENIE_CHARACTER_ROOTS`
- `GENIE_PROPLUS_MODELS_DIR`

`GENIE_CHARACTER_ROOTS` can contain multiple directories separated by your platform path delimiter.

Useful startup variants:

```bash
# Stable GPU path
python start_genie_server.py --provider cuda

# CPU-only fallback
python start_genie_server.py --provider cpu

# Experimental TensorRT path
python start_genie_server.py --provider tensorrt
```

Notes on provider selection:

- `auto` prefers CUDA when available and otherwise falls back to CPU.
- `tensorrt` is explicit on purpose. It is not used automatically.
- `tensorrt` requires the TensorRT runtime DLLs on `PATH` or startup will fail fast instead of silently dropping to CPU.
- TensorRT cache files are written under `.cache/tensorrt/` by default.

### 2. UI side

```bash
npm install
npm start
```

Open:

`http://localhost:3088`

## Notes

- The UI expects a real Genie character model folder for `load_character`.
- A working v2 folder needs the ONNX files and bin sidecars.
- A working v2ProPlus folder is usually a full `CharacterModels/v2ProPlus/<character>/tts_models` bundle.
- The installed `genie_tts\\Data\\v2\\Models` and `genie_tts\\Data\\v2ProPlus\\Models` package folders are not sufficient by themselves for real character loading.
- The UI can search likely local folders for Genie ONNX model folders.
- The UI can transcribe reference audio locally with `faster-whisper` and auto-fill the reference text box.
- Reference audio upload is stored in `tmp/` and then passed to Genie as a local filesystem path.
- The helper script works around two current Genie Windows issues:
  - emoji output crashing non-UTF8 consoles
  - interactive `GenieData` download prompt during import
- The helper script also forces tuned ONNX Runtime provider/session settings instead of using Genie's package defaults.

## What is intentionally not committed

- `GenieData/`
- `models/`
- `data/`
- `tmp/`
- `.cache/`
- `node_modules/`
