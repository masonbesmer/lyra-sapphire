import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { mkdirSync, existsSync, openSync, closeSync } from 'fs';

import { rootDir } from './constants';

const defaultPath = join(rootDir, 'data', 'word_triggers.db');
const dbPath = process.env.SQLITE_PATH ?? defaultPath;

// Ensure the directory exists before opening the database
mkdirSync(dirname(dbPath), { recursive: true });

// Create the database file if it doesn't exist yet
if (!existsSync(dbPath)) {
	closeSync(openSync(dbPath, 'w'));
}

export const db: Database.Database = new Database(dbPath);

db.exec(
	`CREATE TABLE IF NOT EXISTS word_triggers (
               guild_id TEXT NOT NULL,
               keyword TEXT NOT NULL,
               response TEXT NOT NULL,
               PRIMARY KEY (guild_id, keyword)
       )`
);

// Migrate old word_triggers table (keyed by keyword alone, so every trigger was global)
// to the guild-scoped schema. Old rows carry no guild, so there is nothing to derive them
// from; backfill them to Lyra's home server and let admins re-home any strays by hand.
{
	const cols = db.prepare('PRAGMA table_info(word_triggers)').all() as { name: string }[];
	const hasGuildId = cols.some((c) => c.name === 'guild_id');
	if (!hasGuildId && cols.length > 0) {
		db.exec(`
			ALTER TABLE word_triggers RENAME TO word_triggers_legacy;
			CREATE TABLE word_triggers (
				guild_id TEXT NOT NULL,
				keyword TEXT NOT NULL,
				response TEXT NOT NULL,
				PRIMARY KEY (guild_id, keyword)
			);
			INSERT INTO word_triggers (guild_id, keyword, response)
				SELECT '925192180480491540', keyword, response FROM word_triggers_legacy;
			DROP TABLE word_triggers_legacy;
		`);
	}
}

// /transcribe was removed; its config table is no longer read by anything.
db.exec(`DROP TABLE IF EXISTS transcribe_config`);

db.exec(
	`CREATE TABLE IF NOT EXISTS player_messages (
               channel_id TEXT PRIMARY KEY,
               message_id TEXT NOT NULL
       )`
);

db.exec(
	`CREATE TABLE IF NOT EXISTS starboard_config (
               guild_id TEXT PRIMARY KEY,
               channel_id TEXT,
               threshold INTEGER DEFAULT 3
       )`
);

// Migrate starboard_config: add emoji/enabled/self_star columns if they don't exist yet
{
	const cols = db.prepare('PRAGMA table_info(starboard_config)').all() as { name: string }[];
	const names = new Set(cols.map((c) => c.name));
	if (!names.has('emoji')) db.exec(`ALTER TABLE starboard_config ADD COLUMN emoji TEXT DEFAULT '⭐'`);
	if (!names.has('enabled')) db.exec(`ALTER TABLE starboard_config ADD COLUMN enabled INTEGER DEFAULT 1`);
	if (!names.has('self_star')) db.exec(`ALTER TABLE starboard_config ADD COLUMN self_star INTEGER DEFAULT 1`);
}

db.exec(
	`CREATE TABLE IF NOT EXISTS starboard_messages (
               id TEXT PRIMARY KEY,
               guild_id TEXT NOT NULL,
               original_message_id TEXT NOT NULL,
               original_channel_id TEXT NOT NULL,
               starboard_message_id TEXT NOT NULL,
               star_count INTEGER NOT NULL,
               index_code TEXT NOT NULL UNIQUE
       )`
);

db.exec(
	`CREATE TABLE IF NOT EXISTS starboard_blacklist (
               guild_id TEXT NOT NULL,
               target_id TEXT NOT NULL,
               target_type TEXT NOT NULL,
               PRIMARY KEY (guild_id, target_id, target_type)
       )`
);

db.exec(
	`CREATE TABLE IF NOT EXISTS command_permissions (
               guild_id TEXT NOT NULL,
               command_name TEXT NOT NULL,
               required_role_id TEXT NOT NULL,
               PRIMARY KEY (guild_id, command_name)
       )`
);

// Migrate old command_permissions table (no guild_id) to the new guild-scoped schema
{
	const cols = db.prepare('PRAGMA table_info(command_permissions)').all() as { name: string }[];
	const hasGuildId = cols.some((c) => c.name === 'guild_id');
	if (!hasGuildId && cols.length > 0) {
		db.exec(`
			DROP TABLE command_permissions;
			CREATE TABLE command_permissions (
				guild_id TEXT NOT NULL,
				command_name TEXT NOT NULL,
				required_role_id TEXT NOT NULL,
				PRIMARY KEY (guild_id, command_name)
			)
		`);
	}
}

db.exec(
	`CREATE TABLE IF NOT EXISTS music_config (
               guild_id TEXT PRIMARY KEY,
               dj_role_id TEXT,
               default_volume INTEGER DEFAULT 25,
               announce_tracks INTEGER DEFAULT 1
       )`
);

// Migrate music_config: add announce_channel_id column if it doesn't exist yet
{
	const cols = db.prepare('PRAGMA table_info(music_config)').all() as { name: string }[];
	if (!cols.some((c) => c.name === 'announce_channel_id')) {
		db.exec(`ALTER TABLE music_config ADD COLUMN announce_channel_id TEXT`);
	}
}

db.exec(
	`CREATE TABLE IF NOT EXISTS play_history (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               guild_id TEXT NOT NULL,
               user_id TEXT NOT NULL,
               track_title TEXT NOT NULL,
               track_url TEXT NOT NULL,
               track_duration_ms INTEGER DEFAULT 0,
               source TEXT,
               played_at TEXT NOT NULL
       )`
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_play_history_guild_played ON play_history (guild_id, played_at DESC)`);

db.exec(
	`CREATE TABLE IF NOT EXISTS active_sessions (
               session_id TEXT PRIMARY KEY,
               user_id TEXT NOT NULL,
               guild_id TEXT NOT NULL,
               created_at TEXT NOT NULL,
               expires_at TEXT NOT NULL
       )`
);

db.exec(
	`CREATE TABLE IF NOT EXISTS leaderboard_messages (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id    TEXT NOT NULL,
		user_id     TEXT NOT NULL,
		recorded_at TEXT NOT NULL
	)`
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_lb_messages_guild_time ON leaderboard_messages (guild_id, recorded_at DESC)`);

db.exec(
	`CREATE TABLE IF NOT EXISTS leaderboard_voice (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id    TEXT NOT NULL,
		user_id     TEXT NOT NULL,
		duration_s  INTEGER NOT NULL,
		recorded_at TEXT NOT NULL
	)`
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_lb_voice_guild_time ON leaderboard_voice (guild_id, recorded_at DESC)`);

db.exec(
	`CREATE TABLE IF NOT EXISTS guild_meta (
               guild_id TEXT PRIMARY KEY,
               slug TEXT NOT NULL UNIQUE
       )`
);

db.exec(
	`CREATE TABLE IF NOT EXISTS voice_assistant_config (
		guild_id         TEXT PRIMARY KEY,
		enabled          INTEGER DEFAULT 0,
		wake_word        TEXT    DEFAULT 'hey_lyra',
		sensitivity      REAL    DEFAULT 0.5,
		require_dj       INTEGER DEFAULT 1,
		ack_mode         TEXT    DEFAULT 'text',
		text_channel_id  TEXT,
		silence_ms       INTEGER DEFAULT 600,
		max_utterance_ms INTEGER DEFAULT 8000
	)`
);

db.exec(
	`CREATE TABLE IF NOT EXISTS voice_assistant_optout (
		guild_id TEXT NOT NULL,
		user_id  TEXT NOT NULL,
		PRIMARY KEY (guild_id, user_id)
	)`
);

db.exec(
	`CREATE TABLE IF NOT EXISTS voice_command_log (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id    TEXT NOT NULL,
		user_id     TEXT NOT NULL,
		transcript  TEXT NOT NULL,
		intent      TEXT,
		confidence  REAL,
		dispatched  INTEGER DEFAULT 0,
		created_at  TEXT NOT NULL
	)`
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_voice_log_guild_time ON voice_command_log (guild_id, created_at DESC)`);

// Retention sweep. The log holds transcripts of things people said out loud; keeping them
// forever is not justified by the only reason they exist, which is tuning the intent grammar.
db.prepare(`DELETE FROM voice_command_log WHERE created_at < ?`).run(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

db.exec(
	`CREATE TABLE IF NOT EXISTS config_audit (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id    TEXT NOT NULL,
		actor_id    TEXT NOT NULL,
		actor_name  TEXT NOT NULL,
		source      TEXT NOT NULL,
		section     TEXT NOT NULL,
		setting     TEXT NOT NULL,
		old_value   TEXT,
		new_value   TEXT,
		created_at  TEXT NOT NULL
	)`
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_config_audit_guild_id ON config_audit (guild_id, id DESC)`);

// Deliberately not swept, unlike voice_command_log above. Config changes are rare and small,
// and the point of an audit trail is that it still answers "who changed this" months later.
