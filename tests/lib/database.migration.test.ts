import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';

describe('word_triggers legacy migration', () => {
	it('backfills global triggers to the home guild', async () => {
		const legacy = new Database(process.env.SQLITE_PATH!);
		legacy.exec('CREATE TABLE word_triggers (keyword TEXT PRIMARY KEY, response TEXT NOT NULL)');
		legacy.prepare('INSERT INTO word_triggers (keyword, response) VALUES (?, ?)').run('hello', 'world');
		legacy.close();

		// Imported only after the legacy schema exists: the migration runs at module load.
		const { db } = await import('../../src/lib/database.js');

		expect(db.prepare('SELECT guild_id, keyword, response FROM word_triggers').all()).toEqual([
			{ guild_id: '925192180480491540', keyword: 'hello', response: 'world' }
		]);
		expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'word_triggers_legacy'").get()).toBeUndefined();
	});
});
