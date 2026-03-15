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

  db = drizzleDb;
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error("Database not initialized");
  }

  return db;
}
