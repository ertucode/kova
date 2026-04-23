import JSON5 from 'json5'

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

export function formatJson5(value: string) {
  const parsed = JSON5.parse(value)
  return JSON5.stringify(parsed, null, 2)
}

export function formatJson(value: string) {
  const parsed = JSON5.parse(value)
  return JSON.stringify(parsed, null, 2)
}

export function normalizeJson5ToJson(value: string) {
  const parsed = JSON5.parse(value)
  return JSON.stringify(parsed)
}

export function formatJson5PreferringJson(value: string) {
  return hasJson5Comments(value) ? formatJson5(value) : formatJson(value)
}
