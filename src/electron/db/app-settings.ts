import { eq } from 'drizzle-orm'
import {
  APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES,
  DEFAULT_COOKIES_ENABLED,
  DEFAULT_COMPACT_REQUEST_VIEW,
  DEFAULT_FORMAT_SCRIPT_BLOCKS_ON_SAVE,
  DEFAULT_RESPONSE_BODY_DISPLAY_MODE,
  DEFAULT_SCRIPT_AI_MODEL,
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
    scriptAiModel: DEFAULT_SCRIPT_AI_MODEL,
    scriptAiServerPort: null,
    createdAt: now,
    updatedAt: now,
  }

  db.insert(appSettings).values(defaults).run()
  return toAppSettingsRecord(defaults)
}

export async function updateAppSettings(input: UpdateAppSettingsInput): Promise<GenericResult<AppSettingsRecord>> {
  const validationError = validateAppSettingsPatch(input)
  if (validationError) {
    return GenericError.Message(validationError)
  }

  try {
    await ensureAppSettingsExists()

    const db = getDb()
    const nextPatch = buildAppSettingsUpdatePatch(input)

    db.update(appSettings).set(nextPatch).where(eq(appSettings.id, DEFAULT_APP_SETTINGS_ID)).run()
    return Result.Success(await getAppSettings())
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function validateAppSettingsPatch(input: UpdateAppSettingsInput) {
  if (
    input.warnBeforeRequestAfterSeconds !== undefined
    && (!Number.isFinite(input.warnBeforeRequestAfterSeconds) || input.warnBeforeRequestAfterSeconds < 0)
  ) {
    return 'Warn before request timeout must be zero or greater'
  }

  if (
    input.responseBodyDisplayMode !== undefined
    && !APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES.includes(input.responseBodyDisplayMode)
  ) {
    return 'Invalid response body display mode'
  }

  if (input.compactRequestView !== undefined && typeof input.compactRequestView !== 'boolean') {
    return 'Invalid compact request view setting'
  }

  if (input.vimMode !== undefined && typeof input.vimMode !== 'boolean') {
    return 'Invalid vim mode setting'
  }

  if (input.formatScriptBlocksOnSave !== undefined && typeof input.formatScriptBlocksOnSave !== 'boolean') {
    return 'Invalid script formatting setting'
  }

  if (input.scriptBlockPrettierConfig !== undefined) {
    if (typeof input.scriptBlockPrettierConfig !== 'string') {
      return 'Invalid Prettier config setting'
    }

    try {
      parseScriptBlockPrettierConfig(input.scriptBlockPrettierConfig)
    } catch (error) {
      return error instanceof Error ? error.message : 'Invalid Prettier config setting'
    }
  }

  if (input.cookiesEnabled !== undefined && typeof input.cookiesEnabled !== 'boolean') {
    return 'Invalid cookies setting'
  }

  if (input.scriptAiModel !== undefined && input.scriptAiModel !== null && typeof input.scriptAiModel !== 'string') {
    return 'Invalid script AI model setting'
  }

  if (
    input.scriptAiServerPort !== undefined
    && input.scriptAiServerPort !== null
    && (!Number.isInteger(input.scriptAiServerPort) || input.scriptAiServerPort < 1024 || input.scriptAiServerPort > 65535)
  ) {
    return 'Script AI server port must be an integer between 1024 and 65535'
  }

  return null
}

function buildAppSettingsUpdatePatch(input: UpdateAppSettingsInput): Partial<AppSettingsRow> {
  const patch: Partial<AppSettingsRow> = {
    updatedAt: Date.now(),
  }

  if (input.warnBeforeRequestAfterSeconds !== undefined) {
    patch.warnBeforeRequestAfterSeconds = Math.trunc(input.warnBeforeRequestAfterSeconds)
  }

  if (input.responseBodyDisplayMode !== undefined) {
    patch.responseBodyDisplayMode = input.responseBodyDisplayMode
  }

  if (input.compactRequestView !== undefined) {
    patch.compactRequestView = input.compactRequestView
  }

  if (input.vimMode !== undefined) {
    patch.vimMode = input.vimMode
  }

  if (input.formatScriptBlocksOnSave !== undefined) {
    patch.formatScriptBlocksOnSave = input.formatScriptBlocksOnSave
  }

  if (input.scriptBlockPrettierConfig !== undefined) {
    patch.scriptBlockPrettierConfig = input.scriptBlockPrettierConfig
  }

  if (input.cookiesEnabled !== undefined) {
    patch.cookiesEnabled = input.cookiesEnabled
  }

  if (input.scriptAiModel !== undefined) {
    patch.scriptAiModel = input.scriptAiModel
  }

  if (input.scriptAiServerPort !== undefined) {
    patch.scriptAiServerPort = input.scriptAiServerPort
  }

  return patch
}

async function ensureAppSettingsExists() {
  const db = getDb()
  const existing = db.select({ id: appSettings.id }).from(appSettings).where(eq(appSettings.id, DEFAULT_APP_SETTINGS_ID)).get()
  if (existing) {
    return
  }

  await getAppSettings()
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
    scriptAiModel: value.scriptAiModel ?? DEFAULT_SCRIPT_AI_MODEL,
    scriptAiServerPort: value.scriptAiServerPort ?? null,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  }
}
