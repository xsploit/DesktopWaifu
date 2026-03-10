import { existsSync } from 'fs';
import { join } from 'path';
import { BrowserView, BrowserWindow, GlobalShortcut, Screen, Tray, Updater, ffi } from './electrobun-runtime';
import { createFishRpcHandlers } from './fish.js';
import type {
	ElectrobunWindowInteractionState,
	ShellControlActionPayload,
	WebWaifuElectrobunRPC
} from '../lib/electrobun/rpc-schema.js';
import { setWindowClickThrough, refreshWindowHitTest } from './windows-click-through';

// dev server port can be overridden by environment (set by dev:web script)
const DEV_SERVER_PORT = process.env.PORT ? Number(process.env.PORT) : 5173;
// the `dev` script disables TLS when running under the Electrobun shell so
// that the webview doesn't complain about the self-signed certificate.  use
// http:// instead of https:// when ELECTROBUN_DEV is truthy.
const DEV_SERVER_PROTOCOL = process.env.ELECTROBUN_DEV ? 'http' : 'https';
const DEV_SERVER_URL = `${DEV_SERVER_PROTOCOL}://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === 'dev') {
		// wait up to a few seconds for the vite dev server to accept connections
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			try {
				await fetch(DEV_SERVER_URL, { method: 'HEAD' });
				break; // success
			} catch {
				// keep retrying until timeout
				await new Promise((r) => setTimeout(r, 200));
			}
		}
		const urlWithFlag = `${DEV_SERVER_URL}${DEV_SERVER_URL.includes('?') ? '&' : '?'}desktop=1`;
		console.log(`Dev channel: using Vite dev server at ${urlWithFlag}`);
		return urlWithFlag;
	}

	return 'views://mainview/index.html';
}

const url = await getMainViewUrl();
// on Wayland the GTK/Electrobun window backend may not provide an
// RGBA visual, resulting in an opaque black background even when
// `transparent:true` is requested.  Force X11 compatibility via
// GDK_BACKEND so that transparency works (runs under XWayland).  This is
// the same behavior you get on Windows/macOS and satisfies the "works on
// Wayland" requirement without needing core changes.
if (process.env.XDG_SESSION_TYPE === 'wayland') {
	console.warn('Wayland detected – forcing GDK_BACKEND=x11 for transparency support');
	process.env.GDK_BACKEND = 'x11';
}

const display = Screen.getPrimaryDisplay();
const displayBounds = display.bounds;

function getInitialFrame() {
	return {
		x: displayBounds.x,
		y: displayBounds.y,
		width: displayBounds.width,
		height: displayBounds.height
	};
}

const initialFrame = getInitialFrame();
const STT_TOGGLE_ACCELERATOR = 'CommandOrControl+Alt+Space';
const RECOVER_CONTROLS_ACCELERATOR = 'CommandOrControl+Alt+M';
const CHAT_TOGGLE_ACCELERATOR = 'F6';

type TrayClickEvent = {
	data?: {
		action?: string;
	};
};

let appRpc: ReturnType<typeof BrowserView.defineRPC<WebWaifuElectrobunRPC>>;
const fishRpcHandlers = createFishRpcHandlers({
	sendAudioChunk(payload) {
		appRpc.send.fishStreamAudioChunk(payload);
	},
	sendComplete(payload) {
		appRpc.send.fishStreamComplete(payload);
	},
	sendError(payload) {
		appRpc.send.fishStreamError(payload);
	}
});

appRpc = BrowserView.defineRPC<WebWaifuElectrobunRPC>({
	handlers: {
		requests: {
			...fishRpcHandlers.requests,
			windowGetFrame() {
				return mainWindow.getFrame();
			},
			windowSetFrame(frame) {
				mainWindow.setFrame(frame.x, frame.y, frame.width, frame.height);
				refreshWindowHitTest(mainWindow.ptr);
				return { ok: true as const };
			},
			windowStartMove() {
				ffi.request.startWindowMove({ id: mainWindow.id });
				return { ok: true as const };
			},
			windowGetInteractionState() {
				return getWindowInteractionState();
			},
			windowClose() {
				mainWindow.close();
				return { ok: true as const };
			}
		},
		messages: fishRpcHandlers.messages
	}
});

const mainWindow = new BrowserWindow({
	title: 'WEBWAIFU 3',
	url,
	rpc: appRpc,
	frame: initialFrame,
	titleBarStyle: 'hidden',
	transparent: true,
});

let clickThroughEnabled = false;
let alwaysOnTopPreferred = true;

function getWindowInteractionState(): ElectrobunWindowInteractionState {
	return {
		clickThrough: clickThroughEnabled,
		alwaysOnTop: clickThroughEnabled || alwaysOnTopPreferred
	};
}

function sendShellControlAction(payload: ShellControlActionPayload) {
	appRpc.send.shellControlAction(payload);
}

function emitWindowInteractionState() {
	appRpc.send.windowInteractionChanged(getWindowInteractionState());
}

function resolveTrayImage() {
	const devImagePath = join(process.cwd(), 'static', 'assets', 'desktopwaifu-icon.png');
	if (existsSync(devImagePath)) {
		return devImagePath;
	}

	return 'views://mainview/static/assets/desktopwaifu-icon.png';
}

const tray = new Tray({
	title: 'WEBWAIFU 3',
	image: resolveTrayImage(),
	template: false,
	width: 18,
	height: 18,
});

function restoreWindow() {
	if (mainWindow.isMinimized()) {
		mainWindow.unminimize();
	}
	mainWindow.focus();
}

function minimizeToTray() {
	mainWindow.minimize();
}

function syncWindowMode() {
	mainWindow.setAlwaysOnTop(clickThroughEnabled || alwaysOnTopPreferred);
	setWindowClickThrough(mainWindow.ptr, clickThroughEnabled);
	emitWindowInteractionState();
	updateTrayMenu();
}

function applyClickThrough(enabled: boolean, source: 'hotkey' | 'tray' | 'shell' = 'shell') {
	const previous = clickThroughEnabled;
	clickThroughEnabled = enabled;
	syncWindowMode();
	if (previous && !enabled) {
		sendShellControlAction({ action: 'reveal-controls', source });
	}
}

function toggleClickThrough() {
	applyClickThrough(!clickThroughEnabled, 'tray');
}

function applyAlwaysOnTop(enabled: boolean) {
	alwaysOnTopPreferred = enabled;
	syncWindowMode();
}

function toggleAlwaysOnTop() {
	applyAlwaysOnTop(!alwaysOnTopPreferred);
}

function recoverControls(source: 'hotkey' | 'tray' | 'shell' = 'shell') {
	const wasClickThrough = clickThroughEnabled;
	if (clickThroughEnabled) {
		applyClickThrough(false, source);
	}
	restoreWindow();
	if (!wasClickThrough) {
		sendShellControlAction({
			action: 'reveal-controls',
			accelerator: source === 'hotkey' ? RECOVER_CONTROLS_ACCELERATOR : undefined,
			source
		});
	}
}

function registerShortcut(accelerator: string, callback: () => void) {
	if (GlobalShortcut.isRegistered(accelerator)) {
		return;
	}
	const registered = GlobalShortcut.register(accelerator, callback);
	if (!registered) {
		console.warn(`[Electrobun] Failed to register global shortcut: ${accelerator}`);
	}
}

function updateTrayMenu() {
	const minimized = mainWindow.isMinimized();
	const effectiveAlwaysOnTop = clickThroughEnabled || alwaysOnTopPreferred;
	tray.setMenu([
		{
			type: 'normal',
			label: minimized ? 'Restore Window' : 'Minimize to Tray',
			action: minimized ? 'restore-window' : 'minimize-window',
		},
		{
			type: 'normal',
			label: clickThroughEnabled ? 'Disable Click Through' : 'Enable Click Through',
			action: 'toggle-click-through',
			checked: clickThroughEnabled,
		},
		{
			type: 'normal',
			label: clickThroughEnabled
				? 'Always On Top (forced by Click Through)'
				: 'Always On Top',
			action: 'toggle-always-on-top',
			checked: effectiveAlwaysOnTop,
		},
		{ type: 'divider' },
		{
			type: 'normal',
			label: 'Quit',
			action: 'quit-app',
		},
	]);
}

tray.on('tray-clicked', (event) => {
	const action = (event as TrayClickEvent)?.data?.action ?? '';

	switch (action) {
		case '':
		case 'restore-window':
			restoreWindow();
			sendShellControlAction({ action: 'reveal-controls', source: 'tray' });
			break;
		case 'minimize-window':
			minimizeToTray();
			break;
		case 'toggle-click-through':
			toggleClickThrough();
			break;
		case 'toggle-always-on-top':
			toggleAlwaysOnTop();
			break;
		case 'quit-app':
			mainWindow.close();
			return;
		default:
			return;
	}

	updateTrayMenu();
});

mainWindow.on('close', () => {
	GlobalShortcut.unregisterAll();
	tray.remove();
});

registerShortcut(STT_TOGGLE_ACCELERATOR, () => {
	sendShellControlAction({
		action: 'toggle-stt',
		accelerator: STT_TOGGLE_ACCELERATOR,
		source: 'hotkey'
	});
});

registerShortcut(CHAT_TOGGLE_ACCELERATOR, () => {
	sendShellControlAction({
		action: 'toggle-chat',
		accelerator: CHAT_TOGGLE_ACCELERATOR,
		source: 'hotkey'
	});
});

registerShortcut(RECOVER_CONTROLS_ACCELERATOR, () => {
	recoverControls('hotkey');
});

syncWindowMode();

console.log('WEBWAIFU 3 Electrobun shell started');
console.log('Main window id:', mainWindow.id);
