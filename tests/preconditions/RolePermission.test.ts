import { describe, expect, it } from 'vitest';
import { setCommandPermission } from '../../src/lib/config';
import { UserPrecondition } from '../../src/preconditions/RolePermission';
import { buildPrecondition, settled, guildMember } from '../helpers/discord';

const GUILD = 'roleperm-guild';
const precondition = buildPrecondition(UserPrecondition, 'RolePermission');

setCommandPermission(GUILD, 'Ban', 'mod');

function member(roles: string[]) {
	return guildMember({ roles: { cache: new Map(roles.map((role) => [role, {}])) } });
}

function interaction(commandName: string, roles: string[], guildId: string | null = GUILD) {
	return { commandName, member: member(roles), guildId } as never;
}

describe('RolePermission', () => {
	it('allows commands outside a guild', () => {
		expect(settled(precondition.chatInputRun(interaction('ban', [], null))).isOk()).toBe(true);
	});

	it('allows an interaction whose member is not a resolved GuildMember', () => {
		expect(settled(precondition.chatInputRun({ commandName: 'ban', member: { roles: [] }, guildId: GUILD } as never)).isOk()).toBe(true);
	});

	it('allows commands with no role requirement', () => {
		expect(settled(precondition.chatInputRun(interaction('ping', []))).isOk()).toBe(true);
	});

	it('allows members holding the required role', () => {
		expect(settled(precondition.chatInputRun(interaction('ban', ['mod']))).isOk()).toBe(true);
		expect(settled(precondition.contextMenuRun(interaction('ban', ['mod']))).isOk()).toBe(true);
	});

	it('refuses members without the required role', () => {
		const result = settled(precondition.chatInputRun(interaction('ban', ['member'])));
		expect(result.isErr()).toBe(true);
		expect(result.unwrapErr().message).toBe("you don't have permission for that one.");
	});

	it('is scoped to the guild that set the requirement', () => {
		expect(settled(precondition.chatInputRun(interaction('ban', [], 'roleperm-other'))).isOk()).toBe(true);
	});

	it('checks message commands by command name', () => {
		const message = { member: member([]), guildId: GUILD } as never;
		expect(settled(precondition.messageRun(message, { name: 'ban' } as never)).isErr()).toBe(true);
		expect(settled(precondition.messageRun(message, { name: 'ping' } as never)).isOk()).toBe(true);
	});
});
