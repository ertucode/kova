import path from 'path'
import fsSync from 'fs'
import { appendFile, mkdir, open, rename, stat, unlink, writeFile } from 'fs/promises'
import { pipeline } from 'stream/promises'
import {
  DEFAULT_SERVER_LOG_MAX_SIZE_MB,
  type ServerLogConfig,
  type UpdateServerLogConfigInput,
} from '../common/ServerLog.js'

const SETTINGS_FILE_NAME = 'server-log-settings.json'
const DEFAULT_LOG_FILE_NAME = 'kova.log'
const RETAINED_FILE_RATIO = 0.75

let serverLog: ServerLog | null = null

export function initializeServerLog(userDataPath: string, captureOutput: boolean) {
  if (serverLog) {
    return serverLog.getConfig()
  }

  serverLog = new ServerLog(userDataPath, captureOutput)
  return serverLog.getConfig()
}

export function getServerLogConfig() {
  if (!serverLog) {
    throw new Error('Server log has not been initialized')
  }

  return serverLog.getConfig()
}

export async function updateServerLogConfig(input: UpdateServerLogConfigInput) {
  if (!serverLog) {
    throw new Error('Server log has not been initialized')
  }

  return await serverLog.updateConfig(input)
}

class ServerLog {
  private readonly settingsPath: string
  private readonly originalStderrWrite = process.stderr.write.bind(process.stderr)
  private config: ServerLogConfig
  private pendingChunks: Buffer[] = []
  private flushScheduled = false
  private operation = Promise.resolve()

  constructor(userDataPath: string, captureOutput: boolean) {
    this.settingsPath = path.join(userDataPath, SETTINGS_FILE_NAME)
    this.config = readConfig(this.settingsPath, userDataPath)
    persistInitialConfig(this.settingsPath, this.config)

    if (!captureOutput) {
      return
    }

    this.captureStream(process.stdout)
    this.captureStream(process.stderr)
    this.enqueue(Buffer.from(`\n--- Kova server log started ${new Date().toISOString()} ---\n`))
  }

  getConfig(): ServerLogConfig {
    return { ...this.config }
  }

  async updateConfig(input: UpdateServerLogConfigInput) {
    const nextConfig = normalizeConfig({ ...this.config, ...input }, path.dirname(this.settingsPath))
    if (nextConfig.filePath === this.settingsPath) {
      throw new Error('Server log path cannot be the server log settings file')
    }
    this.flushPending()

    await this.queueOperation(async () => {
      await mkdir(path.dirname(nextConfig.filePath), { recursive: true })
      const file = await open(nextConfig.filePath, 'a')
      await file.close()
      await appendWithTailLimit(nextConfig.filePath, Buffer.alloc(0), toBytes(nextConfig.maxSizeMb))
      await persistConfig(this.settingsPath, nextConfig)
      this.config = nextConfig
    })

    return this.getConfig()
  }

  private captureStream(stream: NodeJS.WriteStream) {
    const originalWrite = stream.write.bind(stream)
    type WriteArguments = Parameters<NodeJS.WriteStream['write']>

    stream.write = ((...args: WriteArguments) => {
      const chunk = args[0]
      const encoding = typeof args[1] === 'string' ? args[1] : undefined
      this.enqueue(typeof chunk === 'string' ? Buffer.from(chunk, encoding) : Buffer.from(chunk))
      return Reflect.apply(originalWrite, stream, args) as boolean
    }) as NodeJS.WriteStream['write']
  }

  private enqueue(chunk: Buffer) {
    this.pendingChunks.push(chunk)
    if (this.flushScheduled) {
      return
    }

    this.flushScheduled = true
    setImmediate(() => this.flushPending())
  }

  private flushPending() {
    this.flushScheduled = false
    if (this.pendingChunks.length === 0) {
      return
    }

    const chunk = Buffer.concat(this.pendingChunks)
    const config = this.getConfig()
    this.pendingChunks = []
    void this.queueOperation(() => appendWithTailLimit(config.filePath, chunk, toBytes(config.maxSizeMb)))
  }

  private queueOperation(operation: () => Promise<void>) {
    const result = this.operation.then(operation)
    this.operation = result.catch(error => {
      const message = error instanceof Error ? (error.stack ?? error.message) : String(error)
      Reflect.apply(this.originalStderrWrite, process.stderr, [`[server-log] ${message}\n`])
    })
    return result
  }
}

function readConfig(settingsPath: string, userDataPath: string): ServerLogConfig {
  try {
    const parsed = JSON.parse(fsSync.readFileSync(settingsPath, 'utf8')) as unknown
    if (isServerLogConfig(parsed)) {
      return normalizeConfig(parsed, userDataPath)
    }
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      process.stderr.write(`[server-log] Failed to read settings: ${String(error)}\n`)
    }
  }

  return {
    filePath: path.join(userDataPath, DEFAULT_LOG_FILE_NAME),
    maxSizeMb: DEFAULT_SERVER_LOG_MAX_SIZE_MB,
  }
}

function normalizeConfig(config: ServerLogConfig, userDataPath: string): ServerLogConfig {
  const trimmedPath = config.filePath.trim()
  if (!trimmedPath) {
    throw new Error('Server log path cannot be empty')
  }
  if (!Number.isInteger(config.maxSizeMb) || config.maxSizeMb < 1 || config.maxSizeMb > 10_240) {
    throw new Error('Server log maximum size must be a whole number between 1 and 10240 MB')
  }

  const expandedPath =
    trimmedPath === '~'
      ? (process.env.HOME ?? trimmedPath)
      : trimmedPath.startsWith(`~${path.sep}`)
        ? path.join(process.env.HOME ?? '~', trimmedPath.slice(2))
        : trimmedPath

  return {
    filePath: path.resolve(userDataPath, expandedPath),
    maxSizeMb: config.maxSizeMb,
  }
}

function isServerLogConfig(value: unknown): value is ServerLogConfig {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return typeof candidate.filePath === 'string' && typeof candidate.maxSizeMb === 'number'
}

async function persistConfig(settingsPath: string, config: ServerLogConfig) {
  await mkdir(path.dirname(settingsPath), { recursive: true })
  const temporaryPath = `${settingsPath}.${process.pid}.tmp`
  await writeFile(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
  await rename(temporaryPath, settingsPath)
}

function persistInitialConfig(settingsPath: string, config: ServerLogConfig) {
  try {
    fsSync.mkdirSync(path.dirname(settingsPath), { recursive: true })
    const temporaryPath = `${settingsPath}.${process.pid}.tmp`
    fsSync.writeFileSync(temporaryPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    fsSync.renameSync(temporaryPath, settingsPath)
  } catch (error) {
    process.stderr.write(`[server-log] Failed to persist settings: ${String(error)}\n`)
  }
}

async function appendWithTailLimit(filePath: string, chunk: Buffer, maxBytes: number) {
  await mkdir(path.dirname(filePath), { recursive: true })

  let currentSize = 0
  try {
    currentSize = (await stat(filePath)).size
  } catch (error) {
    if (!isNodeError(error) || error.code !== 'ENOENT') {
      throw error
    }
  }

  if (currentSize + chunk.length <= maxBytes) {
    if (chunk.length > 0) {
      await appendFile(filePath, chunk)
    }
    return
  }

  const boundedChunk = chunk.subarray(Math.max(0, chunk.length - maxBytes))
  const retainedByteCount = Math.max(0, Math.floor(maxBytes * RETAINED_FILE_RATIO) - boundedChunk.length)
  const temporaryPath = `${filePath}.${process.pid}.rotate`
  try {
    if (retainedByteCount > 0 && currentSize > 0) {
      const start = Math.max(0, currentSize - retainedByteCount)
      await pipeline(fsSync.createReadStream(filePath, { start }), fsSync.createWriteStream(temporaryPath))
      await appendFile(temporaryPath, boundedChunk)
    } else {
      await writeFile(temporaryPath, boundedChunk)
    }
    await rename(temporaryPath, filePath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

function toBytes(megabytes: number) {
  return megabytes * 1024 * 1024
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
