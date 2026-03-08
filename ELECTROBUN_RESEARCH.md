# Electrobun Research For `webwaifu3` Port

This document is the durable handoff for the Electrobun investigation done from the local checkout at:

- `C:\Users\SUBSECT\Documents\GitHub\QWENSTUDIO\electrobun`

It is scoped to the migration living in:

- `C:\Users\SUBSECT\Downloads\JSMATE\electrobun-webwaifu3`

## Bottom line

Electrobun is a believable shell for a cross-platform `webwaifu3` desktop app if the goal is:

- transparent or frameless avatar window
- always-on-top window
- tray and shortcuts
- web frontend with local/native shell

It is not a drop-in replacement for the current `VrmHost`/Win32 desktop-pet behavior if the goal is:

- snapping to arbitrary external windows
- taskbar sitting
- enumerating desktop windows
- deep Win32-only mouse-hook state machines

For this product split, that is acceptable if we turf window/taskbar sitting.

## What Electrobun already gives us

From the local Electrobun source:

- `BrowserWindow` with frame, fullscreen, maximize, minimize, position/size, always-on-top.
- transparent windows on Windows/macOS/Linux in the native wrappers.
- webview passthrough toggles at the `webviewtag` / `BrowserView` level.
- tray support.
- global shortcuts.
- screen/display information and cursor position.
- drag-region support via preload and `startWindowMove`.

Useful source files:

- `package/src/bun/core/BrowserWindow.ts`
- `package/src/bun/core/BrowserView.ts`
- `package/src/bun/core/Tray.ts`
- `package/src/bun/proc/native.ts`
- `package/src/bun/preload/webviewTag.ts`
- `package/src/native/win/nativeWrapper.cpp`
- `package/src/native/macos/nativeWrapper.mm`
- `package/src/native/linux/nativeWrapper.cpp`

## Cross-platform reality

Electrobun's own README says official support is:

- macOS 14+
- Windows 11+
- Ubuntu 22.04+

Other Linux distros are community-supported if they have the right GTK/WebKit stack.

Important Linux caveat from `package/src/bun/proc/linux.md`:

- tray support depends on desktop environment
- GNOME often needs AppIndicator support installed
- application menus/context menus are weaker on Linux

So yes, this is a real cross-platform shell, but Linux still needs operational caveats.

## What it does not give us

I did not find first-class APIs for:

- enumerating external OS windows
- reading taskbar/appbar geometry as a public Bun API
- snapping to third-party windows
- desktop-pet sitting behavior
- global low-level mouse hooks equivalent to the current .NET host logic

That means:

- `JSMATE` native pet behavior does not port "for free"
- `webwaifu3` frontend + Electrobun shell is viable
- `desktop mate but AI` is still a separate architecture decision

## The local packaging bug we hit

The biggest practical blocker was not `webwaifu3`. It was the local Electrobun package layout.

### Symptom

`electrobun build` created the outer app bundle folder, then failed with a generic:

- `Bundle failed`

Directly testing the Bun main-process entry showed why:

- `bun build src/bun/index.ts --target bun --outdir .tmp-bun-build`

failed on:

- `Could not resolve: "electrobun/bun"`

### Why

The installed local package at `node_modules/electrobun/package.json` exports:

- `"./bun": "./dist/api/bun/index.ts"`

But the package contents installed from the local checkout only contain:

- `node_modules/electrobun/dist-win-x64/api/bun/index.ts`

There is no `dist/api/bun/index.ts` in the installed package, so Bun cannot resolve the documented subpath export.

### Proof

This fails:

```powershell
bun build src/bun/index.ts --target bun --outdir .tmp-bun-build
```

This works:

```powershell
bun build .\tmp-electrobun-relative.ts --target bun --outdir .\tmp-electrobun-relative-out
```

when the file imports from:

```ts
./node_modules/electrobun/dist-win-x64/api/bun/index.ts
```

## Local workaround applied

To keep this migration moving on this machine, I added:

- `src/bun/electrobun-runtime.ts`

It re-exports from:

- `../../node_modules/electrobun/dist-win-x64/api/bun/index.ts`

And `src/bun/index.ts` now imports from that shim instead of `electrobun/bun`.

This is intentionally a local Windows migration workaround, not a final cross-platform answer.

## `webwaifu3` migration implications

### Good news

The app itself is structurally compatible with a desktop shell:

- LLM path is client-side in `src/lib/llm/client.ts`
- most of the UI/frontend is static-web friendly
- the frontend already builds to `dist/`

### Remaining server assumptions

The only SvelteKit route handlers left in this copied app are still:

- `src/routes/api/tts/fish/+server.ts`
- `src/routes/api/tts/fish-stream/+server.ts`

Originally, the frontend called:

- `/api/tts/fish`
- `/api/tts/fish-stream`

from:

- `src/lib/tts/manager.ts`
- `src/lib/components/tabs/TtsTab.svelte`
- `src/lib/components/manager/FishVoicesSection.svelte`
- `src/lib/components/manager/providers.ts`

That is no longer the desktop blocker in the Electrobun port. The current migration now has:

- Bun-side Fish handlers in `src/bun/fish.ts`
- shared RPC schema in `src/lib/electrobun/rpc-schema.ts`
- browser-side bridge in `src/lib/electrobun/bridge.ts`
- shared frontend Fish client in `src/lib/tts/fish-client.ts`

The SvelteKit routes remain as fallback/reference code for non-Electrobun contexts.

## Recommended migration order

1. Keep this port focused on `webwaifu3` + desktop shell only.
2. Do not port window/taskbar sitting into Electrobun.
3. Make the shell boot reliably using the local runtime shim.
4. Validate the new Bun/Electrobun Fish RPC path end-to-end in the actual shell.
5. Only after the app boots cleanly, turn on transparency/passthrough.

## Practical recommendation

For this repo, the sane split is:

- `JSMATE` stays the Windows-native experimental desktop-pet app
- `electrobun-webwaifu3` becomes the cross-platform avatar/chat shell

That keeps product scope coherent:

- if you want best pet behavior: use `Mate-Engine`
- if you want best cross-platform web shell: use Electrobun

Trying to make one codebase be both at the same time is what keeps making this balloon.

## Next concrete steps

1. Re-run `electrobun build` and `electrobun dev` after the runtime shim change.
2. If bundling passes, verify `views://mainview/index.html` loads.
3. Replace `/api/tts/fish*` calls with a Bun RPC or external service base URL.
4. Add transparency only after the app boots normally.
