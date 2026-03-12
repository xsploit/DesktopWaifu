# Electrobun DPI / Fuzzy UI Fix Guide

This is the fix set that made `electrobun-webwaifu3` stop looking soft on a 4K Windows display.

The important point is that the main fix was in the Electrobun Windows runtime, not the Svelte app.

## Root Cause

- The crisp `.NET` app in [`VrmHost`](/c:/Users/SUBSECT/Downloads/JSMATE/VrmHost) proved WebView2 itself was fine on this machine.
- The blur was coming from Electrobun's custom Win32 + raw WebView2 host path.
- On a 4K monitor, bad DPI awareness or bad WebView2 scale handling gets exposed immediately.

## What Actually Fixed It

### 1. Patch Electrobun's Windows runtime

File:
- [`nativeWrapper.cpp`](/c:/Users/SUBSECT/Documents/GitHub/QWENSTUDIO/electrobun/package/src/native/win/nativeWrapper.cpp)

Changes:
- Opt into PerMonitorV2 DPI awareness as soon as the event loop starts.
- Compute the real monitor scale using `GetDpiForWindow` and `GetDpiForMonitor`.
- Build WebView2 browser args with:
  - `--high-dpi-support=1`
  - `--force-device-scale-factor=<monitor scale>`
- Apply WebView2 DPI settings on the controller:
  - `put_ZoomFactor(1.0)`
  - `NotifyParentWindowPositionChanged()`
  - `put_ShouldDetectMonitorScaleChanges(TRUE)`
  - `put_BoundsMode(COREWEBVIEW2_BOUNDS_MODE_USE_RAW_PIXELS)`
  - `put_RasterizationScale(scaleFactor)`
- Reapply those settings when:
  - the controller is attached
  - the container HWND is attached
  - the webview is resized
  - the controller is first created
- Handle `WM_DPICHANGED` and resize the container/webview immediately.
- Re-run resize logic on `WM_MOVE`, because monitor moves matter on multi-display DPI setups.
- Add a forward declaration for `log(const std::string&)`, because the new DPI helpers call it before the actual definition later in the file.

What mattered most:
- `PerMonitorV2`
- explicit monitor scale detection
- `force-device-scale-factor`
- `RasterizationScale`
- `WM_DPICHANGED`

### 2. Rebuild the Electrobun package itself

The app build alone is not enough. You have to rebuild the referenced Electrobun package.

Commands:

```powershell
cd C:\Users\SUBSECT\Documents\GitHub\QWENSTUDIO\electrobun\package
bun run build:dev
```

If your app references that local package via `file:...`, then refresh the dependency:

```powershell
cd C:\Users\SUBSECT\Downloads\JSMATE\electrobun-webwaifu3
bun install
```

Then rebuild the app:

```powershell
bun run build
```

### 3. Keep the app importing the platform-specific Electrobun runtime

Files:
- [`src/bun/electrobun-runtime.ts`](/c:/Users/SUBSECT/Downloads/JSMATE/electrobun-webwaifu3/src/bun/electrobun-runtime.ts)
- [`src/lib/electrobun/bridge.ts`](/c:/Users/SUBSECT/Downloads/JSMATE/electrobun-webwaifu3/src/lib/electrobun/bridge.ts)

Why:
- The local `file:` dependency was using `dist-win-x64`, but package exports did not resolve cleanly in this app.
- The shim imports the actual built runtime directly.

That pattern is reusable if another project references a local Electrobun checkout.

### 4. Add Windows sidecar manifests

Files:
- [`scripts/write-windows-manifests.mjs`](/c:/Users/SUBSECT/Downloads/JSMATE/electrobun-webwaifu3/scripts/write-windows-manifests.mjs)
- [`package.json`](/c:/Users/SUBSECT/Downloads/JSMATE/electrobun-webwaifu3/package.json)

What it does:
- writes `launcher.exe.manifest`
- writes `bun.exe.manifest`
- requests:
  - `dpiAware=true/pm`
  - `dpiAwareness=PerMonitorV2,PerMonitor`
  - `gdiScaling=true`

Important:
- this helped packaging correctness
- this was not the whole fix by itself

## Optional App-Side Fixes For Canvas / WebGL Apps

These are useful if your Electrobun app renders WebGL or Three.js content and still looks soft even after the host is fixed.

Files:
- [`scene.ts`](/c:/Users/SUBSECT/Downloads/JSMATE/electrobun-webwaifu3/src/lib/vrm/scene.ts)
- [`postprocessing.ts`](/c:/Users/SUBSECT/Downloads/JSMATE/electrobun-webwaifu3/src/lib/vrm/postprocessing.ts)
- [`VrmCanvas.svelte`](/c:/Users/SUBSECT/Downloads/JSMATE/electrobun-webwaifu3/src/lib/components/VrmCanvas.svelte)

Changes:
- Size the renderer from the actual canvas box, not `window.innerWidth` / `window.innerHeight`.
- Use a desktop-shell DPR fallback when `window.devicePixelRatio` incorrectly reports about `1.0`.
- Keep `EffectComposer`, FXAA, SMAA, outline, and bloom sizes in sync with the real canvas size.
- Pass the real canvas element into the resize path.

If your future app is mostly plain DOM/UI and not WebGL-heavy, you probably do not need these parts.

## Minimal Reuse Checklist For Future Electrobun Projects

If another Electrobun app looks fuzzy on Windows:

1. Patch the Electrobun package runtime in:

```text
C:\Users\SUBSECT\Documents\GitHub\QWENSTUDIO\electrobun\package\src\native\win\nativeWrapper.cpp
```

2. Rebuild the package:

```powershell
cd C:\Users\SUBSECT\Documents\GitHub\QWENSTUDIO\electrobun\package
bun run build:dev
```

3. Refresh the app's local package dependency:

```powershell
cd <your-app>
bun install
```

4. Rebuild the app:

```powershell
bun run build
```

5. If the app uses canvas/WebGL, also copy the renderer/composer sizing pattern from:
- [`scene.ts`](/c:/Users/SUBSECT/Downloads/JSMATE/electrobun-webwaifu3/src/lib/vrm/scene.ts)
- [`postprocessing.ts`](/c:/Users/SUBSECT/Downloads/JSMATE/electrobun-webwaifu3/src/lib/vrm/postprocessing.ts)

6. Keep the manifest script in the app build if you package Windows binaries.

## What I Would Reuse As A Package-Level Fix

If you want this available everywhere without repeating the patch:

- keep the runtime DPI/WebView2 fixes in your Electrobun fork
- keep using the local `file:` package reference until you're happy with it
- then either:
  - keep your own forked package, or
  - upstream the Windows DPI fix

## What Not To Confuse With This

- This was not a WebGPU fix.
- This was not a generic "Three.js is blurry" fix.
- This was not just a manifest fix.
- This was a Windows Electrobun WebView2 host DPI fix, plus optional canvas cleanup.
