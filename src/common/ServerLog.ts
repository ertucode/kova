export const DEFAULT_SERVER_LOG_MAX_SIZE_MB = 100

export type ServerLogConfig = {
  filePath: string
  maxSizeMb: number
}

export type UpdateServerLogConfigInput = Partial<ServerLogConfig>
