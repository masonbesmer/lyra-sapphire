import { describe, expect, it } from 'vitest';
import {
	APPEAL_COOLDOWN_MS,
	REPORT_LIMIT,
	REPORT_WINDOW_MS,
	appealBlocker,
	closeReport,
	closeTicket,
	createAppeal,
	createReport,
	createTicket,
	decideAppeal,
	findOpenDuplicate,
	getAppeal,
	getModQueueConfig,
	getOpenTicket,
	getReport,
	getTicketByThread,
	isAppealUrl,
	latestAppeal,
	recentReportCount,
	reopenAppeal,
	setModQueueField,
	ticketThreadName
} from '../../src/lib/modQueue';
import { toggleAction } from '../../src/lib/modVoice';

describe('mod queue config', () => {
	it('defaults to everything off and saves one field at a time', () => {
		expect(getModQueueConfig('q1')).toEqual({
			guild_id: 'q1',
			report_channel_id: null,
			ticket_channel_id: null,
			staff_role_id: null,
			appeal_channel_id: null,
			appeal_url: null
		});
		setModQueueField('q1', 'report_channel_id', 'c1');
		setModQueueField('q1', 'staff_role_id', 'r1');
		setModQueueField('q1', 'report_channel_id', null);
		expect(getModQueueConfig('q1')).toMatchObject({ report_channel_id: null, staff_role_id: 'r1' });
	});

	it('refuses unknown fields (they are interpolated into SQL)', () => {
		expect(() => setModQueueField('q1', 'guild_id = 1; --' as never, 'x')).toThrow(/unknown/);
	});

	it.each([
		['https://forms.example.com/appeal', true],
		['http://example.com', true],
		['javascript:alert(1)', false],
		['example.com/appeal', false],
		[`https://example.com/${'a'.repeat(600)}`, false]
	])('appeal URL %s → %s', (url, ok) => expect(isAppealUrl(url)).toBe(ok));
});

describe('reports', () => {
	const base = { guildId: 'r', reporterId: 'reporter', targetId: 'target', reason: '  spamming invites  ' };

	it('stores a report with trimmed reason and message copy', () => {
		const report = createReport({ ...base, channelId: 'c', messageId: 'm1', messageContent: 'x'.repeat(2_000) });
		expect(report).toMatchObject({ status: 'open', reason: 'spamming invites', channel_id: 'c', message_id: 'm1' });
		expect(report.message_content).toHaveLength(1_000);
		expect(findOpenDuplicate('r', 'reporter', 'target', 'm1')?.id).toBe(report.id);
		expect(findOpenDuplicate('r', 'reporter', 'target', 'm2')).toBeNull();
		expect(findOpenDuplicate('r', 'reporter', 'target', null)).toBeNull();
	});

	it('lets only the first moderator close a report', () => {
		const report = createReport({ ...base, guildId: 'r2' });
		expect(closeReport('r2', report.id, 'resolved', 'mod1')).toBe(true);
		expect(closeReport('r2', report.id, 'dismissed', 'mod2')).toBe(false);
		expect(getReport('r2', report.id)).toMatchObject({ status: 'resolved', handled_by: 'mod1' });
		// Closed reports don't count as duplicates.
		expect(findOpenDuplicate('r2', 'reporter', 'target', null)).toBeNull();
	});

	it('counts reports inside the rate window', () => {
		const now = new Date('2026-11-27T12:00:00Z');
		for (let i = 0; i < REPORT_LIMIT; i++) createReport({ ...base, guildId: 'r3', targetId: `t${i}`, now });
		expect(recentReportCount('r3', 'reporter', now)).toBe(REPORT_LIMIT);
		expect(recentReportCount('r3', 'reporter', new Date(now.getTime() + REPORT_WINDOW_MS + 1))).toBe(0);
		expect(recentReportCount('r3', 'someone-else', now)).toBe(0);
	});
});

describe('tickets', () => {
	it('tracks one open ticket per member and closes it once', () => {
		expect(getOpenTicket('t', 'u')).toBeNull();
		const ticket = createTicket('t', 'u', 'thread1', '  billing  ');
		expect(ticket).toMatchObject({ status: 'open', subject: 'billing', thread_id: 'thread1' });
		expect(getOpenTicket('t', 'u')?.thread_id).toBe('thread1');
		expect(closeTicket('thread1', 'mod')).toBe(true);
		expect(closeTicket('thread1', 'mod')).toBe(false);
		expect(getOpenTicket('t', 'u')).toBeNull();
		expect(getTicketByThread('thread1')).toMatchObject({ status: 'closed', closed_by: 'mod' });
	});

	it('names threads within Discord limits', () => {
		expect(ticketThreadName('alice', null)).toBe('ticket-alice');
		expect(ticketThreadName('alice', 'help')).toBe('ticket-alice · help');
		expect(ticketThreadName('alice', 'x'.repeat(200))).toHaveLength(100);
	});
});

describe('appeals', () => {
	it('allows one pending appeal at a time and a cooldown after a denial', () => {
		const now = new Date('2026-11-27T12:00:00Z');
		expect(appealBlocker(latestAppeal('a', 'u'), now)).toBeNull();
		const appeal = createAppeal('a', 'u', 'user', 'please let me back', now);
		expect(appealBlocker(latestAppeal('a', 'u'), now)).toMatch(/waiting/);

		expect(decideAppeal('a', appeal.id, 'denied', 'mod', now)).toBe(true);
		expect(decideAppeal('a', appeal.id, 'accepted', 'mod2', now)).toBe(false);
		expect(appealBlocker(latestAppeal('a', 'u'), new Date(now.getTime() + 1_000))).toMatch(/denied/);
		expect(appealBlocker(latestAppeal('a', 'u'), new Date(now.getTime() + APPEAL_COOLDOWN_MS + 1))).toBeNull();
	});

	it('can put a decision back when the unban failed', () => {
		const appeal = createAppeal('a2', 'u', null, 'sorry');
		decideAppeal('a2', appeal.id, 'accepted', 'mod');
		reopenAppeal('a2', appeal.id);
		expect(getAppeal('a2', appeal.id)).toMatchObject({ status: 'pending', handled_by: null });
	});
});

describe('voice toggles', () => {
	it('records the direction of the toggle', () => {
		expect(toggleAction('mute', false)).toBe('vmute');
		expect(toggleAction('mute', true)).toBe('vunmute');
		expect(toggleAction('deafen', false)).toBe('vdeafen');
		expect(toggleAction('deafen', true)).toBe('vundeafen');
	});
});
