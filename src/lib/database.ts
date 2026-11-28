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

// Channels keyword replies stay out of. Presence is the setting, like the starboard
// blacklist: a row means triggers never fire in that channel.
db.exec(
	`CREATE TABLE IF NOT EXISTS word_trigger_excluded_channels (
               guild_id   TEXT NOT NULL,
               channel_id TEXT NOT NULL,
               PRIMARY KEY (guild_id, channel_id)
       )`
);

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

// Migrate music_config: add columns added after the table shipped.
{
	const cols = db.prepare('PRAGMA table_info(music_config)').all() as { name: string }[];
	const names = new Set(cols.map((c) => c.name));
	if (!names.has('announce_channel_id')) db.exec(`ALTER TABLE music_config ADD COLUMN announce_channel_id TEXT`);
	// How long the music bot sits in voice after the queue runs dry. 0 means it stays put.
	if (!names.has('idle_timeout_ms')) db.exec(`ALTER TABLE music_config ADD COLUMN idle_timeout_ms INTEGER DEFAULT 300000`);
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
		max_utterance_ms INTEGER DEFAULT 8000,
		follow_delay_ms  INTEGER DEFAULT 10000,
		wake_chime       INTEGER DEFAULT 1,
		google_api_key   TEXT,
		google_speech_api_key TEXT,
		stt_provider     TEXT    DEFAULT 'local',
		tts_provider     TEXT    DEFAULT 'local',
		stt_language     TEXT    DEFAULT 'en-US',
		tts_voice        TEXT    DEFAULT 'en-US-Neural2-F',
		gemini_model     TEXT    DEFAULT 'gemini-3.5-flash-lite'
	)`
);

// Migrate voice_assistant_config: follow and the wake chime arrived after the table did.
{
	const cols = db.prepare('PRAGMA table_info(voice_assistant_config)').all() as { name: string }[];
	if (!cols.some((column) => column.name === 'follow_delay_ms')) {
		db.exec(`ALTER TABLE voice_assistant_config ADD COLUMN follow_delay_ms INTEGER DEFAULT 10000`);
	}
	if (!cols.some((column) => column.name === 'wake_chime')) {
		db.exec(`ALTER TABLE voice_assistant_config ADD COLUMN wake_chime INTEGER DEFAULT 1`);
	}
	// Per-guild Google key and the cloud speech providers it unlocks.
	const added: [string, string][] = [
		['google_api_key', 'TEXT'],
		['google_speech_api_key', 'TEXT'],
		['stt_provider', "TEXT DEFAULT 'local'"],
		['tts_provider', "TEXT DEFAULT 'local'"],
		['stt_language', "TEXT DEFAULT 'en-US'"],
		['tts_voice', "TEXT DEFAULT 'en-US-Neural2-F'"],
		['gemini_model', "TEXT DEFAULT 'gemini-3.5-flash-lite'"]
	];
	for (const [name, type] of added) {
		if (!cols.some((column) => column.name === name)) db.exec(`ALTER TABLE voice_assistant_config ADD COLUMN ${name} ${type}`);
	}
}

// Spoken word triggers were removed. The keyword table goes, and so does the switch that
// armed them: `triggers_enabled` was the only reason the detector ever ran in scan mode, and
// leaving the column would keep offering a setting nothing reads.
db.exec(`DROP TABLE IF EXISTS voice_word_triggers`);
{
	const cols = db.prepare('PRAGMA table_info(voice_assistant_config)').all() as { name: string }[];
	if (cols.some((column) => column.name === 'triggers_enabled')) {
		db.exec(`ALTER TABLE voice_assistant_config DROP COLUMN triggers_enabled`);
	}
}

db.exec(
	`CREATE TABLE IF NOT EXISTS voice_assistant_optout (
		guild_id TEXT NOT NULL,
		user_id  TEXT NOT NULL,
		PRIMARY KEY (guild_id, user_id)
	)`
);

// Presence is the setting: a row means that member wants Lyra to follow them into voice.
// Guild-scoped like the opt-out table, so following one server says nothing about another.
db.exec(
	`CREATE TABLE IF NOT EXISTS voice_assistant_follow (
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

// Trigger fires were logged here under their own intent, with the keyword in the transcript
// column. With triggers gone the rows describe a feature that no longer exists, and the
// grammar tuning they existed for cannot use them.
db.exec(`DELETE FROM voice_command_log WHERE intent = 'voice_trigger'`);

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

// The one exception to the no-sweep rule below. `voice_triggers` is no longer a section the
// dashboard can label or filter by, so its rows would render as a blank heading over a
// setting nobody can look up — worse than not showing them.
db.exec(`DELETE FROM config_audit WHERE section = 'voice_triggers'`);

// Deliberately not swept, unlike voice_command_log above. Config changes are rare and small,
// and the point of an audit trail is that it still answers "who changed this" months later.

// Playlists belong to a Discord user, not a guild, so there is deliberately no guild column:
// the same playlist follows its owner into every server. Foreign keys are never enabled on
// this connection, so deleting a playlist must delete its tracks and grants explicitly
// (deletePlaylist in src/lib/playlists.ts does it in one transaction).
db.exec(
	`CREATE TABLE IF NOT EXISTS playlists (
		id               INTEGER PRIMARY KEY AUTOINCREMENT,
		owner_id         TEXT    NOT NULL,
		name             TEXT    NOT NULL,
		description      TEXT,
		is_public        INTEGER NOT NULL DEFAULT 0,
		cover_image      BLOB,
		cover_mime       TEXT,
		cover_updated_at TEXT,
		created_at       TEXT    NOT NULL,
		updated_at       TEXT    NOT NULL
	)`
);

db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_playlists_owner_name ON playlists (owner_id, name COLLATE NOCASE)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_playlists_public ON playlists (is_public, owner_id)`);

// raw_json is the Lavalink track exactly as Kazagumo received it, so a saved track plays
// without another search. The other columns duplicate it only so listings need not parse it.
db.exec(
	`CREATE TABLE IF NOT EXISTS playlist_tracks (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		playlist_id INTEGER NOT NULL,
		position    INTEGER NOT NULL,
		title       TEXT    NOT NULL,
		uri         TEXT,
		author      TEXT,
		length_ms   INTEGER NOT NULL DEFAULT 0,
		source      TEXT,
		raw_json    TEXT    NOT NULL,
		added_by    TEXT    NOT NULL,
		added_at    TEXT    NOT NULL
	)`
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_playlist_tracks_order ON playlist_tracks (playlist_id, position)`);

db.exec(
	`CREATE TABLE IF NOT EXISTS playlist_grants (
		playlist_id INTEGER NOT NULL,
		user_id     TEXT    NOT NULL,
		can_create  INTEGER NOT NULL DEFAULT 0,
		can_read    INTEGER NOT NULL DEFAULT 0,
		can_update  INTEGER NOT NULL DEFAULT 0,
		can_delete  INTEGER NOT NULL DEFAULT 0,
		granted_by  TEXT    NOT NULL,
		granted_at  TEXT    NOT NULL,
		PRIMARY KEY (playlist_id, user_id)
	)`
);

db.exec(`CREATE INDEX IF NOT EXISTS idx_playlist_grants_user ON playlist_grants (user_id)`);

// Audio files uploaded into playlists (Discord CDN links expire, so the bytes are kept on disk next
// to this database; see src/lib/playlistMedia.ts). `file` is `<sha256>.<ext>`, so the same upload
// is stored once however many playlists hold it. uploaded_by and guild_id are only for quotas: the
// first uploader pays for the bytes. A track points at its file through playlist_tracks.media_file,
// and a file nothing points at any more is removed by pruneOrphanMedia.
db.exec(
	`CREATE TABLE IF NOT EXISTS playlist_media (
		file        TEXT    PRIMARY KEY,
		size_bytes  INTEGER NOT NULL,
		uploaded_by TEXT    NOT NULL,
		guild_id    TEXT    NOT NULL,
		created_at  TEXT    NOT NULL
	)`
);
db.exec(`CREATE INDEX IF NOT EXISTS idx_playlist_media_uploader ON playlist_media (uploaded_by)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_playlist_media_guild ON playlist_media (guild_id)`);

{
	const cols = db.prepare('PRAGMA table_info(playlist_tracks)').all() as { name: string }[];
	if (!cols.some((col) => col.name === 'media_file')) db.exec(`ALTER TABLE playlist_tracks ADD COLUMN media_file TEXT`);
}
db.exec(`CREATE INDEX IF NOT EXISTS idx_playlist_tracks_media ON playlist_tracks (media_file) WHERE media_file IS NOT NULL`);

// Moderation (LYRA-8). Case numbers are per guild and never reused, so a deleted case leaves a
// gap rather than handing its number to the next action: the counter lives in its own table
// instead of being derived from MAX(case_number), which would recycle the last number.
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_case_counter (
		guild_id  TEXT PRIMARY KEY,
		last_case INTEGER NOT NULL
	)`
);

// target_type says what target_id points at: a user for member actions, a channel for purge,
// slowmode and lock, or the guild itself for a server-wide lockdown. Tags are copied at write
// time because the user may be gone (banned, left, renamed) by the time anyone reads the case.
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_cases (
		guild_id       TEXT    NOT NULL,
		case_number    INTEGER NOT NULL,
		action         TEXT    NOT NULL,
		target_type    TEXT    NOT NULL DEFAULT 'user',
		target_id      TEXT    NOT NULL,
		target_tag     TEXT,
		moderator_id   TEXT    NOT NULL,
		moderator_tag  TEXT,
		reason         TEXT,
		duration_ms    INTEGER,
		expires_at     TEXT,
		created_at     TEXT    NOT NULL,
		log_channel_id TEXT,
		log_message_id TEXT,
		PRIMARY KEY (guild_id, case_number)
	)`
);
db.exec(`CREATE INDEX IF NOT EXISTS idx_mod_cases_target ON mod_cases (guild_id, target_id, case_number DESC)`);

// Private moderator notes. Never shown to the member, never DMed.
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_notes (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id   TEXT NOT NULL,
		target_id  TEXT NOT NULL,
		author_id  TEXT NOT NULL,
		author_tag TEXT,
		content    TEXT NOT NULL,
		created_at TEXT NOT NULL
	)`
);
db.exec(`CREATE INDEX IF NOT EXISTS idx_mod_notes_target ON mod_notes (guild_id, target_id, id DESC)`);

// Timed actions that must survive a restart: lifting a temp-ban, removing a timed role.
// role_id is '' rather than NULL for actions without a role, so the unique index treats
// "unban this user" as one slot (NULLs never collide in a SQLite unique index).
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_scheduled_actions (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id    TEXT    NOT NULL,
		action      TEXT    NOT NULL,
		target_id   TEXT    NOT NULL,
		role_id     TEXT    NOT NULL DEFAULT '',
		run_at      TEXT    NOT NULL,
		case_number INTEGER,
		attempts    INTEGER NOT NULL DEFAULT 0
	)`
);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_scheduled_slot ON mod_scheduled_actions (guild_id, action, target_id, role_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_mod_scheduled_due ON mod_scheduled_actions (run_at)`);

// dm_actions is a comma-separated list of the actions that DM their target. NULL means the
// default list (every action that can reach the member), so a guild that never ran /modconfig
// gets DMs without a row.
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_config (
		guild_id       TEXT PRIMARY KEY,
		log_channel_id TEXT,
		dm_actions     TEXT
	)`
);

// Channels Lyra locked, with the @everyone overwrite bits they had before (JSON of
// permission name → true/false/null). Unlock puts those back exactly, and a server-wide
// unlock only reopens these, so channels that were read-only before the lockdown stay that way.
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_locked_channels (
		guild_id   TEXT NOT NULL,
		channel_id TEXT NOT NULL,
		previous   TEXT NOT NULL DEFAULT '{}',
		PRIMARY KEY (guild_id, channel_id)
	)`
);

// Self-assign role panels (LYRA-9). A panel is one message: a bot-posted embed with buttons or a
// select menu, or any message (the bot's or someone else's) that people react to. `owned` says
// whether Lyra posted it, so she only edits or deletes messages that are hers.
db.exec(
	`CREATE TABLE IF NOT EXISTS role_panels (
		id          INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id    TEXT    NOT NULL,
		channel_id  TEXT    NOT NULL,
		message_id  TEXT    NOT NULL,
		kind        TEXT    NOT NULL,
		mode        TEXT    NOT NULL DEFAULT 'normal',
		title       TEXT,
		description TEXT,
		owned       INTEGER NOT NULL DEFAULT 1,
		created_by  TEXT    NOT NULL,
		created_at  TEXT    NOT NULL
	)`
);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_role_panels_message ON role_panels (message_id)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_role_panels_guild ON role_panels (guild_id, id)`);

// emoji_key is what a reaction is matched on: a custom emoji's ID, or the unicode emoji with
// variation selectors stripped. emoji keeps the original text for display.
db.exec(
	`CREATE TABLE IF NOT EXISTS role_panel_entries (
		panel_id  INTEGER NOT NULL,
		role_id   TEXT    NOT NULL,
		emoji     TEXT,
		emoji_key TEXT,
		label     TEXT,
		position  INTEGER NOT NULL,
		PRIMARY KEY (panel_id, role_id)
	)`
);
db.exec(`CREATE INDEX IF NOT EXISTS idx_role_panel_entries_emoji ON role_panel_entries (panel_id, emoji_key)`);

// Roles given on join. target is 'human' or 'bot'.
db.exec(
	`CREATE TABLE IF NOT EXISTS auto_roles (
		guild_id TEXT NOT NULL,
		role_id  TEXT NOT NULL,
		target   TEXT NOT NULL,
		PRIMARY KEY (guild_id, role_id, target)
	)`
);

// Roles that come back when a member leaves and rejoins (e.g. a mute role), and the ones each
// departed member held. role_ids is a JSON array, filtered against the current sticky list on rejoin.
db.exec(
	`CREATE TABLE IF NOT EXISTS sticky_role_config (
		guild_id TEXT NOT NULL,
		role_id  TEXT NOT NULL,
		PRIMARY KEY (guild_id, role_id)
	)`
);
db.exec(
	`CREATE TABLE IF NOT EXISTS sticky_role_holds (
		guild_id TEXT NOT NULL,
		user_id  TEXT NOT NULL,
		role_ids TEXT NOT NULL,
		saved_at TEXT NOT NULL,
		PRIMARY KEY (guild_id, user_id)
	)`
);

// Event logging (LYRA-10). One row per routed event type; an event with no row isn't logged.
db.exec(
	`CREATE TABLE IF NOT EXISTS log_routes (
		guild_id   TEXT NOT NULL,
		event      TEXT NOT NULL,
		channel_id TEXT NOT NULL,
		PRIMARY KEY (guild_id, event)
	)`
);

// Channels and users the event log skips. target_type is 'channel' or 'user'.
db.exec(
	`CREATE TABLE IF NOT EXISTS log_ignores (
		guild_id    TEXT NOT NULL,
		target_type TEXT NOT NULL,
		target_id   TEXT NOT NULL,
		PRIMARY KEY (guild_id, target_type, target_id)
	)`
);

// AutoMod (LYRA-11). One row per filter per guild; a guild that never touched /automod has no
// rows and every filter is off. `settings` is JSON (limits, word lists, link mode) so each filter
// can carry its own knobs without a column each; exempt_* are JSON arrays of IDs.
db.exec(
	`CREATE TABLE IF NOT EXISTS automod_rules (
		guild_id        TEXT    NOT NULL,
		rule            TEXT    NOT NULL,
		enabled         INTEGER NOT NULL DEFAULT 0,
		action          TEXT    NOT NULL DEFAULT 'delete',
		duration_ms     INTEGER,
		settings        TEXT    NOT NULL DEFAULT '{}',
		exempt_roles    TEXT    NOT NULL DEFAULT '[]',
		exempt_channels TEXT    NOT NULL DEFAULT '[]',
		PRIMARY KEY (guild_id, rule)
	)`
);

// Guild-wide AutoMod switches. native_sync mirrors the word / mention / spam filters into
// Discord's own AutoMod rules, which block a message before anyone sees it.
db.exec(
	`CREATE TABLE IF NOT EXISTS automod_settings (
		guild_id        TEXT PRIMARY KEY,
		native_sync     INTEGER NOT NULL DEFAULT 0,
		exempt_roles    TEXT    NOT NULL DEFAULT '[]',
		exempt_channels TEXT    NOT NULL DEFAULT '[]'
	)`
);

// Warn thresholds (B14): reaching warn_count active warnings applies `action`. duration_ms is
// the timeout length, or a temp-ban length (NULL = permanent ban).
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_warn_thresholds (
		guild_id    TEXT    NOT NULL,
		warn_count  INTEGER NOT NULL,
		action      TEXT    NOT NULL,
		duration_ms INTEGER,
		PRIMARY KEY (guild_id, warn_count)
	)`
);

// Warn expiry: warnings older than expiry_ms stop counting toward thresholds (the case stays).
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_warn_config (
		guild_id  TEXT PRIMARY KEY,
		expiry_ms INTEGER
	)`
);

// Moderation P5 (LYRA-12): where reports, tickets and ban appeals go. One row per guild; NULL
// channels mean that feature is off. appeal_url is an outside form shown in ban DMs instead of
// (or as well as) the built-in appeal button.
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_queue_config (
		guild_id           TEXT PRIMARY KEY,
		report_channel_id  TEXT,
		ticket_channel_id  TEXT,
		staff_role_id      TEXT,
		appeal_channel_id  TEXT,
		appeal_url         TEXT
	)`
);

// Member reports. message_* is set for a "Report message" report, with a copy of the content
// because the message may be deleted before a moderator looks at it.
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_reports (
		id               INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id         TEXT NOT NULL,
		reporter_id      TEXT NOT NULL,
		target_id        TEXT NOT NULL,
		target_tag       TEXT,
		reason           TEXT NOT NULL,
		channel_id       TEXT,
		message_id       TEXT,
		message_content  TEXT,
		status           TEXT NOT NULL DEFAULT 'open',
		handled_by       TEXT,
		handled_at       TEXT,
		queue_message_id TEXT,
		created_at       TEXT NOT NULL
	)`
);
db.exec(`CREATE INDEX IF NOT EXISTS idx_mod_reports_reporter ON mod_reports (guild_id, reporter_id, created_at)`);

// Tickets: a private thread per member and guild while open.
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_tickets (
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id   TEXT NOT NULL,
		user_id    TEXT NOT NULL,
		thread_id  TEXT NOT NULL,
		subject    TEXT,
		status     TEXT NOT NULL DEFAULT 'open',
		opened_at  TEXT NOT NULL,
		closed_at  TEXT,
		closed_by  TEXT
	)`
);
db.exec(`CREATE INDEX IF NOT EXISTS idx_mod_tickets_user ON mod_tickets (guild_id, user_id, status)`);
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_mod_tickets_thread ON mod_tickets (thread_id)`);

// Ban appeals sent through the built-in form (the button in the ban DM).
db.exec(
	`CREATE TABLE IF NOT EXISTS mod_appeals (
		id               INTEGER PRIMARY KEY AUTOINCREMENT,
		guild_id         TEXT NOT NULL,
		user_id          TEXT NOT NULL,
		user_tag         TEXT,
		content          TEXT NOT NULL,
		status           TEXT NOT NULL DEFAULT 'pending',
		handled_by       TEXT,
		handled_at       TEXT,
		queue_message_id TEXT,
		created_at       TEXT NOT NULL
	)`
);
db.exec(`CREATE INDEX IF NOT EXISTS idx_mod_appeals_user ON mod_appeals (guild_id, user_id, created_at DESC)`);

// Anti-raid and the verification gate. Durations are in ms. raid_until is set while raid mode
// is on (so it survives a restart), raid_locked says whether raid mode locked the server and so
// has to unlock it when it ends.
db.exec(
	`CREATE TABLE IF NOT EXISTS antiraid_config (
		guild_id            TEXT PRIMARY KEY,
		enabled             INTEGER NOT NULL DEFAULT 0,
		join_threshold      INTEGER NOT NULL DEFAULT 10,
		join_window_ms      INTEGER NOT NULL DEFAULT 10000,
		raid_lockdown       INTEGER NOT NULL DEFAULT 1,
		raid_join_action    TEXT    NOT NULL DEFAULT 'quarantine',
		raid_duration_ms    INTEGER NOT NULL DEFAULT 900000,
		alert_channel_id    TEXT,
		alert_role_id       TEXT,
		min_account_age_ms  INTEGER NOT NULL DEFAULT 0,
		account_age_action  TEXT    NOT NULL DEFAULT 'quarantine',
		default_avatar_action TEXT  NOT NULL DEFAULT 'none',
		quarantine_role_id  TEXT,
		quarantine_on_join  INTEGER NOT NULL DEFAULT 0,
		verify_role_id      TEXT,
		verify_mode         TEXT    NOT NULL DEFAULT 'button',
		raid_until          TEXT,
		raid_locked         INTEGER NOT NULL DEFAULT 0,
		raid_join_count     INTEGER NOT NULL DEFAULT 0
	)`
);
