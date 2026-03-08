<script lang="ts">
	import { onMount } from 'svelte';
	import VrmCanvas from '$lib/components/VrmCanvas.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import ChatBar from '$lib/components/ChatBar.svelte';
	import MenuFab from '$lib/components/MenuFab.svelte';
	import Toast from '$lib/components/Toast.svelte';
	import ChatLog from '$lib/components/ChatLog.svelte';
	import SpeechBubble from '$lib/components/SpeechBubble.svelte';
	import SplashModal from '$lib/components/SplashModal.svelte';
	import { getElectrobunRpc } from '$lib/electrobun/bridge.js';
	import type {
		ElectrobunWindowFrame,
		ElectrobunWindowInteractionState,
		ShellControlActionPayload
	} from '$lib/electrobun/rpc-schema.js';
	import {
		getChat,
		getVrmState,
		getVrmVisuals,
		getLlmSettings,
		getTtsSettings,
		getCharacterState,
		getSettingsPanel,
		getSequencerState,
		getSttState,
		getModelList,
		getMemoryState,
		toast,
		addLog
	} from '$lib/stores/app.svelte.js';
	import { getLlmClient } from '$lib/llm/client.js';
	import { getTtsManager } from '$lib/tts/manager.js';
	import { getStorageManager } from '$lib/storage/index.js';
	import { getAnimationSequencer, DEFAULT_ANIMATIONS } from '$lib/vrm/sequencer.js';
	import { getMemoryManager } from '$lib/memory/manager.js';
	import { configureSttController, initializeSttModel, toggleSttRecording } from '$lib/stt/controller.js';
	import type { ChatMessage } from '$lib/llm/client.js';

	const chat = getChat();
	const vrmState = getVrmState();
	const llmSettings = getLlmSettings();
	const ttsSettings = getTtsSettings();
	const chars = getCharacterState();
	const panel = getSettingsPanel();
	const seqState = getSequencerState();
	const sttState = getSttState();
	const models = getModelList();
	const visuals = getVrmVisuals();
	const ttsManager = getTtsManager();
	const sequencer = getAnimationSequencer();
	const memState = getMemoryState();
	const memoryManager = getMemoryManager();
	const MIN_WINDOW_WIDTH = 1100;
	const MIN_WINDOW_HEIGHT = 720;
	const UI_REFERENCE_WIDTH = 1720;
	const UI_REFERENCE_HEIGHT = 1480;
	const UI_MIN_SCALE = 0.54;

	type ResizeDirection = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

	let vrmCanvas: VrmCanvas;
	let uiScale = $state(1);
	let uiStageWidth = $state(1);
	let uiStageHeight = $state(1);
	let interactiveChromeVisible = $state(true);
	let interactiveChromeHideTimer: ReturnType<typeof setTimeout> | null = null;
	let windowInteraction = $state<ElectrobunWindowInteractionState>({
		clickThrough: false,
		alwaysOnTop: true
	});
	const storage = getStorageManager();
	const INTERACTIVE_CHROME_IDLE_MS = 10000;

	function clearInteractiveChromeHideTimer() {
		if (interactiveChromeHideTimer) {
			clearTimeout(interactiveChromeHideTimer);
			interactiveChromeHideTimer = null;
		}
	}

	function scheduleInteractiveChromeHide() {
		clearInteractiveChromeHideTimer();
		if (windowInteraction.clickThrough) return;
		interactiveChromeHideTimer = setTimeout(() => {
			interactiveChromeVisible = false;
		}, INTERACTIVE_CHROME_IDLE_MS);
	}

	function revealInteractiveChrome(force = false) {
		if (windowInteraction.clickThrough && !force) {
			return;
		}
		interactiveChromeVisible = true;
		scheduleInteractiveChromeHide();
	}

	function isInteractiveSurface(target: EventTarget | null): boolean {
		if (!(target instanceof Element)) return false;
		return !!target.closest(
			[
				'#settings-panel',
				'#chat-container',
				'.log-toggle',
				'.log-panel',
				'.speech-bubble',
				'.splash-overlay',
				'#menu-fab',
				'.mgr-btn',
				'.resize-hitbox',
				'button',
				'a',
				'input',
				'textarea',
				'select',
				'label',
				'summary'
			].join(', ')
		);
	}

	function applyWindowInteractionState(
		nextState: ElectrobunWindowInteractionState,
		options: { revealOnInteractive?: boolean } = {}
	) {
		const previousClickThrough = windowInteraction.clickThrough;
		windowInteraction = nextState;

		if (nextState.clickThrough) {
			panel.open = false;
			chat.logOpen = false;
			clearInteractiveChromeHideTimer();
			interactiveChromeVisible = false;
			return;
		}

		if (options.revealOnInteractive || previousClickThrough) {
			revealInteractiveChrome(true);
		}
	}

	async function startWindowResize(direction: ResizeDirection, event: PointerEvent) {
		event.preventDefault();
		event.stopPropagation();
		revealInteractiveChrome(true);

		const rpc = await getElectrobunRpc();
		if (!rpc) return;

		const startFrame = await rpc.request.windowGetFrame({});
		const startScreenX = event.screenX;
		const startScreenY = event.screenY;
		const scaleX = startFrame.width / Math.max(window.innerWidth || 1, 1);
		const scaleY = startFrame.height / Math.max(window.innerHeight || 1, 1);
		let nextFrame: ElectrobunWindowFrame = { ...startFrame };
		let rafId = 0;

		const flushResize = () => {
			rafId = 0;
			void rpc.request.windowSetFrame(nextFrame);
		};

		const onPointerMove = (moveEvent: PointerEvent) => {
			const dx = Math.round((moveEvent.screenX - startScreenX) * scaleX);
			const dy = Math.round((moveEvent.screenY - startScreenY) * scaleY);
			const frame = { ...startFrame };

			if (direction.includes('e')) {
				frame.width = Math.max(MIN_WINDOW_WIDTH, startFrame.width + dx);
			}
			if (direction.includes('s')) {
				frame.height = Math.max(MIN_WINDOW_HEIGHT, startFrame.height + dy);
			}
			if (direction.includes('w')) {
				frame.width = Math.max(MIN_WINDOW_WIDTH, startFrame.width - dx);
				frame.x = startFrame.x + (startFrame.width - frame.width);
			}
			if (direction.includes('n')) {
				frame.height = Math.max(MIN_WINDOW_HEIGHT, startFrame.height - dy);
				frame.y = startFrame.y + (startFrame.height - frame.height);
			}

			nextFrame = frame;
			if (!rafId) {
				rafId = requestAnimationFrame(flushResize);
			}
		};

		const onPointerUp = () => {
			window.removeEventListener('pointermove', onPointerMove);
			window.removeEventListener('pointerup', onPointerUp);
			if (rafId) {
				cancelAnimationFrame(rafId);
			}
			void rpc.request.windowSetFrame(nextFrame);
		};

		window.addEventListener('pointermove', onPointerMove);
		window.addEventListener('pointerup', onPointerUp, { once: true });
	}

	function revokeBlobUrl(url: string | null | undefined) {
		if (url && url.startsWith('blob:')) {
			try {
				URL.revokeObjectURL(url);
			} catch {
				// ignore invalid/expired URL revocation
			}
		}
	}

	function toChatMessage(message: { role: string; content: string }): ChatMessage | null {
		if (message.role === 'system' || message.role === 'user' || message.role === 'assistant') {
			return { role: message.role, content: message.content };
		}
		return null;
	}

	const TTS_FORMATTING_RULES = [
		'Never use emojis, emoticons, or unicode symbols in your responses.',
		'Use proper punctuation and natural sentence structure.',
		'Do not use asterisks for actions or emphasis (e.g. *giggles* or **bold**).',
		'Do not use markdown formatting, bullet points, or numbered lists.',
		'Write in flowing, spoken prose — your text will be read aloud by a TTS engine.',
		'Avoid parenthetical asides, ellipsis chains, or excessive exclamation marks.',
		'Keep responses concise — 1 to 3 short sentences unless asked for more detail.'
	].join(' ');

	function getEffectiveSystemPrompt(): string {
		const character = chars.current?.systemPrompt?.trim() ?? '';
		const nickname = chars.current?.userNickname?.trim();

		const parts: string[] = [];
		if (character) parts.push(character);
		if (nickname) parts.push(`The user's preferred name is "${nickname}". Address them by this name naturally when appropriate.`);
		if (ttsSettings.enabled) parts.push(TTS_FORMATTING_RULES);

		return parts.join('\n\n');
	}

	async function loadAndCommitVrm(url: string): Promise<boolean> {
		const previousUrl = vrmState.vrmUrl;
		const loaded = await vrmCanvas?.loadVrmFromUrl(url);
		if (!loaded) return false;
		if (previousUrl !== url) {
			revokeBlobUrl(previousUrl);
		}
		vrmState.vrmUrl = url;
		return true;
	}

	// Initialize playlist on first load
	if (seqState.playlist.length === 0) {
		seqState.playlist = DEFAULT_ANIMATIONS.map(a => ({ ...a }));
	}

	async function handleSend(message: string) {
		if (chat.isGenerating) return;

		chat.history = [...chat.history, { role: 'user', content: message }];
		chat.isGenerating = true;
		addLog(`User: ${message.slice(0, 60)}...`, 'info');
		addLog(`LLM: ${llmSettings.provider}/${llmSettings.model} @ ${llmSettings.endpoint}`, 'info');
		if (!llmSettings.model) addLog('No model selected!', 'err');
		if (!llmSettings.apiKey && (llmSettings.provider === 'openai' || llmSettings.provider === 'openrouter')) {
			addLog(`No API key set for ${llmSettings.provider}!`, 'err');
		}
		let turnConversationId: number | null = null;

		try {
			const savedId = await storage.saveCurrentConversation($state.snapshot(chat.history));
			if (typeof savedId === 'number') {
				turnConversationId = savedId;
			}
		} catch (e) {
			console.warn('[Conversation] Failed to persist user message:', e);
		}

		try {
			const client = getLlmClient();
			const effectiveSystemPrompt = getEffectiveSystemPrompt();
			client.provider = llmSettings.provider;
			client.model = llmSettings.model;
			client.apiKey = llmSettings.apiKey;
			client.endpoint = llmSettings.endpoint;
			client.systemPrompt = effectiveSystemPrompt;
			client.temperature = llmSettings.temperature;
			client.maxTokens = llmSettings.maxTokens;
			client.numCtx = llmSettings.numCtx;
			client.flashAttn = llmSettings.flashAttn;
			client.kvCacheType = llmSettings.kvCacheType;

			if (llmSettings.streaming) {
				chat.streamingText = '';
				client.onStreamChunk = (delta: string) => {
					chat.streamingText += delta;
					if (ttsSettings.enabled) {
						ttsManager.enqueueStreamChunk(delta);
					}
				};
			}

			client.onResponseReceived = async (text: string) => {
				console.log('[LLM Response]', text);
				chat.streamingText = '';
				chat.history = [...chat.history, { role: 'assistant', content: text }];
				addLog(`AI: ${text.slice(0, 60)}...`, 'info');
				void storage.saveCurrentConversation($state.snapshot(chat.history))
					.then((savedId) => {
						if (typeof savedId === 'number') turnConversationId = savedId;
					})
					.catch((e) => {
						console.warn('[Conversation] Failed to persist assistant message:', e);
					});
				if (ttsSettings.enabled) {
					if (llmSettings.streaming) {
						ttsManager.enqueueStreamChunk('', true);
					} else {
						ttsManager.speak(text);
					}
				}
				// Embed assistant response for memory
				if (memState.enabled && memoryManager.modelReady) {
					const currentConvoId = turnConversationId ?? await storage.getSetting('currentConversationId');
					if (typeof currentConvoId === 'number') {
						void memoryManager.addMessage('assistant', text, currentConvoId, chat.history.length - 1);
						void memoryManager.pruneAndSummarize(currentConvoId);
					}
				}
			};

			client.onError = (err: Error) => {
				toast('LLM Error: ' + err.message);
				addLog('LLM Error: ' + err.message, 'err');
			};

			// Configure TTS before sending
			if (ttsSettings.enabled) {
				ttsManager.provider = ttsSettings.provider;
				if (ttsSettings.provider === 'kokoro') {
					ttsManager.kokoroVoice = ttsSettings.kokoroVoice as any;
					ttsManager.kokoroDtype = ttsSettings.kokoroDtype as any;
					ttsManager.kokoroDevice =
						ttsSettings.kokoroDevice === 'auto' ? null : ttsSettings.kokoroDevice as any;
				}
				if (ttsSettings.provider === 'fish') {
					ttsManager.fishApiKey = ttsSettings.fishApiKey;
					ttsManager.fishVoiceId = ttsSettings.fishVoiceId;
					ttsManager.fishModel = ttsSettings.fishModel as any;
				}
				if (ttsSettings.provider === 'qwen') {
					ttsManager.qwenEndpoint = ttsSettings.qwenEndpoint;
					ttsManager.qwenLanguage = ttsSettings.qwenLanguage;
					ttsManager.qwenVoiceId = ttsSettings.qwenVoiceId;
					ttsManager.qwenLatencyMode = ttsSettings.qwenLatencyMode;
					ttsManager.qwenEmitEveryFrames = ttsSettings.qwenEmitEveryFrames;
					ttsManager.qwenDecodeWindowFrames = ttsSettings.qwenDecodeWindowFrames;
					ttsManager.qwenOverlapSamples = ttsSettings.qwenOverlapSamples;
					ttsManager.qwenMaxFrames = ttsSettings.qwenMaxFrames;
					ttsManager.qwenUseOptimizedDecode = ttsSettings.qwenUseOptimizedDecode;
				}

				ttsManager.enableTts = true;
			}

			// Build context with memory system if enabled
			let contextMessages: ChatMessage[] | undefined;
			if (memState.enabled && memoryManager.modelReady) {
				try {
					const rawContextMessages = await memoryManager.buildContext(
						message,
						chat.history.slice(0, -1), // exclude the user message we just added
						effectiveSystemPrompt
					);
					contextMessages = rawContextMessages
						.map(toChatMessage)
						.filter((m): m is ChatMessage => m !== null);
					// Embed the user message
					const currentConvoId = turnConversationId ?? await storage.getSetting('currentConversationId');
					if (typeof currentConvoId === 'number') {
						void memoryManager.addMessage('user', message, currentConvoId, chat.history.length - 1);
					}
				} catch (e) {
					console.error('[Memory] buildContext failed, falling back:', e);
				}
			}

			await client.generateResponse(message, null, { contextMessages });
		} catch (err: any) {
			toast('Error: ' + err.message);
			addLog('Error: ' + err.message, 'err');
		} finally {
			chat.streamingText = '';
			chat.isGenerating = false;
		}
	}

	onMount(() => {
		configureSttController({ onSend: handleSend });
		let uiScaleFrame = 0;

		function updateUiScale() {
			const viewport = window.visualViewport;
			const width = Math.max(1, viewport?.width || window.innerWidth || 1);
			const height = Math.max(1, viewport?.height || window.innerHeight || 1);
			const fit = Math.min(width / UI_REFERENCE_WIDTH, height / UI_REFERENCE_HEIGHT);
			uiScale = Math.min(1, Math.max(UI_MIN_SCALE, Math.max(fit, 0.01)));
			uiStageWidth = width;
			uiStageHeight = height;
		}

		function scheduleUiScaleUpdate() {
			if (uiScaleFrame) cancelAnimationFrame(uiScaleFrame);
			uiScaleFrame = requestAnimationFrame(() => {
				uiScaleFrame = 0;
				updateUiScale();
				revealInteractiveChrome(true);
			});
		}

		function handleUiActivity() {
			revealInteractiveChrome();
		}

		function handleChatVisibilityToggle() {
			chat.toggleVisible();
		}

		function handleGlobalKeydown(event: KeyboardEvent) {
			handleUiActivity();
			if (event.key === 'F6') {
				event.preventDefault();
				handleChatVisibilityToggle();
			}
		}

		async function handleShellControlAction(payload: ShellControlActionPayload) {
			if (payload.action === 'toggle-stt') {
				await toggleSttRecording('hotkey');
				return;
			}

			if (payload.action === 'toggle-chat') {
				handleChatVisibilityToggle();
				return;
			}

			if (payload.action === 'reveal-controls') {
				revealInteractiveChrome(true);
			}
		}

		const rpcCleanup: Array<() => void> = [];

		void (async () => {
			const rpc = await getElectrobunRpc();
			if (!rpc) return;

			const onWindowInteractionChanged = (payload: ElectrobunWindowInteractionState) => {
				applyWindowInteractionState(payload, { revealOnInteractive: false });
			};
			const onShellControlAction = (payload: ShellControlActionPayload) => {
				void handleShellControlAction(payload);
			};

			rpc.addMessageListener('windowInteractionChanged', onWindowInteractionChanged);
			rpc.addMessageListener('shellControlAction', onShellControlAction);
			rpcCleanup.push(() => {
				rpc.removeMessageListener('windowInteractionChanged', onWindowInteractionChanged);
				rpc.removeMessageListener('shellControlAction', onShellControlAction);
			});

			const initialInteraction = await rpc.request.windowGetInteractionState({});
			applyWindowInteractionState(initialInteraction, { revealOnInteractive: false });
		})();

		updateUiScale();
		revealInteractiveChrome(true);
		window.addEventListener('resize', scheduleUiScaleUpdate);
		window.visualViewport?.addEventListener('resize', scheduleUiScaleUpdate);
		window.visualViewport?.addEventListener('scroll', scheduleUiScaleUpdate);
		const viewportResizeObserver = new ResizeObserver(() => scheduleUiScaleUpdate());
		viewportResizeObserver.observe(document.documentElement);
		window.addEventListener('pointermove', handleUiActivity, { passive: true });
		window.addEventListener('pointerdown', handleUiActivity, { passive: true });
		window.addEventListener('touchstart', handleUiActivity, { passive: true });
		window.addEventListener('keydown', handleGlobalKeydown);

		// Initialize storage and load saved settings
		storage.initialize().then(async () => {
			try {
				await storage.initializeDefaultCharacters();
				const state = await storage.loadAppState();

				if (state.llm) {
					// Migrate legacy -responses variants to base provider name
					llmSettings.provider = (state.llm.provider?.replace('-responses', '') || 'ollama') as any;
					llmSettings.model = state.llm.model;
					llmSettings.apiKey = state.llm.apiKey;
					llmSettings.endpoint = state.llm.endpoint;
					llmSettings.temperature = state.llm.temperature;
					llmSettings.maxTokens = state.llm.maxTokens;
					if (state.llm.streaming !== undefined) llmSettings.streaming = state.llm.streaming;
					if (state.llm.numCtx !== undefined) llmSettings.numCtx = state.llm.numCtx;
					if (state.llm.flashAttn !== undefined) llmSettings.flashAttn = state.llm.flashAttn;
					if (state.llm.kvCacheType !== undefined) llmSettings.kvCacheType = state.llm.kvCacheType;
				}

				// Apply per-provider defaults from manager page (manager is canonical for API keys)
				const providerDefaults = await storage.getSetting('manager.providerDefaults', {});
				if (providerDefaults[llmSettings.provider]) {
					const d = providerDefaults[llmSettings.provider];
					llmSettings.apiKey = d.apiKey ?? llmSettings.apiKey;
					llmSettings.endpoint = d.endpoint ?? llmSettings.endpoint;
					llmSettings.model = d.model ?? llmSettings.model;
				}
				if (state.tts) {
					ttsSettings.provider = state.tts.provider ?? ttsSettings.provider;
					ttsSettings.kokoroVoice = state.tts.kokoroVoice ?? ttsSettings.kokoroVoice;
					ttsSettings.kokoroDtype = state.tts.kokoroDtype ?? ttsSettings.kokoroDtype;
					ttsSettings.kokoroDevice = state.tts.kokoroDevice ?? ttsSettings.kokoroDevice;
					ttsSettings.fishVoiceId = state.tts.fishVoiceId ?? '';
					ttsSettings.fishLatency = state.tts.fishLatency ?? ttsSettings.fishLatency;
					ttsSettings.qwenEndpoint = state.tts.qwenEndpoint ?? ttsSettings.qwenEndpoint;
					ttsSettings.qwenLanguage = state.tts.qwenLanguage ?? ttsSettings.qwenLanguage;
					ttsSettings.qwenVoiceId = state.tts.qwenVoiceId ?? ttsSettings.qwenVoiceId;
					ttsSettings.qwenQualityPreset = state.tts.qwenQualityPreset ?? ttsSettings.qwenQualityPreset;
					ttsSettings.qwenLatencyMode = state.tts.qwenLatencyMode ?? ttsSettings.qwenLatencyMode;
					ttsSettings.qwenEmitEveryFrames = state.tts.qwenEmitEveryFrames ?? ttsSettings.qwenEmitEveryFrames;
					ttsSettings.qwenDecodeWindowFrames = state.tts.qwenDecodeWindowFrames ?? ttsSettings.qwenDecodeWindowFrames;
					ttsSettings.qwenOverlapSamples = state.tts.qwenOverlapSamples ?? ttsSettings.qwenOverlapSamples;
					ttsSettings.qwenMaxFrames = state.tts.qwenMaxFrames ?? ttsSettings.qwenMaxFrames;
					ttsSettings.qwenUseOptimizedDecode = state.tts.qwenUseOptimizedDecode ?? ttsSettings.qwenUseOptimizedDecode;
					ttsSettings.fishApiKey = state.tts.fishApiKey ?? '';
					ttsSettings.enabled = state.tts.enabled ?? ttsSettings.enabled;
					ttsSettings.fishModel = state.tts.fishModel ?? ttsSettings.fishModel;
					ttsSettings.fishSavedVoices = state.tts.fishSavedVoices ?? [];
				}
				if (state.stt) {
					sttState.enabled = state.stt.enabled;
					sttState.autoSend = state.stt.autoSend;

					// Auto-init Whisper model if STT was enabled
					if (state.stt.enabled) {
						void initializeSttModel().catch((e) => {
							console.error('[STT] Auto-init failed:', e);
						});
					}
				}
				if (state.sequencer) {
					seqState.speed = state.sequencer.speed;
					seqState.duration = state.sequencer.duration;
					seqState.shuffle = state.sequencer.shuffle;
					seqState.loop = state.sequencer.loop;
				}
				if (state.ui) {
					if (state.ui.settingsPanelOpen !== undefined) {
						panel.open = !!state.ui.settingsPanelOpen;
					}
					if (typeof state.ui.activeTab === 'string' && state.ui.activeTab.trim().length > 0) {
						panel.activeTab = state.ui.activeTab;
					}
				}

				// Restore visual settings (post-processing, shaders, lighting)
				if (state.visuals) {
					const v = state.visuals;
					// VRM state props
					if (v.realisticMode !== undefined) vrmState.realisticMode = v.realisticMode;
					if (v.autoRotate !== undefined) vrmState.autoRotate = v.autoRotate;
					if (v.crossfadeDuration !== undefined) vrmState.crossfadeDuration = v.crossfadeDuration;
					if (v.postProcessingEnabled !== undefined) vrmState.postProcessingEnabled = v.postProcessingEnabled;
					// Toggles
					if (v.outline !== undefined) { visuals.outline = v.outline; vrmState.useOutlineEffect = v.outline; }
					if (v.bloom !== undefined) visuals.bloom = v.bloom;
					if (v.chroma !== undefined) visuals.chroma = v.chroma;
					if (v.grain !== undefined) visuals.grain = v.grain;
					if (v.glitch !== undefined) visuals.glitch = v.glitch;
					if (v.fxaa !== undefined) visuals.fxaa = v.fxaa;
					if (v.smaa !== undefined) visuals.smaa = v.smaa;
					if (v.taa !== undefined) visuals.taa = v.taa;
					if (v.bleach !== undefined) visuals.bleach = v.bleach;
					if (v.colorCorr !== undefined) visuals.colorCorr = v.colorCorr;
					// Shader uniforms
					if (v.bloomStrength !== undefined) visuals.bloomStrength = v.bloomStrength;
					if (v.bloomRadius !== undefined) visuals.bloomRadius = v.bloomRadius;
					if (v.bloomThreshold !== undefined) visuals.bloomThreshold = v.bloomThreshold;
					if (v.chromaAmount !== undefined) visuals.chromaAmount = v.chromaAmount;
					if (v.chromaAngle !== undefined) visuals.chromaAngle = v.chromaAngle;
					if (v.grainAmount !== undefined) visuals.grainAmount = v.grainAmount;
					if (v.vignetteAmount !== undefined) visuals.vignetteAmount = v.vignetteAmount;
					if (v.vignetteHardness !== undefined) visuals.vignetteHardness = v.vignetteHardness;
					if (v.bleachOpacity !== undefined) visuals.bleachOpacity = v.bleachOpacity;
					if (v.colorPowR !== undefined) visuals.colorPowR = v.colorPowR;
					if (v.colorPowG !== undefined) visuals.colorPowG = v.colorPowG;
					if (v.colorPowB !== undefined) visuals.colorPowB = v.colorPowB;
					if (v.taaSampleLevel !== undefined) visuals.taaSampleLevel = v.taaSampleLevel;
					// Lighting
					if (v.keyLight !== undefined) visuals.keyLight = v.keyLight;
					if (v.fillLight !== undefined) visuals.fillLight = v.fillLight;
					if (v.rimLight !== undefined) visuals.rimLight = v.rimLight;
					if (v.hemiLight !== undefined) visuals.hemiLight = v.hemiLight;
					if (v.ambientLight !== undefined) visuals.ambientLight = v.ambientLight;

					// Apply pass toggles and uniforms to the scene after a tick
					setTimeout(() => {
						// Toggle passes
						const passToggles: Record<string, boolean> = {
							bloom: visuals.bloom, chromatic: visuals.chroma, grain: visuals.grain,
							glitch: visuals.glitch, fxaa: visuals.fxaa, smaa: visuals.smaa,
							taa: visuals.taa, bleach: visuals.bleach, colorCorrection: visuals.colorCorr
						};
						for (const [name, enabled] of Object.entries(passToggles)) {
							window.dispatchEvent(new CustomEvent('webwaifu3:toggle-pass', { detail: { name, enabled } }));
						}
						// Shader uniforms
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'bloom', uniform: 'strength', value: visuals.bloomStrength } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'bloom', uniform: 'radius', value: visuals.bloomRadius } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'bloom', uniform: 'threshold', value: visuals.bloomThreshold } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'chromatic', uniform: 'amount', value: visuals.chromaAmount } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'chromatic', uniform: 'angle', value: visuals.chromaAngle } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'grain', uniform: 'grainAmount', value: visuals.grainAmount } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'grain', uniform: 'vignetteAmount', value: visuals.vignetteAmount } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'grain', uniform: 'vignetteHardness', value: visuals.vignetteHardness } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'bleach', uniform: 'opacity', value: visuals.bleachOpacity } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'colorCorrection', uniform: 'powR', value: visuals.colorPowR } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'colorCorrection', uniform: 'powG', value: visuals.colorPowG } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'colorCorrection', uniform: 'powB', value: visuals.colorPowB } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:pass-uniform', { detail: { name: 'taa', uniform: 'sampleLevel', value: visuals.taaSampleLevel } }));
						// Lighting
						window.dispatchEvent(new CustomEvent('webwaifu3:light', { detail: { light: 'key', value: visuals.keyLight } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:light', { detail: { light: 'fill', value: visuals.fillLight } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:light', { detail: { light: 'rim', value: visuals.rimLight } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:light', { detail: { light: 'hemi', value: visuals.hemiLight } }));
						window.dispatchEvent(new CustomEvent('webwaifu3:light', { detail: { light: 'ambient', value: visuals.ambientLight } }));
					}, 100);
				}

				// Restore playlist enabled states
				if (state.playlistEnabled) {
					seqState.playlist = seqState.playlist.map(a => ({
						...a,
						enabled: state.playlistEnabled![a.id] ?? a.enabled
					}));
				}

				const allChars = await storage.getAllCharacters();
				chars.all = allChars;
				if (state.character) {
					chars.current = state.character;
				} else if (allChars.length > 0) {
					chars.current = allChars[0];
				}

				if (state.conversation?.messages) {
					chat.history = state.conversation.messages;
				}

				// Apply loaded settings to TTS manager singleton
				ttsManager.provider = ttsSettings.provider;
				ttsManager.enableTts = ttsSettings.enabled;
				if (ttsSettings.provider === 'kokoro') {
					const isMobile = window.matchMedia('(max-width: 900px)').matches;
					if (isMobile) {
						// Kokoro WebGPU/WASM is too heavy for mobile — switch to Fish
						ttsSettings.provider = 'fish';
						ttsManager.provider = 'fish';
						addLog('Kokoro disabled on mobile — switched to Fish Audio', 'warn');
					} else {
						ttsManager.kokoroVoice = ttsSettings.kokoroVoice as any;
						ttsManager.kokoroDtype = ttsSettings.kokoroDtype as any;
						ttsManager.kokoroDevice =
							ttsSettings.kokoroDevice === 'auto' ? null : ttsSettings.kokoroDevice as any;
						// Auto-init Kokoro worker so TTS is ready on first message
						if (!ttsManager.kokoroReadyInWorker && !ttsManager.ttsWorker) {
							ttsManager.initKokoroInWorker({
								dtype: ttsSettings.kokoroDtype as any,
								device: ttsSettings.kokoroDevice === 'auto' ? null : ttsSettings.kokoroDevice as any
							});
						}
					}
				}
				if (ttsSettings.provider === 'fish') {
					ttsManager.fishApiKey = ttsSettings.fishApiKey;
					ttsManager.fishVoiceId = ttsSettings.fishVoiceId;
					ttsManager.fishModel = ttsSettings.fishModel as any;
				}
				if (ttsSettings.provider === 'qwen') {
					ttsManager.qwenEndpoint = ttsSettings.qwenEndpoint;
					ttsManager.qwenLanguage = ttsSettings.qwenLanguage;
					ttsManager.qwenVoiceId = ttsSettings.qwenVoiceId;
					ttsManager.qwenLatencyMode = ttsSettings.qwenLatencyMode;
					ttsManager.qwenEmitEveryFrames = ttsSettings.qwenEmitEveryFrames;
					ttsManager.qwenDecodeWindowFrames = ttsSettings.qwenDecodeWindowFrames;
					ttsManager.qwenOverlapSamples = ttsSettings.qwenOverlapSamples;
					ttsManager.qwenMaxFrames = ttsSettings.qwenMaxFrames;
					ttsManager.qwenUseOptimizedDecode = ttsSettings.qwenUseOptimizedDecode;
				}

				// Load memory settings
				if (state.memory) {
					memState.enabled = state.memory.enabled;
					memState.mode = state.memory.mode;
					memState.maxContext = state.memory.maxContext;
					memState.windowSize = state.memory.windowSize;
					memState.topK = state.memory.topK;
					memState.similarityThreshold = state.memory.similarityThreshold;
					memState.summarizationProvider = state.memory.summarizationProvider;
					memState.summarizationModel = state.memory.summarizationModel;
					memState.summarizationApiKey = state.memory.summarizationApiKey;
					memState.summarizationEndpoint = state.memory.summarizationEndpoint;

					// Wire memory manager
					memoryManager.enabled = state.memory.enabled;
					memoryManager.mode = state.memory.mode;
					memoryManager.maxContextMessages = state.memory.maxContext;
					memoryManager.windowSize = state.memory.windowSize;
					memoryManager.topK = state.memory.topK;
					memoryManager.similarityThreshold = state.memory.similarityThreshold;
					memoryManager.summarizationProvider = state.memory.summarizationProvider as any;
					memoryManager.summarizationModel = state.memory.summarizationModel;
					memoryManager.summarizationApiKey = state.memory.summarizationApiKey;
					memoryManager.summarizationEndpoint = state.memory.summarizationEndpoint;

					// Auto-init embedding model if memory was enabled
					if (state.memory.enabled) {
						memState.modelLoading = true;
						memoryManager.initEmbeddingModel().then(() => {
							memState.modelReady = true;
							memState.modelLoading = false;
							addLog('Embedding model auto-loaded', 'info');
						}).catch((e) => {
							memState.modelLoading = false;
							console.error('[Memory] Auto-init failed:', e);
						});
					}
				}


				// Restore saved VRM model
				const savedVrmUrl = state.vrmUrl || '/assets/hikkyc2.vrm';
				if (savedVrmUrl === 'idb://vrmFile') {
					const fileData = await storage.getVrmFile();
					if (fileData) {
						const blob = new Blob([fileData], { type: 'application/octet-stream' });
						const blobUrl = URL.createObjectURL(blob);
						const loaded = await loadAndCommitVrm(blobUrl);
						if (!loaded) {
							revokeBlobUrl(blobUrl);
							await loadAndCommitVrm('/assets/hikkyc2.vrm');
						}
					} else {
						await loadAndCommitVrm('/assets/hikkyc2.vrm');
					}
				} else {
					const loaded = await loadAndCommitVrm(savedVrmUrl);
					if (!loaded) {
						await loadAndCommitVrm('/assets/hikkyc2.vrm');
					}
				}
			} catch (e) {
				console.error('Failed to load settings:', e);
				// Fallback: load default VRM
				await loadAndCommitVrm('/assets/hikkyc2.vrm');
			}
			// Auto-fetch models for configured providers
			if (models.models.length === 0) {
				const client = getLlmClient();
				client.provider = llmSettings.provider;
				client.apiKey = llmSettings.apiKey;
				client.endpoint = llmSettings.endpoint;
				client.fetchModels().then((fetched) => {
					if (fetched.length > 0) {
						models.models = fetched;
						addLog(`Auto-loaded ${fetched.length} models`, 'info');
					}
				}).catch(() => { /* silent fail on auto-fetch */ });
			}

			addLog('Storage initialized', 'info');
		});

		// Wire up custom events from VrmTab/AnimTab to VrmCanvas
		async function onLoadVrm(e: Event) {
			// Stop sequencer when loading new VRM
			sequencer.stop();
			seqState.playing = false;
			seqState.currentIndex = -1;
			const detail = (e as CustomEvent).detail;
			const url = typeof detail === 'string' ? detail : detail.url;
			const fileData: ArrayBuffer | undefined = typeof detail === 'string' ? undefined : detail.fileData;

			try {
				const loaded = await loadAndCommitVrm(url);
				if (!loaded) {
					if (url.startsWith('blob:')) revokeBlobUrl(url);
					return;
				}

				// Persist VRM choice
				if (fileData) {
					await storage.saveVrmFile(fileData);
					await storage.setSetting('vrmUrl', 'idb://vrmFile');
				} else {
					await storage.clearVrmFile();
					await storage.setSetting('vrmUrl', url);
				}
			} catch (err) {
				console.error('[VRM] Failed to load:', err);
				toast('Failed to load VRM model');
				if (url.startsWith('blob:')) revokeBlobUrl(url);
			}
		}

		function onLoadAnim(e: Event) {
			const url = (e as CustomEvent).detail;
			vrmCanvas?.loadAnimationFromUrl(url);
		}

		function onTogglePass(e: Event) {
			const { name, enabled } = (e as CustomEvent).detail;
			const ppRefs = vrmCanvas?.getPostProcessingRefs();
			if (!ppRefs) return;
			const passMap: Record<string, any> = {
				bloom: ppRefs.bloomPass,
				chromatic: ppRefs.chromaticAberrationPass,
				grain: ppRefs.filmGrainPass,
				glitch: ppRefs.glitchPass,
				fxaa: ppRefs.fxaaPass,
				smaa: ppRefs.smaaPass,
				taa: ppRefs.taaPass,
				bleach: ppRefs.bleachBypassPass,
				colorCorrection: ppRefs.colorCorrectionPass
			};
			const pass = passMap[name];
			if (pass) pass.enabled = enabled;
		}

		function onPassUniform(e: Event) {
			const { name, uniform, value } = (e as CustomEvent).detail;
			const ppRefs = vrmCanvas?.getPostProcessingRefs();
			if (!ppRefs) return;
			const passMap: Record<string, any> = {
				bloom: ppRefs.bloomPass,
				chromatic: ppRefs.chromaticAberrationPass,
				grain: ppRefs.filmGrainPass,
				bleach: ppRefs.bleachBypassPass,
				colorCorrection: ppRefs.colorCorrectionPass,
				taa: ppRefs.taaPass
			};
			const pass = passMap[name];
			if (!pass) return;

			// Special handling for bloom pass properties
			if (name === 'bloom') {
				if (uniform === 'strength') pass.strength = value;
				else if (uniform === 'radius') pass.radius = value;
				else if (uniform === 'threshold') pass.threshold = value;
			} else if (name === 'taa') {
				if (uniform === 'sampleLevel') pass.sampleLevel = value;
			} else if (pass.uniforms?.[uniform]) {
				pass.uniforms[uniform].value = value;
			}
		}

		function onLight(e: Event) {
			const { light, value } = (e as CustomEvent).detail;
			const sceneRefs = vrmCanvas?.getSceneRefs();
			if (!sceneRefs) return;
			const lightMap: Record<string, any> = {
				key: sceneRefs.key,
				fill: sceneRefs.fill,
				rim: sceneRefs.rim,
				hemi: sceneRefs.hemi,
				ambient: sceneRefs.ambient
			};
			const l = lightMap[light];
			if (l) l.intensity = value;
		}

		// Sequencer events
		function onSeqStart() {
			sequencer.onAdvance = (entry, index) => {
				seqState.currentIndex = index;
				vrmCanvas?.loadAnimationFromUrl(entry.url);
				addLog(`Sequencer: ${entry.name}`, 'info');
			};
			sequencer.start(seqState.playlist, {
				shuffle: seqState.shuffle,
				loop: seqState.loop,
				duration: seqState.duration
			});
			seqState.playing = true;
		}

		function onSeqStop() {
			sequencer.stop();
			seqState.playing = false;
			seqState.currentIndex = -1;
		}

		function onSeqPlayOne(e: Event) {
			const { url, index } = (e as CustomEvent).detail;
			seqState.currentIndex = index;
			vrmCanvas?.loadAnimationFromUrl(url);
		}

		window.addEventListener('webwaifu3:load-vrm', onLoadVrm);
		window.addEventListener('webwaifu3:load-anim', onLoadAnim);
		window.addEventListener('webwaifu3:toggle-pass', onTogglePass);
		window.addEventListener('webwaifu3:pass-uniform', onPassUniform);
		window.addEventListener('webwaifu3:light', onLight);
		window.addEventListener('webwaifu3:sequencer-start', onSeqStart);
		window.addEventListener('webwaifu3:sequencer-stop', onSeqStop);
		window.addEventListener('webwaifu3:sequencer-play-one', onSeqPlayOne);

		toast('WEBWAIFU 3 initialized');

		return () => {
			clearInteractiveChromeHideTimer();
			if (uiScaleFrame) {
				cancelAnimationFrame(uiScaleFrame);
			}
			viewportResizeObserver.disconnect();
			window.removeEventListener('resize', scheduleUiScaleUpdate);
			window.visualViewport?.removeEventListener('resize', scheduleUiScaleUpdate);
			window.visualViewport?.removeEventListener('scroll', scheduleUiScaleUpdate);
			window.removeEventListener('pointermove', handleUiActivity);
			window.removeEventListener('pointerdown', handleUiActivity);
			window.removeEventListener('touchstart', handleUiActivity);
			window.removeEventListener('keydown', handleGlobalKeydown);
			rpcCleanup.forEach((dispose) => dispose());
			window.removeEventListener('webwaifu3:load-vrm', onLoadVrm);
			window.removeEventListener('webwaifu3:load-anim', onLoadAnim);
			window.removeEventListener('webwaifu3:toggle-pass', onTogglePass);
			window.removeEventListener('webwaifu3:pass-uniform', onPassUniform);
			window.removeEventListener('webwaifu3:light', onLight);
			window.removeEventListener('webwaifu3:sequencer-start', onSeqStart);
			window.removeEventListener('webwaifu3:sequencer-stop', onSeqStop);
			window.removeEventListener('webwaifu3:sequencer-play-one', onSeqPlayOne);
			sequencer.stop();
			revokeBlobUrl(vrmState.vrmUrl);
		};
	});

	// Auto-save settings when they change (debounced to avoid excessive IDB writes)
	let saveTimer: ReturnType<typeof setTimeout> | null = null;
	let saveChain: Promise<void> = Promise.resolve();
	$effect(() => {
		// IMPORTANT: Read ALL reactive deps FIRST, before any non-reactive guard.
		// storage.db is NOT reactive ($state), so if we return early before reading
		// reactive vars, the $effect never subscribes and never re-runs — settings
		// would never be saved.

		// Build playlist enabled map
		const playlistEnabled: Record<string, boolean> = {};
		for (const a of seqState.playlist) {
			playlistEnabled[a.id] = a.enabled;
		}

		// Capture all reactive values to establish Svelte 5 dependency tracking
		const snapshot = {
			llm: {
				provider: llmSettings.provider,
				model: llmSettings.model,
				apiKey: llmSettings.apiKey,
				endpoint: llmSettings.endpoint,
				temperature: llmSettings.temperature,
				maxTokens: llmSettings.maxTokens,
				streaming: llmSettings.streaming,
				numCtx: llmSettings.numCtx,
				flashAttn: llmSettings.flashAttn,
				kvCacheType: llmSettings.kvCacheType
			},
			tts: {
				provider: ttsSettings.provider,
				kokoroVoice: ttsSettings.kokoroVoice,
				kokoroDtype: ttsSettings.kokoroDtype,
				kokoroDevice: ttsSettings.kokoroDevice,
				fishVoiceId: ttsSettings.fishVoiceId,
				fishLatency: ttsSettings.fishLatency,
				qwenEndpoint: ttsSettings.qwenEndpoint,
				qwenLanguage: ttsSettings.qwenLanguage,
				qwenVoiceId: ttsSettings.qwenVoiceId,
				qwenQualityPreset: ttsSettings.qwenQualityPreset,
				qwenLatencyMode: ttsSettings.qwenLatencyMode,
				qwenEmitEveryFrames: ttsSettings.qwenEmitEveryFrames,
				qwenDecodeWindowFrames: ttsSettings.qwenDecodeWindowFrames,
				qwenOverlapSamples: ttsSettings.qwenOverlapSamples,
				qwenMaxFrames: ttsSettings.qwenMaxFrames,
				qwenUseOptimizedDecode: ttsSettings.qwenUseOptimizedDecode,
				fishApiKey: ttsSettings.fishApiKey,
				enabled: ttsSettings.enabled,
				fishModel: ttsSettings.fishModel,
				fishSavedVoices: $state.snapshot(ttsSettings.fishSavedVoices)
			},
			stt: {
				enabled: sttState.enabled,
				autoSend: sttState.autoSend
			},
			sequencer: {
				speed: seqState.speed,
				duration: seqState.duration,
				shuffle: seqState.shuffle,
				loop: seqState.loop
			},
			visuals: {
				realisticMode: vrmState.realisticMode, autoRotate: vrmState.autoRotate,
				crossfadeDuration: vrmState.crossfadeDuration, postProcessingEnabled: vrmState.postProcessingEnabled,
				outline: visuals.outline, bloom: visuals.bloom, chroma: visuals.chroma,
				grain: visuals.grain, glitch: visuals.glitch, fxaa: visuals.fxaa,
				smaa: visuals.smaa, taa: visuals.taa, bleach: visuals.bleach, colorCorr: visuals.colorCorr,
				bloomStrength: visuals.bloomStrength, bloomRadius: visuals.bloomRadius, bloomThreshold: visuals.bloomThreshold,
				chromaAmount: visuals.chromaAmount, chromaAngle: visuals.chromaAngle,
				grainAmount: visuals.grainAmount, vignetteAmount: visuals.vignetteAmount, vignetteHardness: visuals.vignetteHardness,
				bleachOpacity: visuals.bleachOpacity, colorPowR: visuals.colorPowR, colorPowG: visuals.colorPowG, colorPowB: visuals.colorPowB,
				taaSampleLevel: visuals.taaSampleLevel,
				keyLight: visuals.keyLight, fillLight: visuals.fillLight, rimLight: visuals.rimLight,
				hemiLight: visuals.hemiLight, ambientLight: visuals.ambientLight
			},
			ui: {
				settingsPanelOpen: panel.open,
				activeTab: panel.activeTab
			},
			playlistEnabled,
			character: chars.current,
			conversation: $state.snapshot(chat.history),
			memory: {
				enabled: memState.enabled,
				mode: memState.mode,
				maxContext: memState.maxContext,
				windowSize: memState.windowSize,
				topK: memState.topK,
				similarityThreshold: memState.similarityThreshold,
				summarizationProvider: memState.summarizationProvider,
				summarizationModel: memState.summarizationModel,
				summarizationApiKey: memState.summarizationApiKey,
				summarizationEndpoint: memState.summarizationEndpoint
			}
		};

		// NOW check non-reactive guard — deps are already tracked above
		if (!storage.db) return;

		// Debounce: wait 500ms after last change before writing to IndexedDB
		if (saveTimer) clearTimeout(saveTimer);
		saveTimer = setTimeout(() => {
			// Serialize async saves so older writes cannot finish after newer ones.
			saveChain = saveChain
				.catch(() => {
					// keep queue alive after a failed write
				})
				.then(async () => {
					await storage.saveAppState(snapshot);

					// Sync active LLM settings back to manager.providerDefaults.
					// Persist explicit empty strings so clearing credentials actually sticks.
					try {
						const defaults = await storage.getSetting('manager.providerDefaults', {});
						const provider = snapshot.llm.provider;
						defaults[provider] = {
							model: snapshot.llm.model ?? '',
							apiKey: snapshot.llm.apiKey ?? '',
							endpoint: snapshot.llm.endpoint ?? ''
						};
						await storage.setSetting('manager.providerDefaults', defaults);
					} catch {
						/* non-critical */
					}
				});
		}, 500);

		return () => {
			if (saveTimer) {
				clearTimeout(saveTimer);
				saveTimer = null;
			}
		};
	});

	function handleClickOutside() {
		if (panel.open) panel.open = false;
	}
</script>

<svelte:head>
	<title>WEBWAIFU 3 | VRM Companion</title>
</svelte:head>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="shell" class:click-through={windowInteraction.clickThrough} onclick={handleClickOutside}>
	<VrmCanvas bind:this={vrmCanvas} />
	<div class="drag-surface electrobun-webkit-app-region-drag"></div>
	<div class="resize-hitbox edge-n" onpointerdown={(event) => startWindowResize('n', event)}></div>
	<div class="resize-hitbox edge-s" onpointerdown={(event) => startWindowResize('s', event)}></div>
	<div class="resize-hitbox edge-e" onpointerdown={(event) => startWindowResize('e', event)}></div>
	<div class="resize-hitbox edge-w" onpointerdown={(event) => startWindowResize('w', event)}></div>
	<div class="resize-hitbox corner-nw" onpointerdown={(event) => startWindowResize('nw', event)}></div>
	<div class="resize-hitbox corner-ne" onpointerdown={(event) => startWindowResize('ne', event)}></div>
	<div class="resize-hitbox corner-sw" onpointerdown={(event) => startWindowResize('sw', event)}></div>
	<div class="resize-hitbox corner-se" onpointerdown={(event) => startWindowResize('se', event)}></div>
	<div class="corner-dot corner-dot-nw" class:visible={interactiveChromeVisible}></div>
	<div class="corner-dot corner-dot-ne" class:visible={interactiveChromeVisible}></div>
	<div class="corner-dot corner-dot-sw" class:visible={interactiveChromeVisible}></div>
	<div class="corner-dot corner-dot-se" class:visible={interactiveChromeVisible}></div>
	<div class="ui-viewport">
		<div
			class="ui-stage"
			style={`--ui-scale: ${uiScale}; --ui-stage-width: ${uiStageWidth}px; --ui-stage-height: ${uiStageHeight}px;`}
		>
			<div class="top-controls" class:visible={interactiveChromeVisible}>
				<a href="/manager" class="mgr-btn" title="Waifu Manager">MGR</a>
			</div>
			<ChatLog visible={interactiveChromeVisible} />
			<SpeechBubble />
			<MenuFab visible={interactiveChromeVisible} />
			<SettingsPanel />
			<ChatBar onsend={handleSend} />
			<Toast />
			<SplashModal />
		</div>
	</div>
</div>

<style>
	.shell {
		position: fixed;
		inset: 0;
		background: var(--bg-canvas);
	}

	.drag-surface {
		position: absolute;
		inset: 0;
		z-index: 1;
		pointer-events: auto;
	}

	.shell.click-through .drag-surface,
	.shell.click-through .resize-hitbox,
	.shell.click-through .corner-dot {
		pointer-events: none;
	}

	.ui-viewport {
		position: absolute;
		inset: 0;
		overflow: hidden;
		z-index: 10;
		pointer-events: none;
	}

	.ui-stage {
		position: absolute;
		inset: 0;
		width: var(--ui-stage-width, 100vw);
		height: var(--ui-stage-height, 100vh);
		--desktop-ui-scale: var(--ui-scale, 1);
		--desktop-edge-gap: clamp(10px, calc(24px * var(--desktop-ui-scale)), 24px);
		--desktop-top-gap: clamp(10px, calc(24px * var(--desktop-ui-scale)), 24px);
		--desktop-icon-size: clamp(30px, calc(48px * var(--desktop-ui-scale)), 48px);
		--desktop-chat-width: clamp(220px, calc(var(--ui-stage-width, 100vw) * 0.5), 520px);
		--desktop-chat-margin: clamp(12px, calc(28px * var(--desktop-ui-scale)), 28px);
		--desktop-panel-width: clamp(280px, calc(var(--ui-stage-width, 100vw) * 0.28), 380px);
		--desktop-panel-height: clamp(420px, calc(var(--ui-stage-height, 100vh) * 0.78), 680px);
		--desktop-bubble-width: clamp(260px, calc(var(--ui-stage-width, 100vw) * 0.34), 520px);
		transform: none;
		transform-origin: top left;
		pointer-events: none;
		will-change: auto;
	}

	.top-controls {
		position: absolute;
		top: var(--desktop-top-gap);
		left: 50%;
		display: flex;
		align-items: center;
		transform: translateX(-50%) translateY(-12px);
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 180ms ease,
			transform 220ms ease;
		z-index: 50;
	}

	.top-controls.visible {
		transform: translateX(-50%) translateY(0);
		opacity: 1;
		pointer-events: auto;
	}

	.mgr-btn {
		position: relative;
		padding: 10px 16px;
		color: var(--text-dim);
		background: color-mix(in oklab, var(--c-panel) 92%, transparent);
		border: 1px solid color-mix(in oklab, var(--c-border) 85%, transparent);
		clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
	}

	.mgr-btn::before,
	.mgr-btn::after {
		content: '';
		position: absolute;
		width: 10px;
		height: 10px;
		pointer-events: none;
		opacity: 0.85;
	}

	.mgr-btn::before {
		top: 0;
		left: 0;
		background: linear-gradient(135deg, transparent 48%, color-mix(in oklab, var(--c-text-accent) 62%, var(--c-border)) 50%);
	}

	.mgr-btn::after {
		right: 0;
		bottom: 0;
		background: linear-gradient(315deg, transparent 48%, color-mix(in oklab, var(--c-text-accent) 62%, var(--c-border)) 50%);
	}

	.mgr-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: calc(84px * var(--desktop-ui-scale));
		pointer-events: auto;
		font-family: var(--font-tech);
		font-size: clamp(0.58rem, calc(0.7rem * var(--desktop-ui-scale)), 0.7rem);
		font-weight: 600;
		letter-spacing: calc(0.15em * var(--desktop-ui-scale));
		text-transform: uppercase;
		text-decoration: none;
		color: var(--text-main);
		background: var(--c-panel);
		padding: calc(10px * var(--desktop-ui-scale)) calc(16px * var(--desktop-ui-scale));
		border: 1px solid var(--c-border);
		clip-path: polygon(8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%, 0 8px);
		transition: all 0.2s var(--ease-tech);
	}
	.mgr-btn:hover {
		color: var(--c-text-accent);
		border-color: var(--c-text-accent);
		background: color-mix(in oklab, var(--c-panel) 80%, transparent);
	}

	.resize-hitbox {
		position: absolute;
		z-index: 80;
		pointer-events: auto;
		background: transparent;
	}

	.edge-n,
	.edge-s {
		left: 12px;
		right: 12px;
		height: 8px;
	}

	.edge-e,
	.edge-w {
		top: 12px;
		bottom: 12px;
		width: 8px;
	}

	.edge-n {
		top: 0;
		cursor: ns-resize;
	}

	.edge-s {
		bottom: 0;
		cursor: ns-resize;
	}

	.edge-e {
		right: 0;
		cursor: ew-resize;
	}

	.edge-w {
		left: 0;
		cursor: ew-resize;
	}

	.corner-nw,
	.corner-ne,
	.corner-sw,
	.corner-se {
		width: 18px;
		height: 18px;
	}

	.corner-nw {
		top: 0;
		left: 0;
		cursor: nwse-resize;
	}

	.corner-ne {
		top: 0;
		right: 0;
		cursor: nesw-resize;
	}

	.corner-sw {
		left: 0;
		bottom: 0;
		cursor: nesw-resize;
	}

	.corner-se {
		right: 0;
		bottom: 0;
		cursor: nwse-resize;
	}

	.corner-dot {
		position: absolute;
		z-index: 82;
		width: 6px;
		height: 6px;
		border-radius: 999px;
		background: rgba(160, 160, 160, 0.5);
		box-shadow: 0 0 0 1px rgba(64, 64, 64, 0.14);
		pointer-events: none;
		opacity: 0;
		transition: opacity 160ms ease;
	}

	.corner-dot.visible {
		opacity: 1;
	}

	.corner-dot-nw {
		top: 4px;
		left: 4px;
	}

	.corner-dot-ne {
		top: 4px;
		right: 4px;
	}

	.corner-dot-sw {
		left: 4px;
		bottom: 4px;
	}

	.corner-dot-se {
		right: 4px;
		bottom: 4px;
	}
	@media (max-width: 900px) {
		.top-controls {
			top: calc(clamp(12px, 2vh, 24px) + var(--safe-top, 0px));
		}
	}
	@media (min-width: 901px) and (max-width: 1280px), (min-width: 901px) and (max-height: 860px) {
		.top-controls {
			top: clamp(10px, 1.8vh, 18px);
		}

		.mgr-btn {
			padding: 8px 12px;
			font-size: 0.62rem;
		}

		.mgr-btn {
			letter-spacing: 0.12em;
		}
	}
</style>
