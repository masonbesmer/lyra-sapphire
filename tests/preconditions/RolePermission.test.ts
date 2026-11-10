import { ApplicationCommandRegistry, Option } from '@sapphire/framework';
import type { SubcommandMappingArray } from '@sapphire/plugin-subcommands';
import { describe, expect, it } from 'vitest';
import { setCommandPermission } from '../../src/lib/config';
import { UserPrecondition } from '../../src/preconditions/RolePermission';
import { buildPrecondition, settled, guildMember } from '../helpers/discord';

const precondition = buildPrecondition(UserPrecondition, 'RolePermission');
const DENIED = "you don't have permission for that one.";

const keywordMappings: SubcommandMappingArray = [
	{ name: 'add', messageRun: 'a' },
	{ name: 'edit', messageRun: 'e' },
	{ name: 'list', messageRun: 'l', default: true }
];

function member(roles: string[]) {
	return guildMember({ roles: { cache: new Map(roles.map((role) => [role, {}])) } });
}

const starboardMappings: SubcommandMappingArray = [
	{
		name: 'blacklist',
		type: 'group',
		entries: [
			{ name: 'add', messageRun: 'ba' },
			{ name: 'remove', messageRun: 'br' }
		]
	}
];

function chatInput(guildId: string | null, roles: string[], subcommand: string | null = null, group: string | null = null) {
	return {
		member: member(roles),
		guildId,
		options: { getSubcommandGroup: () => group, getSubcommand: () => subcommand }
	} as never;
}

function runChatInput(commandName: string, guildId: string | null, roles: string[], subcommand: string | null = null, group: string | null = null) {
	return settled(precondition.chatInputRun(chatInput(guildId, roles, subcommand, group), { name: commandName } as never));
}

/** A message command whose lexer yields `tokens`, as `messagePreParse` would after unquoting. */
function keywordCommand(tokens: string[]) {
	return subcommandCommand('keyword', keywordMappings, tokens);
}

function subcommandCommand(name: string, mappings: SubcommandMappingArray, tokens: string[]) {
	return { name, parsedSubcommandMappings: mappings, caseInsensitiveSubcommands: true, messagePreParse: lexed(tokens) } as never;
}

/** A plain `Command`, optionally with a `/config`-style slash definition registered. */
function plainCommand(name: string, tokens: string[] = [], register?: (registry: ApplicationCommandRegistry) => void) {
	const applicationCommandRegistry = new ApplicationCommandRegistry(name);
	register?.(applicationCommandRegistry);
	return { name, applicationCommandRegistry, messagePreParse: lexed(tokens) } as never;
}

function lexed(tokens: string[]) {
	return () => {
		const queue = [...tokens];
		return { nextMaybe: () => (queue.length ? Option.some(queue.shift()!) : Option.none) };
	};
}

async function runMessage(guildId: string, roles: string[] | null, command: unknown) {
	const message = { member: roles === null ? null : member(roles), guildId } as never;
	return precondition.messageRun(message, command as never, { parameters: '', context: {} } as never);
}

describe('RolePermission basics', () => {
	const GUILD = 'roleperm-basics';
	setCommandPermission(GUILD, 'Ban', 'mod');

	it('allows commands outside a guild', () => {
		expect(runChatInput('ban', null, []).isOk()).toBe(true);
	});

	it('reads the role IDs of a raw API member from an uncached guild', () => {
		const run = (roles: string[]) =>
			settled(
				precondition.chatInputRun(
					{ member: { roles }, guildId: GUILD, options: { getSubcommandGroup: () => null, getSubcommand: () => null } } as never,
					{ name: 'ban' } as never
				)
			);
		expect(run([]).isErr()).toBe(true);
		expect(run(['mod']).isOk()).toBe(true);
	});

	it('refuses a gated command when the invoker cannot be resolved to a member', async () => {
		expect((await runMessage(GUILD, null, plainCommand('ban'))).isErr()).toBe(true);
		expect((await runMessage(GUILD, null, plainCommand('ping'))).isOk()).toBe(true);
	});

	it('refuses members without the required role and allows those with it', () => {
		const result = runChatInput('ban', GUILD, ['member']);
		expect(result.isErr()).toBe(true);
		expect(result.unwrapErr().message).toBe(DENIED);
		expect(runChatInput('ban', GUILD, ['mod']).isOk()).toBe(true);
	});

	it('is scoped to the guild that set the requirement', () => {
		expect(runChatInput('ban', 'roleperm-other', []).isOk()).toBe(true);
	});

	it('keys context menu commands on the command piece name', () => {
		const interaction = { member: member([]), guildId: GUILD, commandName: 'Ban User' } as never;
		expect(settled(precondition.contextMenuRun(interaction, { name: 'ban' } as never)).isErr()).toBe(true);
	});

	it('gates a plain message command by its name', async () => {
		expect((await runMessage(GUILD, [], plainCommand('ban'))).isErr()).toBe(true);
		expect((await runMessage(GUILD, [], plainCommand('ping'))).isOk()).toBe(true);
	});

	it('never gates /permissions, even with a stray row', () => {
		setCommandPermission(GUILD, 'permissions', 'mod');
		expect(runChatInput('permissions', GUILD, [], 'set').isOk()).toBe(true);
	});
});

describe('RolePermission with no gate', () => {
	it('allows the command and its subcommands', async () => {
		expect(runChatInput('keyword', 'roleperm-none', [], 'add').isOk()).toBe(true);
		expect((await runMessage('roleperm-none', [], keywordCommand(['add']))).isOk()).toBe(true);
	});
});

describe('RolePermission with a parent-only gate', () => {
	const GUILD = 'roleperm-parent';
	setCommandPermission(GUILD, 'keyword', 'A');

	it('applies to every subcommand', async () => {
		expect(runChatInput('keyword', GUILD, [], 'add').isErr()).toBe(true);
		expect(runChatInput('keyword', GUILD, ['A'], 'add').isOk()).toBe(true);
		expect((await runMessage(GUILD, [], keywordCommand(['edit']))).isErr()).toBe(true);
		expect((await runMessage(GUILD, ['A'], keywordCommand(['edit']))).isOk()).toBe(true);
	});
});

describe('RolePermission with a subcommand-only gate', () => {
	const GUILD = 'roleperm-sub';
	setCommandPermission(GUILD, 'keyword add', 'B');

	it('applies to that subcommand only', async () => {
		expect(runChatInput('keyword', GUILD, [], 'add').isErr()).toBe(true);
		expect(runChatInput('keyword', GUILD, ['B'], 'add').isOk()).toBe(true);
		expect(runChatInput('keyword', GUILD, [], 'edit').isOk()).toBe(true);
		expect((await runMessage(GUILD, [], keywordCommand(['add', 'hi']))).isErr()).toBe(true);
		expect((await runMessage(GUILD, [], keywordCommand(['edit']))).isOk()).toBe(true);
	});

	it('resolves the subcommand from the lexed token, so a quoted "add" is still gated', async () => {
		expect((await runMessage(GUILD, [], keywordCommand(['ADD']))).isErr()).toBe(true);
	});
});

describe('RolePermission with parent and subcommand gates', () => {
	const GUILD = 'roleperm-both';
	setCommandPermission(GUILD, 'keyword', 'A');
	setCommandPermission(GUILD, 'keyword add', 'B');

	it('requires both roles on a slash command', () => {
		expect(runChatInput('keyword', GUILD, ['A'], 'add').isErr()).toBe(true);
		expect(runChatInput('keyword', GUILD, ['B'], 'add').isErr()).toBe(true);
		expect(runChatInput('keyword', GUILD, ['A', 'B'], 'add').isOk()).toBe(true);
		expect(runChatInput('keyword', GUILD, ['A'], 'edit').isOk()).toBe(true);
	});

	it('requires both roles on a message command', async () => {
		expect((await runMessage(GUILD, ['A'], keywordCommand(['add']))).isErr()).toBe(true);
		expect((await runMessage(GUILD, ['B'], keywordCommand(['add']))).isErr()).toBe(true);
		expect((await runMessage(GUILD, ['A', 'B'], keywordCommand(['add']))).isOk()).toBe(true);
	});
});

describe('RolePermission on a default subcommand', () => {
	const GUILD = 'roleperm-default';
	setCommandPermission(GUILD, 'keyword list', 'L');

	it('gates a message invocation that falls back to the default by the default path', async () => {
		expect((await runMessage(GUILD, [], keywordCommand([]))).isErr()).toBe(true);
		expect((await runMessage(GUILD, ['L'], keywordCommand(['whatever']))).isOk()).toBe(true);
	});
});

describe('RolePermission on a subcommand group entry', () => {
	const GUILD = 'roleperm-group';
	setCommandPermission(GUILD, 'starboard', 'A');
	setCommandPermission(GUILD, 'starboard blacklist add', 'B');

	it('requires every gate on the group path for a slash command', () => {
		expect(runChatInput('starboard', GUILD, ['A'], 'add', 'blacklist').isErr()).toBe(true);
		expect(runChatInput('starboard', GUILD, ['B'], 'add', 'blacklist').isErr()).toBe(true);
		expect(runChatInput('starboard', GUILD, ['A', 'B'], 'add', 'blacklist').isOk()).toBe(true);
		expect(runChatInput('starboard', GUILD, ['A'], 'remove', 'blacklist').isOk()).toBe(true);
	});

	it('requires every gate on the group path for a message command', async () => {
		const command = (tokens: string[]) => subcommandCommand('starboard', starboardMappings, tokens);
		expect((await runMessage(GUILD, ['A'], command(['blacklist', 'add']))).isErr()).toBe(true);
		expect((await runMessage(GUILD, ['A', 'B'], command(['blacklist', 'add']))).isOk()).toBe(true);
		expect((await runMessage(GUILD, ['A'], command(['blacklist', 'remove']))).isOk()).toBe(true);
	});
});

describe('RolePermission on a plain command with registered subcommands', () => {
	const GUILD = 'roleperm-plain';
	setCommandPermission(GUILD, 'config', 'A');
	setCommandPermission(GUILD, 'config music dj-role', 'B');
	const config = (tokens: string[]) =>
		plainCommand('config', tokens, (registry) =>
			registry.registerChatInputCommand((builder) =>
				builder
					.setName('config')
					.setDescription('d')
					.addSubcommand((sub) => sub.setName('view').setDescription('d'))
					.addSubcommandGroup((group) =>
						group
							.setName('music')
							.setDescription('d')
							.addSubcommand((sub) => sub.setName('dj-role').setDescription('d'))
					)
			)
		);

	it('requires every gate on the group path for a message command', async () => {
		expect((await runMessage(GUILD, ['A'], config(['music', 'dj-role', '@mods']))).isErr()).toBe(true);
		expect((await runMessage(GUILD, ['A', 'B'], config(['music', 'dj-role', '@mods']))).isOk()).toBe(true);
		expect((await runMessage(GUILD, ['A'], config(['view']))).isOk()).toBe(true);
		expect((await runMessage(GUILD, [], config(['view']))).isErr()).toBe(true);
	});
});
