import { Listener, container } from '@sapphire/framework';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

const DIR = join(__dirname, '../../src/listeners/eventLog');

describe('event-log listeners', () => {
	it('export only uniquely named Listener pieces', async () => {
		(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
		(container as any).client ??= { options: {} };
		const names: string[] = [];
		for (const file of readdirSync(DIR).filter((name) => name.endsWith('.ts'))) {
			const module = (await import(join(DIR, file))) as Record<string, unknown>;
			for (const [exportName, value] of Object.entries(module)) {
				expect(typeof value === 'function' && value.prototype instanceof Listener, `${file}: ${exportName}`).toBe(true);
				const Ctor = value as new (context: never, options: never) => Listener;
				const piece = new Ctor({ name: exportName, path: join(DIR, file), root: DIR, store: null } as never, {} as never);
				names.push(piece.name);
			}
		}
		expect(names.length).toBeGreaterThan(10);
		expect(new Set(names).size).toBe(names.length);
	});
});
