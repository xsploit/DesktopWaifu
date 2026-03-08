import type { ElectrobunConfig } from 'electrobun';

export default {
	app: {
		name: 'webwaifu3-electrobun',
		identifier: 'webwaifu3.electrobun.local',
		version: '0.0.1',
	},
	build: {
		copy: {
			'dist/index.html': 'views/mainview/index.html',
			'dist/_app': 'views/mainview/_app',
			'dist/assets': 'views/mainview/assets',
			'dist/.well-known': 'views/mainview/.well-known',
			'dist/robots.txt': 'views/mainview/robots.txt',
			'dist/og-banner.png': 'views/mainview/og-banner.png',
			'static': 'views/mainview/static',
		},
		watchIgnore: ['dist/**'],
		mac: {
			bundleCEF: false,
		},
		linux: {
			bundleCEF: false,
		},
		win: {
			bundleCEF: false,
		},
	},
} satisfies ElectrobunConfig;
