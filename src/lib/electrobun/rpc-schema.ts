export type FishLatencyMode = 'normal' | 'balanced';
export type FishBackendModel = 's1' | 'speech-1.5' | 'speech-1.6';
export type FishAudioFormat = 'mp3' | 'wav' | 'opus' | 'pcm';

export interface FishModelInfo {
	id: string;
	name: string;
	author?: string;
	languages?: string[];
	state?: string;
}

export interface FishListModelsParams {
	apiKey: string;
}

export interface FishSearchModelsParams {
	apiKey: string;
	query: string;
}

export interface FishDeleteModelParams {
	apiKey: string;
	modelId: string;
}

export interface FishCreateVoiceParams {
	apiKey: string;
	title: string;
	fileName: string;
	mimeType: string;
	audioBase64: string;
}

export interface FishSynthesizeParams {
	apiKey: string;
	text: string;
	referenceId?: string;
	model?: FishBackendModel;
	format?: FishAudioFormat;
	latency?: FishLatencyMode;
	sampleRate?: number;
}

export interface FishSynthesizeResult {
	audioBase64: string;
	contentType: string;
	sampleRate?: number;
}

export interface FishStreamStartParams {
	streamId: string;
	apiKey: string;
	referenceId?: string;
	model?: FishBackendModel;
	format?: FishAudioFormat;
	latency?: FishLatencyMode;
	sampleRate?: number;
}

export interface FishStreamFinishParams {
	streamId: string;
}

export interface FishStreamAbortParams {
	streamId: string;
}

export interface FishStreamChunkPayload {
	streamId: string;
	text: string;
}

export interface FishStreamAudioChunkPayload {
	streamId: string;
	audioBase64: string;
	contentType: string;
	sampleRate?: number;
}

export interface FishStreamCompletePayload {
	streamId: string;
}

export interface FishStreamErrorPayload {
	streamId: string;
	error: string;
}

export interface ElectrobunWindowFrame {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface ElectrobunWindowInteractionState {
	clickThrough: boolean;
	alwaysOnTop: boolean;
}

export interface ShellControlActionPayload {
	action: 'toggle-stt' | 'toggle-chat' | 'reveal-controls';
	accelerator?: string;
	source?: 'hotkey' | 'tray' | 'shell';
}

export interface WebWaifuElectrobunRPC {
	bun: {
		requests: {
			fishListModels: {
				params: FishListModelsParams;
				response: { items: FishModelInfo[] };
			};
			fishSearchModels: {
				params: FishSearchModelsParams;
				response: { items: FishModelInfo[] };
			};
			fishCreateVoice: {
				params: FishCreateVoiceParams;
				response: { id: string; title: string };
			};
			fishDeleteModel: {
				params: FishDeleteModelParams;
				response: { ok: true };
			};
			fishSynthesize: {
				params: FishSynthesizeParams;
				response: FishSynthesizeResult;
			};
			fishStreamStart: {
				params: FishStreamStartParams;
				response: { ok: true };
			};
			fishStreamFinish: {
				params: FishStreamFinishParams;
				response: { ok: true };
			};
			fishStreamAbort: {
				params: FishStreamAbortParams;
				response: { ok: true };
			};
			windowGetFrame: {
				params: {};
				response: ElectrobunWindowFrame;
			};
			windowSetFrame: {
				params: ElectrobunWindowFrame;
				response: { ok: true };
			};
			windowStartMove: {
				params: {};
				response: { ok: true };
			};
			windowGetInteractionState: {
				params: {};
				response: ElectrobunWindowInteractionState;
			};
		};
		messages: {
			fishStreamChunk: FishStreamChunkPayload;
		};
	};
	webview: {
		requests: {};
		messages: {
			fishStreamAudioChunk: FishStreamAudioChunkPayload;
			fishStreamComplete: FishStreamCompletePayload;
			fishStreamError: FishStreamErrorPayload;
			windowInteractionChanged: ElectrobunWindowInteractionState;
			shellControlAction: ShellControlActionPayload;
		};
	};
}
