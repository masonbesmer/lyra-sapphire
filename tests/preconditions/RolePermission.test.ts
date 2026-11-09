import { Option } from '@sapphire/framework';
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

function chatInput(guildId: string | null, roles: string[], subcommand: string | null = null) {
	return {
		member: member(roles),
		guildId,
		options: { getSubcommandGroup: () => null, getSubcommand: () => subcommand }
	} as never;
}

function runChatInput(commandName: string, guildId: string | null, roles: string[], subcommand: string | null = null) {
	return settled(precondition.chatInputRun(chatInput(guildId, roles, subcommand), { name: commandName } as never));
}

/** A message command whose lexer yields `tokens`, as `messagePreParse` would after unquoting. */
function keywordCommand(tokens: string[]) {
	return {
		name: 'keyword',
		parsedSubcommandMappings: keywordMappings,
		caseInsensitiveSubcommands: true,
		messagePreParse: () => {
			const queue = [...tokens];
			return { nextMaybe: () => (queue.length ? Option.some(queue.shift()!) : Option.none) };
		}
	} as never;
}

async function runMessage(guildId: string, roles: string[], command: unknown) {
	const message = { member: member(roles), guildId } as never;
	return precondition.messageRun(message, command as never, { parameters: '', context: {} } as never);
}

describe('RolePermission basics', () => {
	const GUILD = 'roleperm-basics';
	setCommandPermission(GUILD, 'Ban', 'mod');

	it('allows commands outside a guild', () => {
		expect(runChatInput('ban', null, []).isOk()).toBe(true);
	});

	it('allows an interaction whose member is not a resolved GuildMember', () => {
		const interaction = {
			member: { roles: [] },
			guildId: GUILD,
			options: { getSubcommandGroup: () => null, getSubcommand: () => null }
		} as never;
		expect(settled(precondition.chatInputRun(interaction, { name: 'ban' } as never)).isOk()).toBe(true);
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
		expect((await runMessage(GUILD, [], { name: 'ban' })).isErr()).toBe(true);
		expect((await runMessage(GUILD, [], { name: 'ping' })).isOk()).toBe(true);
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
