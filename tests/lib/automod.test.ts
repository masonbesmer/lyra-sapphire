import { container } from '@sapphire/framework';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
	RULE_DEFAULTS,
	SpamTracker,
	capsPercent,
	checkContentRule,
	countEmoji,
	duplicateKey,
	extractHosts,
	findBannedWord,
	findInvites,
	getAutomodSettings,
	getEnabledRules,
	getRule,
	getRules,
	hostMatches,
	isExempt,
	longestCombiningRun,
	normaliseListEntry,
	parseRegexEntry,
	pickWorst,
	saveAutomodSettings,
	updateRule,
	type AutomodMessage,
	type AutomodRule,
	type RuleConfig,
	type RuleSettings
} from '../../src/lib/automod';

beforeAll(() => {
	// The phishing filter would otherwise download the shared list.
	process.env.PHISHING_DOMAIN_LIST_URL = '';
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

function rule(name: AutomodRule, settings: RuleSettings = {}, action: RuleConfig['action'] = 'delete'): RuleConfig {
	return {
		rule: name,
		enabled: true,
		action,
		durationMs: null,
		settings: { ...structuredClone(RULE_DEFAULTS[name]), ...settings },
		exemptRoles: [],
		exemptChannels: []
	};
}

function msg(content: string, extra: Partial<AutomodMessage> = {}): AutomodMessage {
	return { content, mentionCount: 0, attachmentNames: [], ...extra };
}

describe('banned words', () => {
	it('matches whole words case-insensitively', () => {
		expect(findBannedWord('this is a SCAM ok', ['scam'])).toBe('scam');
		expect(findBannedWord('scampi for dinner', ['scam'])).toBeNull();
	});

	it('supports * wildcards', () => {
		expect(findBannedWord('total scammer', ['scam*'])).toBe('scam*');
		expect(findBannedWord('buy shitcoin', ['*coin'])).toBe('*coin');
		expect(findBannedWord('coins', ['*coin'])).toBeNull();
	});

	it('escapes regex characters in plain words', () => {
		expect(findBannedWord('a.b', ['a.b'])).toBe('a.b');
		expect(findBannedWord('axb', ['a.b'])).toBeNull();
	});

	it('supports /regex/ entries', () => {
		expect(findBannedWord('free n1tro here', ['/fr[e3]{2}\\s+n[i1]tro/'])).toBe('/fr[e3]{2}\\s+n[i1]tro/');
	});

	it('handles non-latin words', () => {
		expect(findBannedWord('это спам!', ['спам'])).toBe('спам');
		expect(findBannedWord('спамер', ['спам'])).toBeNull();
	});

	it('rejects broken and catastrophic regexes', () => {
		expect(parseRegexEntry('/(/')).toBeInstanceOf(Error);
		expect(parseRegexEntry('/(a+)+$/')).toBeInstanceOf(Error);
		expect(parseRegexEntry('/(x*)*/')).toBeInstanceOf(Error);
		expect(parseRegexEntry('/a+b/')).toBeInstanceOf(RegExp);
		expect(parseRegexEntry('plain')).toBeNull();
	});
});

describe('normaliseListEntry', () => {
	it.each([
		['words', 'BadWord', 'badword'],
		['words', '/Ab+c/', '/Ab+c/'],
		['invites', 'https://discord.gg/abc123', 'abc123'],
		['invites', 'abc123', 'abc123'],
		['links', 'https://www.Example.com/path', 'example.com'],
		['links', 'sub.example.org', 'sub.example.org'],
		['phishing', 'scam.ru', 'scam.ru'],
		['attachments', '.EXE', 'exe'],
		['attachments', '*.scr', 'scr']
	] as const)('%s %s → %s', (ruleName, input, expected) => {
		expect(normaliseListEntry(ruleName, input)).toEqual({ value: expected });
	});

	it.each([
		['words', '/(/'],
		['links', 'not a domain'],
		['attachments', 'exe file'],
		['invites', 'https://example.com/x y'],
		['words', '   ']
	] as const)('rejects %s %j', (ruleName, input) => {
		expect(normaliseListEntry(ruleName, input)).toHaveProperty('error');
	});
});

describe('links and invites', () => {
	it('extracts hosts', () => {
		expect(extractHosts('see https://WWW.Example.com/a and http://sub.test.org?x and www.other.net/x')).toEqual([
			'example.com',
			'sub.test.org',
			'other.net'
		]);
	});

	it('matches subdomains of a listed domain', () => {
		expect(hostMatches('a.b.example.com', ['example.com'])).toBe('example.com');
		expect(hostMatches('notexample.com', ['example.com'])).toBeNull();
	});

	it('finds invites', () => {
		expect(findInvites('join discord.gg/abc and https://discord.com/invite/XyZ-9')).toEqual(['abc', 'XyZ-9']);
	});

	it('blocks listed domains in block mode and unlisted ones in allow mode', () => {
		const block = rule('links', { mode: 'block', domains: ['bad.com'] });
		expect(checkContentRule(block, msg('go to https://x.bad.com/'))).toMatchObject({ rule: 'links' });
		expect(checkContentRule(block, msg('go to https://good.com/'))).toBeNull();
		const allow = rule('links', { mode: 'allow', domains: ['youtube.com'] });
		expect(checkContentRule(allow, msg('https://youtube.com/watch'))).toBeNull();
		expect(checkContentRule(allow, msg('https://evil.com/'))).toMatchObject({ detail: 'link to evil.com' });
	});

	it('allows listed invite codes', () => {
		const config = rule('invites', { allow: ['ours'] });
		expect(checkContentRule(config, msg('discord.gg/ours'))).toBeNull();
		expect(checkContentRule(config, msg('discord.gg/OURS'))).toBeNull();
		expect(checkContentRule(config, msg('discord.gg/theirs'))).toMatchObject({ detail: 'invite link (theirs)' });
	});
});

describe('content filters', () => {
	it('mentions over the limit', () => {
		expect(checkContentRule(rule('mentions', { limit: 3 }), msg('x', { mentionCount: 3 }))).toBeNull();
		expect(checkContentRule(rule('mentions', { limit: 3 }), msg('x', { mentionCount: 4 }))).toMatchObject({ rule: 'mentions' });
	});

	it('caps percentage ignores short messages, mentions and links', () => {
		expect(capsPercent('HELLO WORLD').percent).toBe(100);
		expect(checkContentRule(rule('caps'), msg('LOL OK'))).toBeNull();
		expect(checkContentRule(rule('caps'), msg('WHY IS EVERYONE SO LOUD'))).toMatchObject({ rule: 'caps' });
		expect(checkContentRule(rule('caps'), msg('<@123456789012345678> hello there friend https://EXAMPLE.COM'))).toBeNull();
	});

	it('counts unicode and custom emoji', () => {
		expect(countEmoji('hi 😀😀 <:pog:123456789012345678> <a:dance:123456789012345678>')).toBe(4);
		expect(checkContentRule(rule('emoji', { limit: 3 }), msg('😀😀😀😀'))).toMatchObject({ rule: 'emoji' });
		expect(checkContentRule(rule('emoji', { limit: 3 }), msg('😀😀😀'))).toBeNull();
	});

	it('zalgo needs a long run of combining marks', () => {
		const zalgo = 'h́̂̃̄̅̆ello';
		expect(longestCombiningRun(zalgo)).toBe(6);
		expect(checkContentRule(rule('zalgo'), msg(zalgo))).toMatchObject({ rule: 'zalgo' });
		// Vietnamese stacks at most two marks.
		expect(checkContentRule(rule('zalgo'), msg('Tiếng Việt'))).toBeNull();
	});

	it('blocks attachment extensions', () => {
		expect(checkContentRule(rule('attachments'), msg('', { attachmentNames: ['cat.png', 'free.EXE'] }))).toMatchObject({
			detail: 'blocked file type (free.EXE)'
		});
		expect(checkContentRule(rule('attachments'), msg('', { attachmentNames: ['cat.png'] }))).toBeNull();
	});

	it('flags guild-listed phishing domains', () => {
		expect(checkContentRule(rule('phishing', { domains: ['evil.example'] }), msg('https://login.evil.example/x'))).toMatchObject({
			rule: 'phishing'
		});
		expect(checkContentRule(rule('phishing'), msg('https://discord.com/channels/1/2'))).toBeNull();
	});
});

describe('SpamTracker', () => {
	it('flags floods within the window', () => {
		const tracker = new SpamTracker();
		const settings = { limit: 3, windowMs: 5000 };
		let history = tracker.record('g', 'u', { id: '1', channelId: 'c', at: 0, key: 'a' });
		expect(tracker.check('flood', settings, history, 0)).toBeNull();
		history = tracker.record('g', 'u', { id: '2', channelId: 'c', at: 1000, key: 'b' });
		history = tracker.record('g', 'u', { id: '3', channelId: 'c', at: 2000, key: 'c' });
		expect(tracker.check('flood', settings, history, 2000)?.map((entry) => entry.id)).toEqual(['1', '2', '3']);
		// Spread out, it's fine.
		history = tracker.record('g', 'v', { id: '4', channelId: 'c', at: 0, key: 'a' });
		history = tracker.record('g', 'v', { id: '5', channelId: 'c', at: 6000, key: 'b' });
		history = tracker.record('g', 'v', { id: '6', channelId: 'c', at: 12000, key: 'c' });
		expect(tracker.check('flood', settings, history, 12000)).toBeNull();
	});

	it('flags duplicates of the latest message only', () => {
		const tracker = new SpamTracker();
		const settings = { limit: 3, windowMs: 30_000 };
		tracker.record('g', 'u', { id: '1', channelId: 'c', at: 0, key: duplicateKey('Buy NOW') });
		tracker.record('g', 'u', { id: '2', channelId: 'd', at: 1000, key: duplicateKey('hello') });
		tracker.record('g', 'u', { id: '3', channelId: 'c', at: 2000, key: duplicateKey('buy  now') });
		const history = tracker.record('g', 'u', { id: '4', channelId: 'c', at: 3000, key: duplicateKey('buy now ') });
		expect(tracker.check('duplicates', settings, history, 3000)?.map((entry) => entry.id)).toEqual(['1', '3', '4']);
		tracker.reset('g', 'u');
		const fresh = tracker.record('g', 'u', { id: '5', channelId: 'c', at: 4000, key: 'buy now' });
		expect(tracker.check('duplicates', settings, fresh, 4000)).toBeNull();
	});

	it('ignores empty (attachment-only) messages for duplicates', () => {
		const tracker = new SpamTracker();
		let history = tracker.record('g', 'u', { id: '1', channelId: 'c', at: 0, key: '' });
		history = tracker.record('g', 'u', { id: '2', channelId: 'c', at: 1, key: '' });
		history = tracker.record('g', 'u', { id: '3', channelId: 'c', at: 2, key: '' });
		expect(tracker.check('duplicates', { limit: 2, windowMs: 1000 }, history, 2)).toBeNull();
	});
});

describe('exemptions and severity', () => {
	it('exempts roles, channels and threads of exempt channels', () => {
		const lists = { exemptRoles: ['r1'], exemptChannels: ['c1'] };
		expect(isExempt(lists, { roleIds: ['r1'], channelId: 'x', parentChannelId: null })).toBe(true);
		expect(isExempt(lists, { roleIds: [], channelId: 'c1', parentChannelId: null })).toBe(true);
		expect(isExempt(lists, { roleIds: [], channelId: 'thread', parentChannelId: 'c1' })).toBe(true);
		expect(isExempt(lists, { roleIds: ['r2'], channelId: 'c2', parentChannelId: null })).toBe(false);
	});

	it('picks the harshest action, first rule on a tie', () => {
		const hits = [{ config: rule('caps', {}, 'delete') }, { config: rule('words', {}, 'timeout') }, { config: rule('links', {}, 'timeout') }];
		expect(pickWorst(hits)?.config.rule).toBe('words');
		expect(pickWorst([])).toBeNull();
	});
});

describe('storage', () => {
	it('starts with every filter off and phishing defaulting to ban', () => {
		const rules = getRules('g-store');
		expect(rules.every((entry) => !entry.enabled)).toBe(true);
		expect(rules.find((entry) => entry.rule === 'phishing')?.action).toBe('ban');
		expect(getEnabledRules('g-store')).toEqual([]);
	});

	it('round-trips a rule and keeps defaults for unset settings', () => {
		updateRule('g-store', 'flood', (config) => {
			config.enabled = true;
			config.action = 'timeout';
			config.durationMs = 60_000;
			config.settings.limit = 8;
			config.exemptRoles = ['r'];
		});
		const stored = getRule('g-store', 'flood');
		expect(stored).toMatchObject({ enabled: true, action: 'timeout', durationMs: 60_000, exemptRoles: ['r'] });
		expect(stored.settings).toEqual({ limit: 8, windowMs: 5000 });
		expect(getEnabledRules('g-store').map((entry) => entry.rule)).toEqual(['flood']);
	});

	it('stores guild-wide settings', () => {
		expect(getAutomodSettings('g-set')).toEqual({ nativeSync: false, exemptRoles: [], exemptChannels: [] });
		saveAutomodSettings('g-set', { nativeSync: true, exemptRoles: ['a'], exemptChannels: ['b'] });
		expect(getAutomodSettings('g-set')).toEqual({ nativeSync: true, exemptRoles: ['a'], exemptChannels: ['b'] });
	});
});
