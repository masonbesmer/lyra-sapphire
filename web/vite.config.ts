import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { THEMES, THEME_STORAGE_KEY } from './src/lib/theme-names';

function gitVersion(): string {
	try {
		return execSync('git describe --tags --always --dirty').toString().trim();
	} catch {
		return 'unknown';
	}
}

// The pre-paint script in index.html runs before any bundle, so it cannot import the theme names.
function themeNames(): Plugin {
	return {
		name: 'lyra-theme-names',
		transformIndexHtml: (html) => html.replaceAll('%LYRA_THEMES%', THEMES.join(',')).replaceAll('%LYRA_THEME_STORAGE_KEY%', THEME_STORAGE_KEY)
	};
}

export default defineConfig({
	plugins: [svelte(), themeNames()],
	define: {
		__APP_VERSION__: JSON.stringify(gitVersion()),
		__BUILD_TIME__: JSON.stringify(new Date().toISOString())
	},
	build: {
		outDir: '../dist/web',
		emptyOutDir: true
	},
	server: {
		proxy: {
			'/api': 'http://localhost:4000',
			'/oauth': 'http://localhost:4000',
			'/ws': {
				target: 'ws://localhost:4000',
				ws: true
			}
		}
	}
});
