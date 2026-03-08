import { FishAudioClient, RealtimeEvents, type Backends } from 'fish-audio';
import type {
	FishAudioFormat,
	FishCreateVoiceParams,
	FishDeleteModelParams,
	FishListModelsParams,
	FishModelInfo,
	FishSearchModelsParams,
	FishStreamAbortParams,
	FishStreamChunkPayload,
	FishStreamFinishParams,
	FishStreamStartParams,
	FishSynthesizeParams,
	WebWaifuElectrobunRPC
} from '../lib/electrobun/rpc-schema.js';

type FishRpcHandlers = {
	requests: {
		[K in keyof WebWaifuElectrobunRPC['bun']['requests']]: (
			params: WebWaifuElectrobunRPC['bun']['requests'][K]['params']
		) => Promise<WebWaifuElectrobunRPC['bun']['requests'][K]['response']>;
	};
	messages: {
		[K in keyof WebWaifuElectrobunRPC['bun']['messages']]: (
			payload: WebWaifuElectrobunRPC['bun']['messages'][K]
		) => void | Promise<void>;
	};
	dispose(): void;
};

interface FishRpcCallbacks {
	sendAudioChunk(payload: WebWaifuElectrobunRPC['webview']['messages']['fishStreamAudioChunk']): void;
	sendComplete(payload: WebWaifuElectrobunRPC['webview']['messages']['fishStreamComplete']): void;
	sendError(payload: WebWaifuElectrobunRPC['webview']['messages']['fishStreamError']): void;
}

interface FishStreamQueue {
	stream(): AsyncGenerator<string>;
	push(text: string): void;
	close(): void;
	abort(): void;
}

interface FishStreamSession {
	queue: FishStreamQueue;
	connection: Awaited<ReturnType<FishAudioClient['textToSpeech']['convertRealtime']>>;
	finished: boolean;
	completion: Promise<void>;
}

function bytesToBase64(bytes: Uint8Array) {
	return Buffer.from(bytes).toString('base64');
}

function base64ToBytes(base64: string) {
	return new Uint8Array(Buffer.from(base64, 'base64'));
}

function contentTypeForFormat(format: FishAudioFormat) {
	switch (format) {
		case 'wav':
			return 'audio/wav';
		case 'pcm':
			return 'audio/pcm';
		case 'opus':
			return 'audio/opus';
		default:
			return 'audio/mpeg';
	}
}

function normalizeSampleRate(value: unknown) {
	if (value == null || value === '') return undefined;
	const parsed = typeof value === 'number' ? value : Number(value);
	if (!Number.isFinite(parsed)) return undefined;
	const rounded = Math.round(parsed);
	return rounded > 0 ? rounded : undefined;
}

async function collectAudioBuffer(stream: ReadableStream<Uint8Array>) {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value && value.length > 0) {
			chunks.push(value);
		}
	}

	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
	const audio = new Uint8Array(totalLength);
	let offset = 0;
	for (const chunk of chunks) {
		audio.set(chunk, offset);
		offset += chunk.length;
	}
	return audio;
}

function createFishClient(apiKey: string) {
	return new FishAudioClient({ apiKey });
}

function mapFishModels(items: unknown[]) {
	return items.map((item: any): FishModelInfo => ({
		id: item._id,
		name: item.title || item._id,
		author: item.author?.nickname,
		languages: Array.isArray(item.languages) ? item.languages : undefined,
		state: typeof item.state === 'string' ? item.state : undefined
	}));
}

function createTextQueue(): FishStreamQueue {
	const queued: string[] = [];
	let closed = false;
	let wake: (() => void) | null = null;

	const notify = () => {
		const pending = wake;
		wake = null;
		pending?.();
	};

	return {
		async *stream() {
			while (!closed || queued.length > 0) {
				if (queued.length === 0) {
					await new Promise<void>((resolve) => {
						wake = resolve;
					});
					continue;
				}
				const next = queued.shift();
				if (next) {
					yield next;
				}
			}
		},
		push(text: string) {
			if (closed) {
				throw new Error('Fish stream session is already closed');
			}
			queued.push(text);
			notify();
		},
		close() {
			closed = true;
			notify();
		},
		abort() {
			queued.length = 0;
			closed = true;
			notify();
		}
	};
}

async function listModels(params: FishListModelsParams) {
	if (!params.apiKey) return { items: [] };
	const client = createFishClient(params.apiKey);
	const result = await client.voices.search({
		page_size: 100,
		self: true
	});
	return { items: mapFishModels(result.items || []) };
}

async function searchModels(params: FishSearchModelsParams) {
	if (!params.apiKey) return { items: [] };
	const client = createFishClient(params.apiKey);
	const result = await client.voices.search({
		page_size: 20,
		title: params.query || '',
		self: false
	});
	return { items: mapFishModels(result.items || []) };
}

async function createVoice(params: FishCreateVoiceParams) {
	const client = createFishClient(params.apiKey);
	const file = new File([base64ToBytes(params.audioBase64)], params.fileName, {
		type: params.mimeType || 'audio/wav'
	});
	const result = await client.voices.ivc.create({
		title: params.title,
		voices: [file],
		visibility: 'private',
		train_mode: 'fast',
		enhance_audio_quality: true
	});
	return {
		id: result._id,
		title: result.title || params.title
	};
}

async function deleteModel(params: FishDeleteModelParams) {
	const client = createFishClient(params.apiKey);
	await client.voices.delete(params.modelId);
	return { ok: true as const };
}

async function synthesize(params: FishSynthesizeParams) {
	if (!params.text || !params.apiKey) {
		throw new Error('text and apiKey required');
	}

	const format = params.format || 'mp3';
	const sampleRate = normalizeSampleRate(params.sampleRate);
	const client = createFishClient(params.apiKey);
	const stream = await client.textToSpeech.convert(
		{
			text: params.text,
			format,
			sample_rate: sampleRate,
			mp3_bitrate: 128,
			chunk_length: 200,
			normalize: true,
			latency: params.latency || 'balanced',
			reference_id: params.referenceId || undefined,
			prosody: { speed: 1.0, volume: 0.0 }
		},
		(params.model || 'speech-1.5') as Backends
	);
	const audio = await collectAudioBuffer(stream);
	return {
		audioBase64: bytesToBase64(audio),
		contentType: contentTypeForFormat(format),
		sampleRate
	};
}

function createRealtimeSession(
	params: FishStreamStartParams,
	callbacks: FishRpcCallbacks,
	onSettled: () => void
) {
	const queue = createTextQueue();
	const client = createFishClient(params.apiKey);
	const format = params.format || 'pcm';
	const sampleRate = normalizeSampleRate(params.sampleRate);

	return client.textToSpeech.convertRealtime(
		{
			text: '',
			reference_id: params.referenceId || undefined,
			format,
			sample_rate: sampleRate,
			mp3_bitrate: 128,
			chunk_length: 200,
			normalize: true,
			latency: params.latency || 'balanced',
			prosody: { speed: 1.0, volume: 0.0 },
			condition_on_previous_chunks: true,
			top_p: 0.7,
			temperature: 0.7,
			repetition_penalty: 1.2,
			max_new_tokens: 1024,
			min_chunk_length: 50,
			early_stop_threshold: 1.0
		},
		queue.stream(),
		(params.model || 's1') as Backends
	).then((connection) => {
		let settled = false;
		const settle = (fn: () => void) => {
			if (settled) return;
			settled = true;
			try {
				fn();
			} finally {
				onSettled();
			}
		};

		const completion = new Promise<void>((resolve, reject) => {
			connection.on(RealtimeEvents.AUDIO_CHUNK, (data: unknown) => {
				if (!(data instanceof Uint8Array) && !Buffer.isBuffer(data)) return;
				const chunk = data instanceof Uint8Array ? data : new Uint8Array(data);
				callbacks.sendAudioChunk({
					streamId: params.streamId,
					audioBase64: bytesToBase64(chunk),
					contentType: contentTypeForFormat(format),
					sampleRate
				});
			});

			connection.on(RealtimeEvents.ERROR, (error: unknown) => {
				const normalized = error instanceof Error ? error : new Error(String(error));
				settle(() => {
					callbacks.sendError({
						streamId: params.streamId,
						error: normalized.message
					});
					reject(normalized);
				});
			});

			connection.on(RealtimeEvents.CLOSE, () => {
				settle(() => {
					callbacks.sendComplete({ streamId: params.streamId });
					resolve();
				});
			});
		});

		return {
			queue,
			connection,
			finished: false,
			completion
		} satisfies FishStreamSession;
	});
}

export function createFishRpcHandlers(callbacks: FishRpcCallbacks): FishRpcHandlers {
	const sessions = new Map<string, FishStreamSession>();

	const requests: FishRpcHandlers['requests'] = {
		fishListModels: listModels,
		fishSearchModels: searchModels,
		fishCreateVoice: createVoice,
		fishDeleteModel: deleteModel,
		fishSynthesize: synthesize,
		async fishStreamStart(params: FishStreamStartParams) {
			if (sessions.has(params.streamId)) {
				throw new Error(`Fish stream session already exists: ${params.streamId}`);
			}
			const session = await createRealtimeSession(params, callbacks, () => {
				sessions.delete(params.streamId);
			});
			sessions.set(params.streamId, session);
			return { ok: true as const };
		},
		async fishStreamFinish(params: FishStreamFinishParams) {
			const session = sessions.get(params.streamId);
			if (!session) {
				return { ok: true as const };
			}
			session.finished = true;
			session.queue.close();
			return { ok: true as const };
		},
		async fishStreamAbort(params: FishStreamAbortParams) {
			const session = sessions.get(params.streamId);
			if (!session) {
				return { ok: true as const };
			}
			session.queue.abort();
			try {
				session.connection.close();
			} catch {
				// Ignore teardown failures during abort.
			}
			return { ok: true as const };
		}
	};

	const messages: FishRpcHandlers['messages'] = {
		fishStreamChunk(payload: FishStreamChunkPayload) {
			const session = sessions.get(payload.streamId);
			if (!session) {
				throw new Error(`Missing Fish stream session: ${payload.streamId}`);
			}
			session.queue.push(payload.text);
		}
	};

	return {
		requests,
		messages,
		dispose() {
			for (const session of sessions.values()) {
				session.queue.abort();
				try {
					session.connection.close();
				} catch {
					// Ignore shutdown failures during app exit.
				}
			}
			sessions.clear();
		}
	};
}
