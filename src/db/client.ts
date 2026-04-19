import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

import { settings } from '../config.ts';
import * as schema from './schema.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Resolve the DB path relative to the project root (two levels up from src/db).
const dbPath = resolve(__dirname, '..', '..', settings.database_url);

export const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

export const db = drizzle(sqlite, { schema });
