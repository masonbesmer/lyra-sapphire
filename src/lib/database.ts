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