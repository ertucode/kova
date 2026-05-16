export type ParsedStructuredResponse = {
  format: 'json' | 'xml'
  root: unknown
}

export type ResponseTableResolution = {
  isAvailable: boolean
  rows: Array<Record<string, unknown>>
  detectedAccessor: string | null
}

export function resolveResponseTableRows(
  parsedStructuredResponse: ParsedStructuredResponse | null,
  accessor: string
): ResponseTableResolution {
  if (!parsedStructuredResponse) {
    return { isAvailable: false, rows: [], detectedAccessor: null }
  }

  const detectedMatch = findFirstObjectArray(parsedStructuredResponse.root)
  const candidate = accessor.trim()
    ? resolveAccessor(parsedStructuredResponse.root, accessor.trim())
    : detectedMatch?.value
  const rows = normalizeResponseTableRows(candidate)

  return {
    isAvailable: true,
    rows,
    detectedAccessor: detectedMatch?.path ?? null,
  }
}

function resolveAccessor(root: unknown, accessor: string): unknown {
  const segments = parseAccessorSegments(accessor)
  if (segments === null) {
    return undefined
  }

  let current: unknown = root

  for (const segment of segments) {
    if (typeof segment === 'number') {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        return undefined
      }

      current = current[segment]
      continue
    }

    if (!isRecordLike(current) || !(segment in current)) {
      return undefined
    }

    current = current[segment]
  }

  return current
}

function parseAccessorSegments(accessor: string): Array<string | number> | null {
  const trimmed = accessor.trim()
  if (!trimmed) {
    return []
  }

  if (trimmed === 'r') {
    return []
  }

  if (!trimmed.startsWith('r')) {
    return null
  }

  const segments: Array<string | number> = []
  let index = 1

  while (index < trimmed.length) {
    const currentChar = trimmed[index]

    if (currentChar === '.') {
      index += 1
      const start = index
      while (index < trimmed.length && /[A-Za-z0-9_$-]/.test(trimmed[index] ?? '')) {
        index += 1
      }

      if (start === index) {
        return null
      }

      segments.push(trimmed.slice(start, index))
      continue
    }

    if (currentChar === '[') {
      const closingIndex = trimmed.indexOf(']', index)
      if (closingIndex < 0) {
        return null
      }

      const innerValue = trimmed.slice(index + 1, closingIndex).trim()
      if (/^\d+$/.test(innerValue)) {
        segments.push(Number(innerValue))
      } else {
        const quotedMatch = innerValue.match(/^(['"])(.*)\1$/)
        if (!quotedMatch) {
          return null
        }

        segments.push(quotedMatch[2])
      }

      index = closingIndex + 1
      continue
    }

    return null
  }

  return segments
}

function findFirstObjectArray(root: unknown): { path: string; value: unknown } | null {
  const queue: Array<{ value: unknown; path: string }> = [{ value: root, path: 'r' }]
  const visited = new Set<unknown>()

  while (queue.length > 0) {
    const currentEntry = queue.shift()
    const current = currentEntry?.value

    if (!currentEntry || current == null || visited.has(current)) {
      continue
    }

    if (typeof current === 'object') {
      visited.add(current)
    }

    if (Array.isArray(current) && current.length > 0 && current.every(isRecordLike)) {
      return currentEntry
    }

    if (Array.isArray(current)) {
      current.forEach((item, index) => {
        queue.push({ value: item, path: `${currentEntry.path}[${index}]` })
      })
      continue
    }

    if (isRecordLike(current)) {
      Object.entries(current).forEach(([key, value]) => {
        queue.push({ value, path: `${currentEntry.path}${formatAccessorSegment(key)}` })
      })
    }
  }

  return null
}

function formatAccessorSegment(key: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$-]*$/.test(key) ? `.${key}` : `[${JSON.stringify(key)}]`
}

function normalizeResponseTableRows(value: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(value)) {
    return []
  }

  return value.filter(isRecordLike)
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
