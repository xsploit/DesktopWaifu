import type { WebWaifuElectrobunRPC } from './rpc-schema.js';

type ElectrobunRpcInstance = {
	request: {
		[K in keyof WebWaifuElectrobunRPC['bun']['requests']]: (
			params: WebWaifuElectrobunRPC['bun']['requests'][K]['params']
		) => Promise<WebWaifuElectrobunRPC['bun']['requests'][K]['response']>;
	};
	send: {
		[K in keyof WebWaifuElectrobunRPC['webview']['messages']]: (
			payload: WebWaifuElectrobunRPC['webview']['messages'][K]
		) => void;
	} & {
		[K in keyof WebWaifuElectrobunRPC['bun']['messages']]: (
			payload: WebWaifuElectrobunRPC['bun']['messages'][K]
		) => void;
	};
	addMessageListener: <K extends keyof WebWaifuElectrobunRPC['webview']['messages']>(
		message: K,
		listener: (payload: WebWaifuElectrobunRPC['webview']['messages'][K]) => void
	) => void;
	removeMessageListener: <K extends keyof WebWaifuElectrobunRPC['webview']['messages']>(
		message: K,
		listener: (payload: WebWaifuElectrobunRPC['webview']['messages'][K]) => void
	) => void;
};

type BrowserElectrobunModule = {
	Electroview: {
		defineRPC<Schema>(config: {
			handlers: {
				requests?: Record<string, never>;
				messages?: Record<string, (...args: unknown[]) => void>;
			};
		}): ElectrobunRpcInstance;
		new(config: { rpc: ElectrobunRpcInstance }): unknown;
	};
};

let rpcPromise: Promise<ElectrobunRpcInstance | null> | null = null;

export function isElectrobunRuntime() {
	if (typeof window === 'undefined') return false;
	const globalWindow = window as typeof window & {
		__electrobun?: unknown;
		__electrobunWebviewId?: number;
	};
	return Boolean(globalWindow.__electrobun && globalWindow.__electrobunWebviewId);
}

export async function getElectrobunRpc() {
	if (!isElectrobunRuntime()) return null;
	if (rpcPromise) return rpcPromise;

	rpcPromise = (async () => {
		const mod = await import('../../../node_modules/electrobun/dist-win-x64/api/browser/index.ts') as unknown as BrowserElectrobunModule;
		const rpc = mod.Electroview.defineRPC<WebWaifuElectrobunRPC>({
			handlers: {
				requests: {},
				messages: {}
			}
		});
		new mod.Electroview({ rpc });
		return rpc;
	})().catch((error) => {
		console.error('[Electrobun] Failed to initialize browser RPC bridge:', error);
		rpcPromise = null;
		return null;
	});

	return rpcPromise;
}
