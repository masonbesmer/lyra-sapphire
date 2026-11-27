import { ApplicationCommandRegistry, container } from '@sapphire/framework';
import { join } from 'node:path';
import { ApplicationCommandType } from 'discord.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { registeredSubcommandPaths } from '../../src/lib/commandPermissions';
import { looksLikeCommand } from '../../src/listeners/modmailDm';

const DIR = join(__dirname, '../../src/commands/Support');

interface Built {
	name: string;
	type?: number;
	default_member_permissions?: string | null;
	contexts?: number[];
}

const built = new Map<string, { registry: ApplicationCommandRegistry; calls: Built[] }>();

beforeAll(async () => {
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
	(container as any).client ??= { options: {} };
	for (const file of ['report.ts', 'ticket.ts']) {
		const module = (await import(join(DIR, file))) as Record<string, unknown>;
		const Ctor = Object.values(module).find((value) => typeof value === 'function') as new (
			context: never,
			options: never
		) => Record<string, unknown>;
		const command = new Ctor({ name: file.replace(/\.ts$/, ''), path: join(DIR, file), root: DIR, store: null } as never, {} as never);
		const registry = new ApplicationCommandRegistry(command.name as string);
		(command.registerApplicationCommands as (registry: ApplicationCommandRegistry) => void).call(command, registry);
		const calls = (registry as unknown as { apiCalls: { builtData: Built }[] }).apiCalls.map((call) => call.builtData);
		built.set(command.name as string, { registry, calls });
	}
});

describe('member-facing commands', () => {
	it('are guild-only and open to everyone', () => {
		for (const [name, { calls }] of built) {
			for (const call of calls) {
				expect(call.contexts, name).toEqual([0]);
				expect(call.default_member_permissions ?? null, name).toBeNull();
			}
		}
	});

	it('registers /report and the "Report message" context menu', () => {
		const calls = built.get('report')!.calls;
		expect(calls.map((call) => call.name)).toEqual(['report', 'Report message']);
		expect(calls[1].type).toBe(ApplicationCommandType.Message);
	});

	it('exposes ticket subcommands to /permissions', () => {
		expect(registeredSubcommandPaths('ticket', built.get('ticket')!.registry)).toEqual(['ticket open', 'ticket close', 'ticket panel']);
	});
});

describe('modmail DM filter', () => {
	it.each(['%play song', '  %help', 'lyra, play something', 'hey lyra play x', 'Lyra! skip'])('treats %j as a command', (text) =>
		expect(looksLikeCommand(text)).toBe(true)
	);
	it.each(['hi, someone is spamming in #general', 'lyrics please', 'I want to appeal'])('treats %j as a message for staff', (text) =>
		expect(looksLikeCommand(text)).toBe(false)
	);
});
