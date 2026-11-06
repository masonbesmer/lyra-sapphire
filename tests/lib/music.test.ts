import { describe, expect, it, vi } from 'vitest';
import { setMusicConfig } from '../../src/lib/config';
import { getActiveFilters } from '../../src/lib/lavalinkFilters';
import {
	applyLoopMode,
	buildProgressBar,
	checkDJPermission,
	cleanTrackTitle,
	formatDuration,
	isAutoplayEnabled,
	loopDisplayMode,
	parseTimeString,
	repeatModeLabel,
	serializePlayer,
	serializeTrack,
	serializeVoiceState,
	setAutoplay
} from '../../src/lib/music';

describe('formatDuration', () => {
	it('formats zero, negative and missing values as 0:00', () => {
		expect(formatDuration(0)).toBe('0:00');
		expect(formatDuration(-5000)).toBe('0:00');
		expect(formatDuration(Number.NaN)).toBe('0:00');
	});

	it('formats m:ss below an hour and h:mm:ss above', () => {
		expect(formatDuration(65_000)).toBe('1:05');
		expect(formatDuration(59_999)).toBe('0:59');
		expect(formatDuration(3_661_000)).toBe('1:01:01');
	});
});

describe('buildProgressBar', () => {
	it('renders an empty bar when the total is unknown', () => {
		expect(buildProgressBar(10, 0, 5)).toBe('▬▬▬▬▬');
	});

	it('places the knob proportionally', () => {
		expect(buildProgressBar(50, 100, 10)).toBe('▬▬▬▬▬🔘▬▬▬▬');
		expect(buildProgressBar(0, 100, 4)).toBe('🔘▬▬▬');
	});

	it('clamps past the end', () => {
		expect(buildProgressBar(500, 100, 4)).toBe('▬▬▬▬🔘');
	});
});

describe('parseTimeString', () => {
	it.each([
		['1:30', 90_000],
		['1:02:03', 3_723_000],
		['90s', 90_000],
		['90S', 90_000],
		['90', 90_000]
	])('parses %s', (input, ms) => {
		expect(parseTimeString(input)).toBe(ms);
	});

	it.each(['', 'abc', '1:3', '1m', '-5', '1:30:5'])('rejects %j', (input) => {
		expect(parseTimeString(input)).toBeNull();
	});
});

describe('cleanTrackTitle', () => {
	it('strips video suffixes and bracketed tags', () => {
		expect(cleanTrackTitle('Artist - Song (Official Music Video) [4K Remaster]')).toBe('Artist - Song');
		expect(cleanTrackTitle('Song (Lyrics)')).toBe('Song');
		expect(cleanTrackTitle('Song  HQ  audio')).toBe('Song');
	});
});

function fakePlayer(overrides: Record<string, unknown> = {}) {
	const player = { data: new Map<string, unknown>(), loop: 'none', setLoop: vi.fn((mode: string) => (player.loop = mode)), ...overrides };
	return player;
}

describe('loop and autoplay', () => {
	it('autoplay is off until set', () => {
		const player = fakePlayer();
		expect(isAutoplayEnabled(player as never)).toBe(false);
		setAutoplay(player as never, true);
		expect(isAutoplayEnabled(player as never)).toBe(true);
	});

	it('displays autoplay over the native loop state', () => {
		const player = fakePlayer({ loop: 'track' });
		expect(loopDisplayMode(player as never)).toBe('track');
		setAutoplay(player as never, true);
		expect(loopDisplayMode(player as never)).toBe('autoplay');
	});

	it('applying autoplay resets the native loop and sets the flag', () => {
		const player = fakePlayer({ loop: 'queue' });
		applyLoopMode(player as never, 'autoplay');
		expect(player.setLoop).toHaveBeenCalledWith('none');
		expect(isAutoplayEnabled(player as never)).toBe(true);
	});

	it('applying a native mode clears autoplay', () => {
		const player = fakePlayer();
		setAutoplay(player as never, true);
		applyLoopMode(player as never, 'track');
		expect(player.setLoop).toHaveBeenCalledWith('track');
		expect(loopDisplayMode(player as never)).toBe('track');
	});

	it.each([
		['none', 'Off'],
		['track', 'Track'],
		['queue', 'Queue'],
		['autoplay', 'Autoplay']
	] as const)('labels %s as %s', (mode, label) => {
		expect(repeatModeLabel(mode)).toBe(label);
	});
});

describe('serialization', () => {
	const track = {
		title: 'Song',
		uri: 'https://x/y',
		thumbnail: 'https://x/t.png',
		length: 125_000,
		author: 'Artist',
		requester: { id: '1', username: 'alice' }
	};

	it('serializes a track', () => {
		expect(serializeTrack(track as never)).toEqual({
			title: 'Song',
			url: 'https://x/y',
			thumbnail: 'https://x/t.png',
			duration: '2:05',
			durationMS: 125_000,
			author: 'Artist',
			requestedBy: { id: '1', username: 'alice' }
		});
	});

	it('fills missing track fields with nulls and falls back to the requester id', () => {
		expect(serializeTrack({ title: 'Bare', requester: { id: '9' } } as never)).toEqual({
			title: 'Bare',
			url: null,
			thumbnail: null,
			duration: '0:00',
			durationMS: 0,
			author: null,
			requestedBy: { id: '9', username: '9' }
		});
		expect(serializeTrack({ title: 'Anon' } as never).requestedBy).toBeNull();
	});

	it('serializes no player as null', () => {
		expect(serializePlayer(null)).toBeNull();
	});

	it('serializes a player', () => {
		const queue = Object.assign([{ title: 'Next' }], { current: track });
		const player = { data: new Map(), queue, volume: 70, paused: true, loop: 'queue', position: 1000 };
		getActiveFilters(player as never).add('8D');
		const serialized = serializePlayer(player as never);
		expect(serialized).toMatchObject({ volume: 70, paused: true, loop: 'queue', position: 1000, filters: ['8D'] });
		expect(serialized?.current?.title).toBe('Song');
		expect(serialized?.tracks.map((entry) => entry.title)).toEqual(['Next']);
		expect(serialized?.eq).toHaveLength(15);
	});

	it('serializes the member voice channel', () => {
		expect(serializeVoiceState(null)).toEqual({ channelId: null, channelName: null });
		expect(serializeVoiceState({ voice: { channel: null } } as never)).toEqual({ channelId: null, channelName: null });
		expect(serializeVoiceState({ voice: { channel: { id: 'v1', name: 'Lounge' } } } as never)).toEqual({
			channelId: 'v1',
			channelName: 'Lounge'
		});
	});
});

describe('checkDJPermission', () => {
	const DJ_ROLE = 'dj-role';

	function member(options: { manageGuild?: boolean; roleExists?: boolean; hasRole?: boolean; humansInVoice?: number | null } = {}) {
		const { manageGuild = false, roleExists = true, hasRole = false, humansInVoice = null } = options;
		const humans = Array.from({ length: humansInVoice ?? 0 }, () => ({ user: { bot: false } }));
		const voiceMembers = [...humans, { user: { bot: true } }];
		return {
			permissions: { has: (permission: string) => permission === 'ManageGuild' && manageGuild },
			guild: { roles: { cache: new Map(roleExists ? [[DJ_ROLE, {}]] : []) } },
			roles: { cache: new Map(hasRole ? [[DJ_ROLE, {}]] : []) },
			voice: {
				channel:
					humansInVoice === null
						? null
						: {
								members: {
									filter: (predicate: (m: { user: { bot: boolean } }) => boolean) => ({
										size: voiceMembers.filter(predicate).length
									})
								}
							}
			}
		} as never;
	}

	it('allows everyone when no DJ role is configured', () => {
		expect(checkDJPermission(member(), 'dj-none')).toBe(true);
	});

	describe('with a DJ role configured', () => {
		const guildId = 'dj-set';
		setMusicConfig({ guild_id: guildId, dj_role_id: DJ_ROLE });

		it('allows members with ManageGuild', () => {
			expect(checkDJPermission(member({ manageGuild: true }), guildId)).toBe(true);
		});

		it('allows everyone when the role was deleted', () => {
			expect(checkDJPermission(member({ roleExists: false }), guildId)).toBe(true);
		});

		it('allows members holding the role', () => {
			expect(checkDJPermission(member({ hasRole: true }), guildId)).toBe(true);
		});

		it('allows a member alone in voice with the bot', () => {
			expect(checkDJPermission(member({ humansInVoice: 1 }), guildId)).toBe(true);
		});

		it('refuses everyone else', () => {
			expect(checkDJPermission(member(), guildId)).toBe(false);
			expect(checkDJPermission(member({ humansInVoice: 2 }), guildId)).toBe(false);
		});
	});
});
