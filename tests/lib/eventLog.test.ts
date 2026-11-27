import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
	LOG_EVENTS,
	LOG_GROUPS,
	NEW_ACCOUNT_MS,
	accountAgeLine,
	addLogIgnore,
	bulkTranscript,
	describeChanges,
	diffIds,
	findUsedInvite,
	getLogChannel,
	getLogIgnores,
	getLogRoutes,
	isLogDestination,
	isLogIgnored,
	manualCaseFromAudit,
	permissionDiff,
	quoteContent,
	removeLogIgnore,
	resolveLogEvents,
	setLogRoutes,
	truncate,
	voiceEvent,
	type AuditEntryLike,
	type InviteSnapshot
} from '../../src/lib/eventLog';
import { setModLogChannel } from '../../src/lib/moderation';

describe('event selectors', () => {
	it('fits the slash-command choice limit (all + groups + events ≤ 25)', () => {
		expect(1 + Object.keys(LOG_GROUPS).length + LOG_EVENTS.length).toBeLessThanOrEqual(25);
	});

	it('resolves all, groups and single events', () => {
		expect(resolveLogEvents('all')).toEqual([...LOG_EVENTS]);
		expect(resolveLogEvents('Voice')).toEqual(['voice_join', 'voice_leave', 'voice_move']);
		expect(resolveLogEvents('message_edit')).toEqual(['message_edit']);
		expect(resolveLogEvents('nope')).toEqual([]);
		expect(resolveLogEvents('constructor')).toEqual([]);
	});
});

describe('routes', () => {
	it('routes, reroutes and clears events per guild', () => {
		setLogRoutes('g-routes', ['message_edit', 'message_delete'], 'c1');
		setLogRoutes('g-other', ['message_edit'], 'c9');
		expect(getLogRoutes('g-routes')).toEqual({ message_edit: 'c1', message_delete: 'c1' });

		setLogRoutes('g-routes', ['message_delete'], 'c2');
		expect(getLogChannel('g-routes', 'message_delete')).toBe('c2');

		setLogRoutes('g-routes', ['message_edit'], null);
		expect(getLogChannel('g-routes', 'message_edit')).toBeNull();
		expect(getLogChannel('g-other', 'message_edit')).toBe('c9');
	});

	it('treats every log channel and the mod log as destinations', () => {
		setLogRoutes('g-dest', ['voice_join'], 'voice-log');
		setModLogChannel('g-dest', 'mod-log');
		expect(isLogDestination('g-dest', 'voice-log')).toBe(true);
		expect(isLogDestination('g-dest', 'mod-log')).toBe(true);
		expect(isLogDestination('g-dest', 'general')).toBe(false);
	});
});

describe('ignore lists', () => {
	it('adds and removes once', () => {
		expect(addLogIgnore('g-ign', 'channel', 'c1')).toBe(true);
		expect(addLogIgnore('g-ign', 'channel', 'c1')).toBe(false);
		expect(addLogIgnore('g-ign', 'user', 'u1')).toBe(true);
		expect(getLogIgnores('g-ign')).toEqual({ channel: ['c1'], user: ['u1'] });
		expect(removeLogIgnore('g-ign', 'user', 'u1')).toBe(true);
		expect(removeLogIgnore('g-ign', 'user', 'u1')).toBe(false);
	});

	it('matches a channel, its parent or category, or the user', () => {
		addLogIgnore('g-match', 'channel', 'category');
		addLogIgnore('g-match', 'user', 'quiet');
		expect(isLogIgnored('g-match', { channelIds: ['thread', 'channel', 'category'] })).toBe(true);
		expect(isLogIgnored('g-match', { channelIds: ['channel', null, undefined] })).toBe(false);
		expect(isLogIgnored('g-match', { channelIds: ['channel'], userId: 'quiet' })).toBe(true);
		expect(isLogIgnored('g-match', { userId: 'loud' })).toBe(false);
		expect(isLogIgnored('g-elsewhere', { userId: 'quiet' })).toBe(false);
	});
});

describe('formatting', () => {
	it('truncates and quotes content', () => {
		expect(truncate('abcdef', 4)).toBe('abc…');
		expect(quoteContent(null)).toBe('_not cached_');
		expect(quoteContent('   ')).toBe('_no text_');
		expect(quoteContent('x'.repeat(2000))).toHaveLength(1024);
	});

	it('flags young accounts', () => {
		const now = 1_800_000_000_000;
		expect(accountAgeLine(now - NEW_ACCOUNT_MS + 1000, now)).toContain('new account');
		expect(accountAgeLine(now - NEW_ACCOUNT_MS * 2, now)).not.toContain('new account');
	});

	it('diffs ids and fields', () => {
		expect(diffIds(['a', 'b'], ['b', 'c'])).toEqual({ added: ['c'], removed: ['a'] });
		expect(
			describeChanges([
				{ name: 'Name', before: 'old', after: 'new' },
				{ name: 'Same', before: 1, after: 1 },
				{ name: 'Topic', before: null, after: 'hi' }
			])
		).toEqual(['**Name:** old → new', '**Topic:** _none_ → hi']);
	});

	it('names granted and revoked permissions', () => {
		const diff = permissionDiff(
			PermissionFlagsBits.SendMessages | PermissionFlagsBits.KickMembers,
			PermissionFlagsBits.SendMessages | PermissionFlagsBits.BanMembers
		);
		expect(diff).toEqual({ added: ['BanMembers'], removed: ['KickMembers'] });
	});

	it('classifies voice state changes', () => {
		expect(voiceEvent(null, 'a')).toBe('voice_join');
		expect(voiceEvent('a', null)).toBe('voice_leave');
		expect(voiceEvent('a', 'b')).toBe('voice_move');
		expect(voiceEvent('a', 'a')).toBeNull();
	});

	it('writes a bulk-delete transcript oldest first', () => {
		const text = bulkTranscript([
			{ id: '2', partial: false, createdTimestamp: 2000, content: 'second', author: { id: 'u', username: 'bob' } },
			{ id: '3', partial: true, createdTimestamp: null },
			{
				id: '1',
				partial: false,
				createdTimestamp: 1000,
				content: 'first',
				author: { id: 'u', username: 'bob' },
				attachments: { size: 1, values: () => [{ name: 'cat.png' }] }
			}
		]);
		expect(text.split('\n')).toEqual([
			'[not cached] 3',
			'[1970-01-01T00:00:01.000Z] bob (u): first [cat.png]',
			'[1970-01-01T00:00:02.000Z] bob (u): second'
		]);
	});
});

describe('findUsedInvite', () => {
	const invite = (code: string, uses: number, maxUses = 0): InviteSnapshot => ({ code, uses, maxUses, inviterId: 'inviter' });
	const before = new Map([
		['aaa', invite('aaa', 3)],
		['bbb', invite('bbb', 0)],
		['last', invite('last', 4, 5)]
	]);

	it('finds the one invite that gained a use', () => {
		expect(findUsedInvite(before, [invite('aaa', 4), invite('bbb', 0), invite('last', 4, 5)])?.code).toBe('aaa');
	});

	it('counts an invite created since the snapshot', () => {
		expect(findUsedInvite(before, [invite('aaa', 3), invite('bbb', 0), invite('last', 4, 5), invite('new', 1)])?.code).toBe('new');
	});

	it('falls back to a used-up invite that vanished', () => {
		expect(findUsedInvite(before, [invite('aaa', 3), invite('bbb', 0)])).toMatchObject({ code: 'last', uses: 5 });
	});

	it('gives up when it is ambiguous', () => {
		expect(findUsedInvite(before, [invite('aaa', 4), invite('bbb', 1), invite('last', 4, 5)])).toBeNull();
		expect(findUsedInvite(before, [invite('aaa', 3), invite('bbb', 0), invite('last', 4, 5)])).toBeNull();
	});
});

describe('manualCaseFromAudit', () => {
	const at = Date.parse('2026-11-27T12:00:00Z');
	const entry = (fields: Partial<AuditEntryLike>): AuditEntryLike => ({
		action: AuditLogEvent.MemberBanAdd,
		executorId: 'mod',
		targetId: 'target',
		createdTimestamp: at,
		changes: [],
		...fields
	});

	it('maps bans, unbans and kicks', () => {
		expect(manualCaseFromAudit(entry({}), 'bot')?.action).toBe('ban');
		expect(manualCaseFromAudit(entry({ action: AuditLogEvent.MemberBanRemove }), 'bot')?.action).toBe('unban');
		expect(manualCaseFromAudit(entry({ action: AuditLogEvent.MemberKick }), 'bot')?.action).toBe('kick');
	});

	it('skips what Lyra did herself and entries without a target', () => {
		expect(manualCaseFromAudit(entry({ executorId: 'bot' }), 'bot')).toBeNull();
		expect(manualCaseFromAudit(entry({ executorId: null }), 'bot')).toBeNull();
		expect(manualCaseFromAudit(entry({ targetId: null }), 'bot')).toBeNull();
	});

	it('reads timeouts from the member update', () => {
		const until = new Date(at + 10 * 60_000).toISOString();
		expect(
			manualCaseFromAudit(entry({ action: AuditLogEvent.MemberUpdate, changes: [{ key: 'communication_disabled_until', new: until }] }), 'bot')
		).toEqual({ action: 'timeout', durationMs: 600_000, expiresAt: new Date(until) });
		expect(
			manualCaseFromAudit(entry({ action: AuditLogEvent.MemberUpdate, changes: [{ key: 'communication_disabled_until', old: until }] }), 'bot')
				?.action
		).toBe('untimeout');
	});

	it('ignores other member updates and other actions', () => {
		expect(manualCaseFromAudit(entry({ action: AuditLogEvent.MemberUpdate, changes: [{ key: 'nick', new: 'x' }] }), 'bot')).toBeNull();
		expect(manualCaseFromAudit(entry({ action: AuditLogEvent.ChannelCreate }), 'bot')).toBeNull();
	});
});
