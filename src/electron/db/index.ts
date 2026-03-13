import path from "path";
import fs from "fs";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from './schema.js'

let db: BetterSQLite3Database<typeof schema> | null = null;

export function initializeDatabase(options: { dbPath: string; migrationsPath: string }) {
  if (db) return db;

  const sqlite = new Database(options.dbPath);
  const drizzleDb = drizzle(sqlite, { schema });

  if (fs.existsSync(options.migrationsPath)) {
    const migrationsPath = path.resolve(options.migrationsPath);
    migrate(drizzleDb, { migrationsFolder: migrationsPath });
  }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      variables text NOT NULL DEFAULT '',
      priority integer NOT NULL DEFAULT 0,
      created_at integer NOT NULL,
      deleted_at integer
    );
    CREATE INDEX IF NOT EXISTS environments_deleted_at_idx ON environments (deleted_at);
    CREATE INDEX IF NOT EXISTS environments_priority_idx ON environments (priority);
  `)

  db = drizzleDb;
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error("Database not initialized");
  }

  return db;
}
