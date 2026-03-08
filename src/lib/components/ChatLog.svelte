<script lang="ts">
	import { getChat, getLogs } from '../stores/app.svelte.js';
	import { tick } from 'svelte';
	let { visible = true }: { visible?: boolean } = $props();

	const chat = getChat();
	const logs = getLogs();
	let scrollEl: HTMLDivElement;
	let wasAtBottom = true;
	let showLogs = $state(false);

	function isScrolledToBottom() {
		if (!scrollEl) return true;
		return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 40;
	}

	function scrollToBottom() {
		if (scrollEl) scrollEl.scrollTop = scrollEl.scrollHeight;
	}

	$effect(() => {
		// Track history length, streaming text, and logs to auto-scroll
		chat.history.length;
		chat.streamingText;
		if (showLogs) logs.entries.length;
		if (wasAtBottom) {
			tick().then(scrollToBottom);
		}
	});

	async function copyMessage(text: string) {
		try {
			await navigator.clipboard.writeText(text);
		} catch { /* clipboard not available */ }
	}

	function handleScroll() {
		wasAtBottom = isScrolledToBottom();
	}
</script>

<!-- Toggle button (always visible) -->
<button
	class="log-toggle"
	class:visible={visible}
	class:active={chat.logOpen}
	title={chat.logOpen ? 'Close Chat Log' : 'Open Chat Log'}
	onclick={(e) => { e.stopPropagation(); chat.toggleLog(); }}
>
	<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
		<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
	</svg>
</button>

<!-- Panel -->
<div class="log-panel" class:open={chat.logOpen}>
	<div class="log-header">
		<span class="log-title">// CHAT LOG</span>
		<div class="log-header-right">
			<button class="log-btn" class:active={showLogs} title="Show system logs" onclick={() => showLogs = !showLogs}>LOG</button>
			<span class="log-count">{chat.history.length} msgs</span>
		</div>
	</div>
	<div class="log-deco"></div>
	<div class="log-messages" bind:this={scrollEl} onscroll={handleScroll}>
		{#if chat.history.length === 0 && !chat.streamingText}
			<div class="log-empty">No messages yet.</div>
		{/if}
		{#each chat.history as msg, i (i)}
			<!-- svelte-ignore a11y_click_events_have_key_events -->
			<!-- svelte-ignore a11y_no_static_element_interactions -->
			<div class="log-msg" class:user={msg.role === 'user'} class:assistant={msg.role === 'assistant'} class:system={msg.role === 'system'} onclick={() => copyMessage(msg.content)}>
				<span class="msg-role">{msg.role === 'user' ? 'YOU' : msg.role === 'assistant' ? 'AI' : 'SYS'}</span>
				<span class="msg-text">{msg.content}</span>
			</div>
		{/each}
		{#if chat.streamingText}
			<div class="log-msg assistant streaming">
				<span class="msg-role">AI</span>
				<span class="msg-text">{chat.streamingText}<span class="cursor-blink">_</span></span>
			</div>
		{/if}
		{#if showLogs}
			<div class="log-divider">// SYSTEM LOGS</div>
			{#each logs.entries as entry, i (i)}
				<!-- svelte-ignore a11y_click_events_have_key_events -->
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div class="log-msg log-entry" class:log-warn={entry.level === 'warn'} class:log-err={entry.level === 'err'} onclick={() => copyMessage(`[${entry.time}] ${entry.message}`)}>
					<span class="msg-role">{entry.level === 'err' ? 'ERR' : entry.level === 'warn' ? 'WRN' : 'LOG'}</span>
					<span class="msg-text log-text"><span class="log-time">{entry.time}</span> {entry.message}</span>
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.log-toggle {
		position: absolute;
		top: var(--desktop-top-gap, 24px);
		left: var(--desktop-edge-gap, 24px);
		width: var(--desktop-icon-size, 48px);
		height: var(--desktop-icon-size, 48px);
		background: var(--c-panel);
		border: none;
		color: var(--text-main);
		display: flex;
		align-items: center;
		justify-content: center;
		cursor: pointer;
		pointer-events: none;
		z-index: 50;
		opacity: 0;
		visibility: hidden;
		transform: translateY(-10px);
		transition: all 0.2s var(--ease-tech);
		clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
	}
	.log-toggle.visible {
		pointer-events: auto;
		opacity: 1;
		visibility: visible;
		transform: translateY(0);
	}
	.log-toggle::before {
		content: '';
		position: absolute;
		inset: 0;
		background: var(--c-border);
		z-index: -1;
	}
	.log-toggle::after {
		content: '';
		position: absolute;
		inset: 1px;
		background: var(--c-panel);
		z-index: -1;
		clip-path: polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px);
	}
	.log-toggle:hover { transform: translateY(0) scale(1.05); }
	.log-toggle:hover::before { background: var(--c-text-accent); }
	.log-toggle.active { color: var(--c-text-accent); }
	.log-toggle.active::before { background: var(--c-text-accent); }

	.log-panel {
		position: absolute;
		top: 0;
		left: 0;
		width: min(var(--desktop-panel-width, 380px), calc(100% - 20px));
		height: 100%;
		background: var(--c-panel);
		border-right: 1px solid var(--c-border);
		pointer-events: none;
		z-index: 40;
		display: flex;
		flex-direction: column;
		transform: translateX(-100%);
		opacity: 0;
		transition: transform 0.35s var(--ease-tech), opacity 0.25s var(--ease-tech);
	}
	.log-panel.open {
		transform: translateX(0);
		opacity: 1;
		pointer-events: auto;
	}

	.log-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: calc(16px * var(--desktop-ui-scale, 1)) calc(20px * var(--desktop-ui-scale, 1)) calc(12px * var(--desktop-ui-scale, 1));
		padding-top: calc(var(--desktop-top-gap, 24px) + var(--desktop-icon-size, 48px) + (12px * var(--desktop-ui-scale, 1)));
	}
	.log-title {
		font-family: var(--font-tech);
		font-size: clamp(0.62rem, calc(0.75rem * var(--desktop-ui-scale, 1)), 0.75rem);
		font-weight: 600;
		letter-spacing: calc(0.15em * var(--desktop-ui-scale, 1));
		color: var(--c-text-accent);
		text-transform: uppercase;
	}
	.log-header-right {
		display: flex;
		align-items: center;
		gap: calc(10px * var(--desktop-ui-scale, 1));
	}
	.log-count {
		font-family: var(--font-tech);
		font-size: clamp(0.54rem, calc(0.65rem * var(--desktop-ui-scale, 1)), 0.65rem);
		color: var(--text-dim);
		letter-spacing: calc(0.1em * var(--desktop-ui-scale, 1));
	}
	.log-btn {
		padding: calc(3px * var(--desktop-ui-scale, 1)) calc(8px * var(--desktop-ui-scale, 1));
		background: transparent;
		border: 1px solid var(--c-border);
		color: var(--text-dim);
		font-family: var(--font-tech);
		font-size: clamp(0.5rem, calc(0.6rem * var(--desktop-ui-scale, 1)), 0.6rem);
		letter-spacing: calc(0.1em * var(--desktop-ui-scale, 1));
		cursor: pointer;
		transition: all 0.2s;
	}
	.log-btn:hover { border-color: var(--c-text-accent); color: var(--text-main); }
	.log-btn.active { border-color: var(--c-text-accent); color: var(--c-text-accent); background: rgba(56,189,248,0.1); }

	.log-deco {
		height: 1px;
		margin: 0 calc(20px * var(--desktop-ui-scale, 1)) calc(8px * var(--desktop-ui-scale, 1));
		background: linear-gradient(90deg, var(--c-text-accent), transparent);
		opacity: 0.4;
	}

	.log-messages {
		flex: 1;
		overflow-y: auto;
		padding: calc(8px * var(--desktop-ui-scale, 1)) calc(16px * var(--desktop-ui-scale, 1)) calc(120px * var(--desktop-ui-scale, 1));
		display: flex;
		flex-direction: column;
		gap: calc(10px * var(--desktop-ui-scale, 1));
		scrollbar-width: thin;
		scrollbar-color: var(--c-border) transparent;
	}

	.log-empty {
		font-family: var(--font-tech);
		font-size: clamp(0.62rem, calc(0.75rem * var(--desktop-ui-scale, 1)), 0.75rem);
		color: var(--text-dim);
		text-align: center;
		padding: calc(40px * var(--desktop-ui-scale, 1)) 0;
		letter-spacing: calc(0.05em * var(--desktop-ui-scale, 1));
	}

	.log-msg {
		display: flex;
		flex-direction: column;
		gap: calc(4px * var(--desktop-ui-scale, 1));
		padding: calc(8px * var(--desktop-ui-scale, 1)) calc(12px * var(--desktop-ui-scale, 1));
		border-left: 2px solid var(--c-border);
		transition: border-color 0.2s;
	}
	.log-msg.user {
		border-left-color: var(--c-text-accent);
	}
	.log-msg.assistant {
		border-left-color: #818cf8;
	}
	.log-msg.system {
		border-left-color: var(--text-dim);
		opacity: 0.6;
	}
	.log-msg.streaming {
		border-left-color: #22d3ee;
		animation: streamPulse 1.5s ease-in-out infinite;
	}

	.msg-role {
		font-family: var(--font-tech);
		font-size: clamp(0.5rem, calc(0.6rem * var(--desktop-ui-scale, 1)), 0.6rem);
		font-weight: 600;
		letter-spacing: calc(0.15em * var(--desktop-ui-scale, 1));
		text-transform: uppercase;
	}
	.log-msg.user .msg-role { color: var(--c-text-accent); }
	.log-msg.assistant .msg-role { color: #818cf8; }
	.log-msg.system .msg-role { color: var(--text-dim); }
	.log-msg.streaming .msg-role { color: #22d3ee; }

	.msg-text {
		font-family: var(--font-ui);
		font-size: clamp(0.68rem, calc(0.82rem * var(--desktop-ui-scale, 1)), 0.82rem);
		line-height: 1.55;
		color: var(--text-main);
		word-break: break-word;
		white-space: pre-wrap;
	}

	.log-msg { cursor: pointer; }
	.log-msg:active { opacity: 0.7; }

	.log-divider {
		font-family: var(--font-tech);
		font-size: clamp(0.5rem, calc(0.6rem * var(--desktop-ui-scale, 1)), 0.6rem);
		color: var(--text-dim);
		letter-spacing: calc(0.15em * var(--desktop-ui-scale, 1));
		text-align: center;
		padding: calc(8px * var(--desktop-ui-scale, 1)) 0 calc(4px * var(--desktop-ui-scale, 1));
		border-top: 1px solid var(--c-border);
		margin-top: calc(4px * var(--desktop-ui-scale, 1));
	}

	.log-entry {
		border-left-color: var(--text-dim);
		opacity: 0.7;
	}
	.log-entry .msg-role { color: var(--text-dim); }
	.log-entry.log-warn { border-left-color: #f59e0b; }
	.log-entry.log-warn .msg-role { color: #f59e0b; }
	.log-entry.log-err { border-left-color: var(--danger); opacity: 1; }
	.log-entry.log-err .msg-role { color: var(--danger); }
	.log-text { font-size: clamp(0.6rem, calc(0.72rem * var(--desktop-ui-scale, 1)), 0.72rem); }
	.log-time { color: var(--text-dim); margin-right: calc(4px * var(--desktop-ui-scale, 1)); }

	.cursor-blink {
		color: #22d3ee;
		animation: blink 0.8s step-end infinite;
	}

	@keyframes blink {
		50% { opacity: 0; }
	}

	@keyframes streamPulse {
		0%, 100% { border-left-color: #22d3ee; }
		50% { border-left-color: #818cf8; }
	}

	@media (max-width: 900px) {
		.log-toggle {
			top: calc(clamp(12px, 2vh, 24px) + var(--safe-top, 0px));
			left: calc(clamp(12px, 2vw, 24px) + var(--safe-left, 0px));
			min-width: 44px;
			min-height: 44px;
		}
		.log-panel {
			padding-top: var(--safe-top, 0px);
		}
		.log-header {
			padding-top: calc(var(--safe-top, 0px) + clamp(12px, 2vh, 24px) + clamp(40px, 7vw, 48px) + 12px);
		}
		.log-messages {
			padding-bottom: calc(120px + var(--safe-bottom, 0px));
		}
	}
	@media (max-width: 640px) {
		.log-panel { width: 100%; }
	}
	@media (min-width: 901px) and (max-width: 1280px), (min-width: 901px) and (max-height: 860px) {
		.log-panel {
			width: min(var(--desktop-panel-width, 340px), calc(100% - 20px));
		}
		.log-header {
			padding: 14px 16px 10px;
			padding-top: calc(clamp(10px, 1.8vh, 18px) + clamp(40px, 7vw, 48px) + 10px);
		}
		.log-messages {
			padding: 8px 14px 96px;
			gap: 8px;
		}
		.msg-text {
			font-size: 0.78rem;
		}
	}
</style>
