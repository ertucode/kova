import { dirname } from 'path'
import { applyEdits, modify, parse, printParseErrorCode, type ParseError } from 'jsonc-parser'
import { mkdir, readFile, stat, writeFile } from 'fs/promises'
import { homedir } from 'os'
import z from 'zod'
import { CommandMetadata } from '../common/Command.js'

export const ServerConfig = z.object({
  commands: z
    .object({
      command: z.string(),
    })
    .and(CommandMetadata)
    .array()
    .nullish(),
  databases: z
    .object({
      active: z.string().nullish(),
      items: z
        .object({
          name: z.string(),
          path: z.string(),
        })
        .array()
        .nullish(),
    })
    .nullish(),
})
export type ServerConfig = z.infer<typeof ServerConfig>

export type ServerDatabaseEntry = {
  name: string
  path: string
}

export type ResolvedServerDatabaseConfig = {
  activeName: string
  defaultDirectoryPath: string
  items: Array<ServerDatabaseEntry & { isDefault: boolean; sizeBytes: number | null }>
}

const SERVER_CONFIG_PATH = homedir() + '/.config/kova/kova.json'
const JSON_FORMATTING_OPTIONS = {
  insertSpaces: true,
  tabSize: 2,
  eol: '\n',
}

let serverConfig: ServerConfig = ServerConfig.parse({})
let configLoadPromise: Promise<ServerConfig> | null = null

async function loadConfig(): Promise<ServerConfig> {
  try {
    const file = await readFile(SERVER_CONFIG_PATH, 'utf-8')
    const parseErrors: ParseError[] = []
    const parsedConfig = parse(file, parseErrors)

    if (parseErrors.length > 0) {
      throw new Error(`Failed to parse config: ${parseErrors.map(error => printParseErrorCode(error.error)).join(', ')}`)
    }

    const parsed = normalizeServerConfig(ServerConfig.parse(parsedConfig))

    console.log('Loaded config:', JSON.stringify(parsed, null, 2))
    return parsed
  } catch (error: unknown) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') {
      console.log('No config found, using default')
      return ServerConfig.parse({})
    }

    if (error instanceof z.ZodError) {
      console.error('Invalid config found, using default', error)
      return ServerConfig.parse({})
    }

    console.error(error)
    return ServerConfig.parse({})
  }
}

export async function getServerConfig() {
  return ensureServerConfigLoaded()
}

export async function getResolvedDatabaseConfig(defaultDbPath: string): Promise<ResolvedServerDatabaseConfig> {
  const config = await ensureServerConfigLoaded()
  const defaultDirectoryPath = dirname(defaultDbPath)
  const customItems = config.databases?.items ?? []
  const items = [
    {
      name: 'default',
      path: defaultDbPath,
      isDefault: true,
      sizeBytes: await getFileSize(defaultDbPath),
    },
    ...(await Promise.all(
      customItems.map(async item => ({
        ...item,
        isDefault: false,
        sizeBytes: await getFileSize(item.path),
      }))
    )),
  ]

  const activeName = items.some(item => item.name === config.databases?.active) ? (config.databases?.active ?? 'default') : 'default'

  return {
    activeName,
    defaultDirectoryPath,
    items,
  }
}

export async function upsertCustomDatabaseConfig(input: { previousName?: string; name: string; path: string }) {
  const config = await ensureServerConfigLoaded()
  const nextName = input.name.trim()
  const nextPath = input.path.trim()
  const previousName = input.previousName?.trim()

  if (!nextName) {
    throw new Error('Database name is required')
  }

  if (!nextPath) {
    throw new Error('Database path is required')
  }

  if (nextName === 'default') {
    throw new Error('default is reserved and cannot be renamed')
  }

  const currentItems = config.databases?.items ?? []
  const nameInUse = currentItems.some(item => item.name === nextName && item.name !== previousName)
  if (nameInUse) {
    throw new Error(`A database named ${nextName} already exists`)
  }

  const nextItems = currentItems.filter(item => item.name !== previousName).concat({
    name: nextName,
    path: nextPath,
  })

  const nextConfig = normalizeServerConfig({
    ...config,
    databases: {
      active: config.databases?.active === previousName ? nextName : config.databases?.active,
      items: nextItems,
    },
  })

  await writeConfig(nextConfig)
}

export async function deleteCustomDatabaseConfig(name: string) {
  const config = await ensureServerConfigLoaded()
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error('Database name is required')
  }

  if (trimmedName === 'default') {
    throw new Error('The default database cannot be deleted')
  }

  const nextItems = (config.databases?.items ?? []).filter(item => item.name !== trimmedName)
  const nextConfig = normalizeServerConfig({
    ...config,
    databases: {
      active: config.databases?.active === trimmedName ? 'default' : config.databases?.active,
      items: nextItems,
    },
  })

  await writeConfig(nextConfig)
}

export async function setActiveDatabaseConfig(name: string) {
  const config = await ensureServerConfigLoaded()
  const trimmedName = name.trim()

  if (!trimmedName) {
    throw new Error('Database name is required')
  }

  const availableNames = new Set(['default', ...(config.databases?.items ?? []).map(item => item.name)])
  if (!availableNames.has(trimmedName)) {
    throw new Error(`Database ${trimmedName} does not exist`)
  }

  const nextConfig = normalizeServerConfig({
    ...config,
    databases: {
      active: trimmedName,
      items: config.databases?.items ?? [],
    },
  })

  await writeConfig(nextConfig)
}

async function ensureServerConfigLoaded() {
  if (!configLoadPromise) {
    configLoadPromise = loadConfig().then(config => {
      serverConfig = config
      return config
    })
  }

  return configLoadPromise
}

function normalizeServerConfig(input: ServerConfig): ServerConfig {
  const nextConfig = ServerConfig.parse(input)

  if (nextConfig.commands) {
    const commandNames = new Set<string>()
    nextConfig.commands = nextConfig.commands.filter(command => {
      if (commandNames.has(command.name)) {
        console.error('Duplicate command names found in config:', command.name)
        return false
      }

      commandNames.add(command.name)
      return true
    })
  }

  if (nextConfig.databases?.items) {
    const seenNames = new Set<string>()
    nextConfig.databases.items = nextConfig.databases.items.filter(item => {
      const name = item.name.trim()
      const entry = {
        ...item,
        name,
        path: item.path.trim(),
      }

      item.name = entry.name
      item.path = entry.path

      if (!entry.name || !entry.path || entry.name === 'default' || seenNames.has(entry.name)) {
        console.error('Invalid database entry found in config:', entry)
        return false
      }

      seenNames.add(entry.name)
      return true
    })
  }

  if (nextConfig.databases?.items?.length === 0) {
    nextConfig.databases.items = undefined
  }

  if (nextConfig.databases?.active === 'default') {
    nextConfig.databases.active = 'default'
  } else if (!nextConfig.databases?.items?.some(item => item.name === nextConfig.databases?.active)) {
    nextConfig.databases = nextConfig.databases
      ? {
          ...nextConfig.databases,
          active: undefined,
        }
      : undefined
  }

  if (nextConfig.databases && !nextConfig.databases.active && !nextConfig.databases.items) {
    nextConfig.databases = undefined
  }

  return nextConfig
}

async function writeConfig(nextConfig: ServerConfig) {
  const normalized = normalizeServerConfig(nextConfig)
  await mkdir(dirname(SERVER_CONFIG_PATH), { recursive: true })

  let nextContents: string

  try {
    const currentContents = await readFile(SERVER_CONFIG_PATH, 'utf-8')
    const edits = modify(currentContents, ['databases'], normalized.databases, {
      formattingOptions: JSON_FORMATTING_OPTIONS,
    })

    nextContents = applyEdits(currentContents, edits)
  } catch (error: unknown) {
    if (!isErrorWithCode(error) || error.code !== 'ENOENT') {
      console.error('Failed to patch config file, rewriting it from normalized state', error)
    }

    nextContents = `${JSON.stringify(normalized, null, 2)}\n`
  }

  await writeFile(SERVER_CONFIG_PATH, nextContents, 'utf-8')
  serverConfig = normalized
  configLoadPromise = Promise.resolve(serverConfig)
}

function isErrorWithCode(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

async function getFileSize(filePath: string) {
  try {
    const fileStats = await stat(filePath)
    return fileStats.isFile() ? fileStats.size : null
  } catch (error) {
    if (isErrorWithCode(error) && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}
