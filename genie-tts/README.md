# Genie-TTS

Standalone DesktopWaifu Genie-TTS compat API server and local development harness.

## Source of truth

For DesktopWaifu, this folder's source of truth is:

- primary server entrypoint: `genie_compat_api.py`
- primary bootstrap helper: `start_genie_server.py`
- default runtime provider: `cuda`
- default clone base: `gpt-sovits-v2pro-default`
- bundled wave source: `Riko`
- release packaging target: compiled Windows `onedir` payload plus the GUI installer

The Node web UI in `server.js` and `public/` is dev-only. The DesktopWaifu release path is the compat API server, not the web harness.

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

### Fast path with uv

```bash
uv sync
uv run python genie_compat_api.py --download-default-model
```

That does the intended DesktopWaifu bootstrap:

- installs Python dependencies
- downloads `GenieData` on first run if needed
- downloads the DesktopWaifu default converted `v2ProPlus` clone base on first run if needed
- downloads the upstream Genie character packs (`mika`, `thirtyseven`, `feibi`) on first run if needed
- seeds the bundled `Riko` wave preset so `default model + different wave` works immediately
- starts the compat API on `http://127.0.0.1:8000`
- uses `CUDAExecutionProvider` by default

The default converted model is downloaded from the DesktopWaifu release assets into:

- `./models/converted/gpt-sovits-v2proplus-default`

The upstream Genie character packs are downloaded into:

- `./models/High-Logic-Genie/CharacterModels/v2ProPlus`

### pip / venv fallback

```bash
python -m venv .venv
pip install -r requirements.txt
python genie_compat_api.py --download-default-model
```

### UI side

```bash
npm install
npm start
```

Open:

`http://localhost:3088`

### npm convenience scripts

```bash
npm run api
# or
npm run api:uv
```

These start the compat server with automatic default-model download enabled.

### Windows onedir build

```bash
python build_windows_onedir.py
# or
npm run build:windows-onedir
```

Output:

- `./build/windows-onedir/DesktopWaifu-GenieCompat/DesktopWaifu-GenieCompat.exe`

### Windows GUI installer

```bash
python build_windows_installer.py
# or
npm run build:windows-installer
```

Output:

- `./build/windows-installer/DesktopWaifu-GenieCompat-Setup.exe`

This is the proper Windows installer for the compiled compat server. It packages the `onedir` payload, installs under the current user, creates shortcuts, and registers an uninstall entry.

Notes:

- `npm run build:windows-installer` is the full source-of-truth build and rebuilds the `onedir` payload first.
- `python build_windows_installer.py` reuses an existing `onedir` build when one already exists.
- `python build_windows_installer.py --rebuild-onedir` forces a fresh compile before the installer step.

## Defaults

The helper defaults to:

- host: `127.0.0.1`
- port: `8000`
- GenieData: `./GenieData`
- DesktopWaifu default clone model:
  - `./models/converted/gpt-sovits-v2proplus-default`

Optional environment variables:

- `GENIE_DATA_DIR`
- `GENIE_CHARACTER_ROOTS`
- `GENIE_PROPLUS_MODELS_DIR`
- `GENIE_AUTO_DOWNLOAD_DEFAULT_MODEL=1`
- `GENIE_AUTO_DOWNLOAD_CHARACTERS=1`
- `GENIE_AUTO_DOWNLOAD_DATA=1`
- `DESKTOPWAIFU_GENIE_HOME`

`GENIE_CHARACTER_ROOTS` can contain multiple directories separated by your platform path delimiter.

For the compiled Windows `onedir` build, writable state defaults to:

- `%LOCALAPPDATA%\\DesktopWaifu\\genie-tts`

That is where the packaged server stores:

- `GenieData`
- downloaded default models
- downloaded upstream Genie character packs
- temporary files
- saved voice preset state

Useful startup variants:

```bash
# Default path, uses CUDA unless you override it
python genie_compat_api.py --download-default-model

# Explicit GPU path
python start_genie_server.py --provider cuda

# CPU-only fallback
python start_genie_server.py --provider cpu

# Experimental TensorRT path
python start_genie_server.py --provider tensorrt
```

Notes on provider selection:

- `cuda` is the default provider for DesktopWaifu.
- `auto` is still available if you want runtime fallback behavior.
- `tensorrt` is explicit on purpose. It is not used automatically.
- `tensorrt` requires the TensorRT runtime DLLs on `PATH` or startup will fail fast instead of silently dropping to CPU.
- TensorRT cache files are written under `.cache/tensorrt/` by default.

## Notes

- The intended DesktopWaifu clone path uses the shipped converted default model plus arbitrary wave sources.
- Upstream Genie characters like `mika`, `thirtyseven`, and `feibi` are still supported as base models, but they are not the only intended default path.
- `default-model.json` points at the DesktopWaifu release asset that contains the converted default model bundle.
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
- The helper script can also auto-download the DesktopWaifu default converted clone model from GitHub Releases.
- The helper script can also auto-download the upstream Genie character packs from Hugging Face.
- The helper script also forces tuned ONNX Runtime provider/session settings instead of using Genie's package defaults.
- The bundled `Riko` wave preset ships as an app resource and is exposed by the compat server automatically.
- The intended packaged release is the compat API server only. The Node web UI is not required for normal DesktopWaifu use.

## What is intentionally not committed

- `GenieData/`
- `models/`
- `data/`
- `tmp/`
- `.cache/`
- `node_modules/`
