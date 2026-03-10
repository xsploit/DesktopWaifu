<script lang="ts">
	import { injectAnalytics } from '@vercel/analytics/sveltekit';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';

	injectAnalytics({ mode: 'auto' });

	let { children } = $props();

	// mark the root element when running in the Electrobun shell so
	// CSS rules targeting the transparent background can apply.
	if (typeof window !== 'undefined') {
		console.log('layout shell detection', {
			navigator: navigator.userAgent,
			__electrobun: (window as any).__electrobun,
			__electrobunWebviewId: (window as any).__electrobunWebviewId,
			dataset: document.documentElement.dataset.desktopShell,
		});
		if ((window as any).__electrobun || (window as any).__electrobunWebviewId) {
			document.documentElement.dataset.desktopShell = 'electrobun';
		}
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
