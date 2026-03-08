import { defineConfig } from 'tsup';

export default defineConfig({
	// Don't clean dist to preserve web build
	clean: false,
	bundle: false,
	dts: false,
	entry: ['src/**/*.ts', '!src/**/*.d.ts'],
	outDir: 'dist',
	format: ['cjs'],
	minify: false,
	tsconfig: 'tsconfig.json',
	target: 'es2020',
	splitting: false,
	skipNodeModulesBundle: true,
	sourcemap: true,
	shims: false,
	keepNames: true
});
