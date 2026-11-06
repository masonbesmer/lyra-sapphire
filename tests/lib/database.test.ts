import { describe, expect, it } from 'vitest';
import { db } from '../../src/lib/database';

describe('database', () => {
	it('creates every table on import', () => {
		const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map((row) => row.name);
		expect(tables).toEqual(
			expect.arrayContaining([
				'word_triggers',
				'word_trigger_excluded_channels',
				'player_messages',
				'starboard_config',
				'starboard_messages',
				'starboard_blacklist',
				'command_permissions',
				'music_config',
				'play_history',
				'active_sessions',
				'leaderboard_messages',
				'leaderboard_voice',
				'guild_meta',
				'voice_assistant_config',
				'voice_assistant_optout',
				'voice_assistant_follow',
				'voice_command_log',
				'config_audit'
			])
		);
		expect(tables).not.toContain('transcribe_config');
	});
});
