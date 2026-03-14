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

  ensureFolderAndRequestColumns(sqlite)

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS environments (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      variables text NOT NULL DEFAULT '',
      position integer NOT NULL DEFAULT 0,
      priority integer NOT NULL DEFAULT 0,
      created_at integer NOT NULL,
      deleted_at integer
    );
    CREATE INDEX IF NOT EXISTS environments_deleted_at_idx ON environments (deleted_at);
    CREATE INDEX IF NOT EXISTS environments_priority_idx ON environments (priority);
    CREATE INDEX IF NOT EXISTS environments_position_idx ON environments (position);
  `)

  ensureEnvironmentColumns(sqlite)

  db = drizzleDb;
  return db;
}

function ensureFolderAndRequestColumns(sqlite: Database.Database) {
  const folderColumns = sqlite.prepare("PRAGMA table_info(folders)").all() as Array<{ name: string }>;
  if (!folderColumns.some((column) => column.name === 'headers')) {
    sqlite.exec("ALTER TABLE folders ADD COLUMN headers text NOT NULL DEFAULT '';")
  }

  if (!folderColumns.some((column) => column.name === 'auth_json')) {
    sqlite.exec("ALTER TABLE folders ADD COLUMN auth_json text NOT NULL DEFAULT '{\"type\":\"inherit\"}';")
  }

  const columns = sqlite.prepare("PRAGMA table_info(requests)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'path_params')) {
    sqlite.exec("ALTER TABLE requests ADD COLUMN path_params text NOT NULL DEFAULT '';")
  }

  if (!columns.some((column) => column.name === 'search_params')) {
    sqlite.exec("ALTER TABLE requests ADD COLUMN search_params text NOT NULL DEFAULT '';")
  }

  if (!columns.some((column) => column.name === 'auth_json')) {
    sqlite.exec("ALTER TABLE requests ADD COLUMN auth_json text NOT NULL DEFAULT '{\"type\":\"inherit\"}';")
  }
}

function ensureEnvironmentColumns(sqlite: Database.Database) {
  const columns = sqlite.prepare("PRAGMA table_info(environments)").all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === 'position')) {
    sqlite.exec("ALTER TABLE environments ADD COLUMN position integer NOT NULL DEFAULT 0;")
  }

  sqlite.exec("CREATE INDEX IF NOT EXISTS environments_position_idx ON environments (position);")

  const activeRows = sqlite.prepare("SELECT id FROM environments WHERE deleted_at IS NULL ORDER BY position, created_at").all() as Array<{ id: string }>
  activeRows.forEach((row, index) => {
    sqlite.prepare("UPDATE environments SET position = ? WHERE id = ?").run(index, row.id)
  })
}

export function getDb() {
  if (!db) {
    throw new Error("Database not initialized");
  }

  return db;
}
