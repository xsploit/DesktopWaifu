<script lang="ts">
	import { getSettingsPanel } from '../stores/app.svelte.js';

	const panel = getSettingsPanel();

	type TabId = 'vrm' | 'anim' | 'character' | 'ai' | 'tts' | 'stt' | 'controls' | 'logs';
	type TabModule = { default: any };

	const tabs: { id: TabId; label: string }[] = [
		{ id: 'vrm', label: 'VRM' },
		{ id: 'anim', label: 'Anim' },
		{ id: 'character', label: 'Char' },
		{ id: 'ai', label: 'AI' },
		{ id: 'tts', label: 'TTS' },
		{ id: 'stt', label: 'STT' },
		{ id: 'controls', label: 'Ctrl' },
		{ id: 'logs', label: 'Logs' }
	];

	const tabLoaders: Record<TabId, () => Promise<TabModule>> = {
		vrm: () => import('./tabs/VrmTab.svelte'),
		anim: () => import('./tabs/AnimTab.svelte'),
		character: () => import('./tabs/CharacterTab.svelte'),
		ai: () => import('./tabs/AiTab.svelte'),
		tts: () => import('./tabs/TtsTab.svelte'),
		stt: () => import('./tabs/SttTab.svelte'),
		controls: () => import('./tabs/ControlsTab.svelte'),
		logs: () => import('./tabs/LogsTab.svelte')
	};
	const tabCache = new Map<TabId, Promise<TabModule>>();

	let retryCount = $state(0);

	function getTabModule(tabId: TabId): Promise<TabModule> {
		const cached = tabCache.get(tabId);
		if (cached) return cached;
		const loaded = tabLoaders[tabId]().catch((err) => {
			tabCache.delete(tabId);
			throw err;
		});
		tabCache.set(tabId, loaded);
		return loaded;
	}

	function getActiveTabId(): TabId {
		return tabs.some((tab) => tab.id === panel.activeTab) ? panel.activeTab as TabId : 'vrm';
	}

	function getActiveTabModule(): Promise<TabModule> {
		retryCount;
		return getTabModule(getActiveTabId());
	}

	function retryTab() {
		const tabId = getActiveTabId();
		tabCache.delete(tabId);
		retryCount++;
	}

</script>

{#if panel.open}
<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div id="settings-panel" onclick={(e) => e.stopPropagation()}>
	<div class="panel-header">
		<div class="tabs-header">
			{#each tabs as tab}
				<button
					class="tab-btn"
					class:active={panel.activeTab === tab.id}
					onclick={() => panel.activeTab = tab.id}
				>{tab.label}</button>
			{/each}
		</div>
		<div class="header-right">
			<button class="close-btn" title="Close (Esc)" onclick={() => panel.open = false}>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
					<line x1="18" y1="6" x2="6" y2="18"></line>
					<line x1="6" y1="6" x2="18" y2="18"></line>
				</svg>
			</button>
		</div>
	</div>

	<div class="panel-scroll">
		{#await getActiveTabModule()}
			<div class="tab-loading">Loading tab...</div>
		{:then tabModule}
			<svelte:component this={tabModule.default} />
		{:catch err}
			<div class="tab-error">
				Failed to load tab.
				<small class="tab-error-detail">{err?.message || 'Unknown error'}</small>
				<button class="tab-retry-btn" onclick={retryTab}>Retry</button>
				<button class="tab-retry-btn" onclick={() => location.reload()}>Reload Page</button>
			</div>
		{/await}
	</div>
</div>
{/if}

<style>
	#settings-panel {
		position: fixed;
		inset: 0;
		z-index: 9000;
		pointer-events: all;
		display: flex;
		flex-direction: column;
		background:
			linear-gradient(
				90deg,
				rgba(10, 14, 23, 0) 0%,
				rgba(10, 14, 23, 0.08) 42%,
				rgba(10, 14, 23, 0.56) 58%,
				rgba(10, 14, 23, 0.9) 72%,
				rgba(10, 14, 23, 0.96) 100%
			);
	}

	.panel-header {
		display: grid;
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: start;
		gap: 12px;
		padding: 16px 24px;
		border-bottom: 1px solid var(--c-border);
		flex-shrink: 0;
		width: min(36vw, 560px);
		margin-left: auto;
		background: rgba(10, 14, 23, 0.9);
		border-left: 1px solid var(--c-border);
		backdrop-filter: blur(16px);
	}

	.tabs-header {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(72px, 1fr));
		gap: 6px;
		align-items: stretch;
		min-width: 0;
	}

	.header-right {
		display: flex;
		align-items: center;
		gap: 12px;
		flex-shrink: 0;
	}

	.close-btn {
		width: 36px;
		height: 36px;
		background: transparent;
		border: 1px solid var(--c-border);
		color: var(--text-muted);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		transition: all 0.2s;
	}
	.close-btn svg {
		width: 18px;
		height: 18px;
	}
	.close-btn:hover { color: var(--danger, #f43f5e); border-color: var(--danger, #f43f5e); }

	.tab-btn {
		background: transparent;
		border: 1px solid color-mix(in oklab, var(--c-border) 85%, transparent);
		background: rgba(255, 255, 255, 0.02);
		color: var(--text-muted);
		padding: 8px 10px;
		font-size: 0.74rem;
		font-family: var(--font-tech);
		text-transform: uppercase;
		letter-spacing: 0.05em;
		cursor: pointer;
		transition: color 0.2s, border-color 0.2s, background 0.2s;
		position: relative;
		min-height: 38px;
		text-align: center;
		display: inline-flex;
		align-items: center;
		justify-content: center;
	}
	.tab-btn:hover {
		color: var(--c-text-accent);
		border-color: color-mix(in oklab, var(--c-text-accent) 52%, transparent);
	}
	.tab-btn.active {
		color: var(--c-text-accent);
		font-weight: 600;
		border-color: color-mix(in oklab, var(--c-text-accent) 78%, transparent);
		background: color-mix(in oklab, var(--c-text-accent) 14%, transparent);
	}
	.tab-btn.active::after {
		content: '';
		position: absolute;
		inset-inline: 10px;
		bottom: 4px;
		height: 1px;
		background: var(--c-text-accent);
		box-shadow: 0 0 6px color-mix(in oklab, var(--c-text-accent) 72%, transparent);
	}

	.panel-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 24px 32px 40px;
		display: flex;
		flex-direction: column;
		gap: 20px;
		width: min(36vw, 560px);
		max-width: min(36vw, 560px);
		margin: 0 0 0 auto;
		padding: 20px 28px 36px;
		background: rgba(10, 14, 23, 0.86);
		border-left: 1px solid var(--c-border);
		backdrop-filter: blur(16px);
	}

	.tab-loading, .tab-error {
		font-family: var(--font-tech);
		font-size: 0.75rem;
		color: var(--text-muted);
		padding: 12px;
		border: 1px dashed var(--c-border);
	}
	.tab-error { color: var(--danger); display: flex; flex-direction: column; gap: 8px; align-items: flex-start; }
	.tab-error-detail { color: var(--text-dim); font-size: 0.65rem; word-break: break-all; }
	.tab-retry-btn {
		padding: 8px 16px;
		background: transparent;
		border: 1px solid var(--danger);
		color: var(--danger);
		font-family: var(--font-tech);
		font-size: 0.75rem;
		text-transform: uppercase;
		cursor: pointer;
		transition: all 0.2s;
	}
	.tab-retry-btn:hover { background: var(--danger); color: #000; }

	@media (max-width: 600px) {
		.panel-header { padding: 12px 16px; }
		.panel-scroll { padding: 16px; }
		.tabs-header { grid-template-columns: repeat(2, minmax(0, 1fr)); }
		.tab-btn { padding: 8px 8px; font-size: 0.7rem; min-height: 38px; }
		.panel-header,
		.panel-scroll {
			width: 100%;
			max-width: 100%;
		}
	}
</style>
