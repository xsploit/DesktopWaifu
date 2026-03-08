import { BrowserView, BrowserWindow, Updater } from './electrobun-runtime';
import { createFishRpcHandlers } from './fish.js';
import type { WebWaifuElectrobunRPC } from '../lib/electrobun/rpc-schema.js';

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
	const channel = await Updater.localInfo.channel();
	if (channel === 'dev') {
		try {
			await fetch(DEV_SERVER_URL, { method: 'HEAD' });
			console.log(`HMR enabled: using Vite dev server at ${DEV_SERVER_URL}`);
			return DEV_SERVER_URL;
		} catch {
			console.log('Vite dev server not running. Run "bun run dev:hmr" for HMR.');
		}
	}

	return 'views://mainview/index.html';
}

const url = await getMainViewUrl();

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
		requests: fishRpcHandlers.requests,
		messages: fishRpcHandlers.messages
	}
});

const mainWindow = new BrowserWindow({
	title: 'WEBWAIFU 3',
	url,
	rpc: appRpc,
	frame: {
		width: 1440,
		height: 960,
		x: 120,
		y: 80,
	},
	transparent: true,
});

console.log('WEBWAIFU 3 Electrobun shell started');
console.log('Main window id:', mainWindow.id);
