// Local workaround for the checked-out Electrobun package.
// The file: dependency installs platform-specific runtime files under
// node_modules/electrobun/dist-win-x64/, but its package exports still point to
// ./dist/api/... which Bun cannot resolve during app bundling.
//
// Importing the top-level runtime also eagerly pulls in WGPU code that crashes
// at startup in this local build, so this shim re-exports only the modules this
// app actually needs right now.
export { BrowserWindow } from '../../node_modules/electrobun/dist-win-x64/api/bun/core/BrowserWindow.ts';
export { BrowserView } from '../../node_modules/electrobun/dist-win-x64/api/bun/core/BrowserView.ts';
export { Tray } from '../../node_modules/electrobun/dist-win-x64/api/bun/core/Tray.ts';
export { Updater } from '../../node_modules/electrobun/dist-win-x64/api/bun/core/Updater.ts';
export { GlobalShortcut, Screen, ffi } from '../../node_modules/electrobun/dist-win-x64/api/bun/proc/native.ts';
