import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
	plugins: [svelte()],
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
