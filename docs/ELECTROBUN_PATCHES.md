# Electrobun Patches

DesktopWaifu currently depends on a patched Electrobun package. We no longer vendor the full built package in git; instead, we install the published `electrobun` package and reapply a small set of source patches on `postinstall`.

Patch source lives in:

- `patches/electrobun/`

Patch apply hook:

- `scripts/apply-electrobun-patches.mjs`

## Why this exists

DesktopWaifu hits a combination of Windows-specific issues in stock Electrobun:

- blurry WebView2 rendering on high-DPI displays
- transparent/layered window hit-test issues
- dead zones after programmatic resize/frame updates
- unstable Windows self-extractor behavior in optimized builds
- broken Windows launcher naming in some bundle paths

These patches are the local changes currently required to keep the app working.

## Patched Electrobun files

### `build.ts`

Purpose:

- build the Windows self-extractor in `Debug` mode for release packaging

Reason:

- the optimized Windows extractor was unstable and could deadlock before extraction finished

### `src/cli/index.ts`

Purpose:

- preserve the `.exe` extension on the copied Windows launcher output

Reason:

- some bundle paths produced a launcher without the expected Windows extension

### `src/extractor/main.zig`

Purpose:

- disable the Windows spinner/progress-thread path in the extractor

Reason:

- the concurrent progress output could hang the extractor on Windows

### `src/native/win/nativeWrapper.cpp`

Purposes:

- improve high-DPI WebView2 rendering
- fix layered-window hit testing
- ensure window frame/size changes also resize the container child hwnd and autosizing views

Reasons:

- WebView2 looked blurry on 4K/high-DPI displays
- transparent/layered windows had bad click behavior near edges
- after resize, the container/webview could fall out of sync with the native window and create dead regions

## Install/build model

The repo now uses:

- published `electrobun@1.15.1`

Then reapplies the local source overrides from `patches/electrobun/` during:

- `bun install`

This keeps the repo GitHub-safe while still preserving the Electrobun changes the app needs.
