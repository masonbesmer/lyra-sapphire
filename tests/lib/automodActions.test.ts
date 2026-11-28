import { container } from '@sapphire/framework';
import { AutoModerationActionType } from 'discord.js';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveAutomodSettings, updateRule } from '../../src/lib/automod';
import { handleNativeExecution, runAutomod } from '../../src/lib/automodActions';
import { NATIVE_NAMES } from '../../src/lib/automodNative';
import { getCasesForTarget } from '../../src/lib/moderation';
import { setThreshold } from '../../src/lib/warnThresholds';

beforeAll(() => {
	process.env.PHISHING_DOMAIN_LIST_URL = '';
});

beforeEach(() => {
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

let nextId = 1;

function setup(guildId: string, opts: { admin?: boolean; roles?: string[] } = {}) {
	const send = vi.fn(async () => ({ delete: vi.fn(async () => undefined) }));
	const bulkDelete = vi.fn(async () => undefined);
	const channel = { id: 'chan', isThread: () => false, parentId: null, isSendable: () => true, send, bulkDelete };
	const guild: Record<string, unknown> = {
		id: guildId,
		name: 'Test',
		ownerId: 'owner',
		channels: { cache: new Map(), fetch: vi.fn() },
		bans: { create: vi.fn(async () => undefined) },
		client: { user: { id: 'bot' } }
	};
	guild.members = { me: { id: 'bot', user: { username: 'Lyra' } }, cache: new Map(), fetch: vi.fn() };
	const member = {
		id: 'user',
		guild,
		user: { id: 'user', username: 'spammer', send: vi.fn(async () => undefined) },
		permissions: { has: () => opts.admin ?? false },
		roles: { cache: new Map((opts.roles ?? []).map((id) => [id, {}])) },
		moderatable: true,
		kickable: true,
		bannable: true,
		timeout: vi.fn(async () => undefined),
		kick: vi.fn(async () => undefined)
	};
	(guild.members as { cache: Map<string, unknown> }).cache.set('user', member);

	const message = (content: string, extra: { mentions?: number; attachments?: string[] } = {}) => {
		const msg = {
			id: String(nextId++),
			content,
			guild,
			guildId,
			channel,
			channelId: 'chan',
			author: { id: 'user', bot: false },
			member,
			webhookId: null,
			system: false,
			inGuild: () => true,
			mentions: {
				parsedUsers: new Map(Array.from({ length: extra.mentions ?? 0 }, (_, i) => [String(i), {}])),
				roles: new Map(),
				everyone: false
			},
			attachments: new Map((extra.attachments ?? []).map((name, i) => [String(i), { name }])),
			delete: vi.fn(async () => undefined)
		};
		return msg;
	};
	return { guild, member, channel, message, send, bulkDelete };
}

describe('runAutomod', () => {
	it('does nothing when no filter is on', async () => {
		const { message } = setup('a1');
		const msg = message('free nitro scam');
		await runAutomod(msg as never);
		expect(msg.delete).not.toHaveBeenCalled();
	});

	it('deletes a banned word and posts a short notice', async () => {
		updateRule('a2', 'words', (config) => {
			config.enabled = true;
			config.settings.words = ['scam'];
		});
		const { message, send } = setup('a2');
		const msg = message('this is a scam');
		await runAutomod(msg as never);
		expect(msg.delete).toHaveBeenCalled();
		expect(send).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('removed by AutoMod (words)') }));
		expect(getCasesForTarget('a2', 'user')).toEqual([]);
	});

	it('leaves admins, exempt roles and log-only rules alone', async () => {
		updateRule('a3', 'caps', (config) => {
			config.enabled = true;
		});
		const admin = setup('a3', { admin: true });
		const loud = admin.message('THIS IS VERY LOUD TEXT');
		await runAutomod(loud as never);
		expect(loud.delete).not.toHaveBeenCalled();

		saveAutomodSettings('a3', { nativeSync: false, exemptRoles: ['trusted'], exemptChannels: [] });
		const trusted = setup('a3', { roles: ['trusted'] });
		const loud2 = trusted.message('THIS IS VERY LOUD TEXT');
		await runAutomod(loud2 as never);
		expect(loud2.delete).not.toHaveBeenCalled();

		updateRule('a3b', 'caps', (config) => {
			config.enabled = true;
			config.action = 'log';
		});
		const logged = setup('a3b').message('THIS IS VERY LOUD TEXT');
		await runAutomod(logged as never);
		expect(logged.delete).not.toHaveBeenCalled();
	});

	it('warns as Lyra, and the warn counts toward thresholds', async () => {
		updateRule('a4', 'invites', (config) => {
			config.enabled = true;
			config.action = 'warn';
		});
		setThreshold('a4', 1, 'timeout', 60_000);
		const { message, member } = setup('a4');
		const msg = message('join discord.gg/raid');
		await runAutomod(msg as never);
		expect(msg.delete).toHaveBeenCalled();
		const cases = getCasesForTarget('a4', 'user');
		expect(cases.map((entry) => entry.action)).toEqual(['timeout', 'warn']);
		expect(cases[1]).toMatchObject({ moderator_id: 'bot', reason: 'AutoMod invites: invite link (raid)' });
		expect(member.timeout).toHaveBeenCalledWith(60_000, expect.any(String));
	});

	it('removes a flood burst and punishes once', async () => {
		updateRule('a5', 'flood', (config) => {
			config.enabled = true;
			config.action = 'timeout';
			config.settings.limit = 3;
		});
		const { message, member, bulkDelete } = setup('a5');
		for (const text of ['a', 'b', 'c', 'd']) await runAutomod(message(text) as never);
		expect(bulkDelete).toHaveBeenCalledTimes(1);
		expect((bulkDelete.mock.calls[0] as unknown[][])[0]).toHaveLength(3);
		expect(member.timeout).toHaveBeenCalledTimes(1);
		expect(member.timeout).toHaveBeenCalledWith(600_000, expect.any(String));
	});

	it('ignores edits for rate filters but re-checks content', async () => {
		updateRule('a6', 'words', (config) => {
			config.enabled = true;
			config.settings.words = ['bad'];
		});
		const { message } = setup('a6');
		const msg = message('now it is bad');
		await runAutomod(msg as never, true);
		expect(msg.delete).toHaveBeenCalled();
	});

	it('blocks attachments by extension', async () => {
		updateRule('a7', 'attachments', (config) => {
			config.enabled = true;
		});
		const { message } = setup('a7');
		const msg = message('', { attachments: ['setup.exe'] });
		await runAutomod(msg as never);
		expect(msg.delete).toHaveBeenCalled();
	});
});

describe('handleNativeExecution', () => {
	function execution(guild: Record<string, unknown>, ruleName: string, creatorId: string, type: AutoModerationActionType) {
		return {
			guild,
			ruleId: 'r',
			autoModerationRule: {
				name: ruleName,
				creatorId,
				actions: [{ type: AutoModerationActionType.BlockMessage }, { type: AutoModerationActionType.SendAlertMessage }]
			},
			action: { type },
			userId: 'user',
			channelId: 'chan',
			content: 'bad words',
			matchedKeyword: 'bad'
		};
	}

	it("applies the source filter's action once, on the block event", async () => {
		updateRule('n1', 'words', (config) => {
			config.enabled = true;
			config.action = 'kick';
			config.settings.words = ['bad'];
		});
		const { guild, member } = setup('n1');
		await handleNativeExecution(execution(guild, NATIVE_NAMES.words, 'bot', AutoModerationActionType.SendAlertMessage) as never);
		expect(member.kick).not.toHaveBeenCalled();
		await handleNativeExecution(execution(guild, NATIVE_NAMES.words, 'bot', AutoModerationActionType.BlockMessage) as never);
		expect(member.kick).toHaveBeenCalledTimes(1);
		expect(getCasesForTarget('n1', 'user')[0]).toMatchObject({ action: 'kick', reason: 'AutoMod words: `bad` (Discord AutoMod)' });
	});

	it("ignores rules Lyra didn't create", async () => {
		updateRule('n2', 'words', (config) => {
			config.enabled = true;
			config.action = 'kick';
		});
		const { guild, member } = setup('n2');
		await handleNativeExecution(execution(guild, NATIVE_NAMES.words, 'someone', AutoModerationActionType.BlockMessage) as never);
		expect(member.kick).not.toHaveBeenCalled();
	});
});
