<div align="center">

<img src="./static/assets/webwaifu3-banner.svg" alt="DesktopWaifu banner" width="100%" />

# DesktopWaifu

### Desktop VRM companion forked from WEBWAIFU 3 with Electrobun shell, native window behavior, and ONNX voice cloning

<p>
  <a href="#what-it-is">What It Is</a> |
  <a href="#feature-surface">Features</a> |
  <a href="#controls">Controls</a> |
  <a href="#desktopwaifu-vs-webwaifu3">DesktopWaifu vs WebWaifu3</a> |
  <a href="#quick-start">Quick Start</a> |
  <a href="#provider-setup">Provider Setup</a> |
  <a href="#release-builds">Release Builds</a>
</p>

<p>
  <img src="https://img.shields.io/badge/Electrobun-Desktop%20Shell-0f172a" alt="Electrobun" />
  <img src="https://img.shields.io/badge/SvelteKit-2-FF3E00?logo=svelte&logoColor=white" alt="SvelteKit 2" />
  <img src="https://img.shields.io/badge/Svelte-5-FF3E00?logo=svelte&logoColor=white" alt="Svelte 5" />
  <img src="https://img.shields.io/badge/Vite-7-646CFF?logo=vite&logoColor=white" alt="Vite 7" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?logo=typescript&logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/Three.js-0.182-000000?logo=three.js&logoColor=white" alt="Three.js 0.182" />
  <img src="https://img.shields.io/badge/VRM-@pixiv/three--vrm-1f2937" alt="VRM" />
</p>

<p>
  <img src="https://img.shields.io/badge/LLM-Ollama%20%7C%20LM%20Studio%20%7C%20OpenAI%20%7C%20OpenRouter-0f172a" alt="LLM Providers" />
  <img src="https://img.shields.io/badge/TTS-Genie%20TTS%20%7C%20Fish%20Audio%20%7C%20Kokoro-0f172a" alt="TTS Providers" />
  <img src="https://img.shields.io/badge/STT-Whisper%20tiny.en-0f172a" alt="STT" />
  <img src="https://img.shields.io/badge/Voice%20Cloning-GPT--SoVITS%20v2ProPlus%20ONNX-0f172a" alt="Voice Cloning" />
</p>

</div>

<h2 align="center" id="what-it-is">What It Is</h2>

DesktopWaifu is the desktop-shell fork of [WEBWAIFU 3](https://github.com/xsploit/webwaifu3). The browser app remains the original web-first source, while this repo is the desktop-focused source of truth for:

- Electrobun shell behavior
- transparent always-on-top window behavior
- tray, hotkeys, click-through, and desktop chrome
- packaged Windows installers
- local ONNX voice cloning with Genie TTS

The goal is simple: keep the WebWaifu UI and VRM workflow, but ship it as a real desktop companion instead of a browser tab.

<h2 align="center" id="desktopwaifu-vs-webwaifu3">DesktopWaifu vs WebWaifu3</h2>

| | WebWaifu3 | DesktopWaifu |
|---|---|---|
| **Runtime** | Browser / hosted web app | Electrobun desktop app |
| **Windowing** | Normal browser tab/window | Transparent shell, tray, hotkeys, click-through |
| **TTS default** | Kokoro + Fish | Genie TTS voice cloning + Fish |
| **Voice cloning** | Not the default path | GPT-SoVITS v2ProPlus converted to ONNX for local clone workflow |
| **Distribution** | Deploy to web host | Ship installer / release artifacts |
| **Source of truth** | Web app behavior | Desktop shell + release packaging + desktop UX |

<h2 align="center" id="feature-surface">Feature Surface</h2>

### Desktop shell

- Transparent desktop shell via Electrobun
- Tray menu, global shortcuts, desktop drag/resize behavior
- Click-through mode with recovery hotkeys
- Stable Windows installer packaging with post-package patching

### AI chat

- Providers: `ollama`, `lmstudio`, `openai`, `openrouter`
- Streaming token output into sentence-based TTS playback
- Character/system prompt support
- Local desktop persistence for settings and session state

### Text-to-speech

- **Genie TTS**: local ONNX voice cloning path, GPT-SoVITS v2ProPlus converted models, built-in presets plus mix-and-match base model/wave source flow
- **Fish Audio**: realtime cloud TTS path
- **Kokoro**: still available when you want lightweight local speech
- Default clone base preset comes from converted GPT-SoVITS defaults, not only the shipped demo characters

### Speech-to-text

- Whisper tiny.en worker-based STT
- push-to-talk / toggle recording flow
- desktop hotkeys wired into the same recording controller

### 3D avatar and rendering

- VRM loading, animation sequencing, post-processing, lighting controls
- desktop overlay UX instead of browser-tab UX
- shell-level fixes for scaling, drag, and resize behavior

<h2 align="center" id="controls">Controls</h2>

### Keyboard

- `Esc`
  - Open the in-game settings/menu
  - Close the menu and return to the normal canvas
- `F6`
  - Toggle the chat bar
- `Ctrl+Alt+Space`
  - Toggle desktop speech-to-text recording
- `Ctrl+Alt+M`
  - Recover controls if click-through is on
  - Disables click-through, restores focus, and reveals the chrome

### Mouse / window interactions

- `Mouse wheel`
  - Scale the active VRM model
- `Background drag`
  - Drag the desktop window when click-through is off
- `Window edges`
  - Resize the window from the outer edges
- `Tray`
  - Recover the window, toggle click-through, and quit the app

<h2 align="center" id="source-of-truth">Source of Truth</h2>

For clarity:

- `webwaifu3` is the original web product line
- `DesktopWaifu` is the desktop fork built from that frontend
- this repo is the source of truth for the Electrobun desktop app and release packaging

That means desktop-specific behavior should be fixed here, not backported mentally from old experimental copies.

<h2 align="center" id="quick-start">Quick Start</h2>

### Requirements

- Bun
- Node-compatible tooling for the frontend build
- Python environment for Genie compat server if you want local voice cloning
- Windows is the currently validated desktop target

### Included side projects

- [`genie-tts`](./genie-tts)
  - standalone Genie TTS harness kept in this repo
  - source-only: models, GenieData, caches, temp files, and uploaded voices stay local
  - use this when you want to iterate on Genie/FastAPI/Whisper behavior outside the desktop shell

### Dev run

```bash
bun install
bun run dev
```

### Stable release build

```bash
bun run build:stable
```

Windows release artifacts are written to:

- `build/stable-win-x64/`
- `artifacts/`

<h2 align="center" id="provider-setup">Provider Setup</h2>

### LLMs

- `Ollama`
- `LM Studio`
- `OpenAI`
- `OpenRouter`

The manager UI is still the main place to configure provider keys, endpoints, and defaults.

### Genie TTS

DesktopWaifu uses a Python compatibility server for Genie TTS with GPT-SoVITS style ONNX voices.

Typical local run:

```bash
cd genie-tts-test
python genie_compat_api.py --provider cuda
```

Notes:

- `cuda` is the working provider today
- TensorRT runtime can be installed, but current Genie `v2ProPlus` models are not TensorRT-safe as shipped
- built-in Genie presets and uploaded WAV sources are intentionally separated so you can mix:
  - base model: `mika`, `thirtyseven`, `feibi`, or converted GPT-SoVITS default
  - wave source: your saved voice WAV source

### Fish Audio

Fish remains available for cloud TTS and realtime streaming.

<h2 align="center" id="release-builds">Release Builds</h2>

This repo now has a real Windows stable release path:

```bash
bun run build:release
```

The stable installer is:

- `build/stable-win-x64/webwaifu3-electrobun-Setup.exe`

The zipped release artifact is:

- `artifacts/stable-win-x64-webwaifu3-electrobun-Setup.zip`

There is a Windows-specific `postPackage` workaround in the build config because the stock optimized Electrobun self-extractor was deadlocking on this project. The release build swaps in the known-good extractor automatically after packaging.

<h2 align="center" id="architecture">Architecture</h2>

- Frontend: SvelteKit 2, Svelte 5, TypeScript
- Desktop shell: Electrobun
- 3D: `three`, `@pixiv/three-vrm`
- LLM: OpenAI-compatible providers plus local backends
- TTS: Genie TTS compat server, Fish Audio, Kokoro
- Persistence: IndexedDB plus desktop shell state

<h2 align="center" id="license">License</h2>

This repository currently does not include a `LICENSE` file. Add one before public redistribution.
