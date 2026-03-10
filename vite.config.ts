import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
	// when the Electrobun desktop shell manages the app we'll run the
	// frontend on plain HTTP to avoid self-signed certificate errors in the
	// WebKit view.  The `ELECTROBUN_DEV` variable is set by the npm scripts
	// below.
	plugins: [
		...(mode === 'development' && !process.env.ELECTROBUN_DEV ? [basicSsl()] : []),
		tailwindcss(),
		sveltekit()
	],
	worker: {
		format: 'es'
	},
	build: {
		rollupOptions: {
			output: {
				manualChunks(id) {
					const normalized = id.replace(/\\/g, '/');
					if (!normalized.includes('/node_modules/')) return undefined;

					if (
						normalized.includes('/@pixiv/three-vrm')
					) {
						return 'vendor-vrm';
					}

					if (
						normalized.includes('/three/examples/jsm/postprocessing/') ||
						normalized.includes('/three/examples/jsm/shaders/') ||
						normalized.includes('/three/examples/jsm/effects/')
					) {
						return 'vendor-three-fx';
					}

					if (
						normalized.includes('/three/examples/jsm/loaders/')
					) {
						return 'vendor-three-loaders';
					}

					if (
						normalized.includes('/three/examples/jsm/')
					) {
						return 'vendor-three-extras';
					}

					if (
						normalized.includes('/three/')
					) {
						return 'vendor-three-core';
					}

					if (
						normalized.includes('/@ai-sdk/') ||
						normalized.includes('/ai/dist/')
					) {
						return 'vendor-ai';
					}

					return 'vendor';
				}
			}
		}
	},
	ssr: {
		noExternal: ['three', '@pixiv/three-vrm']
	}
}));
