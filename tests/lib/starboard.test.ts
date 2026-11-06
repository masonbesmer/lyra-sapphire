import { container } from '@sapphire/framework';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	addToStarboardBlacklist,
	buildStarboardEmbed,
	countValidStars,
	createStarboardMessage,
	deleteStarboardMessage,
	deleteStarboardMessageByMessageId,
	emojiIdentifier,
	emojiMatches,
	generateStarboardIndex,
	getStarboardBlacklist,
	getStarboardConfig,
	getStarboardMessage,
	getStarboardMessageByIndex,
	getStarboardMessageByStarboardId,
	getStarboardMessages,
	isStarboardBlacklisted,
	removeFromStarboardBlacklist,
	scheduleStarboardSettle,
	setStarboardChannel,
	setStarboardEmoji,
	setStarboardEnabled,
	setStarboardSelfStar,
	setStarboardThreshold,
	updateStarboardMessageCount
} from '../../src/lib/starboard';

afterEach(() => {
	vi.useRealTimers();
});

describe('generateStarboardIndex', () => {
	it('returns five upper-case alphanumerics', () => {
		for (let i = 0; i < 20; i++) expect(generateStarboardIndex()).toMatch(/^[A-Z0-9]{5}$/);
	});
});

describe('emoji matching', () => {
	it('renders unicode, custom and animated emoji', () => {
		expect(emojiIdentifier({ id: null, name: '⭐' })).toBe('⭐');
		expect(emojiIdentifier({ id: '1', name: 'star' })).toBe('<:star:1>');
		expect(emojiIdentifier({ id: '2', name: 'spin', animated: true })).toBe('<a:spin:2>');
		expect(emojiIdentifier({ id: null, name: null })).toBe('');
	});

	it('compares against the configured emoji', () => {
		expect(emojiMatches({ id: null, name: '⭐' }, '⭐')).toBe(true);
		expect(emojiMatches({ id: '1', name: 'star' }, '<:star:1>')).toBe(true);
		expect(emojiMatches({ id: '1', name: 'star' }, '<a:star:1>')).toBe(false);
	});
});

describe('countValidStars', () => {
	const reaction = {
		users: {
			fetch: async () =>
				new Map([
					['author', { id: 'author', bot: false }],
					['fan', { id: 'fan', bot: false }],
					['bot', { id: 'bot', bot: true }]
				])
		}
	};

	it('excludes bots', async () => {
		expect(await countValidStars(reaction, 'author', true)).toBe(2);
	});

	it('excludes the author unless self-star is allowed', async () => {
		expect(await countValidStars(reaction, 'author', false)).toBe(1);
	});
});

describe('scheduleStarboardSettle', () => {
	it('collapses repeated schedules on one key into one run', async () => {
		vi.useFakeTimers();
		const task = vi.fn(async () => {});
		scheduleStarboardSettle('debounce', 1000, task);
		await vi.advanceTimersByTimeAsync(500);
		scheduleStarboardSettle('debounce', 1000, task);
		await vi.advanceTimersByTimeAsync(999);
		expect(task).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(task).toHaveBeenCalledTimes(1);
	});

	it('keeps separate keys independent', async () => {
		vi.useFakeTimers();
		const task = vi.fn(async () => {});
		scheduleStarboardSettle('key-a', 100, task);
		scheduleStarboardSettle('key-b', 100, task);
		await vi.advanceTimersByTimeAsync(100);
		expect(task).toHaveBeenCalledTimes(2);
	});

	it('logs a failing task instead of throwing', async () => {
		vi.useFakeTimers();
		const error = vi.fn();
		(container as any).logger = { error };
		scheduleStarboardSettle('failing', 10, async () => {
			throw new Error('boom');
		});
		await vi.advanceTimersByTimeAsync(10);
		expect(error).toHaveBeenCalledWith(expect.stringContaining('boom'));
	});
});

describe('starboard config', () => {
	it('returns defaults for a guild without a row', () => {
		expect(getStarboardConfig('sb-default')).toEqual({
			guild_id: 'sb-default',
			channel_id: null,
			threshold: 3,
			emoji: '⭐',
			enabled: true,
			self_star: true
		});
	});

	it('updates each field without losing the others', () => {
		const guildId = 'sb-set';
		setStarboardChannel(guildId, 'c1');
		setStarboardThreshold(guildId, 5);
		setStarboardEmoji(guildId, '<:star:1>');
		setStarboardEnabled(guildId, false);
		setStarboardSelfStar(guildId, false);
		expect(getStarboardConfig(guildId)).toEqual({
			guild_id: guildId,
			channel_id: 'c1',
			threshold: 5,
			emoji: '<:star:1>',
			enabled: false,
			self_star: false
		});
		setStarboardChannel(guildId, null);
		expect(getStarboardConfig(guildId)).toMatchObject({ channel_id: null, threshold: 5 });
	});
});

describe('starboard messages', () => {
	it('creates and looks up an entry every way', () => {
		const index = createStarboardMessage('sb-msg', 'orig-1', 'chan-1', 'copy-1', 4);
		const expected = {
			id: 'sb-msg-orig-1',
			guild_id: 'sb-msg',
			original_message_id: 'orig-1',
			original_channel_id: 'chan-1',
			starboard_message_id: 'copy-1',
			star_count: 4,
			index_code: index
		};
		expect(getStarboardMessage('orig-1')).toEqual(expected);
		expect(getStarboardMessageByStarboardId('copy-1')).toEqual(expected);
		expect(getStarboardMessageByIndex(index)).toEqual(expected);
		expect(getStarboardMessage('missing')).toBeNull();
	});

	it('updates the star count and lists by count', () => {
		createStarboardMessage('sb-list', 'low', 'c', 'copy-low', 1);
		createStarboardMessage('sb-list', 'high', 'c', 'copy-high', 2);
		updateStarboardMessageCount('low', 9);
		expect(getStarboardMessages('sb-list').map((entry) => [entry.original_message_id, entry.star_count])).toEqual([
			['low', 9],
			['high', 2]
		]);
	});

	it('deletes by index and by original message', () => {
		const index = createStarboardMessage('sb-del', 'by-index', 'c', 'copy-a', 1);
		createStarboardMessage('sb-del', 'by-message', 'c', 'copy-b', 1);
		expect(deleteStarboardMessage(index)).toBe(true);
		expect(deleteStarboardMessage(index)).toBe(false);
		expect(deleteStarboardMessageByMessageId('by-message')).toBe(true);
		expect(deleteStarboardMessageByMessageId('by-message')).toBe(false);
		expect(getStarboardMessages('sb-del')).toEqual([]);
	});
});

describe('starboard blacklist', () => {
	it('adds, lists and removes targets', () => {
		addToStarboardBlacklist('sb-bl', 'c1', 'channel');
		addToStarboardBlacklist('sb-bl', 'c1', 'channel');
		addToStarboardBlacklist('sb-bl', 'u1', 'user');
		expect(getStarboardBlacklist('sb-bl')).toEqual(
			expect.arrayContaining([
				{ target_id: 'c1', target_type: 'channel' },
				{ target_id: 'u1', target_type: 'user' }
			])
		);
		expect(getStarboardBlacklist('sb-bl')).toHaveLength(2);
		expect(removeFromStarboardBlacklist('sb-bl', 'c1', 'user')).toBe(false);
		expect(removeFromStarboardBlacklist('sb-bl', 'c1', 'channel')).toBe(true);
		expect(getStarboardBlacklist('sb-bl')).toEqual([{ target_id: 'u1', target_type: 'user' }]);
	});

	it('matches a blacklisted channel or author', () => {
		addToStarboardBlacklist('sb-check', 'bad-channel', 'channel');
		addToStarboardBlacklist('sb-check', 'bad-user', 'user');
		expect(isStarboardBlacklisted('sb-check', 'bad-channel', 'someone')).toBe(true);
		expect(isStarboardBlacklisted('sb-check', 'ok-channel', 'bad-user')).toBe(true);
		expect(isStarboardBlacklisted('sb-check', 'ok-channel', 'someone')).toBe(false);
		// The target type matters: a user id in the channel slot is not a hit.
		expect(isStarboardBlacklisted('sb-check', 'bad-user', 'someone')).toBe(false);
		expect(isStarboardBlacklisted('sb-other', 'bad-channel', 'bad-user')).toBe(false);
	});
});

describe('buildStarboardEmbed', () => {
	function message(content: string, attachments: { url: string; contentType: string | null }[]) {
		return {
			id: 'm1',
			url: 'https://discord.com/channels/1/2/3',
			content,
			createdAt: new Date(0),
			author: { username: 'alice', displayAvatarURL: () => 'https://cdn/avatar.png' },
			attachments: new Map(attachments.map((attachment, i) => [String(i), attachment]))
		} as never;
	}

	it('shows the content, stars, index and the first image', async () => {
		const embed = await buildStarboardEmbed(
			message('hello', [
				{ url: 'https://cdn/a.png', contentType: 'image/png' },
				{ url: 'https://cdn/b.png', contentType: 'image/png' },
				{ url: 'https://cdn/c.txt', contentType: 'text/plain' }
			]),
			7,
			'ABCDE',
			'🌟'
		);
		const json = embed.toJSON();
		expect(json.description).toBe('hello');
		expect(json.author?.name).toBe('alice');
		expect(json.image?.url).toBe('https://cdn/a.png');
		expect(json.footer?.text).toBe('Message ID: m1');
		expect(json.fields).toEqual([
			{ name: 'Source', value: '[Jump to message](https://discord.com/channels/1/2/3)', inline: true },
			{ name: 'Stars', value: '🌟 7', inline: true },
			{ name: 'Index', value: 'ABCDE', inline: true },
			{ name: 'Attachments', value: '+2 more', inline: true }
		]);
	});

	it('handles an empty message without attachments', async () => {
		const json = (await buildStarboardEmbed(message('', []), 3, 'ZZZZZ')).toJSON();
		expect(json.description).toBe('*No text content*');
		expect(json.image).toBeUndefined();
		expect(json.fields?.map((field) => field.value)).toEqual(['[Jump to message](https://discord.com/channels/1/2/3)', '⭐ 3', 'ZZZZZ']);
	});
});
