export const DEFAULT_WARN_BEFORE_REQUEST_AFTER_SECONDS = 10

export type AppSettingsRecord = {
  id: string
  warnBeforeRequestAfterSeconds: number
  createdAt: number
  updatedAt: number
}

export type UpdateAppSettingsInput = {
  warnBeforeRequestAfterSeconds: number
}
