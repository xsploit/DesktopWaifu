// Local workaround for the checked-out Electrobun package.
// Prior versions hard‑coded the platform-specific `dist-*-x64` directories,
// which led to bundler resolution errors when the variant for the current OS
// wasn't present.  The published package exposes a cross-platform API under
// `dist/api` so we can simply re‑export from there instead.
//
// We only surface the minimal subset of modules used by this app in order to
// avoid pulling in the entire runtime (and the problematic WebGPU code).
export { BrowserWindow } from '../../node_modules/electrobun/dist/api/bun/core/BrowserWindow.ts';
export { BrowserView } from '../../node_modules/electrobun/dist/api/bun/core/BrowserView.ts';
export { Tray } from '../../node_modules/electrobun/dist/api/bun/core/Tray.ts';
export { Updater } from '../../node_modules/electrobun/dist/api/bun/core/Updater.ts';
export { GlobalShortcut, Screen, ffi } from '../../node_modules/electrobun/dist/api/bun/proc/native.ts';
