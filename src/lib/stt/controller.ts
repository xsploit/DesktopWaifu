import { getChat, getMemoryState, getSttState, addLog, toast } from '../stores/app.svelte.js';
import { getMemoryManager } from '../memory/manager.js';
import { getSttRecorder } from './recorder.js';

type SttControllerConfig = {
	onSend?: (message: string) => void;
};

const chat = getChat();
const stt = getSttState();
const memState = getMemoryState();
const recorder = getSttRecorder();
const memoryManager = getMemoryManager();

let onSendHandler: ((message: string) => void) | null = null;
let recorderCallbacksBound = false;
let toggleInFlight: Promise<void> | null = null;
let pendingStartAfterModelLoad = false;

async function startRecordingNow() {
	recorder.silenceDetection = stt.autoSend;
	if (memState.enabled && memoryManager.modelReady) {
		void memoryManager.preloadEmbeddings().catch(() => {});
	}

	await recorder.startRecording();
	stt.recording = recorder.isRecording();
	if (stt.recording) {
		addLog('STT recording started', 'info');
		toast('STT recording started');
	}
}

function bindRecorderCallbacks() {
	if (recorderCallbacksBound) return;

	recorder.onModelReady = () => {
		stt.modelLoading = false;
		stt.modelReady = true;
		toast('Whisper model ready');
		addLog('Whisper model loaded', 'info');
		if (pendingStartAfterModelLoad && stt.enabled && !stt.recording && !stt.transcribing) {
			pendingStartAfterModelLoad = false;
			void startRecordingNow().catch((err: unknown) => {
				const message = err instanceof Error ? err.message : String(err);
				stt.recording = false;
				toast('Failed to start STT: ' + message);
				addLog('STT auto-start failed: ' + message, 'err');
			});
		}
	};

	recorder.onModelError = (err) => {
		stt.modelLoading = false;
		stt.modelReady = false;
		toast('Whisper model failed: ' + err);
	};

	recorder.onError = (err) => {
		stt.recording = false;
		stt.transcribing = false;
		pendingStartAfterModelLoad = false;
		toast('STT error: ' + err);
	};

	recorder.onTranscript = (text) => {
		addLog(`STT transcript: "${text.slice(0, 60)}"`, 'info');
	};

	recorder.onAutoStop = () => {
		if (!stt.recording || toggleInFlight) return;
		void toggleSttRecording('auto-stop');
	};

	recorderCallbacksBound = true;
}

function applyTranscript(transcript: string) {
	chat.input = (chat.input ? chat.input + ' ' : '') + transcript;
	addLog(`STT: "${transcript.slice(0, 60)}"`, 'info');

	if (stt.autoSend && transcript.trim()) {
		onSendHandler?.(transcript.trim());
		chat.input = '';
	}
}

async function ensureModelReady(): Promise<'ready' | 'loading' | 'error'> {
	bindRecorderCallbacks();

	if (recorder.isModelReady()) {
		stt.modelReady = true;
		stt.modelLoading = false;
		return 'ready';
	}

	if (stt.modelLoading) {
		return 'loading';
	}

	stt.modelLoading = true;

	try {
		await recorder.initialize();
		if (!recorder.isModelReady()) {
			toast('Loading Whisper model...');
			return 'loading';
		}
		return 'ready';
	} catch (e: any) {
		stt.modelLoading = false;
		stt.modelReady = false;
		toast('Failed to init STT: ' + e.message);
		return 'error';
	}
}

async function startRecordingFlow() {
	if (!stt.enabled) {
		toast('STT is disabled');
		return;
	}

	const readyState = await ensureModelReady();
	if (readyState === 'loading') {
		pendingStartAfterModelLoad = true;
		toast('Loading Whisper model... Recording will start when ready.');
		addLog('STT requested while model loads; will auto-start when ready', 'info');
		return;
	}
	if (readyState !== 'ready') {
		return;
	}

	pendingStartAfterModelLoad = false;
	await startRecordingNow();
}

async function stopRecordingFlow() {
	pendingStartAfterModelLoad = false;
	stt.recording = false;
	stt.transcribing = true;

	try {
		const transcript = await recorder.stopRecording();
		if (transcript) {
			applyTranscript(transcript);
		}
	} catch (e: any) {
		toast('Transcription failed: ' + e.message);
	} finally {
		stt.transcribing = false;
	}
}

export function configureSttController(config: SttControllerConfig = {}) {
	if (config.onSend) {
		onSendHandler = config.onSend;
	}
	bindRecorderCallbacks();
}

export async function initializeSttModel() {
	return ensureModelReady();
}

export function isSttBusy() {
	return Boolean(toggleInFlight) || stt.modelLoading || stt.transcribing;
}

export async function toggleSttRecording(_source: 'button' | 'hotkey' | 'auto-stop' = 'button') {
	if (toggleInFlight) {
		return toggleInFlight;
	}

	toggleInFlight = (async () => {
		if (stt.transcribing) return;
		if (stt.recording) {
			await stopRecordingFlow();
			return;
		}

		await startRecordingFlow();
	})().finally(() => {
		toggleInFlight = null;
	});

	return toggleInFlight;
}
