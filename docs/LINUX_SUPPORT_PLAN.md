# Linux Support Plan for DesktopWaifu

## Summary
Add Linux support to the actual DesktopWaifu repo by selectively porting the useful Linux changes from PR #1, without merging the PR wholesale.

Linux v1 target:
- local Linux dev works from a fresh clone
- Linux stable build works and produces a release artifact
- transparent background works on X11 and on Wayland via XWayland fallback
- Windows behavior and Windows release packaging do not regress

## Key Changes

### 1. Cross-platform Electrobun runtime
- Replace the Windows-only shim in `src/bun/electrobun-runtime.ts` with cross-platform imports from the vendored Electrobun package’s `dist/api` surface.
- Keep the vendored patched Electrobun package as the repo source of truth.
- Add Linux runtime assets to the vendored Electrobun package so Linux does not depend on Windows-only `dist-win-x64`.
- Keep `package.json` pointing at `file:./vendor/electrobun/package`.

### 2. Linux transparency and shell detection
- Port the Wayland fallback idea from PR #1: when `XDG_SESSION_TYPE=wayland`, set `GDK_BACKEND=x11` so transparency works through XWayland.
- Apply that environment change before Electrobun runtime initialization.
- Reuse the desktop-shell detection improvements in:
  - `src/app.html`
  - `src/routes/+layout.svelte`
  - `src/lib/vrm/scene.ts`
- Standardize desktop detection on:
  - `views:` / `file:` protocol
  - Electrobun globals
  - `desktop=1` query param
- Keep transparent `html/body` behavior for shell mode.

### 3. Linux-safe dev workflow
- Reuse the PR’s HTTPS/HTTP split, but keep fallback behavior:
  - desktop-shell dev uses HTTP
  - standalone web dev uses HTTPS/basic SSL
- Update `vite.config.ts` so SSL is disabled only when `ELECTROBUN_DEV` is set.
- Keep fixed-port dev startup.
- Keep fallback to `views://mainview/index.html` if the dev server is unavailable.
- Do not keep the PR behavior that always returns the dev URL even after timeout.

### 4. Linux release support
- Add Linux build and artifact collection to the release workflow.
- Restore tag-based releases; do not release from `master` or raw branch names.
- Produce:
  - Linux tarball
  - Linux AppImage when available
- Keep the current Windows installer patch path intact.
- Ensure CI uses the vendored Electrobun package, not any developer-local path.

### 5. Docs and platform expectations
- Update `README.md` with Linux requirements:
  - `libayatana-appindicator3`
  - X11 support
  - Wayland uses XWayland fallback for transparent background
- Explicitly document that Linux v1 transparency support is:
  - native X11
  - Wayland via XWayland fallback
- Do not add CEF in this pass.

## Test Plan
- Windows:
  - `bun install`
  - `bun run dev`
  - `bun run build:stable`
  - verify transparent window, tray, hotkeys, and installer patch still work
- Linux local dev:
  - fresh clone
  - `bun install`
  - `bun run dev`
  - verify no Windows-only Electrobun path failures
- Linux transparency:
  - X11 session renders transparent background correctly
  - Wayland session falls back to X11/XWayland and still renders correctly
- Dev server behavior:
  - shell dev uses HTTP
  - standalone web uses HTTPS
  - broken dev server falls back cleanly instead of blank-loading localhost
- Release:
  - Linux stable build completes
  - tarball is produced
  - AppImage is produced or skipped with warning
  - versioned release tags still work
  - Windows release still works

## Assumptions
- Linux v1 target is `linux-x64` only.
- Wayland via XWayland is acceptable for v1.
- CEF is out of scope for this pass.
- The vendored patched Electrobun package remains the runtime source of truth until the local fixes are upstreamed or published properly.
- PR #1 is a reference source, not a merge target.
