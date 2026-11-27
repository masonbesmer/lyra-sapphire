import { ApplicationCommandRegistry, container } from '@sapphire/framework';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PermissionFlagsBits } from 'discord.js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { registeredSubcommandPaths } from '../../src/lib/commandPermissions';

const DIR = join(__dirname, '../../src/commands/Moderation');
const files = readdirSync(DIR).filter((file) => file.endsWith('.ts'));

interface Built {
	name: string;
	description: string;
	default_member_permissions: string | null;
	contexts?: number[];
	options?: { name: string; description: string; required?: boolean; type: number; options?: { name: string; required?: boolean }[] }[];
}

const commands = new Map<string, { registry: ApplicationCommandRegistry; built: Built; command: Record<string, unknown> }>();

beforeAll(async () => {
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
	// Command constructors read the client's default cooldown options; nothing else.
	(container as any).client ??= { options: {} };
	for (const file of files) {
		const module = (await import(join(DIR, file))) as Record<string, new (context: never, options: never) => Record<string, unknown>>;
		const Ctor = Object.values(module).find((value) => typeof value === 'function')!;
		const command = new Ctor({ name: file.replace(/\.ts$/, ''), path: join(DIR, file), root: DIR, store: null } as never, {} as never);
		const registry = new ApplicationCommandRegistry(command.name as string);
		(command.registerApplicationCommands as (registry: ApplicationCommandRegistry) => void).call(command, registry);
		const calls = (registry as unknown as { apiCalls: { builtData: Built }[] }).apiCalls;
		commands.set(command.name as string, { registry, built: calls[0].builtData, command });
	}
});

describe('moderation commands', () => {
	it('loads every file', () => {
		expect([...commands.keys()].sort()).toEqual([
			'automod',
			'ban',
			'case',
			'kick',
			'lock',
			'modconfig',
			'modlogs',
			'nick',
			'note',
			'purge',
			'role',
			'slowmode',
			'softban',
			'timeout',
			'unban',
			'unlock',
			'untimeout',
			'warn',
			'warnconfig'
		]);
	});

	it('registers guild-only slash commands hidden from members without the permission', () => {
		for (const [name, { built }] of commands) {
			expect(built.name, name).toBe(name);
			expect(built.description.length, name).toBeLessThanOrEqual(100);
			expect(built.contexts, name).toEqual([0]);
			expect(BigInt(built.default_member_permissions ?? '0'), name).not.toBe(0n);
		}
	});

	it('puts required options before optional ones (Discord rejects the reverse)', () => {
		for (const [name, { built }] of commands) {
			const groups = built.options?.some((option) => option.options)
				? built.options!.map((option) => option.options ?? [])
				: [built.options ?? []];
			for (const options of groups) {
				const firstOptional = options.findIndex((option) => !option.required);
				if (firstOptional === -1) continue;
				expect(
					options.slice(firstOptional).every((option) => !option.required),
					name
				).toBe(true);
			}
		}
	});

	it('asks for the right Discord permission', () => {
		const expected: Record<string, bigint> = {
			warn: PermissionFlagsBits.ModerateMembers,
			timeout: PermissionFlagsBits.ModerateMembers,
			kick: PermissionFlagsBits.KickMembers,
			ban: PermissionFlagsBits.BanMembers,
			unban: PermissionFlagsBits.BanMembers,
			softban: PermissionFlagsBits.BanMembers,
			purge: PermissionFlagsBits.ManageMessages,
			lock: PermissionFlagsBits.ManageChannels,
			nick: PermissionFlagsBits.ManageNicknames,
			role: PermissionFlagsBits.ManageRoles,
			modconfig: PermissionFlagsBits.ManageGuild,
			automod: PermissionFlagsBits.ManageGuild,
			warnconfig: PermissionFlagsBits.ManageGuild
		};
		for (const [name, bits] of Object.entries(expected)) {
			expect(BigInt(commands.get(name)!.built.default_member_permissions!), name).toBe(bits);
		}
	});

	it('exposes subcommands to /permissions role gates', () => {
		expect(registeredSubcommandPaths('role', commands.get('role')!.registry)).toEqual(['role add', 'role remove']);
		expect(registeredSubcommandPaths('case', commands.get('case')!.registry)).toEqual(['case view', 'case edit-reason', 'case delete']);
		expect(registeredSubcommandPaths('note', commands.get('note')!.registry)).toEqual(['note add', 'note list', 'note remove']);
		expect(registeredSubcommandPaths('modconfig', commands.get('modconfig')!.registry)).toEqual([
			'modconfig view',
			'modconfig log-channel',
			'modconfig dm'
		]);
		expect(registeredSubcommandPaths('automod', commands.get('automod')!.registry)).toEqual([
			'automod view',
			'automod configure',
			'automod list',
			'automod list add',
			'automod list remove',
			'automod list show',
			'automod exempt',
			'automod exempt add',
			'automod exempt remove',
			'automod native',
			'automod test'
		]);
		expect(registeredSubcommandPaths('warnconfig', commands.get('warnconfig')!.registry)).toEqual([
			'warnconfig view',
			'warnconfig set',
			'warnconfig remove',
			'warnconfig expiry'
		]);
	});
});
