import { describe, expect, it } from 'vitest';
import { db } from '../../src/lib/database';
import { getMessageLeaderboard, getVoiceLeaderboard, recordMessage, recordVoiceSession } from '../../src/lib/leaderboard';

function backdate(table: 'leaderboard_messages' | 'leaderboard_voice', guildId: string, userId: string, modifier: string, durationS = 0) {
	if (table === 'leaderboard_messages') {
		db.prepare(`INSERT INTO leaderboard_messages (guild_id, user_id, recorded_at) VALUES (?, ?, datetime('now', ?))`).run(
			guildId,
			userId,
			modifier
		);
	} else {
		db.prepare(`INSERT INTO leaderboard_voice (guild_id, user_id, duration_s, recorded_at) VALUES (?, ?, ?, datetime('now', ?))`).run(
			guildId,
			userId,
			durationS,
			modifier
		);
	}
}

describe('message leaderboard', () => {
	const guildId = 'lb-messages';
	for (let i = 0; i < 3; i++) recordMessage(guildId, 'busy');
	recordMessage(guildId, 'quiet');
	for (let i = 0; i < 5; i++) backdate('leaderboard_messages', guildId, 'old-timer', '-10 days');
	for (let i = 0; i < 9; i++) backdate('leaderboard_messages', guildId, 'ancient', '-60 days');

	it('counts everything for all time, highest first', () => {
		expect(getMessageLeaderboard(guildId, 'all')).toEqual([
			{ userId: 'ancient', value: 9 },
			{ userId: 'old-timer', value: 5 },
			{ userId: 'busy', value: 3 },
			{ userId: 'quiet', value: 1 }
		]);
	});

	it('limits weekly to the last 7 days', () => {
		expect(getMessageLeaderboard(guildId, 'weekly')).toEqual([
			{ userId: 'busy', value: 3 },
			{ userId: 'quiet', value: 1 }
		]);
	});

	it('limits monthly to the last 30 days', () => {
		expect(getMessageLeaderboard(guildId, 'monthly').map((entry) => entry.userId)).toEqual(['old-timer', 'busy', 'quiet']);
	});

	it('returns at most five entries and is guild-scoped', () => {
		for (let i = 0; i < 7; i++) recordMessage('lb-many', `user-${i}`);
		expect(getMessageLeaderboard('lb-many', 'all')).toHaveLength(5);
		expect(getMessageLeaderboard('lb-nobody', 'all')).toEqual([]);
	});
});

describe('voice leaderboard', () => {
	const guildId = 'lb-voice';
	recordVoiceSession(guildId, 'talker', 60);
	recordVoiceSession(guildId, 'talker', 40);
	recordVoiceSession(guildId, 'listener', 30);
	backdate('leaderboard_voice', guildId, 'old-timer', '-10 days', 500);

	it('sums durations', () => {
		expect(getVoiceLeaderboard(guildId, 'all')).toEqual([
			{ userId: 'old-timer', value: 500 },
			{ userId: 'talker', value: 100 },
			{ userId: 'listener', value: 30 }
		]);
	});

	it('applies the period filter', () => {
		expect(getVoiceLeaderboard(guildId, 'weekly').map((entry) => entry.userId)).toEqual(['talker', 'listener']);
		expect(getVoiceLeaderboard(guildId, 'monthly').map((entry) => entry.userId)).toEqual(['old-timer', 'talker', 'listener']);
	});
});
