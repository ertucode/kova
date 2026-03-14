import { parseKeyValueRows, stringifyKeyValueRows, type KeyValueRow } from './KeyValueRows.js'
import { resolveTemplateVariables } from './RequestVariables.js'

const PATH_PARAM_SEGMENT_PATTERN = /^:([A-Za-z0-9._-]+)$/

export function extractPathParamNames(url: string) {
  const { path } = splitUrlParts(url)
  const names: string[] = []
  const seen = new Set<string>()

  for (const segment of splitPathSegments(path)) {
    const name = getPathParamName(segment)
    if (!name || seen.has(name)) {
      continue
    }

    seen.add(name)
    names.push(name)
  }

  return names
}

export function syncPathParamsWithUrl(url: string, pathParams: string) {
  const rowsByKey = new Map<string, KeyValueRow>()
  const rowsByOrder = parseKeyValueRows(pathParams)

  for (const row of rowsByOrder) {
    const key = row.key.trim()
    if (key && !rowsByKey.has(key)) {
      rowsByKey.set(key, row)
    }
  }

  const nextRows = extractPathParamNames(url).map((name, index) => {
    const byKey = rowsByKey.get(name)
    const byOrder = rowsByOrder[index]
    const source = byKey ?? byOrder

    return {
      id: source?.id ?? `path-param-${index}`,
      enabled: source?.enabled ?? true,
      key: name,
      value: source?.value ?? '',
      description: source?.description ?? '',
    } satisfies KeyValueRow
  })

  return stringifyKeyValueRows(nextRows)
}

export function syncUrlWithPathParams(url: string, pathParams: string) {
  const rows = parseKeyValueRows(pathParams).filter(row => row.key.trim())
  const nextNames = rows.map(row => row.key.trim())
  const { prefix, path, suffix } = splitUrlParts(url)
  const segments = splitPathSegments(path)
  const currentNames = extractUniqueNamesFromSegments(segments)

  const nextSegments: string[] = []

  for (const segment of segments) {
    const currentName = getPathParamName(segment)
    if (!currentName) {
      nextSegments.push(segment)
      continue
    }

    const index = currentNames.indexOf(currentName)
    if (index < 0) {
      nextSegments.push(segment)
      continue
    }

    const replacementName = nextNames[index]
    if (replacementName) {
      nextSegments.push(`:${replacementName}`)
    }
  }

  if (nextNames.length > currentNames.length) {
    nextSegments.push(...nextNames.slice(currentNames.length).map(name => `:${name}`))
  }

  const nextPath = joinPathSegments(nextSegments, path)
  return `${prefix}${nextPath}${suffix}`
}

export function applyPathParamsToUrl(url: string, pathParams: string) {
  const rows = parseKeyValueRows(pathParams)
  const rowsByKey = new Map(rows.map(row => [row.key.trim(), row] satisfies [string, KeyValueRow]))
  const { prefix, path, suffix } = splitUrlParts(url)
  const missingNames: string[] = []
  const nextSegments = splitPathSegments(path).map(segment => {
    const name = getPathParamName(segment)
    if (!name) {
      return segment
    }

    const row = rowsByKey.get(name)
    const value = row?.enabled ? row.value.trim() : ''
    if (!value) {
      if (!missingNames.includes(name)) {
        missingNames.push(name)
      }
      return segment
    }

    return encodeURIComponent(value)
  })

  return {
    url: `${prefix}${joinPathSegments(nextSegments, path)}${suffix}`,
    missingNames,
  }
}

export function syncSearchParamsWithUrl(url: string, searchParams: string) {
  const urlRows = extractSearchParamRows(url)
  const existingRows = parseKeyValueRows(searchParams)
  const disabledRows = existingRows.filter(row => !row.enabled && !urlRows.some(urlRow => urlRow.key === row.key.trim()))
  const existingRowsByKey = new Map(existingRows.map(row => [row.key.trim(), row] satisfies [string, KeyValueRow]))

  const nextRows = urlRows.map((row, index) => {
    const existingRow = existingRowsByKey.get(row.key) ?? existingRows[index]

    return {
      id: existingRow?.id ?? `search-param-${index}`,
      enabled: true,
      key: row.key,
      value: row.value,
      description: existingRow?.description ?? '',
    } satisfies KeyValueRow
  })

  return stringifyKeyValueRows([...nextRows, ...disabledRows])
}

export function syncUrlWithSearchParams(url: string, searchParams: string) {
  const rows = parseKeyValueRows(searchParams)
  const nextQuery = buildQueryString(rows)
  const { prefix, path, hash } = splitUrlParts(url)

  return `${prefix}${path}${nextQuery ? `?${nextQuery}` : ''}${hash}`
}

export function applySearchParamsToUrl(url: string, searchParams: string, variables: Record<string, string>) {
  const rows = parseKeyValueRows(searchParams)
  const { prefix, path, hash } = splitUrlParts(url)
  const query = buildQueryString(
    rows.map(row => ({
      ...row,
      key: resolveQueryToken(row.key, variables),
      value: resolveQueryToken(row.value, variables),
    }))
  )

  return `${prefix}${path}${query ? `?${query}` : ''}${hash}`
}

function splitUrlParts(url: string) {
  const match = url.match(/^([a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/?#]*)?([^?#]*)(\?[^#]*)?(#.*)?$/)

  return {
    prefix: match?.[1] ?? '',
    path: match?.[2] ?? url,
    query: match?.[3] ?? '',
    hash: match?.[4] ?? '',
    suffix: `${match?.[3] ?? ''}${match?.[4] ?? ''}`,
  }
}

function extractSearchParamRows(url: string) {
  const { query } = splitUrlParts(url)
  const queryValue = query.startsWith('?') ? query.slice(1) : query
  if (!queryValue) {
    return [] as Array<{ key: string; value: string }>
  }

  return queryValue.split('&').flatMap(part => {
    if (!part.trim()) {
      return []
    }

    const separatorIndex = part.indexOf('=')
    const key = decodeQueryValue(separatorIndex >= 0 ? part.slice(0, separatorIndex) : part)
    const value = decodeQueryValue(separatorIndex >= 0 ? part.slice(separatorIndex + 1) : '')
    if (!key.trim()) {
      return []
    }

    return [{ key, value }]
  })
}

function buildQueryString(rows: KeyValueRow[]) {
  return rows
    .filter(row => row.enabled && row.key.trim())
    .map(row => `${encodeURIComponent(row.key.trim())}=${encodeURIComponent(row.value)}`)
    .join('&')
}

function decodeQueryValue(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function resolveQueryToken(value: string, variables: Record<string, string>) {
  return resolveTemplateVariables(value, variables)
}

function splitPathSegments(path: string) {
  return path.split('/')
}

function joinPathSegments(segments: string[], originalPath: string) {
  const nextPath = segments.join('/')

  if (nextPath) {
    return nextPath
  }

  if (originalPath.startsWith('/')) {
    return '/'
  }

  return ''
}

function extractUniqueNamesFromSegments(segments: string[]) {
  const names: string[] = []
  const seen = new Set<string>()

  for (const segment of segments) {
    const name = getPathParamName(segment)
    if (!name || seen.has(name)) {
      continue
    }

    seen.add(name)
    names.push(name)
  }

  return names
}

function getPathParamName(segment: string) {
  const match = segment.match(PATH_PARAM_SEGMENT_PATTERN)
  return match?.[1] ?? null
}
