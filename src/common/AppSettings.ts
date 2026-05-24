export const DEFAULT_WARN_BEFORE_REQUEST_AFTER_SECONDS = 10
export const APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES = ['raw', 'formatted'] as const
export const DEFAULT_RESPONSE_BODY_DISPLAY_MODE = 'raw'
export const DEFAULT_COMPACT_REQUEST_VIEW = true
export const DEFAULT_VIM_MODE = false
export const DEFAULT_FORMAT_SCRIPT_BLOCKS_ON_SAVE = true
export const DEFAULT_SCRIPT_BLOCK_PRETTIER_CONFIG = '{}'
export const DEFAULT_COOKIES_ENABLED = true

export type AppSettingsResponseBodyDisplayMode = (typeof APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES)[number]

export type AppSettingsRecord = {
  id: string
  warnBeforeRequestAfterSeconds: number
  responseBodyDisplayMode: AppSettingsResponseBodyDisplayMode
  compactRequestView: boolean
  vimMode: boolean
  formatScriptBlocksOnSave: boolean
  scriptBlockPrettierConfig: string
  cookiesEnabled: boolean
  createdAt: number
  updatedAt: number
}

export type UpdateAppSettingsInput = {
  warnBeforeRequestAfterSeconds: number
  responseBodyDisplayMode: AppSettingsResponseBodyDisplayMode
  compactRequestView: boolean
  vimMode: boolean
  formatScriptBlocksOnSave: boolean
  scriptBlockPrettierConfig: string
  cookiesEnabled: boolean
}

export function parseScriptBlockPrettierConfig(value: string) {
  const parsed = JSON.parse(value) as unknown

  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Prettier config must be a JSON object')
  }

  return parsed as Record<string, unknown>
}
