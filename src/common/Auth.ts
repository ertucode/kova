export type AuthLocation = 'header' | 'query'

export type HttpAuth =
  | { type: 'inherit' }
  | { type: 'noauth' }
  | { type: 'bearer'; token: string }
  | { type: 'apikey'; key: string; value: string; addTo: AuthLocation }
  | { type: 'basic'; username: string; password: string }

export const AUTH_TYPES = ['inherit', 'noauth', 'bearer', 'apikey', 'basic'] as const
export const AUTH_TYPES_WITHOUT_INHERIT = ['noauth', 'bearer', 'apikey', 'basic'] as const
export const AUTH_LOCATIONS = ['header', 'query'] as const

export function createDefaultHttpAuth(): HttpAuth {
  return { type: 'inherit' }
}

export function normalizeHttpAuth(value: unknown): HttpAuth {
  if (!value || typeof value !== 'object' || !('type' in value) || typeof value.type !== 'string') {
    return createDefaultHttpAuth()
  }

  const candidate = value as Record<string, unknown>

  switch (candidate.type) {
    case 'inherit':
    case 'noauth':
      return { type: candidate.type }
    case 'bearer':
      return { type: 'bearer', token: typeof candidate.token === 'string' ? candidate.token : '' }
    case 'apikey':
      return {
        type: 'apikey',
        key: typeof candidate.key === 'string' ? candidate.key : '',
        value: typeof candidate.value === 'string' ? candidate.value : '',
        addTo: candidate.addTo === 'query' ? 'query' : 'header',
      }
    case 'basic':
      return {
        type: 'basic',
        username: typeof candidate.username === 'string' ? candidate.username : '',
        password: typeof candidate.password === 'string' ? candidate.password : '',
      }
    default:
      return createDefaultHttpAuth()
  }
}

export function serializeHttpAuth(auth: HttpAuth) {
  return JSON.stringify(auth)
}

export function parseHttpAuth(value: string) {
  if (!value.trim()) {
    return createDefaultHttpAuth()
  }

  try {
    return normalizeHttpAuth(JSON.parse(value))
  } catch {
    return createDefaultHttpAuth()
  }
}

export function resolveInheritedAuth(folderAuths: HttpAuth[], requestAuth: HttpAuth) {
  let effectiveAuth: HttpAuth = { type: 'noauth' }

  for (const auth of folderAuths) {
    if (auth.type !== 'inherit') {
      effectiveAuth = auth
    }
  }

  if (requestAuth.type !== 'inherit') {
    effectiveAuth = requestAuth
  }

  return effectiveAuth
}

export function getAuthVariableSources(auth: HttpAuth) {
  switch (auth.type) {
    case 'bearer':
      return [auth.token]
    case 'apikey':
      return [auth.key, auth.value]
    case 'basic':
      return [auth.username, auth.password]
    default:
      return []
  }
}

export function resolveAuth(auth: HttpAuth, variables: Record<string, string>) {
  switch (auth.type) {
    case 'inherit':
    case 'noauth':
      return auth
    case 'bearer':
      return { type: 'bearer', token: replaceVariables(auth.token, variables) } as const
    case 'apikey':
      return {
        type: 'apikey',
        key: replaceVariables(auth.key, variables),
        value: replaceVariables(auth.value, variables),
        addTo: auth.addTo,
      } as const
    case 'basic':
      return {
        type: 'basic',
        username: replaceVariables(auth.username, variables),
        password: replaceVariables(auth.password, variables),
      } as const
  }
}

export function getAuthHeaders(auth: HttpAuth) {
  switch (auth.type) {
    case 'bearer':
      return auth.token.trim() ? [{ key: 'Authorization', value: `Bearer ${auth.token}` }] : []
    case 'apikey':
      return auth.addTo === 'header' && auth.key.trim() ? [{ key: auth.key.trim(), value: auth.value }] : []
    case 'basic': {
      const token = toBase64(`${auth.username}:${auth.password}`)
      return [{ key: 'Authorization', value: `Basic ${token}` }]
    }
    default:
      return []
  }
}

export function getAuthQueryParams(auth: HttpAuth) {
  if (auth.type !== 'apikey' || auth.addTo !== 'query' || !auth.key.trim()) {
    return []
  }

  return [{ key: auth.key.trim(), value: auth.value }]
}

function replaceVariables(value: string, variables: Record<string, string>) {
  return value.replace(/\\?\{\{\s*([a-zA-Z0-9._-]+)\s*\}\}/g, (match, variableName: string) => {
    if (match.startsWith('\\')) {
      return match.slice(1)
    }

    return variables[variableName.trim()] ?? match
  })
}

function toBase64(value: string) {
  if (typeof globalThis.btoa === 'function') {
    return globalThis.btoa(value)
  }

  return Buffer.from(value, 'utf8').toString('base64')
}
