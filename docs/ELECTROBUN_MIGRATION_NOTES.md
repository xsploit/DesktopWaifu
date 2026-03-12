This folder is a staging port of `NetHoe` / `webwaifu3` into an Electrobun shell.

Current status:
- NetHoe frontend copied in as the migration baseline.
- SvelteKit switched from Vercel adapter to static output in `dist/`.
- Electrobun main-process entry added in `src/bun/index.ts`.
- Electrobun build config added in `electrobun.config.ts`.
- Local Electrobun import shim added in `src/bun/electrobun-runtime.ts`.
- Fish TTS moved off the SvelteKit-only route dependency path.
- Bun-side Fish RPC handlers now live in `src/bun/fish.ts`.
- Frontend Fish calls now go through `src/lib/tts/fish-client.ts`, which prefers Electrobun RPC and falls back to the old HTTP routes.
- `bun run build` now succeeds on this machine.
- `bun run check` also passes, with one pre-existing Svelte deprecation warning.

What is still not done:
- Transparency/passthrough has not been enabled yet on purpose.
- The app has been built and launcher output generated, but Fish TTS has not been driven manually end-to-end in the Electrobun shell yet.
- The old SvelteKit Fish routes remain in `src/routes/api/tts/` as fallback/reference code, but the Electrobun desktop path should no longer depend on them.

Important local Electrobun findings:
- The local `file:` Electrobun package does not currently resolve `electrobun/bun`
  correctly during Bun bundling on this machine.
- The shim works around that by importing from the installed Windows runtime path.
- Importing Electrobun's top-level runtime also pulled in a WebGPU path that crashed
  at startup, so the shim only re-exports `BrowserWindow` and `Updater`.

Recommended next steps:
1. Manually validate Fish TTS in the Electrobun shell:
   - model list
   - search
   - create voice
   - test voice
   - streamed chat-to-TTS
2. Decide whether to patch the local Electrobun package exports properly or keep the
   current shim during migration.
3. After shell/TTS behavior is stable, turn on transparency and click behavior.
4. Only after that, consider tray/hotkeys/window polish.

Useful commands:
```powershell
bun run check
bun run build
.\build\dev-win-x64\webwaifu3-electrobun-dev\bin\launcher.exe
```

For deeper background, see:
- `ELECTROBUN_RESEARCH.md`
