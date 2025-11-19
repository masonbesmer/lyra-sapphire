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

export const db = new Database(dbPath);

db.exec(
	`CREATE TABLE IF NOT EXISTS word_triggers (
               keyword TEXT PRIMARY KEY,
               response TEXT NOT NULL
       )`
);

db.exec(
	`CREATE TABLE IF NOT EXISTS transcribe_config (
                           guild_id TEXT PRIMARY KEY,
                           min_audio_seconds REAL DEFAULT 0.5,
                           interval_ms INTEGER DEFAULT 2000,
                           chunk_s INTEGER DEFAULT 5
           )`
);

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
