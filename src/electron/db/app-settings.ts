import { eq } from 'drizzle-orm'
import {
  DEFAULT_WARN_BEFORE_REQUEST_AFTER_SECONDS,
  type AppSettingsRecord,
  type UpdateAppSettingsInput,
} from '../../common/AppSettings.js'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { appSettings } from './schema.js'

type AppSettingsRow = typeof appSettings.$inferSelect

const DEFAULT_APP_SETTINGS_ID = 'default'

export async function getAppSettings(): Promise<AppSettingsRecord> {
  const db = getDb()
  const existing = db.select().from(appSettings).where(eq(appSettings.id, DEFAULT_APP_SETTINGS_ID)).get()

  if (existing) {
    return toAppSettingsRecord(existing)
  }

  const now = Date.now()
  const defaults: AppSettingsRow = {
    id: DEFAULT_APP_SETTINGS_ID,
    warnBeforeRequestAfterSeconds: DEFAULT_WARN_BEFORE_REQUEST_AFTER_SECONDS,
    createdAt: now,
    updatedAt: now,
  }

  db.insert(appSettings).values(defaults).run()
  return toAppSettingsRecord(defaults)
}

export async function updateAppSettings(input: UpdateAppSettingsInput): Promise<GenericResult<AppSettingsRecord>> {
  if (!Number.isFinite(input.warnBeforeRequestAfterSeconds) || input.warnBeforeRequestAfterSeconds < 0) {
    return GenericError.Message('Warn before request timeout must be zero or greater')
  }

  try {
    const db = getDb()
    const current = await getAppSettings()
    const updatedAt = Date.now()
    const nextRecord: AppSettingsRow = {
      id: current.id,
      warnBeforeRequestAfterSeconds: Math.trunc(input.warnBeforeRequestAfterSeconds),
      createdAt: current.createdAt,
      updatedAt,
    }

    db.update(appSettings).set(nextRecord).where(eq(appSettings.id, DEFAULT_APP_SETTINGS_ID)).run()
    return Result.Success(toAppSettingsRecord(nextRecord))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function toAppSettingsRecord(value: AppSettingsRow): AppSettingsRecord {
  return {
    id: value.id,
    warnBeforeRequestAfterSeconds: value.warnBeforeRequestAfterSeconds,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}
