import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

function gitVersion(): string {
	try {
		return execSync('git describe --tags --always --dirty').toString().trim();
	} catch {
		return 'unknown';
	}
}

export default defineConfig({
	plugins: [svelte()],
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
