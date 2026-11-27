import { describe, expect, it } from 'vitest';
import {
	BULK_DELETE_MAX_AGE_MS,
	DM_ACTIONS,
	MAX_SCHEDULE_ATTEMPTS,
	addNote,
	cancelScheduledAction,
	clampReason,
	countCasesForTarget,
	createCase,
	deleteCase,
	deleteNote,
	describePurgeFilter,
	failScheduledAction,
	formatCaseLine,
	formatDuration,
	getCase,
	getCasesForTarget,
	getDueActions,
	getLockedChannels,
	getModConfig,
	getNotes,
	getScheduledActions,
	hierarchyProblem,
	isChannelLockedByBot,
	markChannelLocked,
	matchesPurgeFilter,
	parseDuration,
	roleProblem,
	scheduleAction,
	setCaseLogMessage,
	setCaseReason,
	setDmOnAction,
	setModLogChannel,
	shouldDm,
	takeChannelLock,
	type PurgeCandidate
} from '../../src/lib/moderation';

describe('parseDuration', () => {
	it.each([
		['10m', 600_000],
		['2d', 172_800_000],
		['1h30m', 5_400_000],
		['1w 2d', 777_600_000],
		['90s', 90_000],
		['3 days', 259_200_000],
		['1H', 3_600_000]
	])('%s → %d ms', (input, expected) => {
		expect(parseDuration(input)).toBe(expected);
	});

	it.each(['', '   ', '3', 'abc', '10x', 'm10', '10m spam', '0m', '-5m', '1.5h'])('rejects %j', (input) => {
		expect(parseDuration(input)).toBeNull();
	});

	it('rejects null and undefined', () => {
		expect(parseDuration(null)).toBeNull();
		expect(parseDuration(undefined)).toBeNull();
	});
});

describe('formatDuration', () => {
	it('drops zero parts', () => {
		expect(formatDuration(93_784_000)).toBe('1d 2h 3m 4s');
		expect(formatDuration(604_800_000)).toBe('1w');
		expect(formatDuration(0)).toBe('0s');
	});

	it('round-trips with parseDuration', () => {
		for (const text of ['10m', '2d', '1h 30m', '1w 2d'])
			expect(formatDuration(parseDuration(text)!)).toBe(text.replace(/(\d+[a-z])(\d)/, '$1 $2'));
	});
});

describe('clampReason', () => {
	it('trims and turns blank into null', () => {
		expect(clampReason('  spam  ')).toBe('spam');
		expect(clampReason('   ')).toBeNull();
		expect(clampReason(null)).toBeNull();
	});

	it('cuts long reasons to 512 characters', () => {
		const clamped = clampReason('x'.repeat(600))!;
		expect(clamped).toHaveLength(512);
		expect(clamped.endsWith('…')).toBe(true);
	});
});

describe('hierarchyProblem', () => {
	const base = { guildOwnerId: 'owner', moderator: { id: 'mod', highest: 10 }, bot: { id: 'bot', highest: 20 } };

	it('allows acting on someone below both the moderator and the bot', () => {
		expect(hierarchyProblem({ ...base, target: { id: 't', highest: 5 } })).toBeNull();
	});

	it('allows targets outside the guild (no roles to compare)', () => {
		expect(hierarchyProblem({ ...base, target: null })).toBeNull();
	});

	it('refuses self, the bot and the owner', () => {
		expect(hierarchyProblem({ ...base, target: { id: 'mod', highest: 1 } })).toMatch(/yourself/);
		expect(hierarchyProblem({ ...base, target: { id: 'bot', highest: 1 } })).toMatch(/myself/);
		expect(hierarchyProblem({ ...base, target: { id: 'owner', highest: 1 } })).toMatch(/owner/);
	});

	it('refuses targets at or above the moderator', () => {
		expect(hierarchyProblem({ ...base, target: { id: 't', highest: 10 } })).toMatch(/above yours/);
		expect(hierarchyProblem({ ...base, target: { id: 't', highest: 15 } })).toMatch(/above yours/);
	});

	it('refuses targets at or above the bot, even for the owner', () => {
		expect(hierarchyProblem({ ...base, moderator: { id: 'owner', highest: 1 }, target: { id: 't', highest: 20 } })).toMatch(/above mine/);
	});

	it('lets the owner act on anyone the bot outranks', () => {
		expect(hierarchyProblem({ ...base, moderator: { id: 'owner', highest: 1 }, target: { id: 't', highest: 15 } })).toBeNull();
	});
});

describe('roleProblem', () => {
	const base = { guildOwnerId: 'owner', moderator: { id: 'mod', highest: 10 }, bot: { id: 'bot', highest: 20 } };
	const role = (position: number, extra: Partial<{ id: string; managed: boolean }> = {}) => ({
		id: 'r',
		position,
		managed: false,
		guildId: 'g',
		...extra
	});

	it('allows roles below both', () => {
		expect(roleProblem({ ...base, role: role(5) })).toBeNull();
	});

	it('refuses @everyone and managed roles', () => {
		expect(roleProblem({ ...base, role: role(0, { id: 'g' }) })).toMatch(/@everyone/);
		expect(roleProblem({ ...base, role: role(5, { managed: true }) })).toMatch(/integration/);
	});

	it('refuses roles at or above the moderator or the bot', () => {
		expect(roleProblem({ ...base, role: role(10) })).toMatch(/your top role/);
		expect(roleProblem({ ...base, moderator: { id: 'owner', highest: 1 }, role: role(20) })).toMatch(/my top role/);
		expect(roleProblem({ ...base, moderator: { id: 'owner', highest: 1 }, role: role(15) })).toBeNull();
	});
});

describe('matchesPurgeFilter', () => {
	const now = 1_800_000_000_000;
	const message = (fields: Partial<PurgeCandidate> = {}): PurgeCandidate => ({
		authorId: 'u1',
		authorBot: false,
		content: 'hello',
		attachmentCount: 0,
		embedCount: 0,
		createdTimestamp: now - 1000,
		pinned: false,
		...fields
	});

	it('matches everything with no filter', () => {
		expect(matchesPurgeFilter(message(), {}, now)).toBe(true);
	});

	it('never matches pinned or too-old messages', () => {
		expect(matchesPurgeFilter(message({ pinned: true }), {}, now)).toBe(false);
		expect(matchesPurgeFilter(message({ createdTimestamp: now - BULK_DELETE_MAX_AGE_MS }), {}, now)).toBe(false);
	});

	it('applies each filter', () => {
		expect(matchesPurgeFilter(message(), { userId: 'u2' }, now)).toBe(false);
		expect(matchesPurgeFilter(message(), { userId: 'u1' }, now)).toBe(true);
		expect(matchesPurgeFilter(message(), { bots: true }, now)).toBe(false);
		expect(matchesPurgeFilter(message({ authorBot: true }), { bots: true }, now)).toBe(true);
		expect(matchesPurgeFilter(message(), { links: true }, now)).toBe(false);
		expect(matchesPurgeFilter(message({ content: 'see https://example.com' }), { links: true }, now)).toBe(true);
		expect(matchesPurgeFilter(message({ content: 'join discord.gg/abc' }), { links: true }, now)).toBe(true);
		expect(matchesPurgeFilter(message({ attachmentCount: 1 }), { attachments: true }, now)).toBe(true);
		expect(matchesPurgeFilter(message(), { attachments: true }, now)).toBe(false);
		expect(matchesPurgeFilter(message({ embedCount: 2 }), { embeds: true }, now)).toBe(true);
		expect(matchesPurgeFilter(message({ content: 'Buy CHEAP stuff' }), { contains: 'cheap' }, now)).toBe(true);
		expect(matchesPurgeFilter(message(), { contains: 'cheap' }, now)).toBe(false);
	});

	it('requires every filter given to match', () => {
		const filter = { userId: 'u1', links: true };
		expect(matchesPurgeFilter(message({ content: 'https://x.y' }), filter, now)).toBe(true);
		expect(matchesPurgeFilter(message({ authorId: 'u2', content: 'https://x.y' }), filter, now)).toBe(false);
	});

	it('describes the filter for replies', () => {
		expect(describePurgeFilter({})).toBe('');
		expect(describePurgeFilter({ userId: '1', links: true, contains: 'x' })).toBe('from <@1>, with links, containing "x"');
	});
});

describe('cases', () => {
	const input = (guildId: string, targetId = 't1') => ({
		guildId,
		action: 'warn' as const,
		targetId,
		targetTag: 'target',
		moderatorId: 'm1',
		moderatorTag: 'mod',
		reason: 'spam'
	});

	it('numbers cases per guild starting at 1', () => {
		expect(createCase(input('c-num-a')).case_number).toBe(1);
		expect(createCase(input('c-num-a')).case_number).toBe(2);
		expect(createCase(input('c-num-b')).case_number).toBe(1);
	});

	it('never reuses a deleted case number', () => {
		createCase(input('c-reuse'));
		const second = createCase(input('c-reuse'));
		expect(deleteCase('c-reuse', second.case_number)).toBe(true);
		expect(createCase(input('c-reuse')).case_number).toBe(3);
		expect(getCase('c-reuse', 2)).toBeNull();
	});

	it('derives expiry from duration', () => {
		const now = new Date('2026-01-01T00:00:00Z');
		const modCase = createCase({ ...input('c-exp'), action: 'ban', durationMs: 3_600_000, now });
		expect(modCase.expires_at).toBe('2026-01-01T01:00:00.000Z');
		expect(getCase('c-exp', modCase.case_number)).toMatchObject({ action: 'ban', duration_ms: 3_600_000, expires_at: modCase.expires_at });
	});

	it('honours an explicit null expiry (slowmode records a duration that never expires)', () => {
		const modCase = createCase({ ...input('c-noexp'), action: 'slowmode', targetType: 'channel', durationMs: 5000, expiresAt: null });
		expect(modCase.expires_at).toBeNull();
		expect(modCase.target_type).toBe('channel');
	});

	it('edits reasons and log message references', () => {
		const modCase = createCase(input('c-edit'));
		expect(setCaseReason('c-edit', modCase.case_number, '  new reason ')).toBe(true);
		setCaseLogMessage('c-edit', modCase.case_number, 'chan', 'msg');
		expect(getCase('c-edit', modCase.case_number)).toMatchObject({ reason: 'new reason', log_channel_id: 'chan', log_message_id: 'msg' });
		expect(setCaseReason('c-edit', 999, 'x')).toBe(false);
	});

	it('lists a target newest first and counts them', () => {
		createCase(input('c-list', 'a'));
		createCase(input('c-list', 'b'));
		createCase({ ...input('c-list', 'a'), action: 'kick' });
		expect(getCasesForTarget('c-list', 'a').map((c) => [c.case_number, c.action])).toEqual([
			[3, 'kick'],
			[1, 'warn']
		]);
		expect(countCasesForTarget('c-list', 'a')).toBe(2);
	});

	it('formats a /modlogs line', () => {
		const modCase = createCase({ ...input('c-fmt'), action: 'timeout', durationMs: 600_000, now: new Date('2026-01-01T00:00:00Z') });
		expect(formatCaseLine(modCase)).toBe('**#1** Timeout (10m) · <t:1767225600:d> by <@m1> — spam');
	});
});

describe('notes', () => {
	it('adds, lists newest first and deletes', () => {
		const first = addNote('n-g', 'u', 'm', 'mod', 'first');
		const second = addNote('n-g', 'u', 'm', 'mod', '  second  ');
		addNote('n-g', 'other', 'm', 'mod', 'elsewhere');
		expect(getNotes('n-g', 'u').map((note) => note.content)).toEqual(['second', 'first']);
		expect(deleteNote('n-g', first.id)).toBe(true);
		expect(deleteNote('n-g', first.id)).toBe(false);
		expect(getNotes('n-g', 'u').map((note) => note.id)).toEqual([second.id]);
	});

	it('only deletes notes in the same guild', () => {
		const note = addNote('n-a', 'u', 'm', 'mod', 'x');
		expect(deleteNote('n-b', note.id)).toBe(false);
	});
});

describe('scheduled actions', () => {
	it('returns only due actions', () => {
		const now = new Date('2026-06-01T00:00:00Z');
		scheduleAction('s-due', 'unban', 'u1', new Date('2026-05-31T00:00:00Z'), 1);
		scheduleAction('s-due', 'unban', 'u2', new Date('2026-06-02T00:00:00Z'), 2);
		expect(
			getDueActions(now)
				.filter((a) => a.guild_id === 's-due')
				.map((a) => a.target_id)
		).toEqual(['u1']);
	});

	it('replaces the slot for the same action/target/role', () => {
		scheduleAction('s-slot', 'unban', 'u', new Date('2026-01-01T00:00:00Z'), 1);
		scheduleAction('s-slot', 'unban', 'u', new Date('2026-02-01T00:00:00Z'), 2);
		scheduleAction('s-slot', 'role-remove', 'u', new Date('2026-01-01T00:00:00Z'), 3, 'r1');
		scheduleAction('s-slot', 'role-remove', 'u', new Date('2026-01-01T00:00:00Z'), 4, 'r2');
		const rows = getScheduledActions('s-slot', 'u');
		expect(rows).toHaveLength(3);
		expect(rows.find((r) => r.action === 'unban')).toMatchObject({ case_number: 2, run_at: '2026-02-01T00:00:00.000Z' });
	});

	it('cancels by slot', () => {
		scheduleAction('s-cancel', 'role-remove', 'u', new Date(), 1, 'r1');
		expect(cancelScheduledAction('s-cancel', 'role-remove', 'u', 'r2')).toBe(false);
		expect(cancelScheduledAction('s-cancel', 'role-remove', 'u', 'r1')).toBe(true);
		expect(getScheduledActions('s-cancel', 'u')).toEqual([]);
	});

	it('backs off on failure and gives up after the attempt limit', () => {
		const now = new Date('2026-03-01T00:00:00Z');
		scheduleAction('s-fail', 'unban', 'u', now, 1);
		const id = getScheduledActions('s-fail', 'u')[0].id;
		for (let attempt = 1; attempt < MAX_SCHEDULE_ATTEMPTS; attempt++) {
			expect(failScheduledAction(id, now)).toBe(true);
			expect(getScheduledActions('s-fail', 'u')[0]).toMatchObject({ attempts: attempt, run_at: '2026-03-01T00:01:00.000Z' });
		}
		expect(failScheduledAction(id, now)).toBe(false);
		expect(getScheduledActions('s-fail', 'u')).toEqual([]);
	});
});

describe('mod config', () => {
	it('defaults to no log channel and DMs for every DM-able action', () => {
		expect(getModConfig('cfg-default')).toEqual({ guild_id: 'cfg-default', log_channel_id: null, dm_actions: [...DM_ACTIONS] });
		expect(shouldDm('cfg-default', 'ban')).toBe(true);
		expect(shouldDm('cfg-default', 'purge')).toBe(false);
	});

	it('toggles DMs per action without touching the log channel', () => {
		setModLogChannel('cfg-dm', 'chan');
		setDmOnAction('cfg-dm', 'ban', false);
		setDmOnAction('cfg-dm', 'warn', false);
		setDmOnAction('cfg-dm', 'warn', true);
		const config = getModConfig('cfg-dm');
		expect(config.log_channel_id).toBe('chan');
		expect(config.dm_actions).toEqual(DM_ACTIONS.filter((action) => action !== 'ban'));
		expect(shouldDm('cfg-dm', 'ban')).toBe(false);
	});

	it('keeps an empty DM list distinct from the default', () => {
		for (const action of DM_ACTIONS) setDmOnAction('cfg-none', action, false);
		expect(getModConfig('cfg-none').dm_actions).toEqual([]);
	});

	it('clears the log channel without touching DMs', () => {
		setDmOnAction('cfg-clear', 'kick', false);
		setModLogChannel('cfg-clear', 'chan');
		setModLogChannel('cfg-clear', null);
		expect(getModConfig('cfg-clear')).toMatchObject({ log_channel_id: null });
		expect(getModConfig('cfg-clear').dm_actions).not.toContain('kick');
	});
});

describe('lock bookkeeping', () => {
	it('remembers the previous overwrite until taken', () => {
		markChannelLocked('l-g', 'c1', { SendMessages: true, SendMessagesInThreads: null });
		markChannelLocked('l-g', 'c2', {});
		expect(getLockedChannels('l-g').sort()).toEqual(['c1', 'c2']);
		expect(isChannelLockedByBot('l-g', 'c1')).toBe(true);
		expect(takeChannelLock('l-g', 'c1')).toEqual({ SendMessages: true, SendMessagesInThreads: null });
		expect(takeChannelLock('l-g', 'c1')).toBeNull();
		expect(isChannelLockedByBot('l-g', 'c1')).toBe(false);
	});
});
