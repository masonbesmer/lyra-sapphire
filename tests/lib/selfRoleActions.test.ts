import { container } from '@sapphire/framework';
import { PermissionFlagsBits } from 'discord.js';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getCasesForTarget, scheduleAction, getScheduledActions } from '../../src/lib/moderation';
import { runScheduledAction } from '../../src/lib/modScheduler';
import { handlePanelInteraction, onMemberJoin, onMemberLeave } from '../../src/lib/selfRoleActions';
import {
	addAutoRole,
	addStickyRole,
	buttonCustomId,
	createPanel,
	peekStickyHold,
	saveStickyHold,
	selectCustomId,
	upsertEntry
} from '../../src/lib/selfRoles';
import { unknownMember } from '../helpers/discord';

const BOT_TOP = 10;

function role(guildId: string, id: string, position = 1, permissions = 0n) {
	return { id, position, managed: false, permissions: { bitfield: permissions }, guild: { id: guildId } };
}

function fakeGuild(guildId: string, roles: ReturnType<typeof role>[]) {
	const client = { user: { id: 'bot', username: 'lyra' } };
	return {
		id: guildId,
		client,
		roles: { cache: new Map(roles.map((r) => [r.id, r])) },
		members: {
			me: { id: 'bot', roles: { highest: { position: BOT_TOP } } },
			cache: new Map(),
			fetch: vi.fn(async () => Promise.reject(unknownMember()))
		},
		channels: { cache: new Map(), fetch: vi.fn(async () => null) }
	};
}

function fakeMember(guild: ReturnType<typeof fakeGuild>, id: string, roleIds: string[], extra: Record<string, unknown> = {}) {
	const cache = new Map(roleIds.map((r) => [r, { id: r }]));
	return {
		id,
		guild,
		client: guild.client,
		user: { id, username: id, bot: false },
		pending: false,
		partial: false,
		roles: {
			cache,
			add: vi.fn(async (ids: string[]) => ids.forEach((r) => cache.set(r, { id: r }))),
			remove: vi.fn(async (ids: string[]) => ids.forEach((r) => cache.delete(r)))
		},
		...extra
	};
}

function fakeInteraction(
	guild: ReturnType<typeof fakeGuild>,
	member: ReturnType<typeof fakeMember>,
	customId: string,
	messageId: string,
	values?: string[]
) {
	return {
		customId,
		guildId: guild.id,
		guild,
		member,
		user: member.user,
		message: { id: messageId },
		values,
		inCachedGuild: () => true,
		isButton: () => values === undefined,
		deferReply: vi.fn(async () => undefined),
		editReply: vi.fn(async () => undefined)
	};
}

beforeEach(() => {
	(container as any).logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
});

describe('handlePanelInteraction', () => {
	it('ignores components that are not role panels', async () => {
		const guild = fakeGuild('h-g0', []);
		const interaction = fakeInteraction(guild, fakeMember(guild, 'u', []), 'player_skip', 'm');
		expect(await handlePanelInteraction(interaction as never)).toBe(false);
	});

	it('toggles a button role', async () => {
		const guild = fakeGuild('h-g1', [role('h-g1', '111111111111111111')]);
		const panel = createPanel({
			guildId: 'h-g1',
			channelId: 'c',
			messageId: 'h-m1',
			kind: 'button',
			mode: 'normal',
			owned: true,
			createdBy: 'mod'
		});
		upsertEntry(panel, { roleId: '111111111111111111' });
		const member = fakeMember(guild, 'u', []);

		await handlePanelInteraction(fakeInteraction(guild, member, buttonCustomId(panel.id, '111111111111111111'), 'h-m1') as never);
		expect(member.roles.add).toHaveBeenCalledWith(['111111111111111111'], `Role panel #${panel.id}`);

		await handlePanelInteraction(fakeInteraction(guild, member, buttonCustomId(panel.id, '111111111111111111'), 'h-m1') as never);
		expect(member.roles.remove).toHaveBeenCalledWith(['111111111111111111'], `Role panel #${panel.id}`);
	});

	it("refuses a custom ID pointing at another message's panel or a role not on it", async () => {
		const guild = fakeGuild('h-g2', [role('h-g2', '111111111111111111'), role('h-g2', '222222222222222222')]);
		const panel = createPanel({
			guildId: 'h-g2',
			channelId: 'c',
			messageId: 'h-m2',
			kind: 'button',
			mode: 'normal',
			owned: true,
			createdBy: 'mod'
		});
		upsertEntry(panel, { roleId: '111111111111111111' });
		const member = fakeMember(guild, 'u', []);

		const wrongMessage = fakeInteraction(guild, member, buttonCustomId(panel.id, '111111111111111111'), 'not-the-panel');
		await handlePanelInteraction(wrongMessage as never);
		expect(wrongMessage.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining("isn't set up") }));

		const wrongRole = fakeInteraction(guild, member, buttonCustomId(panel.id, '222222222222222222'), 'h-m2');
		await handlePanelInteraction(wrongRole as never);
		expect(member.roles.add).not.toHaveBeenCalled();
	});

	it('skips a role that gained moderator permissions after it was put on the panel', async () => {
		const guild = fakeGuild('h-g3', [role('h-g3', '111111111111111111', 1, PermissionFlagsBits.BanMembers)]);
		const panel = createPanel({
			guildId: 'h-g3',
			channelId: 'c',
			messageId: 'h-m3',
			kind: 'button',
			mode: 'normal',
			owned: true,
			createdBy: 'mod'
		});
		upsertEntry(panel, { roleId: '111111111111111111' });
		const member = fakeMember(guild, 'u', []);
		const interaction = fakeInteraction(guild, member, buttonCustomId(panel.id, '111111111111111111'), 'h-m3');
		await handlePanelInteraction(interaction as never);
		expect(member.roles.add).not.toHaveBeenCalled();
		expect(interaction.editReply).toHaveBeenCalledWith(expect.objectContaining({ content: expect.stringContaining('skipped') }));
	});

	it('applies a unique select menu', async () => {
		const a = '111111111111111111';
		const b = '222222222222222222';
		const guild = fakeGuild('h-g4', [role('h-g4', a), role('h-g4', b)]);
		const panel = createPanel({
			guildId: 'h-g4',
			channelId: 'c',
			messageId: 'h-m4',
			kind: 'select',
			mode: 'unique',
			owned: true,
			createdBy: 'mod'
		});
		upsertEntry(panel, { roleId: a });
		upsertEntry(panel, { roleId: b });
		const member = fakeMember(guild, 'u', [a]);
		await handlePanelInteraction(fakeInteraction(guild, member, selectCustomId(panel.id), 'h-m4', [b]) as never);
		expect([...member.roles.cache.keys()]).toEqual([b]);
	});
});

describe('joins and leaves', () => {
	it('remembers sticky roles on leave and restores them with a case on rejoin', async () => {
		const guild = fakeGuild('j-g1', [role('j-g1', 'muted'), role('j-g1', 'member')]);
		addStickyRole('j-g1', 'muted');
		onMemberLeave(fakeMember(guild, 'u', ['muted', 'member']) as never);
		expect(peekStickyHold('j-g1', 'u')).toEqual(['muted']);

		const back = fakeMember(guild, 'u', []);
		await onMemberJoin(back as never);
		expect(back.roles.add).toHaveBeenCalledWith(['muted'], 'Sticky roles restored on rejoin');
		expect(peekStickyHold('j-g1', 'u')).toEqual([]);
		expect(getCasesForTarget('j-g1', 'u')[0]).toMatchObject({ action: 'role-add', moderator_id: 'bot' });
	});

	it("doesn't overwrite a saved hold with a partial member", () => {
		addStickyRole('j-g2', 'muted');
		saveStickyHold('j-g2', 'u', ['muted']);
		onMemberLeave({ partial: true, id: 'u', guild: { id: 'j-g2' } } as never);
		expect(peekStickyHold('j-g2', 'u')).toEqual(['muted']);
	});

	it('gives auto-roles by member type, but waits for membership screening', async () => {
		const guild = fakeGuild('j-g3', [role('j-g3', 'human-role'), role('j-g3', 'bot-role')]);
		addAutoRole('j-g3', 'human-role', 'human');
		addAutoRole('j-g3', 'bot-role', 'bot');

		const human = fakeMember(guild, 'h', []);
		await onMemberJoin(human as never);
		expect(human.roles.add).toHaveBeenCalledWith(['human-role'], 'Auto-role on join');

		const bot = fakeMember(guild, 'b', []);
		bot.user.bot = true;
		await onMemberJoin(bot as never);
		expect(bot.roles.add).toHaveBeenCalledWith(['bot-role'], 'Auto-role on join');

		const pending = fakeMember(guild, 'p', [], { pending: true });
		await onMemberJoin(pending as never);
		expect(pending.roles.add).not.toHaveBeenCalled();
	});
});

it('a timed role that runs out while the member is away is not restored when they rejoin', async () => {
	addStickyRole('t-g1', 'muted');
	saveStickyHold('t-g1', 'u', ['muted']);
	scheduleAction('t-g1', 'role-remove', 'u', new Date(0), 3, 'muted');
	const guild = fakeGuild('t-g1', [role('t-g1', 'muted')]);
	const client = { user: { id: 'bot' }, guilds: { cache: new Map([['t-g1', guild]]) } };
	const [action] = getScheduledActions('t-g1', 'u');
	expect(await runScheduledAction(client as never, action)).toBe('done');
	expect(peekStickyHold('t-g1', 'u')).toEqual([]);
});
