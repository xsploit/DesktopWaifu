<script lang="ts">
	import {
		getMemoryManager,
		type MemoryCompactionResult
	} from '../../memory/manager.js';
	import { getStorageManager } from '../../storage/index.js';

	let {
		enabled = $bindable(false),
		mode = $bindable('hybrid'),
		maxContext = $bindable(20),
		windowSize = $bindable(30),
		topK = $bindable(3),
		similarityThreshold = $bindable(0.5),
		summarizationProvider = $bindable(''),
		summarizationModel = $bindable(''),
		summarizationApiKey = $bindable(''),
		summarizationEndpoint = $bindable('')
	}: {
		enabled: boolean;
		mode: string;
		maxContext: number;
		windowSize: number;
		topK: number;
		similarityThreshold: number;
		summarizationProvider: string;
		summarizationModel: string;
		summarizationApiKey: string;
		summarizationEndpoint: string;
	} = $props();

	const memoryManager = getMemoryManager();
	const storage = getStorageManager();

	interface ConversationMemoryRow {
		id: number;
		title: string;
		messageCount: number;
		embeddingCount: number;
		summaryCount: number;
		summarizedMessages: number;
		summaryCoverage: number;
		lastSummaryTimestamp: number | null;
	}

	let modelLoading = $state(false);
	let modelReady = $state(false);
	let embeddingsCount = $state(0);
	let summariesCount = $state(0);
	let conversationsCount = $state(0);
	let currentConversationId = $state<number | null>(null);
	let selectedConversationId = $state<number | null>(null);
	let conversationRows = $state<ConversationMemoryRow[]>([]);
	let estimatedStorage = $state('Unknown');
	let statusMsg = $state('');
	let confirmClearEmbeddings = $state(false);
	let confirmClearSummaries = $state(false);
	let compactBusy = $state(false);
	let summarizeBusy = $state(false);
	let compactChunkSize = $state(12);
	let compactResult = $state<MemoryCompactionResult | null>(null);
	let showCompactDetails = $state(false);

	function syncRuntimeState() {
		modelReady = memoryManager.modelReady;
		modelLoading = memoryManager.modelLoading;
	}

	const selectedConversation = $derived(
		conversationRows.find((c) => c.id === selectedConversationId) ?? null
	);

	const modeDescriptions: Record<string, string> = {
		'auto-prune': 'Keeps the last N messages in context. Older messages are still embedded and searchable, but pruned from the direct context window.',
		'auto-summarize': 'Sliding window of recent messages + LLM-generated summaries of older messages. Requires a summarization LLM to be configured.',
		'hybrid': 'Uses auto-summarize when a summarization LLM is configured, falls back to auto-prune otherwise.'
	};

	let showSummarizationConfig = $derived(mode === 'auto-summarize' || mode === 'hybrid');

	function getConversationTitle(messages: any[] | undefined): string {
		if (!Array.isArray(messages) || messages.length === 0) return 'Empty conversation';
		const firstUser = messages.find((m: any) => m?.role === 'user');
		const text = String(firstUser?.content ?? '');
		if (!text) return 'No user messages';
		return text.length > 48 ? `${text.slice(0, 48)}...` : text;
	}

	function computeRangeCoverage(ranges: [number, number][]): number {
		if (ranges.length === 0) return 0;
		const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
		let total = 0;
		let curStart = sorted[0][0];
		let curEnd = sorted[0][1];
		for (let i = 1; i < sorted.length; i++) {
			const [start, end] = sorted[i];
			if (start <= curEnd + 1) {
				curEnd = Math.max(curEnd, end);
			} else {
				total += Math.max(0, curEnd - curStart + 1);
				curStart = start;
				curEnd = end;
			}
		}
		total += Math.max(0, curEnd - curStart + 1);
		return total;
	}

	async function loadStats() {
		try {
			const [embeddings, summaries, conversations, currentId, storageInfo] = await Promise.all([
				storage.getAllEmbeddings(),
				storage.getAllSummaries(),
				storage.getAllConversations(),
				storage.getSetting('currentConversationId', null),
				storage.estimateStorageUsage()
			]);

			embeddingsCount = embeddings.length;
			summariesCount = summaries.length;
			conversationsCount = conversations.length;
			currentConversationId = typeof currentId === 'number' ? currentId : null;
			estimatedStorage = storageInfo.formatted;

			const embeddingsByConversation = new Map<number, number>();
			for (const emb of embeddings) {
				const prev = embeddingsByConversation.get(emb.conversationId) ?? 0;
				embeddingsByConversation.set(emb.conversationId, prev + 1);
			}

			const summariesByConversation = new Map<number, number>();
			const rangesByConversation = new Map<number, [number, number][]>();
			const lastSummaryByConversation = new Map<number, number>();
			for (const summary of summaries) {
				const prev = summariesByConversation.get(summary.conversationId) ?? 0;
				summariesByConversation.set(summary.conversationId, prev + 1);
				const ranges = rangesByConversation.get(summary.conversationId) ?? [];
				ranges.push(summary.messageRange);
				rangesByConversation.set(summary.conversationId, ranges);
				const prevTs = lastSummaryByConversation.get(summary.conversationId) ?? 0;
				lastSummaryByConversation.set(
					summary.conversationId,
					Math.max(prevTs, summary.timestamp ?? 0)
				);
			}

			const rows: ConversationMemoryRow[] = conversations
				.map((convo) => {
					const messageCount = Array.isArray(convo.messages) ? convo.messages.length : 0;
					const summarizedMessages = computeRangeCoverage(
						rangesByConversation.get(convo.id) ?? []
					);
					const summaryCoverage = messageCount > 0
						? Math.min(1, summarizedMessages / messageCount)
						: 0;
					return {
						id: convo.id,
						title: getConversationTitle(convo.messages),
						messageCount,
						embeddingCount: embeddingsByConversation.get(convo.id) ?? 0,
						summaryCount: summariesByConversation.get(convo.id) ?? 0,
						summarizedMessages,
						summaryCoverage,
						lastSummaryTimestamp: (lastSummaryByConversation.get(convo.id) ?? 0) || null
					};
				})
				.sort((a, b) => b.id - a.id);

			conversationRows = rows;

			const selectedStillExists = rows.some((r) => r.id === selectedConversationId);
			if (!selectedStillExists) {
				if (currentConversationId && rows.some((r) => r.id === currentConversationId)) {
					selectedConversationId = currentConversationId;
				} else {
					selectedConversationId = rows[0]?.id ?? null;
				}
			}
		} catch {
			// storage may not be ready
		}
	}

	async function loadModel() {
		modelLoading = true;
		statusMsg = 'Loading embedding model (~23MB)...';
		try {
			await memoryManager.initEmbeddingModel();
			syncRuntimeState();
			statusMsg = 'Model loaded!';
		} catch (e: any) {
			statusMsg = 'Failed: ' + e.message;
		} finally {
			syncRuntimeState();
		}
	}

	async function unloadModel() {
		try {
			await memoryManager.unloadModel();
			syncRuntimeState();
			statusMsg = 'Model unloaded';
		} catch (e: any) {
			statusMsg = 'Unload failed: ' + e.message;
		}
	}

	async function clearEmbeddings() {
		await storage.clearEmbeddings();
		await loadStats();
		confirmClearEmbeddings = false;
		statusMsg = 'Embeddings cleared';
	}

	async function clearSummaries() {
		await storage.clearSummaries();
		await loadStats();
		confirmClearSummaries = false;
		statusMsg = 'Summaries cleared';
	}

	function formatTimestamp(ts: number | null): string {
		if (!ts) return 'Never';
		return new Date(ts).toLocaleString();
	}

	async function runPendingSummarization() {
		if (!selectedConversationId) return;
		summarizeBusy = true;
		statusMsg = `Summarizing pending history for conversation #${selectedConversationId}...`;
		try {
			await memoryManager.pruneAndSummarize(selectedConversationId);
			statusMsg = `Summaries updated for conversation #${selectedConversationId}`;
			await loadStats();
		} catch (e: any) {
			statusMsg = 'Summarization failed: ' + (e?.message ?? String(e));
		} finally {
			summarizeBusy = false;
		}
	}

	async function runCompaction(dryRun: boolean) {
		if (!selectedConversationId) return;
		compactBusy = true;
		const modeLabel = dryRun ? 'dry-run analysis' : 'compaction';
		statusMsg = `Running ${modeLabel} for conversation #${selectedConversationId}...`;
		try {
			compactResult = await memoryManager.compactConversationMemory(selectedConversationId, {
				dryRun,
				chunkSize: compactChunkSize,
				keepWindow: windowSize,
				clearOverlappingSummaries: true
			});
			showCompactDetails = true;
			statusMsg = dryRun
				? `Dry-run complete: ${compactResult.chunksProcessed} chunk(s) analyzed`
				: `Compaction complete: ${compactResult.summariesCreated} summary chunk(s), ${compactResult.embeddingsDeleted} embedding(s) removed`;
			await loadStats();
		} catch (e: any) {
			statusMsg = 'Compaction failed: ' + (e?.message ?? String(e));
		} finally {
			compactBusy = false;
		}
	}

	// Load stats when component mounts
	$effect(() => {
		if (!storage.db) return;
		let cancelled = false;
		const refresh = async () => {
			if (cancelled) return;
			syncRuntimeState();
			await loadStats();
		};
		void refresh();
		const intervalId = window.setInterval(() => {
			void refresh();
		}, 2000);
		return () => {
			cancelled = true;
			window.clearInterval(intervalId);
		};
	});

	// Sync manager properties when settings change
	$effect(() => {
		memoryManager.enabled = enabled;
		memoryManager.mode = mode as any;
		memoryManager.maxContextMessages = maxContext;
		memoryManager.windowSize = windowSize;
		memoryManager.topK = topK;
		memoryManager.similarityThreshold = similarityThreshold;
		memoryManager.summarizationProvider = summarizationProvider as any;
		memoryManager.summarizationModel = summarizationModel;
		memoryManager.summarizationApiKey = summarizationApiKey;
		memoryManager.summarizationEndpoint = summarizationEndpoint;
	});
</script>

<div class="section-card">
	<h2 class="section-title">Memory System</h2>

	<!-- Enable Toggle -->
	<div class="toggle-row">
		<span>Enable Memory</span>
		<label class="switch">
			<input type="checkbox" bind:checked={enabled} />
			<span class="slider"></span>
		</label>
	</div>

	{#if enabled}
		<!-- Mode Selector -->
		<div class="sub-section">
			<h3 class="sub-title">Memory Mode</h3>
			<select class="select-tech" bind:value={mode}>
				<option value="auto-prune">Auto-Prune</option>
				<option value="auto-summarize">Auto-Summarize</option>
				<option value="hybrid">Hybrid (Recommended)</option>
			</select>
			<p class="mode-desc">{modeDescriptions[mode]}</p>
		</div>

		<!-- Embedding Model -->
		<div class="sub-section">
			<h3 class="sub-title">Embedding Model</h3>
			<div class="model-info">
				<span class="model-name">all-MiniLM-L6-v2</span>
				<span class="model-meta">23MB &middot; 384 dimensions</span>
			</div>
			<div class="model-status">
				{#if modelReady}
					<span class="status-badge ready">Ready</span>
					<button class="btn-small" onclick={unloadModel}>Unload</button>
				{:else if modelLoading}
					<span class="status-badge loading">Loading...</span>
				{:else}
					<span class="status-badge idle">Not Loaded</span>
					<button class="btn-init" onclick={loadModel}>Load Model</button>
				{/if}
			</div>
		</div>

		<!-- Context Settings -->
		<div class="sub-section">
			<h3 class="sub-title">Context Settings</h3>

			<div class="slider-row">
				<div>Max Context Messages: <strong>{maxContext}</strong></div>
				<input type="range" min="5" max="50" step="1" bind:value={maxContext} />
			</div>

			<div class="slider-row">
				<div>Semantic Search Top-K: <strong>{topK}</strong></div>
				<input type="range" min="1" max="10" step="1" bind:value={topK} />
			</div>

			<div class="slider-row">
				<div>Similarity Threshold: <strong>{similarityThreshold.toFixed(2)}</strong></div>
				<input type="range" min="0.1" max="0.9" step="0.05" bind:value={similarityThreshold} />
			</div>
		</div>

		<!-- Auto-Summarize Settings -->
		{#if showSummarizationConfig}
			<div class="sub-section">
				<h3 class="sub-title">Auto-Summarize Config</h3>

				<div class="slider-row">
					<div>Window Size (raw messages): <strong>{windowSize}</strong></div>
					<input type="range" min="10" max="100" step="5" bind:value={windowSize} />
				</div>

				<div class="field-group">
					<div class="field-label">Summarization LLM Provider</div>
					<select class="select-tech" bind:value={summarizationProvider}>
						<option value="">None (disable summarization)</option>
						<option value="ollama">Ollama</option>
						<option value="lmstudio">LM Studio</option>
						<option value="openai">OpenAI</option>
						<option value="openrouter">OpenRouter</option>
					</select>
				</div>

				{#if summarizationProvider}
					<div class="field-group">
						<div class="field-label">Model</div>
						<input type="text" class="input-tech" bind:value={summarizationModel} placeholder="e.g. llama3.2:3b, gpt-4o-mini" />
					</div>

					{#if summarizationProvider === 'openai' || summarizationProvider === 'openrouter'}
						<div class="field-group">
							<div class="field-label">API Key</div>
							<input type="text" class="input-tech input-secret" bind:value={summarizationApiKey} placeholder="API key for summarization LLM..." autocomplete="off" data-1p-ignore data-lpignore="true" />
						</div>
					{/if}

					{#if summarizationProvider === 'ollama' || summarizationProvider === 'lmstudio'}
						<div class="field-group">
							<div class="field-label">Endpoint</div>
							<input type="text" class="input-tech" bind:value={summarizationEndpoint} placeholder={summarizationProvider === 'ollama' ? 'http://localhost:11434' : 'http://localhost:1234'} />
						</div>
					{/if}
				{/if}
			</div>
		{/if}

		<!-- Memory Stats -->
		<div class="sub-section">
			<h3 class="sub-title">Memory Dashboard</h3>
			<div class="stats-grid">
				<div class="stat">
					<span class="stat-value">{embeddingsCount}</span>
					<span class="stat-label">Embeddings</span>
				</div>
				<div class="stat">
					<span class="stat-value">{summariesCount}</span>
					<span class="stat-label">Summaries</span>
				</div>
				<div class="stat">
					<span class="stat-value">{conversationsCount}</span>
					<span class="stat-label">Conversations</span>
				</div>
				<div class="stat">
					<span class="stat-value small">{estimatedStorage}</span>
					<span class="stat-label">Browser Storage</span>
				</div>
			</div>

			<div class="field-group">
				<div class="field-label">Conversation Memory View</div>
				<select class="select-tech" bind:value={selectedConversationId}>
					{#if conversationRows.length === 0}
						<option value={null}>No conversations</option>
					{:else}
						{#each conversationRows as convo}
							<option value={convo.id}>
								#{convo.id}
								{convo.id === currentConversationId ? ' (current)' : ''}
								- {convo.title}
							</option>
						{/each}
					{/if}
				</select>
			</div>

			{#if selectedConversation}
				<div class="memory-overview">
					<div><span>Messages:</span><strong>{selectedConversation.messageCount}</strong></div>
					<div><span>Embeddings:</span><strong>{selectedConversation.embeddingCount}</strong></div>
					<div><span>Summaries:</span><strong>{selectedConversation.summaryCount}</strong></div>
					<div><span>Summarized:</span><strong>{selectedConversation.summarizedMessages} ({(selectedConversation.summaryCoverage * 100).toFixed(0)}%)</strong></div>
					<div><span>Last Summary:</span><strong>{formatTimestamp(selectedConversation.lastSummaryTimestamp)}</strong></div>
				</div>

				<div class="compaction-panel">
					<h4 class="mini-title">Compaction</h4>
					<div class="slider-row">
						<div>Chunk Size: <strong>{compactChunkSize}</strong> messages</div>
						<input type="range" min="6" max="40" step="2" bind:value={compactChunkSize} />
					</div>
					<div class="compaction-actions">
						<button class="btn-small" onclick={runPendingSummarization} disabled={summarizeBusy || compactBusy}>
							{summarizeBusy ? 'Summarizing...' : 'Run Summarize'}
						</button>
						<button class="btn-small" onclick={() => runCompaction(true)} disabled={compactBusy}>
							{compactBusy ? 'Working...' : 'Dry Run'}
						</button>
						<button class="btn-small accent" onclick={() => runCompaction(false)} disabled={compactBusy}>
							{compactBusy ? 'Working...' : 'Run Compaction'}
						</button>
					</div>

					{#if compactResult}
						<div class="compact-result">
							<div class="compact-summary">
								<span>Processed:</span> {compactResult.chunksProcessed}/{compactResult.chunksPlanned}
								<span>Summaries:</span> {compactResult.summariesCreated}
								<span>Summary Embeddings:</span> {compactResult.summaryEmbeddingsCreated}
								<span>Embeddings Removed:</span> {compactResult.embeddingsDeleted}
							</div>
							<button class="btn-small" onclick={() => showCompactDetails = !showCompactDetails}>
								{showCompactDetails ? 'Hide Details' : 'Show Details'}
							</button>
							{#if showCompactDetails}
								<div class="compact-details">
									{#each compactResult.details as detail}
										<div class="compact-row">
											<div class="compact-head">
												<span>#{detail.startIndex}-{detail.endIndex}</span>
												<span class={`pill ${detail.status}`}>{detail.status}</span>
											</div>
											<div class="compact-meta">
												msgs: {detail.messageCount} &middot; source emb: {detail.sourceEmbeddings}
											</div>
											{#if detail.summaryPreview}
												<div class="compact-text">{detail.summaryPreview}</div>
											{/if}
											{#if detail.reason}
												<div class="compact-reason">{detail.reason}</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/if}
				</div>
			{/if}

			<div class="stats-actions">
				{#if !confirmClearEmbeddings}
					<button class="btn-small danger" onclick={() => confirmClearEmbeddings = true} disabled={embeddingsCount === 0}>Clear Embeddings</button>
				{:else}
					<button class="btn-small danger confirm" onclick={clearEmbeddings}>Confirm Clear</button>
					<button class="btn-small" onclick={() => confirmClearEmbeddings = false}>Cancel</button>
				{/if}

				{#if !confirmClearSummaries}
					<button class="btn-small danger" onclick={() => confirmClearSummaries = true} disabled={summariesCount === 0}>Clear Summaries</button>
				{:else}
					<button class="btn-small danger confirm" onclick={clearSummaries}>Confirm Clear</button>
					<button class="btn-small" onclick={() => confirmClearSummaries = false}>Cancel</button>
				{/if}
				<button class="btn-small" onclick={loadStats}>Refresh</button>
			</div>
		</div>
	{/if}

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
	@media (max-width: 500px) { .section-card { padding: 14px; } }
	.section-title {
		font-family: var(--font-tech);
		font-size: 0.8rem;
		text-transform: uppercase;
		letter-spacing: 0.15em;
		color: var(--c-text-accent);
		margin: 0 0 16px;
	}
	.sub-title {
		font-family: var(--font-tech);
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		color: var(--text-muted);
		margin: 0 0 8px;
	}
	.sub-section {
		margin-bottom: 16px;
		padding-bottom: 16px;
		border-bottom: 1px dashed var(--c-border);
	}
	.sub-section:last-of-type { border-bottom: none; }
	.toggle-row {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 8px 0;
		margin-bottom: 12px;
		border-bottom: 1px dashed var(--c-border);
		font-size: 0.85rem;
	}
	.switch {
		position: relative;
		width: 40px;
		height: 20px;
		display: inline-block;
	}
	.switch input { opacity: 0; width: 0; height: 0; }
	.slider {
		position: absolute;
		inset: 0;
		background: rgba(255,255,255,0.1);
		border-radius: 10px;
		cursor: pointer;
		transition: background 0.2s;
	}
	.slider::before {
		content: '';
		position: absolute;
		width: 16px;
		height: 16px;
		left: 2px;
		bottom: 2px;
		background: var(--text-main);
		border-radius: 50%;
		transition: transform 0.2s;
	}
	.switch input:checked + .slider { background: var(--c-text-accent); }
	.switch input:checked + .slider::before { transform: translateX(20px); }

	.mode-desc {
		font-size: 0.7rem;
		color: var(--text-muted);
		margin: 6px 0 0;
		line-height: 1.4;
	}
	.model-info {
		display: flex;
		align-items: baseline;
		gap: 8px;
		margin-bottom: 8px;
	}
	.model-name {
		font-family: var(--font-tech);
		font-size: 0.8rem;
		color: var(--text-main);
	}
	.model-meta {
		font-size: 0.65rem;
		color: var(--text-muted);
		font-family: var(--font-tech);
	}
	.model-status {
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.status-badge {
		font-family: var(--font-tech);
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.1em;
		padding: 3px 8px;
		border-radius: 2px;
	}
	.status-badge.ready { background: rgba(16,185,129,0.15); color: var(--success); }
	.status-badge.loading { background: rgba(56,189,248,0.15); color: var(--c-text-accent); }
	.status-badge.idle { background: rgba(255,255,255,0.05); color: var(--text-muted); }

	.slider-row {
		margin-bottom: 10px;
	}
	.slider-row > div {
		display: block;
		font-size: 0.75rem;
		color: var(--text-muted);
		margin-bottom: 4px;
	}
	.slider-row strong { color: var(--c-text-accent); }
	.slider-row input[type="range"] {
		width: 100%;
		height: 4px;
		appearance: none;
		background: var(--c-border);
		border-radius: 2px;
		outline: none;
	}
	.slider-row input[type="range"]::-webkit-slider-thumb {
		appearance: none;
		width: 14px;
		height: 14px;
		background: var(--c-text-accent);
		border-radius: 50%;
		cursor: pointer;
	}

	.field-group {
		margin-bottom: 8px;
	}
	.field-label {
		display: block;
		font-size: 0.65rem;
		color: var(--text-muted);
		font-family: var(--font-tech);
		text-transform: uppercase;
		letter-spacing: 0.08em;
		margin-bottom: 4px;
	}
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
	.select-tech {
		width: 100%;
		background: rgba(0,0,0,0.4);
		border: 1px solid var(--c-border);
		color: var(--text-main);
		padding: 8px 10px;
		font-size: 0.8rem;
		font-family: var(--font-ui);
		cursor: pointer;
	}
	.select-tech option { background: #0d1117; }

	.stats-grid {
		display: flex;
		gap: 16px;
		margin-bottom: 12px;
	}
	.stat {
		display: flex;
		flex-direction: column;
		align-items: center;
		padding: 8px 16px;
		background: rgba(0,0,0,0.3);
		border: 1px solid var(--c-border);
		min-width: 80px;
	}
	.stat-value {
		font-family: var(--font-tech);
		font-size: 1.2rem;
		color: var(--c-text-accent);
	}
	.stat-label {
		font-size: 0.6rem;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}
	.stat-value.small {
		font-size: 0.72rem;
		text-align: center;
	}
	.memory-overview {
		margin: 10px 0 12px;
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
		gap: 6px 12px;
		padding: 10px;
		border: 1px solid var(--c-border);
		background: rgba(0,0,0,0.25);
	}
	.memory-overview div {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 8px;
		font-size: 0.68rem;
		color: var(--text-muted);
		font-family: var(--font-tech);
	}
	.memory-overview strong {
		color: var(--text-main);
		font-size: 0.7rem;
		font-weight: 600;
	}
	.compaction-panel {
		margin-top: 8px;
		padding: 10px;
		border: 1px solid var(--c-border);
		background: rgba(0,0,0,0.22);
	}
	.mini-title {
		font-family: var(--font-tech);
		font-size: 0.65rem;
		text-transform: uppercase;
		letter-spacing: 0.12em;
		color: var(--text-muted);
		margin: 0 0 10px;
	}
	.compaction-actions {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}
	.btn-small.accent {
		border-color: rgba(56,189,248,0.45);
		color: var(--c-text-accent);
		background: rgba(56,189,248,0.08);
	}
	.compact-result {
		margin-top: 10px;
		padding-top: 10px;
		border-top: 1px dashed var(--c-border);
	}
	.compact-summary {
		display: flex;
		flex-wrap: wrap;
		gap: 10px;
		font-family: var(--font-tech);
		font-size: 0.64rem;
		color: var(--text-muted);
		margin-bottom: 8px;
	}
	.compact-summary span {
		color: var(--c-text-accent);
	}
	.compact-details {
		margin-top: 8px;
		max-height: 220px;
		overflow-y: auto;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.compact-row {
		padding: 8px;
		border: 1px solid var(--c-border);
		background: rgba(0,0,0,0.25);
	}
	.compact-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-family: var(--font-tech);
		font-size: 0.65rem;
		color: var(--text-main);
	}
	.pill {
		font-size: 0.55rem;
		text-transform: uppercase;
		letter-spacing: 0.08em;
		padding: 2px 6px;
		border: 1px solid var(--c-border);
	}
	.pill.compacted {
		border-color: rgba(16,185,129,0.45);
		color: var(--success);
	}
	.pill.skipped {
		border-color: rgba(245,158,11,0.45);
		color: #f59e0b;
	}
	.pill.error {
		border-color: rgba(255,80,80,0.55);
		color: rgba(255,80,80,1);
	}
	.compact-meta {
		font-family: var(--font-tech);
		font-size: 0.6rem;
		color: var(--text-muted);
		margin-top: 4px;
	}
	.compact-text {
		margin-top: 6px;
		font-size: 0.7rem;
		color: var(--text-main);
		line-height: 1.35;
	}
	.compact-reason {
		margin-top: 6px;
		font-size: 0.64rem;
		color: #f59e0b;
		font-family: var(--font-tech);
	}
	.stats-actions {
		display: flex;
		gap: 6px;
		flex-wrap: wrap;
	}

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
	.btn-small {
		padding: 4px 10px;
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
	.btn-small.danger.confirm { border-color: rgba(255,80,80,0.8); color: rgba(255,80,80,1); background: rgba(255,80,80,0.1); }
	.btn-small:disabled { opacity: 0.3; cursor: not-allowed; }

	.status-msg {
		margin-top: 12px;
		font-size: 0.7rem;
		font-family: var(--font-tech);
		color: var(--text-muted);
		padding: 6px 10px;
		background: rgba(0,0,0,0.3);
		border-left: 2px solid var(--c-text-accent);
	}
</style>
