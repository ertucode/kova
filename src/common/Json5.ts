import JSON5 from 'json5'

type Json5Formatter = (value: string) => Promise<string>

let json5FormatterPromise: Promise<Json5Formatter> | null = null

type Options = Parameters<(typeof import('prettier/standalone'))['format']>[1]

async function getJson5Formatter(options?: Partial<Options>): Promise<Json5Formatter> {
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
          trailingComma: 'none',
          useTabs: true,
          ...options,
        })
      }
    })
  }

  return json5FormatterPromise
}

// function hasJson5Comments(value: string) {
//   let inString = false
//   let stringQuote = ''
//   let isEscaped = false
//
//   for (let index = 0; index < value.length; index += 1) {
//     const char = value[index]
//     const nextChar = value[index + 1]
//
//     if (inString) {
//       if (isEscaped) {
//         isEscaped = false
//         continue
//       }
//
//       if (char === '\\') {
//         isEscaped = true
//         continue
//       }
//
//       if (char === stringQuote) {
//         inString = false
//         stringQuote = ''
//       }
//
//       continue
//     }
//
//     if (char === '"' || char === "'") {
//       inString = true
//       stringQuote = char
//       continue
//     }
//
//     if (char === '/' && (nextChar === '/' || nextChar === '*')) {
//       return true
//     }
//   }
//
//   return false
// }
//
export async function formatJson5NoTraling(value: string) {
  const format = await getJson5Formatter({ trailingComma: 'none' })
  return format(value)
}

export function formatJson(value: string, indentation?: number) {
  const parsed = JSON5.parse(value)
  return JSON.stringify(parsed, null, indentation ?? 2)
}

export function normalizeJson5ToJson(value: string) {
  try {
    // Already JSON: native validation is fast. Return the source, not the parsed
    // value, so even numbers beyond JavaScript's precision remain untouched.
    JSON.parse(value)
    return value
  } catch {
    // JSON5 syntax needs conversion below.
  }

  // Validate with JSON5, but never serialize its parsed numbers: they may have
  // already lost precision. Convert the original tokens instead.
  JSON5.parse(value)
  // Strings must be matched before comments so comment markers inside strings
  // remain data. Validation above guarantees every other token is JSON5 syntax.
  const tokens =
    value.match(
      /"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|\/\/[^\r\n\u2028\u2029]*|\/\*[\s\S]*?\*\/|[{}\[\]:,]|[^\s{}\[\]:,\/]+/gu
    ) ?? []
  const significantTokens = tokens.filter(token => !token.startsWith('//') && !token.startsWith('/*'))

  return significantTokens
    .map((token, index) => {
      const nextToken = significantTokens[index + 1]
      if (token === ',' && (nextToken === '}' || nextToken === ']')) {
        return ''
      }
      if (token.startsWith('"') || token.startsWith("'")) {
        // Only escaped strings need a parser; ordinary strings just need JSON
        // quoting (including any literal control characters allowed by JSON5).
        return JSON.stringify(token.includes('\\') ? JSON5.parse<string>(token) : token.slice(1, -1))
      }
      if (nextToken === ':') {
        // Validated identifier keys only support \\uXXXX escapes, also valid JSON.
        return JSON.stringify(token.includes('\\') ? JSON.parse(`"${token}"`) : token)
      }
      return normalizeJson5Number(token)
    })
    .join('')
}

function normalizeJson5Number(token: string) {
  if (/^[+-]?(?:Infinity|NaN)$/.test(token)) {
    // Match JSON.stringify's treatment of non-finite JSON5 values.
    return 'null'
  }
  if (/^[+-]?0x/i.test(token)) {
    const negative = token.startsWith('-')
    const integer = BigInt(token.replace(/^[+-]/, ''))
    return (negative ? -integer : integer).toString()
  }
  if (/^[+\-.\d]/.test(token)) {
    return token
      .replace(/^\+/, '')
      .replace(/^(-?)\./, '$10.')
      .replace(/\.(?=[eE]|$)/, '.0')
  }
  return token
}

export async function formatJson5PreferringJson(value: string) {
  // Bu fonksiyon neden vardı hatırlamıyorum. Hatırlayana kadar commentli
  // return hasJson5Comments(value) ? formatJson5(value) : formatJson(value)
  return formatJson5NoTraling(value)
}

export async function formatJson5PreferringJsonWithTemplates(value: string) {
  const masked = maskBareTemplateTokens(value)
  const formatted = await formatJson5PreferringJson(masked.value)
  return restoreBareTemplateTokens(formatted, masked.tokens)
}

export function getJson5Diagnostic(value: string) {
  if (value.trim().length === 0) {
    return null
  }

  const masked = maskBareTemplateTokensForDiagnostics(value)

  try {
    JSON5.parse(masked)
    return null
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const location = extractJson5ErrorLocation(message)
    const from = location ? getOffsetFromLineColumn(value, location.line, location.column) : 0
    const to = Math.min(value.length, Math.max(from + 1, from + getDiagnosticSpanLength(value, from)))

    return {
      message,
      line: location?.line ?? null,
      column: location?.column ?? null,
      from,
      to,
    }
  }
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

function maskBareTemplateTokensForDiagnostics(value: string) {
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
      if (char === '{' && nextChar === '{') {
        const templateEnd = value.indexOf('}}', index + 2)
        if (templateEnd >= 0) {
          const token = value.slice(index, templateEnd + 2)
          result += maskTemplateTokenForQuotedStringDiagnostics(token)
          index = templateEnd + 2
          continue
        }
      }

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
        result += maskTemplateTokenForDiagnostics(token)
        index = templateEnd + 2
        continue
      }
    }

    result += char
    index += 1
  }

  return result
}

function maskTemplateTokenForDiagnostics(token: string) {
  let result = '0'

  for (let index = 1; index < token.length; index += 1) {
    const char = token[index]
    result += char === '\n' || char === '\r' ? char : ' '
  }

  return result
}

function maskTemplateTokenForQuotedStringDiagnostics(token: string) {
  let result = 'x'

  for (let index = 1; index < token.length; index += 1) {
    const char = token[index]
    if (char === '\r') {
      result += '\\\r'
      continue
    }

    if (char === '\n') {
      result += '\\\n'
      continue
    }

    result += ' '
  }

  return result
}

function extractJson5ErrorLocation(message: string) {
  const match = message.match(/at\s+(\d+):(\d+)$/)
  if (!match) {
    return null
  }

  return {
    line: Number(match[1]),
    column: Number(match[2]),
  }
}

function getOffsetFromLineColumn(value: string, line: number, column: number) {
  if (line < 1 || column < 1) {
    return 0
  }

  let offset = 0
  let currentLine = 1

  while (currentLine < line && offset < value.length) {
    if (value[offset] === '\n') {
      currentLine += 1
    }
    offset += 1
  }

  return Math.min(value.length, offset + column - 1)
}

function getDiagnosticSpanLength(value: string, from: number) {
  const nextChar = value[from]
  if (!nextChar || nextChar === '\n') {
    return 1
  }

  let length = 1
  while (from + length < value.length) {
    const char = value[from + length]
    if (char === '\n' || char === ',' || char === ':' || char === '}' || char === ']') {
      break
    }
    length += 1
  }

  return length
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
