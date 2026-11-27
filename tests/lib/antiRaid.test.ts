import { describe, expect, it } from 'vitest';
import {
	CaptchaStore,
	DEFAULT_ANTIRAID,
	JoinRateTracker,
	countRaidJoin,
	displayCaptcha,
	endRaid,
	expiredRaids,
	getAntiRaidConfig,
	isRaidActive,
	makeCaptchaCode,
	membersIntentEnabled,
	screenJoin,
	startRaid,
	updateAntiRaidConfig,
	validateSettings,
	type AntiRaidConfig
} from '../../src/lib/antiRaid';
import { parseSetPairs } from '../../src/lib/antiRaidCommand';

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 27, 12);

function config(overrides: Partial<AntiRaidConfig> = {}): AntiRaidConfig {
	return { guild_id: 'g', ...DEFAULT_ANTIRAID, enabled: true, quarantine_role_id: 'q', ...overrides };
}

const oldAccount = { accountCreatedAt: NOW - 365 * DAY, hasDefaultAvatar: false, isBot: false };

describe('membersIntentEnabled', () => {
	it.each([
		['true', true],
		['1', true],
		['YES', true],
		['on', true],
		['false', false],
		['', false],
		[undefined, false]
	])('%j → %s', (value, expected) => expect(membersIntentEnabled({ DISCORD_MEMBERS_INTENT: value })).toBe(expected));
});

describe('JoinRateTracker', () => {
	it('counts joins inside the window only', () => {
		const tracker = new JoinRateTracker();
		expect(tracker.record('g', 10_000, 0)).toBe(1);
		expect(tracker.record('g', 10_000, 4_000)).toBe(2);
		expect(tracker.record('g', 10_000, 9_999)).toBe(3);
		// The first join (t=0) has fallen out of the window by t=10s.
		expect(tracker.record('g', 10_000, 10_000)).toBe(3);
		expect(tracker.record('other', 10_000, 10_000)).toBe(1);
		tracker.reset('g');
		expect(tracker.record('g', 10_000, 10_001)).toBe(1);
	});
});

describe('screenJoin', () => {
	it('lets everyone in while anti-raid is off, and always lets bots in', () => {
		expect(screenJoin(config({ enabled: false, quarantine_on_join: true }), oldAccount, NOW).action).toBe('none');
		expect(screenJoin(config({ quarantine_on_join: true }), { ...oldAccount, isBot: true }, NOW).action).toBe('none');
	});

	it('applies the account-age rule only to young accounts', () => {
		const rules = config({ min_account_age_ms: 7 * DAY, account_age_action: 'kick' });
		expect(screenJoin(rules, { ...oldAccount, accountCreatedAt: NOW - DAY }, NOW)).toEqual({ action: 'kick', reason: 'account is too new' });
		expect(screenJoin(rules, oldAccount, NOW).action).toBe('none');
	});

	it('flags default avatars when asked to', () => {
		expect(screenJoin(config({ default_avatar_action: 'quarantine' }), { ...oldAccount, hasDefaultAvatar: true }, NOW).action).toBe('quarantine');
		expect(screenJoin(config(), { ...oldAccount, hasDefaultAvatar: true }, NOW).action).toBe('none');
	});

	it('uses the raid action only while raid mode is on', () => {
		const raiding = config({ raid_join_action: 'kick', raid_until: new Date(NOW + 60_000).toISOString() });
		expect(screenJoin(raiding, oldAccount, NOW)).toEqual({ action: 'kick', reason: 'joined during raid mode' });
		expect(screenJoin({ ...raiding, raid_until: new Date(NOW - 1).toISOString() }, oldAccount, NOW).action).toBe('none');
	});

	it('picks the harshest action when several rules match', () => {
		const rules = config({ quarantine_on_join: true, min_account_age_ms: 7 * DAY, account_age_action: 'ban', default_avatar_action: 'kick' });
		expect(screenJoin(rules, { accountCreatedAt: NOW - DAY, hasDefaultAvatar: true, isBot: false }, NOW).action).toBe('ban');
		expect(screenJoin(rules, { ...oldAccount, hasDefaultAvatar: true }, NOW).action).toBe('kick');
		expect(screenJoin(rules, oldAccount, NOW)).toEqual({ action: 'quarantine', reason: 'new members wait for verification' });
	});
});

describe('validateSettings', () => {
	it('accepts the defaults with a quarantine role', () => expect(validateSettings(config())).toBeNull());

	it('rejects out-of-range values', () => {
		expect(validateSettings(config({ join_threshold: 2 }))).toMatch(/threshold/);
		expect(validateSettings(config({ join_window_ms: 1_000 }))).toMatch(/window/);
		expect(validateSettings(config({ raid_duration_ms: 2 * DAY }))).toMatch(/raid mode/);
		expect(validateSettings(config({ min_account_age_ms: 400 * DAY }))).toMatch(/account age/);
	});

	it('needs a quarantine role for any quarantine rule', () => {
		expect(validateSettings(config({ quarantine_role_id: null }))).toMatch(/quarantine role/);
		expect(validateSettings(config({ quarantine_role_id: null, raid_join_action: 'kick' }))).toBeNull();
		expect(validateSettings(config({ quarantine_role_id: null, raid_join_action: 'kick', quarantine_on_join: true }))).toMatch(/quarantine role/);
	});
});

describe('config and raid state', () => {
	it('returns defaults for a new guild and saves only what is given', () => {
		expect(getAntiRaidConfig('fresh')).toEqual({ guild_id: 'fresh', ...DEFAULT_ANTIRAID });
		const saved = updateAntiRaidConfig('saved', { enabled: true, join_threshold: 5, quarantine_role_id: 'role' });
		expect(saved).toMatchObject({
			enabled: true,
			join_threshold: 5,
			quarantine_role_id: 'role',
			join_window_ms: DEFAULT_ANTIRAID.join_window_ms
		});
		expect(updateAntiRaidConfig('saved', { quarantine_role_id: null }).quarantine_role_id).toBeNull();
		expect(getAntiRaidConfig('saved').join_threshold).toBe(5);
	});

	it('tracks raid mode until it ends or expires', () => {
		const until = new Date(NOW + 60_000);
		startRaid('raid', until, true);
		countRaidJoin('raid');
		countRaidJoin('raid');
		const during = getAntiRaidConfig('raid');
		expect(isRaidActive(during, new Date(NOW))).toBe(true);
		expect(expiredRaids(new Date(NOW))).not.toContain('raid');
		expect(expiredRaids(new Date(NOW + 60_000))).toContain('raid');
		expect(endRaid('raid')).toEqual({ locked: true, joins: 2 });
		expect(endRaid('raid')).toBeNull();
		expect(getAntiRaidConfig('raid').raid_until).toBeNull();
	});
});

describe('captcha', () => {
	it('makes codes from the unambiguous alphabet', () => {
		const code = makeCaptchaCode();
		expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}$/);
		expect(displayCaptcha('AB')).toBe('A‍ B');
	});

	it('accepts the right answer once, case- and space-insensitively', () => {
		const store = new CaptchaStore();
		store.issue('g', 'u', 'AB3CD', 0);
		expect(store.check('g', 'u', ' ab3 cd ', 1_000)).toBe('ok');
		expect(store.check('g', 'u', 'AB3CD', 1_000)).toBe('expired');
	});

	it('burns the code on a wrong answer and expires old codes', () => {
		const store = new CaptchaStore();
		store.issue('g', 'u', 'AB3CD', 0);
		expect(store.check('g', 'u', 'XXXXX', 1)).toBe('wrong');
		expect(store.check('g', 'u', 'AB3CD', 2)).toBe('expired');
		store.issue('g', 'u', 'AB3CD', 0);
		expect(store.check('g', 'u', 'AB3CD', 10 * 60_000)).toBe('expired');
	});
});

describe('%antiraid set parsing', () => {
	it('parses key/value pairs', () => {
		expect(
			parseSetPairs([
				'enabled',
				'on',
				'join_threshold',
				'8',
				'join_window',
				'15s',
				'raid_action',
				'kick',
				'min_account_age',
				'3d',
				'alert_role',
				'<@&123456789012345678>'
			])
		).toEqual({
			enabled: true,
			join_threshold: 8,
			join_window_ms: 15_000,
			raid_join_action: 'kick',
			min_account_age_ms: 3 * DAY,
			alert_role_id: '123456789012345678'
		});
		expect(parseSetPairs(['quarantine_role', 'clear', 'min_account_age', 'off'])).toEqual({ quarantine_role_id: null, min_account_age_ms: 0 });
	});

	it('rejects unknown keys, bad values and odd pairs', () => {
		expect(() => parseSetPairs(['nope', '1'])).toThrow(/don't know/);
		expect(() => parseSetPairs(['raid_action', 'explode'])).toThrow(/raid_action/);
		expect(() => parseSetPairs(['enabled', 'maybe'])).toThrow(/on or off/);
		expect(() => parseSetPairs(['enabled'])).toThrow(/usage/);
	});
});
