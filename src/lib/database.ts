import Database from 'better-sqlite3';
import { dirname, join } from 'path';
import { mkdirSync } from 'fs';

import { rootDir } from './constants';

const defaultPath = join(rootDir, 'data', 'word_triggers.db');
const dbPath = process.env.SQLITE_PATH ?? defaultPath;

// Ensure the directory exists before opening the database
mkdirSync(dirname(dbPath), { recursive: true });

export const db = new Database(dbPath);
