import { getElectrobunRpc } from '../electrobun/bridge.js';
import type {
	FishAudioFormat,
	FishBackendModel,
	FishCreateVoiceParams,
	FishLatencyMode,
	FishListModelsParams,
	FishModelInfo,
	FishSearchModelsParams,
	FishSynthesizeParams
} from '../electrobun/rpc-schema.js';

export interface FishSynthesizeOptions {
	apiKey: string;
	text: string;
	referenceId?: string;
	model?: FishBackendModel;
	format?: FishAudioFormat;
	latency?: FishLatencyMode;
	sampleRate?: number;
}

export interface FishSynthesizeResult {
	audioBlob: Blob;
	contentType: string;
	sampleRate?: number;
}

export interface FishRealtimeConfig {
	apiKey: string;
	referenceId?: string;
	model?: FishBackendModel;
	format?: FishAudioFormat;
	latency?: FishLatencyMode;
	sampleRate?: number;
}

export interface FishRealtimeSessionHandlers {
	onAudioChunk: (chunk: Uint8Array, meta: { contentType: string; sampleRate?: number }) => void;
	onComplete?: () => void;
	onError?: (error: Error) => void;
}

export interface FishRealtimeSession {
	write(text: string): Promise<void>;
	close(): Promise<void>;
	abort(): Promise<void>;
	completion: Promise<void>;
}

function bytesToBase64(bytes: Uint8Array) {
	let binary = '';
	const chunkSize = 0x8000;
	for (let index = 0; index < bytes.length; index += chunkSize) {
		const chunk = bytes.subarray(index, index + chunkSize);
		binary += String.fromCharCode(...chunk);
	}
	return btoa(binary);
}

function base64ToBytes(base64: string) {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

async function fileToBase64(file: File) {
	const bytes = new Uint8Array(await file.arrayBuffer());
	return bytesToBase64(bytes);
}

async function postFishJson<TResponse>(body: Record<string, unknown>) {
	const response = await fetch('/api/tts/fish', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(String((data as Record<string, unknown>).error || response.statusText || 'Fish request failed'));
	}
	return data as TResponse;
}

export async function listFishModels(apiKey: string) {
	if (!apiKey) return [];
	const rpc = await getElectrobunRpc();
	if (rpc) {
		const params: FishListModelsParams = { apiKey };
		const response = await rpc.request.fishListModels(params);
		return response.items;
	}
	const response = await postFishJson<{ items?: FishModelInfo[] }>({
		action: 'list-models',
		apiKey
	});
	return response.items || [];
}

export async function searchFishModels(apiKey: string, query: string) {
	if (!apiKey) return [];
	const rpc = await getElectrobunRpc();
	if (rpc) {
		const params: FishSearchModelsParams = { apiKey, query };
		const response = await rpc.request.fishSearchModels(params);
		return response.items;
	}
	const response = await postFishJson<{ items?: FishModelInfo[] }>({
		action: 'search-models',
		apiKey,
		query
	});
	return response.items || [];
}

export async function createFishVoice(apiKey: string, title: string, file: File) {
	if (!apiKey) throw new Error('Fish Audio API key is required');
	const rpc = await getElectrobunRpc();
	if (rpc) {
		const params: FishCreateVoiceParams = {
			apiKey,
			title,
			fileName: file.name || 'voice.wav',
			mimeType: file.type || 'audio/wav',
			audioBase64: await fileToBase64(file)
		};
		return rpc.request.fishCreateVoice(params);
	}

	const formData = new FormData();
	formData.append('apiKey', apiKey);
	formData.append('title', title);
	formData.append('voice', file);

	const response = await fetch('/api/tts/fish', {
		method: 'POST',
		body: formData
	});
	const data = await response.json().catch(() => ({}));
	if (!response.ok) {
		throw new Error(String((data as Record<string, unknown>).error || response.statusText || 'Fish voice create failed'));
	}
	return data as { id: string; title: string };
}

export async function deleteFishModel(apiKey: string, modelId: string) {
	if (!apiKey) throw new Error('Fish Audio API key is required');
	const rpc = await getElectrobunRpc();
	if (rpc) {
		await rpc.request.fishDeleteModel({ apiKey, modelId });
		return;
	}
	await postFishJson({
		action: 'delete-model',
		apiKey,
		modelId
	});
}

export async function synthesizeFishAudio(options: FishSynthesizeOptions): Promise<FishSynthesizeResult> {
	const rpc = await getElectrobunRpc();
	if (rpc) {
		const params: FishSynthesizeParams = {
			apiKey: options.apiKey,
			text: options.text,
			referenceId: options.referenceId,
			model: options.model,
			format: options.format,
			latency: options.latency,
			sampleRate: options.sampleRate
		};
		const result = await rpc.request.fishSynthesize(params);
		const bytes = base64ToBytes(result.audioBase64);
		return {
			audioBlob: new Blob([bytes], { type: result.contentType }),
			contentType: result.contentType,
			sampleRate: result.sampleRate
		};
	}

	const response = await fetch('/api/tts/fish', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(options)
	});
	if (!response.ok) {
		const err = await response.json().catch(() => ({ error: response.statusText }));
		throw new Error(String((err as Record<string, unknown>).error || `Fish Audio error ${response.status}`));
	}
	return {
		audioBlob: await response.blob(),
		contentType: response.headers.get('Content-Type') || options.format || 'audio/mpeg',
		sampleRate: options.sampleRate
	};
}

export async function createFishRealtimeSession(
	config: FishRealtimeConfig,
	handlers: FishRealtimeSessionHandlers
): Promise<FishRealtimeSession | null> {
	const rpc = await getElectrobunRpc();
	if (!rpc) return null;

	const streamId = crypto.randomUUID();

	let resolveCompletion!: () => void;
	let rejectCompletion!: (error: Error) => void;
	let settled = false;
	const completion = new Promise<void>((resolve, reject) => {
		resolveCompletion = resolve;
		rejectCompletion = reject;
	});

	const cleanup = () => {
		rpc.removeMessageListener('fishStreamAudioChunk', onAudioChunk);
		rpc.removeMessageListener('fishStreamComplete', onComplete);
		rpc.removeMessageListener('fishStreamError', onError);
	};

	const settleResolve = () => {
		if (settled) return;
		settled = true;
		cleanup();
		resolveCompletion();
	};

	const settleReject = (error: Error) => {
		if (settled) return;
		settled = true;
		cleanup();
		rejectCompletion(error);
	};

	const onAudioChunk = (payload: { streamId: string; audioBase64: string; contentType: string; sampleRate?: number }) => {
		if (payload.streamId !== streamId) return;
		handlers.onAudioChunk(base64ToBytes(payload.audioBase64), {
			contentType: payload.contentType,
			sampleRate: payload.sampleRate
		});
	};

	const onComplete = (payload: { streamId: string }) => {
		if (payload.streamId !== streamId) return;
		handlers.onComplete?.();
		settleResolve();
	};

	const onError = (payload: { streamId: string; error: string }) => {
		if (payload.streamId !== streamId) return;
		const error = new Error(payload.error || 'Fish realtime session failed');
		handlers.onError?.(error);
		settleReject(error);
	};

	rpc.addMessageListener('fishStreamAudioChunk', onAudioChunk);
	rpc.addMessageListener('fishStreamComplete', onComplete);
	rpc.addMessageListener('fishStreamError', onError);

	try {
		await rpc.request.fishStreamStart({
			streamId,
			apiKey: config.apiKey,
			referenceId: config.referenceId,
			model: config.model,
			format: config.format,
			latency: config.latency,
			sampleRate: config.sampleRate
		});
	} catch (error) {
		const normalized = error instanceof Error ? error : new Error(String(error));
		settleReject(normalized);
		throw normalized;
	}

	return {
		async write(text: string) {
			if (!text.trim()) return;
			rpc.send.fishStreamChunk({ streamId, text });
		},
		async close() {
			if (settled) return completion;
			await rpc.request.fishStreamFinish({ streamId });
			return completion;
		},
		async abort() {
			try {
				await rpc.request.fishStreamAbort({ streamId });
			} finally {
				if (!settled) {
					settleResolve();
				}
			}
		},
		completion
	};
}
