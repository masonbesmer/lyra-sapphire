import { describe, expect, it } from 'vitest';
import { addPlayHistory, getPlayHistory, getTopTracks, getTopUsers } from '../../src/lib/musicHistory';

function play(guildId: string, userId: string, title: string, playedAt: string) {
	addPlayHistory({ guild_id: guildId, user_id: userId, track_title: title, track_url: `https://x/${title}`, played_at: playedAt });
}

describe('addPlayHistory', () => {
	it('defaults the duration to 0 and the source to null', () => {
		addPlayHistory({ guild_id: 'mh-defaults', user_id: 'u1', track_title: 'Song', track_url: 'https://x/song' });
		const [row] = getPlayHistory('mh-defaults');
		expect(row).toMatchObject({ track_title: 'Song', track_url: 'https://x/song', track_duration_ms: 0, source: null });
		expect(Number.isNaN(Date.parse(row.played_at))).toBe(false);
	});
});

describe('getPlayHistory', () => {
	const guildId = 'mh-history';
	play(guildId, 'u1', 'first', '2026-01-01T00:00:00.000Z');
	play(guildId, 'u1', 'third', '2026-01-03T00:00:00.000Z');
	play(guildId, 'u1', 'second', '2026-01-02T00:00:00.000Z');

	it('returns newest first', () => {
		expect(getPlayHistory(guildId).map((row) => row.track_title)).toEqual(['third', 'second', 'first']);
	});

	it('applies limit and offset', () => {
		expect(getPlayHistory(guildId, 1, 1).map((row) => row.track_title)).toEqual(['second']);
	});
});

describe('top tracks and users', () => {
	const guildId = 'mh-top';
	const at = '2026-01-01T00:00:00.000Z';
	play(guildId, 'u1', 'hit', at);
	play(guildId, 'u2', 'hit', at);
	play(guildId, 'u2', 'hit', at);
	play(guildId, 'u2', 'b-side', at);
	play(guildId, 'u3', 'deep-cut', at);

	it('ranks tracks by play count', () => {
		const top = getTopTracks(guildId);
		expect(top[0]).toEqual({ track_title: 'hit', track_url: 'https://x/hit', play_count: 3 });
		expect(top).toHaveLength(3);
		expect(getTopTracks(guildId, 1)).toHaveLength(1);
	});

	it('ranks users by play count', () => {
		const top = getTopUsers(guildId);
		expect(top[0]).toEqual({ user_id: 'u2', play_count: 3 });
		expect(top.slice(1)).toEqual(
			expect.arrayContaining([
				{ user_id: 'u1', play_count: 1 },
				{ user_id: 'u3', play_count: 1 }
			])
		);
		expect(top).toHaveLength(3);
		expect(getTopUsers(guildId, 1)).toEqual([{ user_id: 'u2', play_count: 3 }]);
	});
});
