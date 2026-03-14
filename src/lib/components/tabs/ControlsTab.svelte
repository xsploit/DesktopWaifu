<script lang="ts">
	import { onMount } from 'svelte';
	import { getShellHotkeys, addLog, toast } from '../../stores/app.svelte.js';
	import { getElectrobunRpc, isElectrobunRuntime } from '../../electrobun/bridge.js';

	const shellHotkeys = getShellHotkeys();
	let applyingHotkeys = $state(false);
	let recordingTarget = $state<'sttToggle' | 'chatToggle' | 'recoverControls' | null>(null);

	const MODIFIER_KEYS = new Set(['Control', 'Meta', 'Alt', 'Shift']);

	function formatAccelerator(event: KeyboardEvent): string | null {
		if (MODIFIER_KEYS.has(event.key)) {
			return null;
		}

		const parts: string[] = [];

		if (event.ctrlKey || event.metaKey) {
			parts.push('CommandOrControl');
		}
		if (event.altKey) {
			parts.push('Alt');
		}
		if (event.shiftKey) {
			parts.push('Shift');
		}

		const key = normalizeKey(event.key);
		if (!key) {
			return null;
		}
		parts.push(key);
		return parts.join('+');
	}

	function normalizeKey(key: string): string | null {
		if (!key) return null;
		const namedKeys: Record<string, string> = {
			' ': 'Space',
			Escape: 'Escape',
			Esc: 'Escape',
			Enter: 'Enter',
			Tab: 'Tab',
			Backspace: 'Backspace',
			Delete: 'Delete',
			Insert: 'Insert',
			Home: 'Home',
			End: 'End',
			PageUp: 'PageUp',
			PageDown: 'PageDown',
			ArrowUp: 'Up',
			ArrowDown: 'Down',
			ArrowLeft: 'Left',
			ArrowRight: 'Right'
		};

		if (namedKeys[key]) {
			return namedKeys[key];
		}

		if (/^F\d{1,2}$/i.test(key)) {
			return key.toUpperCase();
		}

		if (key.length === 1) {
			return key.toUpperCase();
		}

		return key;
	}

	function startRecording(target: 'sttToggle' | 'chatToggle' | 'recoverControls') {
		recordingTarget = target;
		toast('Press the new shortcut combo');
	}

	function stopRecording() {
		recordingTarget = null;
	}

	async function applyHotkeys() {
		if (!isElectrobunRuntime()) {
			toast('Desktop hotkeys are only available in the Electrobun app.');
			return;
		}

		applyingHotkeys = true;
		try {
			const rpc = await getElectrobunRpc();
			if (!rpc) {
				throw new Error('Electrobun RPC unavailable.');
			}
			const result = await rpc.request.shellSetHotkeys({
				sttToggle: shellHotkeys.sttToggle,
				chatToggle: shellHotkeys.chatToggle,
				recoverControls: shellHotkeys.recoverControls
			});
			shellHotkeys.replace(result.hotkeys);
			addLog('Desktop hotkeys updated', 'info');
			toast('Desktop hotkeys updated');
		} catch (e: any) {
			console.error('[Controls] Hotkey update failed:', e);
			toast(`Failed to update hotkeys: ${e?.message ?? e}`);
			try {
				const rpc = await getElectrobunRpc();
				const current = rpc ? await rpc.request.shellGetHotkeys({}) : null;
				if (current) shellHotkeys.replace(current);
			} catch {
				// ignore refresh failure
			}
		} finally {
			applyingHotkeys = false;
		}
	}

	function resetHotkeys() {
		shellHotkeys.reset();
		void applyHotkeys();
	}

	onMount(() => {
		function handleKeydown(event: KeyboardEvent) {
			if (!recordingTarget) return;
			event.preventDefault();
			event.stopPropagation();

			if (event.key === 'Escape') {
				stopRecording();
				toast('Shortcut recording cancelled');
				return;
			}

			const accelerator = formatAccelerator(event);
			if (!accelerator) return;

			shellHotkeys[recordingTarget] = accelerator;
			stopRecording();
			toast(`Recorded ${accelerator}`);
		}

		window.addEventListener('keydown', handleKeydown, true);
		return () => {
			window.removeEventListener('keydown', handleKeydown, true);
		};
	});
</script>

<div class="control-group">
	<div class="control-label">Desktop Hotkeys</div>

	<div class="hotkey-grid">
		<label class="hotkey-field">
			<span>STT Toggle</span>
			<div class="hotkey-row">
				<input type="text" bind:value={shellHotkeys.sttToggle} spellcheck="false" />
				<button
					class="record-btn"
					class:recording={recordingTarget === 'sttToggle'}
					onclick={() => recordingTarget === 'sttToggle' ? stopRecording() : startRecording('sttToggle')}
				>
					{recordingTarget === 'sttToggle' ? 'Press Keys…' : 'Record'}
				</button>
			</div>
		</label>
		<label class="hotkey-field">
			<span>Chat Toggle</span>
			<div class="hotkey-row">
				<input type="text" bind:value={shellHotkeys.chatToggle} spellcheck="false" />
				<button
					class="record-btn"
					class:recording={recordingTarget === 'chatToggle'}
					onclick={() => recordingTarget === 'chatToggle' ? stopRecording() : startRecording('chatToggle')}
				>
					{recordingTarget === 'chatToggle' ? 'Press Keys…' : 'Record'}
				</button>
			</div>
		</label>
		<label class="hotkey-field">
			<span>Recover Controls</span>
			<div class="hotkey-row">
				<input type="text" bind:value={shellHotkeys.recoverControls} spellcheck="false" />
				<button
					class="record-btn"
					class:recording={recordingTarget === 'recoverControls'}
					onclick={() => recordingTarget === 'recoverControls' ? stopRecording() : startRecording('recoverControls')}
				>
					{recordingTarget === 'recoverControls' ? 'Press Keys…' : 'Record'}
				</button>
			</div>
		</label>
	</div>

	<div class="hotkey-actions">
		<button class="btn-tech" onclick={applyHotkeys} disabled={applyingHotkeys}>
			{applyingHotkeys ? 'Applying...' : 'Apply Hotkeys'}
		</button>
		<button class="btn-tech ghost" onclick={resetHotkeys} disabled={applyingHotkeys}>
			Reset Defaults
		</button>
	</div>

	<p class="hint">
		Click <code>Record</code>, press the combo once, then hit <code>Apply Hotkeys</code>.
		Press <code>Escape</code> while recording to cancel.
	</p>
</div>

<style>
	.control-group { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
	.control-label { font-size: 0.7rem; color: var(--c-text-accent); font-family: var(--font-tech); text-transform: uppercase; letter-spacing: 0.1em; opacity: 0.8; }
	.hint { font-size: 0.7rem; color: var(--text-dim); margin: 4px 0 0; line-height: 1.4; }
	.hotkey-grid { display: flex; flex-direction: column; gap: 10px; }
	.hotkey-field { display: flex; flex-direction: column; gap: 4px; }
	.hotkey-field span { font-size: 0.8rem; color: var(--text-muted); }
	.hotkey-row {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		gap: 8px;
		align-items: center;
	}
	.hotkey-field input {
		width: 100%;
		padding: 10px 12px;
		background: rgba(5, 10, 18, 0.78);
		border: 1px solid var(--c-border);
		color: var(--text-main);
		font-family: var(--font-tech);
		font-size: 0.78rem;
	}
	.hotkey-field input:focus {
		outline: none;
		border-color: var(--c-text-accent);
		box-shadow: 0 0 0 1px color-mix(in oklab, var(--c-text-accent) 45%, transparent);
	}
	.record-btn {
		padding: 10px 12px;
		background: rgba(255, 255, 255, 0.03);
		border: 1px solid var(--c-border);
		color: var(--text-muted);
		font-family: var(--font-tech);
		font-size: 0.72rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		cursor: pointer;
		transition: all 0.2s;
		white-space: nowrap;
	}
	.record-btn:hover {
		border-color: var(--c-text-accent);
		color: var(--c-text-accent);
	}
	.record-btn.recording {
		border-color: var(--c-text-accent);
		color: var(--c-text-accent);
		background: color-mix(in oklab, var(--c-text-accent) 14%, transparent);
		box-shadow: 0 0 0 1px color-mix(in oklab, var(--c-text-accent) 45%, transparent);
	}
	.hotkey-actions { display: flex; gap: 8px; }
	.hotkey-actions .btn-tech { flex: 1; }
	.btn-tech {
		width: 100%;
		padding: 10px;
		background: transparent;
		border: 1px solid var(--c-text-accent);
		color: var(--c-text-accent);
		font-family: var(--font-tech);
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		cursor: pointer;
		transition: all 0.2s;
	}
	.btn-tech:hover { background: var(--c-text-accent); color: #000; }
	.btn-tech:disabled { opacity: 0.4; cursor: not-allowed; }
	.btn-tech:disabled:hover { background: transparent; color: var(--c-text-accent); }
	.btn-tech.ghost {
		border-color: var(--c-border);
		color: var(--text-muted);
	}
	.btn-tech.ghost:hover {
		background: rgba(255, 255, 255, 0.06);
		color: var(--text-main);
		border-color: var(--text-main);
	}
	code {
		font-family: var(--font-tech);
		font-size: 0.72rem;
		color: var(--text-main);
	}
</style>
