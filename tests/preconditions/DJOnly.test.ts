import { describe, expect, it } from 'vitest';
import { setMusicConfig } from '../../src/lib/config';
import { UserPrecondition } from '../../src/preconditions/DJOnly';
import { buildPrecondition, settled, guildMember } from '../helpers/discord';

const MESSAGE = '🚫 nice try, you need the DJ role for that.';
const GUILD = 'djonly-guild';
const precondition = buildPrecondition(UserPrecondition, 'DJOnly');

setMusicConfig({ guild_id: GUILD, dj_role_id: 'dj' });

function member(hasRole: boolean) {
	return guildMember({
		permissions: { has: () => false },
		guild: { id: GUILD, roles: { cache: new Map([['dj', {}]]) } },
		roles: { cache: new Map(hasRole ? [['dj', {}]] : []) },
		voice: { channel: null }
	});
}

function interaction(cached: boolean, hasRole = false) {
	return { inCachedGuild: () => cached, member: member(hasRole), guildId: GUILD } as never;
}

describe('DJOnly', () => {
	it('refuses an interaction outside a cached guild', () => {
		const result = settled(precondition.chatInputRun(interaction(false, true)));
		expect(result.isErr()).toBe(true);
		expect(result.unwrapErr().message).toBe(MESSAGE);
		expect(settled(precondition.contextMenuRun(interaction(false, true))).isErr()).toBe(true);
	});

	it('checks the DJ role on interactions', () => {
		expect(settled(precondition.chatInputRun(interaction(true, true))).isOk()).toBe(true);
		expect(settled(precondition.contextMenuRun(interaction(true, true))).isOk()).toBe(true);
		expect(settled(precondition.chatInputRun(interaction(true, false))).isErr()).toBe(true);
	});

	it('refuses a message without a guild member', () => {
		expect(settled(precondition.messageRun({ guildId: GUILD, member: { id: 'not-a-guild-member' } } as never)).isErr()).toBe(true);
		expect(settled(precondition.messageRun({ guildId: null, member: member(true) } as never)).isErr()).toBe(true);
	});

	it('checks the DJ role on messages', () => {
		expect(settled(precondition.messageRun({ guildId: GUILD, member: member(true) } as never)).isOk()).toBe(true);
		expect(settled(precondition.messageRun({ guildId: GUILD, member: member(false) } as never)).isErr()).toBe(true);
	});
});
