import JSON5 from 'json5'

type Json5Formatter = (value: string) => Promise<string>

let json5FormatterPromise: Promise<Json5Formatter> | null = null

async function getJson5Formatter(): Promise<Json5Formatter> {
  if (!json5FormatterPromise) {
    json5FormatterPromise = Promise.all([
      import('prettier/standalone'),
      import('prettier/plugins/babel'),
      import('prettier/plugins/estree'),
    ]).then(([prettier, babelPlugin, estreePlugin]) => {
      return (value: string) => {
        return prettier.format(value, {
          parser: 'json5',
          plugins: [babelPlugin.default, estreePlugin.default],
          quoteProps: 'preserve',
          singleQuote: false,
          trailingComma: 'all',
          useTabs: true,
        })
      }
    })
  }

  return json5FormatterPromise
}

function hasJson5Comments(value: string) {
  let inString = false
  let stringQuote = ''
  let isEscaped = false

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    const nextChar = value[index + 1]

    if (inString) {
      if (isEscaped) {
        isEscaped = false
        continue
      }

      if (char === '\\') {
        isEscaped = true
        continue
      }

      if (char === stringQuote) {
        inString = false
        stringQuote = ''
      }

      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      stringQuote = char
      continue
    }

    if (char === '/' && (nextChar === '/' || nextChar === '*')) {
      return true
    }
  }

  return false
}

export async function formatJson5(value: string) {
  const format = await getJson5Formatter()
  return format(value)
}

export function formatJson(value: string) {
  const parsed = JSON5.parse(value)
  return JSON.stringify(parsed, null, 2)
}

export function normalizeJson5ToJson(value: string) {
  const parsed = JSON5.parse(value)
  return JSON.stringify(parsed)
}

export async function formatJson5PreferringJson(value: string) {
  return hasJson5Comments(value) ? formatJson5(value) : formatJson(value)
}
