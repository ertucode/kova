import { eq } from 'drizzle-orm'
import {
  APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES,
  DEFAULT_COOKIES_ENABLED,
  DEFAULT_COMPACT_REQUEST_VIEW,
  DEFAULT_FORMAT_SCRIPT_BLOCKS_ON_SAVE,
  DEFAULT_RESPONSE_BODY_DISPLAY_MODE,
  DEFAULT_SCRIPT_BLOCK_PRETTIER_CONFIG,
  DEFAULT_VIM_MODE,
  DEFAULT_WARN_BEFORE_REQUEST_AFTER_SECONDS,
  parseScriptBlockPrettierConfig,
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
    responseBodyDisplayMode: DEFAULT_RESPONSE_BODY_DISPLAY_MODE,
    compactRequestView: DEFAULT_COMPACT_REQUEST_VIEW,
    vimMode: DEFAULT_VIM_MODE,
    formatScriptBlocksOnSave: DEFAULT_FORMAT_SCRIPT_BLOCKS_ON_SAVE,
    scriptBlockPrettierConfig: DEFAULT_SCRIPT_BLOCK_PRETTIER_CONFIG,
    cookiesEnabled: DEFAULT_COOKIES_ENABLED,
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

  if (!APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES.includes(input.responseBodyDisplayMode)) {
    return GenericError.Message('Invalid response body display mode')
  }

  if (typeof input.compactRequestView !== 'boolean') {
    return GenericError.Message('Invalid compact request view setting')
  }

  if (typeof input.vimMode !== 'boolean') {
    return GenericError.Message('Invalid vim mode setting')
  }

  if (typeof input.formatScriptBlocksOnSave !== 'boolean') {
    return GenericError.Message('Invalid script formatting setting')
  }

  if (typeof input.scriptBlockPrettierConfig !== 'string') {
    return GenericError.Message('Invalid Prettier config setting')
  }

  try {
    parseScriptBlockPrettierConfig(input.scriptBlockPrettierConfig)
  } catch (error) {
    return GenericError.Message(error instanceof Error ? error.message : 'Invalid Prettier config setting')
  }

  if (typeof input.cookiesEnabled !== 'boolean') {
    return GenericError.Message('Invalid cookies setting')
  }

  try {
    const db = getDb()
    const current = await getAppSettings()
    const updatedAt = Date.now()
    const nextRecord: AppSettingsRow = {
      id: current.id,
      warnBeforeRequestAfterSeconds: Math.trunc(input.warnBeforeRequestAfterSeconds),
      responseBodyDisplayMode: input.responseBodyDisplayMode,
      compactRequestView: input.compactRequestView,
      vimMode: input.vimMode,
      formatScriptBlocksOnSave: input.formatScriptBlocksOnSave,
      scriptBlockPrettierConfig: input.scriptBlockPrettierConfig,
      cookiesEnabled: input.cookiesEnabled,
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
  const responseBodyDisplayMode = APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES.includes(
    value.responseBodyDisplayMode as (typeof APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES)[number]
  )
    ? (value.responseBodyDisplayMode as (typeof APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES)[number])
    : DEFAULT_RESPONSE_BODY_DISPLAY_MODE

  return {
    id: value.id,
    warnBeforeRequestAfterSeconds: value.warnBeforeRequestAfterSeconds,
    responseBodyDisplayMode,
    compactRequestView: value.compactRequestView ?? DEFAULT_COMPACT_REQUEST_VIEW,
    vimMode: value.vimMode ?? DEFAULT_VIM_MODE,
    formatScriptBlocksOnSave: value.formatScriptBlocksOnSave ?? DEFAULT_FORMAT_SCRIPT_BLOCKS_ON_SAVE,
    scriptBlockPrettierConfig: value.scriptBlockPrettierConfig ?? DEFAULT_SCRIPT_BLOCK_PRETTIER_CONFIG,
    cookiesEnabled: value.cookiesEnabled ?? DEFAULT_COOKIES_ENABLED,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}
