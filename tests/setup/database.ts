import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every test file gets its own throwaway SQLite file; src/lib/database.ts reads SQLITE_PATH at import.
process.env.SQLITE_PATH = join(mkdtempSync(join(tmpdir(), 'lyra-test-')), 'test.db');
