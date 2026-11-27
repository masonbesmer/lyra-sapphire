import { describe, expect, it } from 'vitest';
import { createCase, findCaseTargets, isModAction, searchCases } from '../../src/lib/moderation';

const GUILD = 'g-search';
const USER = '111111111111111111';
const MOD = '222222222222222222';

createCase({
	guildId: GUILD,
	action: 'warn',
	targetId: USER,
	targetTag: 'alice',
	moderatorId: MOD,
	moderatorTag: 'boss',
	reason: 'spam in #general'
});
createCase({
	guildId: GUILD,
	action: 'ban',
	targetId: '333333333333333333',
	targetTag: 'bob',
	moderatorId: MOD,
	moderatorTag: 'boss',
	reason: '100% scam'
});
createCase({
	guildId: GUILD,
	action: 'timeout',
	targetId: USER,
	targetTag: 'alice',
	moderatorId: 'other',
	moderatorTag: 'helper',
	durationMs: 600_000
});
createCase({ guildId: 'g-other', action: 'warn', targetId: USER, targetTag: 'alice', moderatorId: MOD, reason: 'spam' });

describe('searchCases', () => {
	it('lists newest first with a total, paged', () => {
		const { cases, total } = searchCases(GUILD, { limit: 2 });
		expect(total).toBe(3);
		expect(cases.map((entry) => entry.case_number)).toEqual([3, 2]);
		expect(searchCases(GUILD, { limit: 2, offset: 2 }).cases.map((entry) => entry.case_number)).toEqual([1]);
	});

	it('finds a case by number, with or without #', () => {
		expect(searchCases(GUILD, { query: '#2' }).cases.map((entry) => entry.action)).toEqual(['ban']);
		expect(searchCases(GUILD, { query: '2' }).total).toBe(1);
	});

	it('matches a user ID as target or moderator', () => {
		expect(searchCases(GUILD, { query: USER }).total).toBe(2);
		expect(searchCases(GUILD, { query: MOD }).total).toBe(2);
	});

	it('matches text in reasons and tags, case-insensitively, with LIKE wildcards taken literally', () => {
		expect(searchCases(GUILD, { query: 'SPAM' }).total).toBe(1);
		expect(searchCases(GUILD, { query: 'helper' }).total).toBe(1);
		expect(searchCases(GUILD, { query: '100%' }).total).toBe(1);
		expect(searchCases(GUILD, { query: '%' }).total).toBe(1);
		expect(searchCases(GUILD, { query: '_' }).total).toBe(0);
	});

	it('filters by action and stays inside the guild', () => {
		expect(searchCases(GUILD, { action: 'timeout' }).cases).toHaveLength(1);
		expect(searchCases(GUILD, { query: 'alice', action: 'warn' }).total).toBe(1);
	});
});

describe('findCaseTargets', () => {
	it('groups cases by user whose stored tag matches', () => {
		expect(findCaseTargets(GUILD, 'ALI')).toEqual([{ target_id: USER, target_tag: 'alice', cases: 2 }]);
		expect(findCaseTargets(GUILD, '')).toEqual([]);
	});
});

describe('isModAction', () => {
	it('knows the actions', () => {
		expect(isModAction('ban')).toBe(true);
		expect(isModAction('toString')).toBe(false);
	});
});
