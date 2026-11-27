import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';
import { container } from '@sapphire/framework';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runScheduledAction } from '../../src/lib/modScheduler';
import { getCasesForTarget, getScheduledActions, scheduleAction } from '../../src/lib/moderation';

function apiError(code: number) {
	return new DiscordAPIError({ code, message: 'x' }, code, 404, 'DELETE', '/x', {});
}

function fakeClient(guildId: string, overrides: { bansRemove?: () => Promise<unknown>; member?: unknown } = {}) {
	const bansRemove = vi.fn(overrides.bansRemove ?? (async () => undefined));
	const client: Record<string, unknown> = { user: { id: 'bot', username: 'lyra' }, users: { fetch: vi.fn(async () => ({ username: 'someone' })) } };
	const guild = {
		id: guildId,
		client,
		bans: { remove: bansRemove },
		members: {
			cache: new Map(overrides.member ? [['u', overrides.member]] : []),
			fetch: vi.fn(async () => Promise.reject(apiError(RESTJSONErrorCodes.UnknownMember)))
		},
		channels: { cache: new Map(), fetch: vi.fn() }
	};
	client.guilds = { cache: new Map([[guildId, guild]]) };
	return { client: client as never, bansRemove };
}

function onlyAction(guildId: string) {
	const [action] = getScheduledActions(guildId, 'u');
	return action;
}

beforeEach(() => {
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

describe('runScheduledAction', () => {
	it('lifts an expired temp-ban, records a case and clears the row', async () => {
		scheduleAction('sch-unban', 'unban', 'u', new Date(0), 7);
		const { client, bansRemove } = fakeClient('sch-unban');
		expect(await runScheduledAction(client, onlyAction('sch-unban'))).toBe('done');
		expect(bansRemove).toHaveBeenCalledWith('u', 'Temp-ban expired (case #7)');
		expect(getScheduledActions('sch-unban', 'u')).toEqual([]);
		expect(getCasesForTarget('sch-unban', 'u')[0]).toMatchObject({ action: 'unban', moderator_id: 'bot', reason: 'Temp-ban expired (case #7)' });
	});

	it('drops the row when the ban is already gone', async () => {
		scheduleAction('sch-gone', 'unban', 'u', new Date(0), 1);
		const { client } = fakeClient('sch-gone', { bansRemove: async () => Promise.reject(apiError(RESTJSONErrorCodes.UnknownBan)) });
		expect(await runScheduledAction(client, onlyAction('sch-gone'))).toBe('gone');
		expect(getScheduledActions('sch-gone', 'u')).toEqual([]);
		expect(getCasesForTarget('sch-gone', 'u')).toEqual([]);
	});

	it('retries other failures later', async () => {
		scheduleAction('sch-retry', 'unban', 'u', new Date(0), 1);
		const { client } = fakeClient('sch-retry', { bansRemove: async () => Promise.reject(new Error('network')) });
		expect(await runScheduledAction(client, onlyAction('sch-retry'), new Date('2026-01-01T00:00:00Z'))).toBe('retry');
		expect(onlyAction('sch-retry')).toMatchObject({ attempts: 1, run_at: '2026-01-01T00:01:00.000Z' });
	});

	it('drops actions for guilds the bot has left', async () => {
		scheduleAction('sch-left', 'unban', 'u', new Date(0), 1);
		const { client } = fakeClient('somewhere-else');
		expect(await runScheduledAction(client, onlyAction('sch-left'))).toBe('gone');
		expect(getScheduledActions('sch-left', 'u')).toEqual([]);
	});

	it('removes an expired timed role', async () => {
		scheduleAction('sch-role', 'role-remove', 'u', new Date(0), 3, 'r1');
		const remove = vi.fn(async () => undefined);
		const member = { id: 'u', user: { username: 'someone' }, roles: { cache: new Map([['r1', {}]]), remove } };
		const { client } = fakeClient('sch-role', { member });
		expect(await runScheduledAction(client, onlyAction('sch-role'))).toBe('done');
		expect(remove).toHaveBeenCalledWith('r1', 'Timed role expired (case #3)');
		expect(getCasesForTarget('sch-role', 'u')[0]).toMatchObject({ action: 'role-remove' });
	});

	it('treats a timed role on someone who left, or who already lost it, as done', async () => {
		scheduleAction('sch-role-left', 'role-remove', 'u', new Date(0), 3, 'r1');
		const { client } = fakeClient('sch-role-left');
		expect(await runScheduledAction(client, onlyAction('sch-role-left'))).toBe('done');
		expect(getScheduledActions('sch-role-left', 'u')).toEqual([]);
		expect(getCasesForTarget('sch-role-left', 'u')).toEqual([]);
	});
});
