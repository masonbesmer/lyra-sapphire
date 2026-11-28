import { DiscordAPIError, PermissionFlagsBits, RESTJSONErrorCodes } from 'discord.js';
import { container } from '@sapphire/framework';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ModError, actWithCase, auditReason, describeError, notifyTarget, snowflakeFrom } from '../../src/lib/modActions';
import { readOverwrite } from '../../src/lib/modLock';
import { getCase, getCasesForTarget, setDmOnAction, setModLogChannel } from '../../src/lib/moderation';
import { setModQueueField } from '../../src/lib/modQueue';

function apiError(code: number) {
	return new DiscordAPIError({ code, message: 'x' }, code, 404, 'GET', '/x', {});
}

/** Just enough of a Guild for the mod log and DMs. */
function fakeGuild(id: string, send = vi.fn(async () => ({ id: 'logmsg' }))) {
	const channel = { id: 'log', isSendable: () => true, send };
	return {
		guild: { id, name: 'Test Server', channels: { cache: new Map([['log', channel]]), fetch: vi.fn() } } as never,
		send
	};
}

function fakeUser(id = 'u1', send = vi.fn(async () => undefined)) {
	return { user: { id, username: 'someone', send } as never, send };
}

beforeEach(() => {
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

describe('snowflakeFrom', () => {
	it.each([
		['123456789012345678', '123456789012345678'],
		['<@123456789012345678>', '123456789012345678'],
		['<@!123456789012345678>', '123456789012345678'],
		['<#123456789012345678>', '123456789012345678'],
		['<@&123456789012345678>', '123456789012345678']
	])('%s', (input, expected) => expect(snowflakeFrom(input)).toBe(expected));

	it.each(['server', '123', '', null])('rejects %j', (input) => expect(snowflakeFrom(input)).toBeNull());
});

describe('auditReason', () => {
	it('names the moderator and caps at 512', () => {
		expect(auditReason({ username: 'mod', discriminator: '0' } as never, null)).toBe('mod: No reason given');
		expect(auditReason({ username: 'mod', discriminator: '0' } as never, 'x'.repeat(600))).toHaveLength(512);
	});
});

describe('describeError', () => {
	it('passes ModError messages through', () => {
		expect(describeError(new ModError('nope'))).toBe('nope');
	});

	it('explains common Discord errors', () => {
		expect(describeError(apiError(RESTJSONErrorCodes.UnknownBan))).toMatch(/isn't banned/);
		expect(describeError(apiError(RESTJSONErrorCodes.MissingPermissions))).toMatch(/missing a permission/);
	});
});

describe('notifyTarget', () => {
	it('DMs when the guild has DMs on for the action', async () => {
		const { guild } = fakeGuild('dm-on');
		const { user, send } = fakeUser();
		expect(await notifyTarget(guild, user, 'ban', { caseNumber: 4, reason: 'raiding', durationMs: 86_400_000 })).toBe(true);
		const content = (send.mock.calls[0] as unknown as [{ content: string }])[0].content;
		expect(content).toContain('banned from** **Test Server**');
		expect(content).toContain('**Duration:** 1d');
		expect(content).toContain('raiding');
		expect(content).toContain('Case #4');
	});

	it('adds the appeal button and link to a ban DM when appeals are set up', async () => {
		setModQueueField('dm-appeal', 'appeal_channel_id', '123456789012345678');
		setModQueueField('dm-appeal', 'appeal_url', 'https://example.com/appeal');
		const { guild } = fakeGuild('dm-appeal');
		const { user, send } = fakeUser();
		await notifyTarget(guild, user, 'ban', { caseNumber: 1, reason: null });
		await notifyTarget(guild, user, 'kick', { caseNumber: 2, reason: null });
		const [ban, kick] = send.mock.calls.map(
			(call) => (call as unknown as [{ components: { toJSON(): { components: Record<string, unknown>[] } }[] }])[0]
		);
		const buttons = ban.components[0].toJSON().components;
		expect(buttons.map((button) => button.custom_id ?? button.url)).toEqual(['mod:appeal:open:dm-appeal', 'https://example.com/appeal']);
		expect(kick.components).toEqual([]);
	});

	it('sends no appeal buttons when appeals are off', async () => {
		const { guild } = fakeGuild('dm-no-appeal');
		const { user, send } = fakeUser();
		await notifyTarget(guild, user, 'ban', { caseNumber: 1, reason: null });
		expect((send.mock.calls[0] as unknown as [{ components: unknown[] }])[0].components).toEqual([]);
	});

	it('stays quiet when DMs are off for that action, or the action never DMs', async () => {
		setDmOnAction('dm-off', 'kick', false);
		const { guild } = fakeGuild('dm-off');
		const { user, send } = fakeUser();
		expect(await notifyTarget(guild, user, 'kick', { caseNumber: 1, reason: null })).toBe(false);
		expect(await notifyTarget(guild, user, 'purge', { caseNumber: 1, reason: null })).toBe(false);
		expect(send).not.toHaveBeenCalled();
	});

	it('reports closed DMs as not sent', async () => {
		const { guild } = fakeGuild('dm-closed');
		const { user } = fakeUser(
			'u1',
			vi.fn(async () => Promise.reject(new Error('Cannot send messages to this user')))
		);
		expect(await notifyTarget(guild, user, 'warn', { caseNumber: 1, reason: null })).toBe(false);
	});
});

describe('actWithCase', () => {
	const input = { action: 'kick' as const, targetId: 'u1', targetTag: 'someone', moderatorId: 'm', moderatorTag: 'mod', reason: 'r' };

	it('DMs before acting, then logs the case', async () => {
		const order: string[] = [];
		const { guild, send } = fakeGuild(
			'awc-ok',
			vi.fn(async () => (order.push('log'), { id: 'logmsg' }))
		);
		setModLogChannel('awc-ok', 'log');
		const { user } = fakeUser(
			'u1',
			vi.fn(async () => void order.push('dm'))
		);
		const { modCase, dm } = await actWithCase(guild, input, async () => void order.push('act'), { notify: user });
		expect(order).toEqual(['dm', 'act', 'log']);
		expect(dm).toBe(true);
		expect(send).toHaveBeenCalledOnce();
		expect(getCase('awc-ok', modCase.case_number)).toMatchObject({ log_channel_id: 'log', log_message_id: 'logmsg' });
	});

	it('removes the case and skips the log when the action fails', async () => {
		const { guild, send } = fakeGuild('awc-fail');
		setModLogChannel('awc-fail', 'log');
		await expect(actWithCase(guild, input, async () => Promise.reject(apiError(RESTJSONErrorCodes.MissingPermissions)))).rejects.toThrow();
		expect(getCasesForTarget('awc-fail', 'u1')).toEqual([]);
		expect(send).not.toHaveBeenCalled();
	});

	it('works without a log channel', async () => {
		const { guild, send } = fakeGuild('awc-nolog');
		const { modCase, dm } = await actWithCase(guild, input, async () => undefined);
		expect(dm).toBeUndefined();
		expect(send).not.toHaveBeenCalled();
		expect(modCase.case_number).toBe(1);
	});
});

describe('readOverwrite', () => {
	it('reads allow, deny and inherit for the lock permissions', () => {
		const state = readOverwrite(PermissionFlagsBits.SendMessages, PermissionFlagsBits.CreatePublicThreads);
		expect(state).toEqual({ SendMessages: true, SendMessagesInThreads: null, CreatePublicThreads: false, CreatePrivateThreads: null });
	});
});
