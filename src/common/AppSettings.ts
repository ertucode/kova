export const DEFAULT_WARN_BEFORE_REQUEST_AFTER_SECONDS = 10
export const APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES = ['raw', 'formatted'] as const
export const DEFAULT_RESPONSE_BODY_DISPLAY_MODE = 'raw'

export type AppSettingsResponseBodyDisplayMode = (typeof APP_SETTINGS_RESPONSE_BODY_DISPLAY_MODES)[number]

export type AppSettingsRecord = {
  id: string
  warnBeforeRequestAfterSeconds: number
  responseBodyDisplayMode: AppSettingsResponseBodyDisplayMode
  createdAt: number
  updatedAt: number
}

export type UpdateAppSettingsInput = {
  warnBeforeRequestAfterSeconds: number
  responseBodyDisplayMode: AppSettingsResponseBodyDisplayMode
}
