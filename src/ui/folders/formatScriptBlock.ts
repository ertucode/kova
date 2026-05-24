import { parseScriptBlockPrettierConfig } from '@common/AppSettings'
import { getScriptBlockPrettierConfig } from '@/global/appSettingsStore'

type ScriptBlockFormatter = (value: string) => Promise<string>
type ScriptBlockFormatterWithCursor = (value: string, cursorOffset: number) => Promise<{ formatted: string; cursorOffset: number }>
type LoadedPrettier = {
  format: (value: string, options: Record<string, unknown>) => Promise<string>
  formatWithCursor: (value: string, options: Record<string, unknown>) => Promise<{ formatted: string; cursorOffset: number }>
  plugins: unknown[]
}

let scriptBlockFormatterPromise: Promise<ScriptBlockFormatter> | null = null
let scriptBlockFormatterWithCursorPromise: Promise<ScriptBlockFormatterWithCursor> | null = null
let loadedPrettierPromise: Promise<LoadedPrettier> | null = null
let cachedPrettierConfigString = ''
let cachedPrettierConfig: Record<string, unknown> = {}

async function loadPrettier(): Promise<LoadedPrettier> {
  if (!loadedPrettierPromise) {
    loadedPrettierPromise = Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ]).then(([prettier, babelPlugin, estreePlugin]) => {
      return {
        format: prettier.format as LoadedPrettier['format'],
        formatWithCursor: prettier.formatWithCursor as LoadedPrettier['formatWithCursor'],
        plugins: [babelPlugin.default, estreePlugin.default],
      }
    })
  }

  return loadedPrettierPromise as Promise<LoadedPrettier>
}

function getCachedPrettierConfig() {
  const configString = getScriptBlockPrettierConfig()
  if (configString !== cachedPrettierConfigString) {
    cachedPrettierConfigString = configString
    cachedPrettierConfig = parseScriptBlockPrettierConfig(configString)
  }

  return cachedPrettierConfig
}

function getBaseFormatOptions(plugins: unknown[]) {
  return {
    semi: false,
    singleQuote: true,
    trailingComma: 'all',
    tabWidth: 2,
    useTabs: false,
    ...getCachedPrettierConfig(),
    parser: 'babel-ts',
    plugins,
  }
}

async function getScriptBlockFormatter(): Promise<ScriptBlockFormatter> {
  if (!scriptBlockFormatterPromise) {
    scriptBlockFormatterPromise = loadPrettier().then(({ format, plugins }) => {
      return (value: string) => {
        return format(value, getBaseFormatOptions(plugins))
      }
    })
  }

  return scriptBlockFormatterPromise
}

async function getScriptBlockFormatterWithCursor(): Promise<ScriptBlockFormatterWithCursor> {
  if (!scriptBlockFormatterWithCursorPromise) {
    scriptBlockFormatterWithCursorPromise = loadPrettier().then(({ formatWithCursor, plugins }) => {
      return async (value: string, cursorOffset: number) => {
        const result = await formatWithCursor(value, {
          ...getBaseFormatOptions(plugins),
          cursorOffset,
        })

        return {
          formatted: result.formatted,
          cursorOffset: result.cursorOffset,
        }
      }
    })
  }

  return scriptBlockFormatterWithCursorPromise
}

export async function formatScriptBlock(value: string) {
  const format = await getScriptBlockFormatter()
  return format(value)
}

export async function formatScriptBlockWithCursor(value: string, cursorOffset: number) {
  const format = await getScriptBlockFormatterWithCursor()
  return format(value, cursorOffset)
}
