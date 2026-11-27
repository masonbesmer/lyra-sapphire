import { AutoModerationActionType, AutoModerationRuleTriggerType } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { saveAutomodSettings, updateRule } from '../../src/lib/automod';
import { NATIVE_NAMES, desiredNativeRules, effectiveSource, nativeKindOf, syncNativeRules } from '../../src/lib/automodNative';
import { setModLogChannel } from '../../src/lib/moderation';

describe('desiredNativeRules', () => {
	it('wants nothing while the filters are off', () => {
		expect(desiredNativeRules('n1')).toEqual({ words: null, mentions: null, spam: null });
	});

	it('mirrors words (keywords and regexes), mentions and spam', () => {
		updateRule('n2', 'words', (config) => {
			config.enabled = true;
			config.action = 'warn';
			config.settings.words = ['scam*', '/fr[e3]e\\s+nitro/', 'x'.repeat(70)];
			config.exemptRoles = ['r1'];
		});
		updateRule('n2', 'mentions', (config) => {
			config.enabled = true;
			config.settings.limit = 8;
		});
		updateRule('n2', 'flood', (config) => {
			config.enabled = true;
			config.action = 'timeout';
		});
		saveAutomodSettings('n2', { nativeSync: true, exemptRoles: ['r0'], exemptChannels: ['c0'] });
		const desired = desiredNativeRules('n2');
		expect(desired.words).toMatchObject({
			triggerType: AutoModerationRuleTriggerType.Keyword,
			triggerMetadata: { keywordFilter: ['scam*'], regexPatterns: ['fr[e3]e\\s+nitro'] },
			block: true,
			exemptRoles: ['r0', 'r1'],
			exemptChannels: ['c0'],
			skipped: ['x'.repeat(70)]
		});
		expect(desired.mentions).toMatchObject({ triggerType: AutoModerationRuleTriggerType.MentionSpam, triggerMetadata: { mentionTotalLimit: 8 } });
		expect(desired.spam).toMatchObject({ triggerType: AutoModerationRuleTriggerType.Spam, block: true });
		expect(effectiveSource('n2', 'spam')?.rule).toBe('flood');
	});

	it('skips a log-only rule when there is no log channel', () => {
		updateRule('n3', 'mentions', (config) => {
			config.enabled = true;
			config.action = 'log';
		});
		expect(desiredNativeRules('n3').mentions).toBeNull();
		setModLogChannel('n3', 'log');
		expect(desiredNativeRules('n3').mentions).toMatchObject({ block: false });
	});
});

describe('nativeKindOf', () => {
	it('maps names back', () => {
		expect(nativeKindOf(NATIVE_NAMES.words)).toBe('words');
		expect(nativeKindOf('Someone else: words')).toBeNull();
	});
});

describe('syncNativeRules', () => {
	function fakeGuild(guildId: string, existing: { name: string; creatorId: string }[]) {
		const rules = existing.map((rule) => ({ ...rule, edit: vi.fn(async () => undefined), delete: vi.fn(async () => undefined) }));
		const create = vi.fn(async () => undefined);
		const guild = {
			id: guildId,
			client: { user: { id: 'bot' } },
			autoModerationRules: { fetch: vi.fn(async () => new Map(rules.map((rule, index) => [String(index), rule]))), create }
		};
		return { guild: guild as never, rules, create };
	}

	it('creates missing rules, updates its own, deletes stale ones and ignores others', async () => {
		updateRule('n4', 'words', (config) => {
			config.enabled = true;
			config.settings.words = ['bad'];
		});
		updateRule('n4', 'mentions', (config) => {
			config.enabled = true;
		});
		setModLogChannel('n4', 'logchan');
		const { guild, rules, create } = fakeGuild('n4', [
			{ name: NATIVE_NAMES.mentions, creatorId: 'bot' },
			{ name: NATIVE_NAMES.spam, creatorId: 'bot' },
			{ name: NATIVE_NAMES.words, creatorId: 'someone-else' }
		]);
		const report = await syncNativeRules(guild);
		expect(report).toMatchObject({ created: ['words'], updated: ['mentions'], removed: ['spam'], failed: [] });
		expect(create).toHaveBeenCalledWith(
			expect.objectContaining({
				name: NATIVE_NAMES.words,
				triggerType: AutoModerationRuleTriggerType.Keyword,
				actions: [
					expect.objectContaining({ type: AutoModerationActionType.BlockMessage }),
					{ type: AutoModerationActionType.SendAlertMessage, metadata: { channel: 'logchan' } }
				]
			})
		);
		expect(rules[1].delete).toHaveBeenCalled();
		// Not Lyra's: untouched.
		expect(rules[2].edit).not.toHaveBeenCalled();
		expect(rules[2].delete).not.toHaveBeenCalled();
	});

	it('removes all of its rules when turned off', async () => {
		const { guild, rules } = fakeGuild('n5', [{ name: NATIVE_NAMES.words, creatorId: 'bot' }]);
		const report = await syncNativeRules(guild, { remove: true });
		expect(report.removed).toEqual(['words']);
		expect(rules[0].delete).toHaveBeenCalled();
	});

	it('collects failures instead of throwing', async () => {
		updateRule('n6', 'mentions', (config) => {
			config.enabled = true;
		});
		const { guild, create } = fakeGuild('n6', []);
		create.mockRejectedValueOnce(new Error('Missing Permissions'));
		const report = await syncNativeRules(guild);
		expect(report.failed).toEqual([{ kind: 'mentions', error: 'Missing Permissions' }]);
	});
});
