import { PermissionFlagsBits } from 'discord.js';
import { describe, expect, it } from 'vitest';
import {
	MAX_ENTRIES,
	addAutoRole,
	addStickyRole,
	applyChange,
	buttonCustomId,
	clearStickyHold,
	countPanels,
	createPanel,
	deletePanel,
	findEntryByEmoji,
	forgetRoleInConfig,
	forgetRoleInPanels,
	forgetStickyRole,
	getAutoRoles,
	getEntries,
	getPanel,
	getPanelByMessage,
	getStickyRoles,
	guildsWithStickyRoles,
	membersIntentEnabled,
	parseCustomId,
	parseEmoji,
	parseMessageLink,
	peekStickyHold,
	reactionKey,
	removeAutoRole,
	removeEntry,
	removeStickyRole,
	resolveSelection,
	resolveToggle,
	saveStickyHold,
	selectCustomId,
	selfRoleProblem,
	setPanelMode,
	upsertEntry,
	type PanelKind
} from '../../src/lib/selfRoles';

const PANEL = ['a', 'b', 'c'];
const held = (...ids: string[]) => new Set(ids);

describe('resolveToggle', () => {
	it('normal: click toggles, reactions add and remove', () => {
		expect(resolveToggle('normal', PANEL, held(), 'a', 'click')).toEqual({ add: ['a'], remove: [] });
		expect(resolveToggle('normal', PANEL, held('a'), 'a', 'click')).toEqual({ add: [], remove: ['a'] });
		expect(resolveToggle('normal', PANEL, held(), 'a', 'react')).toEqual({ add: ['a'], remove: [] });
		expect(resolveToggle('normal', PANEL, held('a'), 'a', 'react')).toEqual({ add: [], remove: [] });
		expect(resolveToggle('normal', PANEL, held('a'), 'a', 'unreact')).toEqual({ add: [], remove: ['a'] });
		expect(resolveToggle('normal', PANEL, held(), 'a', 'unreact')).toEqual({ add: [], remove: [] });
	});

	it('unique: picking one drops the other panel roles, and nothing outside the panel', () => {
		expect(resolveToggle('unique', PANEL, held('b', 'c', 'other'), 'a', 'click')).toEqual({ add: ['a'], remove: ['b', 'c'] });
		expect(resolveToggle('unique', PANEL, held('b'), 'a', 'react')).toEqual({ add: ['a'], remove: ['b'] });
		expect(resolveToggle('unique', PANEL, held('a'), 'a', 'click')).toEqual({ add: [], remove: ['a'] });
		expect(resolveToggle('unique', PANEL, held('a'), 'a', 'unreact')).toEqual({ add: [], remove: ['a'] });
	});

	it('verify: only ever adds', () => {
		expect(resolveToggle('verify', PANEL, held(), 'a', 'click')).toEqual({ add: ['a'], remove: [] });
		expect(resolveToggle('verify', PANEL, held('a'), 'a', 'click')).toEqual({ add: [], remove: [] });
		expect(resolveToggle('verify', PANEL, held('a'), 'a', 'unreact')).toEqual({ add: [], remove: [] });
	});

	it('drop: only ever removes', () => {
		expect(resolveToggle('drop', PANEL, held('a'), 'a', 'click')).toEqual({ add: [], remove: ['a'] });
		expect(resolveToggle('drop', PANEL, held('a'), 'a', 'react')).toEqual({ add: [], remove: ['a'] });
		expect(resolveToggle('drop', PANEL, held(), 'a', 'click')).toEqual({ add: [], remove: [] });
		expect(resolveToggle('drop', PANEL, held(), 'a', 'unreact')).toEqual({ add: [], remove: [] });
	});
});

describe('resolveSelection', () => {
	it('normal: the selection becomes the wanted set of panel roles', () => {
		expect(resolveSelection('normal', PANEL, held('a', 'other'), ['b', 'c'])).toEqual({ add: ['b', 'c'], remove: ['a'] });
		expect(resolveSelection('normal', PANEL, held('a', 'b'), [])).toEqual({ add: [], remove: ['a', 'b'] });
	});

	it('ignores values that are not on the panel', () => {
		expect(resolveSelection('normal', PANEL, held(), ['a', 'admin'])).toEqual({ add: ['a'], remove: [] });
	});

	it('unique: keeps at most one pick', () => {
		expect(resolveSelection('unique', PANEL, held('a'), ['b'])).toEqual({ add: ['b'], remove: ['a'] });
		expect(resolveSelection('unique', PANEL, held(), ['a', 'b'])).toEqual({ add: ['a'], remove: [] });
		expect(resolveSelection('unique', PANEL, held('a'), ['a'])).toEqual({ add: [], remove: [] });
	});

	it('verify adds only, drop removes only', () => {
		expect(resolveSelection('verify', PANEL, held('a'), ['b'])).toEqual({ add: ['b'], remove: [] });
		expect(resolveSelection('drop', PANEL, held('a', 'b'), ['a', 'c'])).toEqual({ add: [], remove: ['a'] });
	});
});

it('applyChange removes then adds', () => {
	expect(applyChange(['x', 'a'], { add: ['b'], remove: ['a'] }).sort()).toEqual(['b', 'x']);
});

describe('selfRoleProblem', () => {
	const role = { id: 'r', guildId: 'g', position: 3, managed: false, permissions: 0n };

	it('allows a plain role below the bot', () => {
		expect(selfRoleProblem(role, 5)).toBeNull();
	});

	it('refuses @everyone, managed roles and roles at or above the bot', () => {
		expect(selfRoleProblem({ ...role, id: 'g' }, 5)).toMatch(/everyone/);
		expect(selfRoleProblem({ ...role, managed: true }, 5)).toMatch(/managed/);
		expect(selfRoleProblem(role, 3)).toMatch(/above my top role/);
	});

	it('refuses roles with moderator permissions unless told not to check', () => {
		const mod = { ...role, permissions: PermissionFlagsBits.BanMembers | PermissionFlagsBits.SendMessages };
		expect(selfRoleProblem(mod, 5)).toMatch(/Ban Members/);
		expect(selfRoleProblem({ ...role, permissions: PermissionFlagsBits.Administrator }, 5)).toMatch(/Administrator/);
		expect(selfRoleProblem(mod, 5, false)).toBeNull();
		expect(selfRoleProblem({ ...role, permissions: PermissionFlagsBits.SendMessages | PermissionFlagsBits.Connect }, 5)).toBeNull();
	});
});

describe('emoji', () => {
	it.each(['🎮', '❤️', '👍🏽', '🇺🇸', '1️⃣', '👨‍👩‍👧'])('accepts unicode %s', (text) => {
		expect(parseEmoji(text)).toMatchObject({ text, id: null });
	});

	it('accepts custom emoji and keys them by ID', () => {
		expect(parseEmoji('<:pog:123456789012345678>')).toEqual({
			text: '<:pog:123456789012345678>',
			key: '123456789012345678',
			id: '123456789012345678',
			name: 'pog',
			animated: false
		});
		expect(parseEmoji('<a:spin:123456789012345678>')?.animated).toBe(true);
	});

	it.each(['', 'abc', '🎮🎮', ':smile:', '<:x:1>', 'hello 🎮'])('rejects %j', (text) => {
		expect(parseEmoji(text)).toBeNull();
	});

	it('matches reactions with or without the variation selector', () => {
		expect(parseEmoji('❤️')!.key).toBe(reactionKey({ id: null, name: '❤' }));
		expect(reactionKey({ id: '123456789012345678', name: 'pog' })).toBe('123456789012345678');
	});
});

describe('custom IDs', () => {
	it('round-trips button and select IDs', () => {
		expect(parseCustomId(buttonCustomId(7, '123456789012345678'))).toEqual({ panelId: 7, roleId: '123456789012345678' });
		expect(parseCustomId(selectCustomId(7))).toEqual({ panelId: 7, roleId: null });
	});

	it('rejects anything else', () => {
		expect(parseCustomId('player_skip')).toBeNull();
		expect(parseCustomId('selfrole:x')).toBeNull();
		expect(parseCustomId('selfrole:1:abc')).toBeNull();
	});
});

it('parseMessageLink', () => {
	expect(parseMessageLink('https://discord.com/channels/111111111111111111/222222222222222222/333333333333333333')).toEqual({
		channelId: '222222222222222222',
		messageId: '333333333333333333'
	});
	expect(parseMessageLink('https://ptb.discord.com/channels/111111111111111111/222222222222222222/333333333333333333')).not.toBeNull();
	expect(parseMessageLink('https://example.com/channels/1/2/3')).toBeNull();
});

it('membersIntentEnabled reads DISCORD_MEMBERS_INTENT', () => {
	expect(membersIntentEnabled({} as unknown as NodeJS.ProcessEnv)).toBe(false);
	expect(membersIntentEnabled({ DISCORD_MEMBERS_INTENT: 'true' } as unknown as NodeJS.ProcessEnv)).toBe(true);
	expect(membersIntentEnabled({ DISCORD_MEMBERS_INTENT: ' TRUE ' } as unknown as NodeJS.ProcessEnv)).toBe(true);
	expect(membersIntentEnabled({ DISCORD_MEMBERS_INTENT: '1' } as unknown as NodeJS.ProcessEnv)).toBe(false);
});

describe('panels', () => {
	const make = (guildId: string, messageId: string, kind: PanelKind = 'button') =>
		createPanel({ guildId, channelId: 'c', messageId, kind, mode: 'normal', title: 'Games', owned: true, createdBy: 'mod' });

	it('creates, finds, changes mode and deletes with its entries', () => {
		const panel = make('p-g1', 'p-m1');
		expect(getPanel('p-g1', panel.id)).toMatchObject({ kind: 'button', mode: 'normal', title: 'Games', owned: 1 });
		expect(getPanelByMessage('p-m1')?.id).toBe(panel.id);
		expect(getPanel('other-guild', panel.id)).toBeNull();
		expect(countPanels('p-g1')).toBe(1);

		upsertEntry(panel, { roleId: 'r1', label: 'Minecraft' });
		expect(setPanelMode('p-g1', panel.id, 'unique')).toBe(true);
		expect(getPanel('p-g1', panel.id)?.mode).toBe('unique');

		expect(deletePanel('p-g1', panel.id)).toBe(true);
		expect(getEntries(panel.id)).toEqual([]);
		expect(deletePanel('p-g1', panel.id)).toBe(false);
	});

	it('keeps entry order, updates in place and refuses a duplicate emoji', () => {
		const panel = make('p-g2', 'p-m2', 'reaction');
		upsertEntry(panel, { roleId: 'r1', emoji: parseEmoji('🎮') });
		upsertEntry(panel, { roleId: 'r2', emoji: parseEmoji('🎨') });
		upsertEntry(panel, { roleId: 'r1', emoji: parseEmoji('🕹️'), label: '  Gamer  ' });
		expect(getEntries(panel.id).map((entry) => [entry.role_id, entry.emoji, entry.label])).toEqual([
			['r1', '🕹️', 'Gamer'],
			['r2', '🎨', null]
		]);
		expect(() => upsertEntry(panel, { roleId: 'r3', emoji: parseEmoji('🎨') })).toThrow(/already used/);
		expect(findEntryByEmoji(panel.id, parseEmoji('🕹')!.key)?.role_id).toBe('r1');

		expect(removeEntry(panel.id, 'r2')?.emoji).toBe('🎨');
		expect(removeEntry(panel.id, 'r2')).toBeNull();
	});

	it('caps the number of roles per panel', () => {
		const panel = make('p-g3', 'p-m3', 'reaction');
		for (let i = 0; i < MAX_ENTRIES.reaction; i++) upsertEntry(panel, { roleId: `r${i}` });
		expect(() => upsertEntry(panel, { roleId: 'one-more' })).toThrow(/full/);
		// Updating an existing entry still works on a full panel.
		expect(() => upsertEntry(panel, { roleId: 'r0', label: 'x' })).not.toThrow();
	});

	it('forgets a deleted role on every panel in the guild only', () => {
		const one = make('p-g4', 'p-m4');
		const two = make('p-g4', 'p-m5');
		const elsewhere = make('p-g5', 'p-m6');
		for (const panel of [one, two, elsewhere]) upsertEntry(panel, { roleId: 'gone' });
		expect(forgetRoleInPanels('p-g4', 'gone').sort()).toEqual([one.id, two.id].sort());
		expect(getEntries(elsewhere.id)).toHaveLength(1);
	});
});

describe('auto-roles', () => {
	it('keeps humans and bots apart', () => {
		expect(addAutoRole('a-g1', 'r1', 'human')).toBe(true);
		expect(addAutoRole('a-g1', 'r1', 'human')).toBe(false);
		addAutoRole('a-g1', 'r2', 'bot');
		expect(getAutoRoles('a-g1', 'human')).toEqual(['r1']);
		expect(getAutoRoles('a-g1', 'bot')).toEqual(['r2']);
		expect(removeAutoRole('a-g1', 'r1', 'bot')).toBe(false);
		expect(removeAutoRole('a-g1', 'r1', 'human')).toBe(true);
	});
});

describe('sticky roles', () => {
	it('saves only sticky roles on leave and gives them back on rejoin', () => {
		addStickyRole('s-g1', 'muted');
		addStickyRole('s-g1', 'jail');
		expect(guildsWithStickyRoles()).toContain('s-g1');
		expect(saveStickyHold('s-g1', 'u', ['muted', 'member', 's-g1'])).toEqual(['muted']);
		expect(peekStickyHold('s-g1', 'u')).toEqual(['muted']);
		clearStickyHold('s-g1', 'u');
		expect(peekStickyHold('s-g1', 'u')).toEqual([]);
	});

	it('drops the hold when the member had no sticky roles', () => {
		addStickyRole('s-g2', 'muted');
		saveStickyHold('s-g2', 'u', ['muted']);
		expect(saveStickyHold('s-g2', 'u', ['member'])).toEqual([]);
		expect(peekStickyHold('s-g2', 'u')).toEqual([]);
	});

	it('ignores roles that stopped being sticky while the member was away', () => {
		addStickyRole('s-g3', 'muted');
		addStickyRole('s-g3', 'jail');
		saveStickyHold('s-g3', 'u', ['muted', 'jail']);
		removeStickyRole('s-g3', 'jail');
		expect(peekStickyHold('s-g3', 'u')).toEqual(['muted']);
	});

	it('forgets a timed role that expired while they were away', () => {
		addStickyRole('s-g4', 'muted');
		addStickyRole('s-g4', 'jail');
		saveStickyHold('s-g4', 'u', ['muted', 'jail']);
		forgetStickyRole('s-g4', 'u', 'muted');
		expect(peekStickyHold('s-g4', 'u')).toEqual(['jail']);
		forgetStickyRole('s-g4', 'u', 'jail');
		expect(peekStickyHold('s-g4', 'u')).toEqual([]);
	});

	it('a deleted role leaves the sticky and auto-role lists', () => {
		addStickyRole('s-g5', 'gone');
		addAutoRole('s-g5', 'gone', 'human');
		forgetRoleInConfig('s-g5', 'gone');
		expect(getStickyRoles('s-g5')).toEqual([]);
		expect(getAutoRoles('s-g5', 'human')).toEqual([]);
	});
});
