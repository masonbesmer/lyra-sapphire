import { container } from '@sapphire/framework';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createCase, getCasesForTarget, getScheduledActions } from '../../src/lib/moderation';
import { escalateWarnings } from '../../src/lib/warnEscalation';
import {
	countActiveWarns,
	describeThreshold,
	getThresholds,
	getWarnExpiry,
	removeThreshold,
	setThreshold,
	setWarnExpiry,
	thresholdFor,
	thresholdProblem
} from '../../src/lib/warnThresholds';

const DAY = 86_400_000;

beforeEach(() => {
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

function warn(guildId: string, userId: string, at: Date) {
	return createCase({ guildId, action: 'warn', targetId: userId, moderatorId: 'mod', reason: 'x', now: at });
}

describe('thresholds', () => {
	it('stores, lists in order, replaces and removes', () => {
		setThreshold('g1', 5, 'kick', 123);
		setThreshold('g1', 3, 'timeout', 3_600_000);
		expect(getThresholds('g1')).toEqual([
			{ warn_count: 3, action: 'timeout', duration_ms: 3_600_000 },
			// Kick has no duration.
			{ warn_count: 5, action: 'kick', duration_ms: null }
		]);
		setThreshold('g1', 3, 'ban', null);
		expect(getThresholds('g1')[0]).toEqual({ warn_count: 3, action: 'ban', duration_ms: null });
		expect(removeThreshold('g1', 3)).toBe(true);
		expect(removeThreshold('g1', 3)).toBe(false);
		expect(getThresholds('g1').map((entry) => entry.warn_count)).toEqual([5]);
	});

	it('validates', () => {
		expect(thresholdProblem(0, 'kick', null)).toMatch(/between/);
		expect(thresholdProblem(3, 'timeout', null)).toMatch(/needs a duration/);
		expect(thresholdProblem(3, 'timeout', 29 * DAY)).toMatch(/28 days/);
		expect(thresholdProblem(3, 'ban', 400 * DAY)).toMatch(/year/);
		expect(thresholdProblem(3, 'timeout', 3_600_000)).toBeNull();
		expect(thresholdProblem(3, 'ban', null)).toBeNull();
	});

	it('fires only at the exact count', () => {
		const list = [
			{ warn_count: 3, action: 'timeout' as const, duration_ms: 1 },
			{ warn_count: 5, action: 'kick' as const, duration_ms: null }
		];
		expect(thresholdFor(list, 2)).toBeNull();
		expect(thresholdFor(list, 3)?.action).toBe('timeout');
		expect(thresholdFor(list, 4)).toBeNull();
		expect(thresholdFor(list, 5)?.action).toBe('kick');
	});

	it('describes', () => {
		expect(describeThreshold({ warn_count: 3, action: 'timeout', duration_ms: 3_600_000 })).toBe('3 warns → 1h timeout');
		expect(describeThreshold({ warn_count: 5, action: 'kick', duration_ms: null })).toBe('5 warns → kick');
		expect(describeThreshold({ warn_count: 7, action: 'ban', duration_ms: null })).toBe('7 warns → permanent ban');
		expect(describeThreshold({ warn_count: 7, action: 'ban', duration_ms: 7 * DAY })).toBe('7 warns → 1w ban');
	});
});

describe('countActiveWarns', () => {
	it('counts every warn when nothing expires, and only recent ones with an expiry', () => {
		const now = new Date('2026-06-01T00:00:00Z');
		warn('g2', 'u', new Date(now.getTime() - 40 * DAY));
		warn('g2', 'u', new Date(now.getTime() - 10 * DAY));
		warn('g2', 'u', new Date(now.getTime() - DAY));
		createCase({ guildId: 'g2', action: 'kick', targetId: 'u', moderatorId: 'mod', now });
		warn('g2', 'other', now);
		expect(getWarnExpiry('g2')).toBeNull();
		expect(countActiveWarns('g2', 'u', now)).toBe(3);
		setWarnExpiry('g2', 30 * DAY);
		expect(countActiveWarns('g2', 'u', now)).toBe(2);
		setWarnExpiry('g2', null);
		expect(countActiveWarns('g2', 'u', now)).toBe(3);
	});
});

describe('escalateWarnings', () => {
	function fakeMember(guildId: string, userId: string) {
		const timeout = vi.fn(async () => undefined);
		const kick = vi.fn(async () => undefined);
		const bansCreate = vi.fn(async () => undefined);
		const guild = {
			id: guildId,
			name: 'Test',
			ownerId: 'owner',
			members: { me: { id: 'bot', user: { username: 'Lyra' } } },
			bans: { create: bansCreate },
			channels: { cache: new Map(), fetch: vi.fn() }
		};
		const member = {
			id: userId,
			guild,
			user: { id: userId, username: 'someone', send: vi.fn(async () => undefined) },
			moderatable: true,
			kickable: true,
			bannable: true,
			timeout,
			kick
		};
		return { guild: guild as never, member: member as never, timeout, kick, bansCreate, raw: member };
	}

	it('does nothing without thresholds', async () => {
		const { guild, member } = fakeMember('g3', 'u');
		warn('g3', 'u', new Date());
		expect(await escalateWarnings(guild, member)).toBeNull();
	});

	it('times out at the threshold and records a case by Lyra', async () => {
		const { guild, member, timeout } = fakeMember('g4', 'u');
		setThreshold('g4', 2, 'timeout', 3_600_000);
		warn('g4', 'u', new Date());
		expect(await escalateWarnings(guild, member)).toBeNull();
		warn('g4', 'u', new Date());
		const line = await escalateWarnings(guild, member);
		expect(line).toMatch(/2 active warnings → timed out for 1h \(case #\d+\)/);
		expect(timeout).toHaveBeenCalledWith(3_600_000, 'AutoMod: Reached 2 active warnings');
		const [latest] = getCasesForTarget('g4', 'u');
		expect(latest).toMatchObject({ action: 'timeout', moderator_id: 'bot', duration_ms: 3_600_000 });
	});

	it('temp-bans and schedules the unban', async () => {
		const { guild, member, bansCreate } = fakeMember('g5', 'u');
		setThreshold('g5', 1, 'ban', 7 * DAY);
		warn('g5', 'u', new Date());
		expect(await escalateWarnings(guild, member)).toMatch(/banned for 1w/);
		expect(bansCreate).toHaveBeenCalled();
		expect(getScheduledActions('g5', 'u').map((entry) => entry.action)).toEqual(['unban']);
	});

	it("reports when the bot can't act", async () => {
		const { guild, member, raw, kick } = fakeMember('g6', 'u');
		raw.kickable = false;
		setThreshold('g6', 1, 'kick', null);
		warn('g6', 'u', new Date());
		expect(await escalateWarnings(guild, member)).toMatch(/can't kick/);
		expect(kick).not.toHaveBeenCalled();
	});
});
