<script lang="ts">
	type QwenVoiceInfo = {
		id: string;
		name: string;
		has_ref_text?: boolean;
		created_at?: string;
		updated_at?: string;
		active?: boolean;
	};

	let {
		qwenEndpoint,
		qwenVoiceId = $bindable('')
	}: {
		qwenEndpoint: string;
		qwenVoiceId: string;
	} = $props();

	let voices = $state<QwenVoiceInfo[]>([]);
	let loadingVoices = $state(false);
	let serverChecking = $state(false);
	let serverReady = $state(false);
	let serverStatus = $state('Not checked');
	let statusMsg = $state('');

	let uploadName = $state('');
	let uploadRefText = $state('');
	let uploadActivate = $state(true);
	let uploading = $state(false);
	let uploadFileInput = $state<HTMLInputElement | null>(null);

	let pathName = $state('');
	let pathAudio = $state('');
	let pathRefText = $state('');
	let pathVoiceId = $state('');
	let pathActivate = $state(true);
	let registeringPath = $state(false);

	let manualVoiceId = $state('');

	let refreshTimer: ReturnType<typeof setTimeout> | null = null;

	function normalizeEndpoint(): string {
		const raw = (qwenEndpoint || 'http://localhost:3088').trim();
		const withScheme = /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
		return withScheme.replace(/\/+$/, '');
	}

	async function checkServer() {
		serverChecking = true;
		serverStatus = 'Checking...';
		try {
			const response = await fetch(`${normalizeEndpoint()}/v1/health`);
			if (!response.ok) {
				serverReady = false;
				serverStatus = `HTTP ${response.status}`;
				return;
			}
			const data = await response.json().catch(() => ({}));
			serverReady = Boolean(data?.ok);
			serverStatus = serverReady ? 'Ready' : (data?.last_error || 'Not ready');
			if (data?.active_voice_id) {
				qwenVoiceId = data.active_voice_id;
				manualVoiceId = data.active_voice_id;
			}
		} catch (e: any) {
			serverReady = false;
			serverStatus = e?.message || 'Server unreachable';
		} finally {
			serverChecking = false;
		}
	}

	async function loadVoices() {
		loadingVoices = true;
		try {
			const response = await fetch(`${normalizeEndpoint()}/v1/voices`);
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				voices = [];
				statusMsg = `Failed to load voices: ${data?.detail || data?.error || response.statusText}`;
				return;
			}
			voices = Array.isArray(data?.items) ? data.items : [];
			const activeVoiceId = data?.active_voice_id || voices.find(v => v.active)?.id || '';
			if (activeVoiceId) {
				qwenVoiceId = activeVoiceId;
				manualVoiceId = activeVoiceId;
			}
			statusMsg = voices.length > 0 ? `${voices.length} voice preset(s) loaded` : 'No voice presets yet';
		} catch (e: any) {
			voices = [];
			statusMsg = `Failed to load voices: ${e?.message || 'Unknown error'}`;
		} finally {
			loadingVoices = false;
		}
	}

	async function refresh() {
		statusMsg = '';
		await checkServer();
		await loadVoices();
	}

	async function selectVoice(voiceId: string) {
		const id = voiceId.trim();
		if (!id) {
			statusMsg = 'Voice ID is required';
			return;
		}
		statusMsg = '';
		try {
			const response = await fetch(`${normalizeEndpoint()}/v1/voices/select`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ voice_id: id })
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				statusMsg = `Select failed: ${data?.detail || data?.error || response.statusText}`;
				return;
			}
			qwenVoiceId = id;
			manualVoiceId = id;
			statusMsg = `Selected: ${data?.voice?.name || id}`;
			await refresh();
		} catch (e: any) {
			statusMsg = `Select failed: ${e?.message || 'Unknown error'}`;
		}
	}

	async function deleteVoice(voiceId: string) {
		statusMsg = '';
		try {
			const response = await fetch(`${normalizeEndpoint()}/v1/voices/${encodeURIComponent(voiceId)}`, {
				method: 'DELETE'
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				statusMsg = `Delete failed: ${data?.detail || data?.error || response.statusText}`;
				return;
			}
			if (qwenVoiceId === voiceId) {
				qwenVoiceId = '';
				manualVoiceId = '';
			}
			statusMsg = 'Voice deleted';
			await refresh();
		} catch (e: any) {
			statusMsg = `Delete failed: ${e?.message || 'Unknown error'}`;
		}
	}

	async function uploadVoice() {
		const file = uploadFileInput?.files?.[0];
		if (!uploadName.trim()) {
			statusMsg = 'Voice name is required';
			return;
		}
		if (!file) {
			statusMsg = 'Select an audio file first';
			return;
		}

		uploading = true;
		statusMsg = '';
		try {
			const form = new FormData();
			form.append('name', uploadName.trim());
			form.append('audio_file', file);
			form.append('activate', String(uploadActivate));
			if (uploadRefText.trim()) form.append('ref_text', uploadRefText.trim());

			const response = await fetch(`${normalizeEndpoint()}/v1/voices/upload`, {
				method: 'POST',
				body: form
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				statusMsg = `Upload failed: ${data?.detail || data?.error || response.statusText}`;
				return;
			}
			const selectedId = data?.voice?.id || '';
			if (uploadActivate && selectedId) {
				qwenVoiceId = selectedId;
				manualVoiceId = selectedId;
			}
			uploadName = '';
			uploadRefText = '';
			uploadActivate = true;
			if (uploadFileInput) uploadFileInput.value = '';
			statusMsg = `Uploaded voice: ${data?.voice?.name || selectedId || 'ok'}`;
			await refresh();
		} catch (e: any) {
			statusMsg = `Upload failed: ${e?.message || 'Unknown error'}`;
		} finally {
			uploading = false;
		}
	}

	async function registerPathVoice() {
		if (!pathName.trim()) {
			statusMsg = 'Voice name is required';
			return;
		}
		if (!pathAudio.trim()) {
			statusMsg = 'Reference audio path is required';
			return;
		}

		registeringPath = true;
		statusMsg = '';
		try {
			const payload: Record<string, any> = {
				name: pathName.trim(),
				ref_audio: pathAudio.trim(),
				activate: pathActivate
			};
			if (pathRefText.trim()) payload.ref_text = pathRefText.trim();
			if (pathVoiceId.trim()) payload.voice_id = pathVoiceId.trim();

			const response = await fetch(`${normalizeEndpoint()}/v1/voices/register-path`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(payload)
			});
			const data = await response.json().catch(() => ({}));
			if (!response.ok) {
				statusMsg = `Register path failed: ${data?.detail || data?.error || response.statusText}`;
				return;
			}
			const selectedId = data?.voice?.id || '';
			if (pathActivate && selectedId) {
				qwenVoiceId = selectedId;
				manualVoiceId = selectedId;
			}
			statusMsg = `Registered voice: ${data?.voice?.name || selectedId || 'ok'}`;
			await refresh();
		} catch (e: any) {
			statusMsg = `Register path failed: ${e?.message || 'Unknown error'}`;
		} finally {
			registeringPath = false;
		}
	}

	$effect(() => {
		const endpoint = qwenEndpoint.trim();
		if (refreshTimer) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
		if (!endpoint) {
			voices = [];
			serverReady = false;
			serverStatus = 'Missing endpoint';
			return;
		}
		refreshTimer = setTimeout(() => {
			void refresh();
		}, 350);

		return () => {
			if (refreshTimer) {
				clearTimeout(refreshTimer);
				refreshTimer = null;
			}
		};
	});

	$effect(() => {
		manualVoiceId = qwenVoiceId || '';
	});
</script>

<div class="section-card">
	<div class="section-header">
		<h2 class="section-title">Genie Voice Presets</h2>
	</div>

	<div class="sub-section">
		<div class="row">
			<h3 class="sub-title">Server Status</h3>
			<button class="btn-init" onclick={refresh} disabled={serverChecking || loadingVoices}>
				{serverChecking || loadingVoices ? 'Refreshing...' : 'Refresh'}
			</button>
		</div>
		<div class="status-row">
			<span class:ok={serverReady} class:bad={!serverReady}>{serverStatus}</span>
			<small class="hint">{normalizeEndpoint()}</small>
		</div>
	</div>

	<div class="sub-section">
		<h3 class="sub-title">Active Voice ID</h3>
		<div class="row">
			<input
				type="text"
				class="input-tech"
				style="flex:1"
				bind:value={manualVoiceId}
				placeholder="Voice ID (optional)"
			/>
			<button class="btn-init" onclick={() => selectVoice(manualVoiceId)} disabled={!manualVoiceId.trim()}>
				Use ID
			</button>
		</div>
		<small class="hint">Leave empty to use the server's currently active Genie preset.</small>
	</div>

	<div class="sub-section">
		<h3 class="sub-title">Saved Presets</h3>
		{#if voices.length === 0}
			<small class="hint">No Genie presets found.</small>
		{:else}
			<div class="voice-list">
				{#each voices as voice}
					<div class="voice-row" class:active={qwenVoiceId === voice.id || voice.active}>
						<div class="voice-info">
							<span class="voice-name">{voice.name}</span>
							<span class="voice-id">{voice.id}</span>
						</div>
						<div class="voice-actions">
							<button class="btn-small" onclick={() => selectVoice(voice.id)}>Select</button>
							<button class="btn-small danger" onclick={() => deleteVoice(voice.id)}>Delete</button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<div class="sub-section">
		<h3 class="sub-title">Upload New Voice</h3>
		<input type="text" class="input-tech" bind:value={uploadName} placeholder="Voice name..." />
		<input type="text" class="input-tech" bind:value={uploadRefText} placeholder="Reference text (optional)" />
		<div class="toggle-row">
			<label>
				<input type="checkbox" bind:checked={uploadActivate} />
				activate
			</label>
		</div>
		<input
			type="file"
			class="file-picker"
			accept="audio/*,.wav,.mp3,.flac,.m4a"
			bind:this={uploadFileInput}
		/>
		<button class="btn-tech" onclick={uploadVoice} disabled={uploading}>
			{uploading ? 'Uploading...' : 'Upload Voice'}
		</button>
		<small class="hint">Use the file picker here directly. New presets clone against Mika by default, and empty ref text will be auto-transcribed.</small>
	</div>

	<div class="sub-section">
		<h3 class="sub-title">Register By Path</h3>
		<input type="text" class="input-tech" bind:value={pathName} placeholder="Voice name..." />
		<input type="text" class="input-tech" bind:value={pathAudio} placeholder="Absolute audio path on server machine..." />
		<input type="text" class="input-tech" bind:value={pathRefText} placeholder="Reference text (optional)" />
		<input type="text" class="input-tech" bind:value={pathVoiceId} placeholder="Voice ID override (optional)" />
		<div class="toggle-row">
			<label>
				<input type="checkbox" bind:checked={pathActivate} />
				activate
			</label>
		</div>
		<button class="btn-tech" onclick={registerPathVoice} disabled={registeringPath}>
			{registeringPath ? 'Registering...' : 'Register Path Voice'}
		</button>
		<small class="hint">If reference text is empty, the Genie bridge will transcribe the audio and keep Mika as the base character.</small>
	</div>

	{#if statusMsg}
		<div class="status-msg">{statusMsg}</div>
	{/if}
</div>

<style>
	.section-card {
		background: var(--c-panel, rgba(13,17,23,0.95));
		border: 1px solid var(--c-border);
		padding: 20px;
		overflow: hidden;
	}
	@media (max-width: 500px) {
		.section-card { padding: 14px; }
	}
	.section-title {
		font-family: var(--font-tech);
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.15em;
		color: var(--c-text-accent);
		margin: 0;
	}
	.section-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 16px;
	}
	.sub-title {
		font-family: var(--font-tech);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
		margin: 0;
	}
	.sub-section {
		margin-bottom: 16px;
		padding-bottom: 16px;
		border-bottom: 1px dashed var(--c-border);
	}
	.sub-section:last-of-type { border-bottom: none; }
	.row {
		display: flex;
		gap: 8px;
		align-items: center;
		flex-wrap: wrap;
	}
	.status-row {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-top: 8px;
	}
	.ok { color: var(--success); font-size: 0.8rem; }
	.bad { color: rgba(255,80,80,1); font-size: 0.8rem; }
	.input-tech {
		width: 100%;
		min-width: 0;
		background: rgba(0,0,0,0.4);
		border: 1px solid var(--c-border);
		color: var(--text-main);
		padding: 8px 10px;
		font-size: 0.8rem;
		font-family: var(--font-ui);
		transition: border-color 0.2s;
	}
	.input-tech:focus { outline: none; border-color: var(--c-text-accent); }
	.btn-init {
		padding: 8px 14px;
		background: var(--c-text-accent);
		border: none;
		color: #000;
		font-family: var(--font-tech);
		font-size: 0.7rem;
		text-transform: uppercase;
		cursor: pointer;
		white-space: nowrap;
		transition: opacity 0.2s;
	}
	.btn-init:hover { opacity: 0.8; }
	.btn-init:disabled { opacity: 0.4; cursor: not-allowed; }
	.btn-tech {
		width: 100%;
		padding: 10px;
		background: transparent;
		border: 1px solid var(--c-text-accent);
		color: var(--c-text-accent);
		font-family: var(--font-tech);
		font-size: 0.75rem;
		text-transform: uppercase;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-tech:hover { background: var(--c-text-accent); color: #000; }
	.btn-tech:disabled { opacity: 0.4; cursor: not-allowed; }
	.voice-list {
		margin-top: 8px;
		border: 1px solid var(--c-border);
		max-height: 250px;
		overflow-y: auto;
	}
	.voice-row {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid rgba(255,255,255,0.03);
		transition: background 0.15s;
	}
	.voice-row:hover { background: rgba(56,189,248,0.03); }
	.voice-row.active { background: rgba(56,189,248,0.08); border-left: 2px solid var(--c-text-accent); }
	.voice-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
	.voice-name { font-size: 0.8rem; color: var(--text-main); overflow: hidden; text-overflow: ellipsis; }
	.voice-id { font-size: 0.65rem; color: var(--text-muted); font-family: var(--font-tech); }
	.voice-actions { display: flex; gap: 4px; }
	.btn-small {
		padding: 3px 8px;
		background: transparent;
		border: 1px solid var(--c-border);
		color: var(--text-muted);
		font-family: var(--font-tech);
		font-size: 0.6rem;
		text-transform: uppercase;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-small:hover { border-color: var(--c-text-accent); color: var(--c-text-accent); }
	.btn-small.danger:hover { border-color: rgba(255,80,80,0.8); color: rgba(255,80,80,1); }
	.toggle-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 12px;
		margin: 6px 0;
	}
	.toggle-row label {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 0.72rem;
		color: var(--text-muted);
		font-family: var(--font-tech);
	}
	.hint { color: var(--text-muted); font-size: 0.7rem; display: block; margin-top: 4px; }
	.status-msg {
		margin-top: 12px;
		font-size: 0.7rem;
		font-family: var(--font-tech);
		color: var(--text-muted);
		padding: 6px 10px;
		background: rgba(0,0,0,0.3);
		border-left: 2px solid var(--c-text-accent);
	}
	.file-picker {
		width: 100%;
		min-width: 0;
		padding: 8px 10px;
		background: rgba(0,0,0,0.35);
		border: 1px solid var(--c-border);
		color: var(--text-muted);
		font-size: 0.75rem;
		font-family: var(--font-ui);
		box-sizing: border-box;
	}
	@media (max-width: 500px) {
		.voice-row { flex-direction: column; align-items: flex-start; gap: 6px; }
		.voice-actions { width: 100%; justify-content: flex-start; }
		.section-header { align-items: flex-start; flex-direction: column; }
	}
</style>
