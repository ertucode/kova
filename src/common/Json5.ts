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

export async function formatJson5PreferringJsonWithTemplates(value: string) {
  const masked = maskBareTemplateTokens(value)
  const formatted = await formatJson5PreferringJson(masked.value)
  return restoreBareTemplateTokens(formatted, masked.tokens)
}

function maskBareTemplateTokens(value: string) {
  const tokens: string[] = []
  let result = ''
  let index = 0
  let inString = false
  let stringQuote = ''
  let isEscaped = false
  let inLineComment = false
  let inBlockComment = false

  while (index < value.length) {
    const char = value[index]
    const nextChar = value[index + 1]

    if (inString) {
      result += char
      if (isEscaped) {
        isEscaped = false
      } else if (char === '\\') {
        isEscaped = true
      } else if (char === stringQuote) {
        inString = false
        stringQuote = ''
      }
      index += 1
      continue
    }

    if (inLineComment) {
      result += char
      if (char === '\n') {
        inLineComment = false
      }
      index += 1
      continue
    }

    if (inBlockComment) {
      result += char
      if (char === '*' && nextChar === '/') {
        result += nextChar
        inBlockComment = false
        index += 2
        continue
      }
      index += 1
      continue
    }

    if (char === '"' || char === "'") {
      inString = true
      stringQuote = char
      result += char
      index += 1
      continue
    }

    if (char === '/' && nextChar === '/') {
      inLineComment = true
      result += '//'
      index += 2
      continue
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true
      result += '/*'
      index += 2
      continue
    }

    if (char === '{' && nextChar === '{') {
      const templateEnd = value.indexOf('}}', index + 2)
      if (templateEnd >= 0) {
        const token = value.slice(index, templateEnd + 2)
        const placeholder = `"__KOVA_TEMPLATE_TOKEN_${tokens.length}__"`
        tokens.push(token)
        result += placeholder
        index = templateEnd + 2
        continue
      }
    }

    result += char
    index += 1
  }

  return { value: result, tokens }
}

function restoreBareTemplateTokens(value: string, tokens: string[]) {
  let restored = value

  for (const [index, token] of tokens.entries()) {
    const placeholder = `__KOVA_TEMPLATE_TOKEN_${index}__`
    restored = restored.replaceAll(`"${placeholder}"`, token)
    restored = restored.replaceAll(`'${placeholder}'`, token)
  }

  return restored
}
