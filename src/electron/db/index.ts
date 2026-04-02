import path from 'path'
import fs from 'fs'
import Database from 'better-sqlite3'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import * as schema from './schema.js'

let db: BetterSQLite3Database<typeof schema> | null = null
let sqlite: Database.Database | null = null
let currentDbPath: string | null = null
let currentMigrationsPath: string | null = null

export function initializeDatabase(options: { dbPath: string; migrationsPath: string }) {
  const resolvedDbPath = path.resolve(options.dbPath)
  const resolvedMigrationsPath = path.resolve(options.migrationsPath)

  if (db && currentDbPath === resolvedDbPath && currentMigrationsPath === resolvedMigrationsPath) {
    return db
  }

  const next = createDatabaseConnection({
    dbPath: resolvedDbPath,
    migrationsPath: resolvedMigrationsPath,
  })

  const previousSqlite = sqlite

  sqlite = next.sqlite
  db = next.drizzleDb
  currentDbPath = resolvedDbPath
  currentMigrationsPath = resolvedMigrationsPath

  previousSqlite?.close()

  return db
}

export function verifyDatabaseConnection(options: { dbPath: string; migrationsPath: string }) {
  const resolvedDbPath = path.resolve(options.dbPath)
  const resolvedMigrationsPath = path.resolve(options.migrationsPath)

  const connection = createDatabaseConnection({
    dbPath: resolvedDbPath,
    migrationsPath: resolvedMigrationsPath,
  })

  connection.sqlite.close()
}

export function closeDatabase() {
  sqlite?.close()
  sqlite = null
  db = null
  currentDbPath = null
  currentMigrationsPath = null
}

function createDatabaseConnection(options: { dbPath: string; migrationsPath: string }) {
  fs.mkdirSync(path.dirname(options.dbPath), { recursive: true })

  const sqliteDb = new Database(options.dbPath)
  const drizzleDb = drizzle(sqliteDb, { schema })

  try {
    if (fs.existsSync(options.migrationsPath)) {
      migrate(drizzleDb, { migrationsFolder: options.migrationsPath })
    }
  } catch (error) {
    sqliteDb.close()
    throw error
  }

  return {
    sqlite: sqliteDb,
    drizzleDb,
  }
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialized')
  }

  return db
}
