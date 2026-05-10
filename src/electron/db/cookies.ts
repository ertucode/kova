import { and, asc, desc, eq, lte, sql } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  ClearCookiesInput,
  CookieRecord,
  CookieSameSite,
  CreateCookieInput,
  DeleteCookieInput,
  UpdateCookieInput,
} from '../../common/Cookies.js'
import { Result } from '../../common/Result.js'
import { emitGenericEvent } from '../generic-events.js'
import { getAppSettings } from './app-settings.js'
import { getDb } from './index.js'
import { cookies } from './schema.js'

type CookieRow = typeof cookies.$inferSelect
type NewCookieRow = typeof cookies.$inferInsert

type ParsedResponseCookie = {
  name: string
  value: string
  domain: string
  path: string
  hostOnly: boolean
  secure: boolean
  httpOnly: boolean
  sameSite: CookieSameSite | null
  expiresAt: number | null
}

export async function listCookies(): Promise<CookieRecord[]> {
  pruneExpiredCookies()

  return getDb()
    .select()
    .from(cookies)
    .orderBy(asc(cookies.domain), desc(sql`length(${cookies.path})`), asc(cookies.path), asc(cookies.name), desc(cookies.updatedAt))
    .all()
    .map(toCookieRecord)
}

export async function createCookie(input: CreateCookieInput): Promise<GenericResult<CookieRecord>> {
  try {
    const cookie = normalizeEditableCookie(input)
    const now = Date.now()
    const row: NewCookieRow = {
      id: crypto.randomUUID(),
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      hostOnly: cookie.hostOnly,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expiresAt: cookie.expiresAt,
      createdAt: now,
      updatedAt: now,
    }

    getDb().insert(cookies).values(row).run()
    emitCookiesUpdated()
    return Result.Success({
      id: row.id,
      name: cookie.name,
      value: cookie.value,
      domain: cookie.domain,
      path: cookie.path,
      hostOnly: cookie.hostOnly,
      secure: cookie.secure,
      httpOnly: cookie.httpOnly,
      sameSite: cookie.sameSite,
      expiresAt: cookie.expiresAt,
      createdAt: now,
      updatedAt: now,
    })
  } catch (error) {
    return normalizeCookieMutationError(error)
  }
}

export async function updateCookie(input: UpdateCookieInput): Promise<GenericResult<CookieRecord>> {
  try {
    const cookie = normalizeEditableCookie(input)
    const result = getDb()
      .update(cookies)
      .set({
        ...cookie,
        updatedAt: Date.now(),
      })
      .where(eq(cookies.id, input.id))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Cookie not found')
    }

    const updated = getDb().select().from(cookies).where(eq(cookies.id, input.id)).get()
    if (!updated) {
      return GenericError.Message('Cookie not found')
    }

    emitCookiesUpdated()
    return Result.Success(toCookieRecord(updated))
  } catch (error) {
    return normalizeCookieMutationError(error)
  }
}

export async function deleteCookie(input: DeleteCookieInput): Promise<GenericResult<void>> {
  try {
    const result = getDb().delete(cookies).where(eq(cookies.id, input.id)).run()
    if (result.changes === 0) {
      return GenericError.Message('Cookie not found')
    }

    emitCookiesUpdated()
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function clearCookies(input: ClearCookiesInput = {}): Promise<GenericResult<void>> {
  try {
    const domain = normalizeCookieDomain(input.domain ?? '')
    if (domain) {
      getDb().delete(cookies).where(eq(cookies.domain, domain)).run()
    } else {
      getDb().delete(cookies).run()
    }

    emitCookiesUpdated()
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function storeResponseCookies(input: { requestUrl: string; setCookieValues: string[] }) {
  if (!(await getAppSettings()).cookiesEnabled) {
    console.info('[cookies] skipping response cookies because cookies are disabled', {
      requestUrl: input.requestUrl,
      setCookieValues: input.setCookieValues,
    })
    return
  }

  if (input.setCookieValues.length === 0) {
    console.info('[cookies] no response cookies to store', {
      requestUrl: input.requestUrl,
    })
    return
  }

  const requestUrl = parseHttpUrl(input.requestUrl)
  if (!requestUrl) {
    console.warn('[cookies] skipping response cookies because request URL is not http/https', {
      requestUrl: input.requestUrl,
      setCookieValues: input.setCookieValues,
    })
    return
  }

  pruneExpiredCookies()
  const db = getDb()
  const now = Date.now()
  let didChange = false

  console.info('[cookies] storing response cookies', {
    requestUrl: requestUrl.toString(),
    setCookieValues: input.setCookieValues,
  })

  db.transaction(tx => {
    for (const value of input.setCookieValues) {
      const parsed = parseSetCookieHeader(value, requestUrl, now)
      if (!parsed) {
        console.warn('[cookies] rejected set-cookie header during parse', {
          requestUrl: requestUrl.toString(),
          headerValue: value,
        })
        continue
      }

      console.info('[cookies] parsed set-cookie header', {
        requestUrl: requestUrl.toString(),
        headerValue: value,
        parsed,
      })

      const existing = tx
        .select()
        .from(cookies)
        .where(
          and(
            eq(cookies.name, parsed.name),
            eq(cookies.domain, parsed.domain),
            eq(cookies.path, parsed.path),
            eq(cookies.hostOnly, parsed.hostOnly)
          )
        )
        .get()

      if (parsed.expiresAt !== null && parsed.expiresAt <= now) {
        console.info('[cookies] response cookie expires immediately', {
          requestUrl: requestUrl.toString(),
          parsed,
          hadExistingCookie: Boolean(existing),
        })
        if (existing) {
          tx.delete(cookies).where(eq(cookies.id, existing.id)).run()
          didChange = true
        }
        continue
      }

      if (existing) {
        console.info('[cookies] updating existing cookie', {
          requestUrl: requestUrl.toString(),
          cookieId: existing.id,
          parsed,
        })
        tx.update(cookies)
          .set({
            value: parsed.value,
            secure: parsed.secure,
            httpOnly: parsed.httpOnly,
            sameSite: parsed.sameSite,
            expiresAt: parsed.expiresAt,
            updatedAt: now,
          })
          .where(eq(cookies.id, existing.id))
          .run()
      } else {
        console.info('[cookies] inserting new cookie', {
          requestUrl: requestUrl.toString(),
          parsed,
        })
        const row: NewCookieRow = {
          id: crypto.randomUUID(),
          name: parsed.name,
          value: parsed.value,
          domain: parsed.domain,
          path: parsed.path,
          hostOnly: parsed.hostOnly,
          secure: parsed.secure,
          httpOnly: parsed.httpOnly,
          sameSite: parsed.sameSite,
          expiresAt: parsed.expiresAt,
          createdAt: now,
          updatedAt: now,
        }
        tx.insert(cookies).values(row).run()
      }

      didChange = true
    }
  })

  if (didChange) {
    console.info('[cookies] response cookies stored successfully', {
      requestUrl: requestUrl.toString(),
    })
    emitCookiesUpdated()
  } else {
    console.info('[cookies] response cookies produced no database changes', {
      requestUrl: requestUrl.toString(),
      setCookieValues: input.setCookieValues,
    })
  }
}

export async function getCookieHeaderForUrl(url: string) {
  if (!(await getAppSettings()).cookiesEnabled) {
    return null
  }

  pruneExpiredCookies()

  const parsedUrl = parseHttpUrl(url)
  if (!parsedUrl) {
    return null
  }

  const matchingCookies = getDb()
    .select()
    .from(cookies)
    .all()
    .filter(cookie => cookieMatchesUrl(toCookieRecord(cookie), parsedUrl))
    .sort((left, right) => right.path.length - left.path.length || left.createdAt - right.createdAt)

  if (matchingCookies.length === 0) {
    return null
  }

  return matchingCookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ')
}

export function getSetCookieHeaderValues(headers: Headers) {
  const valuesFromEntries = getSetCookieHeaderValuesFromEntries(headers.entries())
  if (valuesFromEntries.length > 0) {
    return valuesFromEntries
  }

  const values = headers.getSetCookie()
  if (values.length > 0) {
    return values.length === 1 ? splitCombinedSetCookieHeader(values[0]) : values
  }

  const combined = headers.get('set-cookie')
  if (!combined) {
    return []
  }

  return splitCombinedSetCookieHeader(combined)
}

export function getSetCookieHeaderValuesFromEntries(entries: Iterable<[string, string]>) {
  const values: string[] = []

  for (const [key, value] of entries) {
    if (key.toLowerCase() !== 'set-cookie') {
      continue
    }

    values.push(...splitCombinedSetCookieHeader(value))
  }

  return values
}

export function parseSetCookieHeader(value: string, requestUrl: URL, now = Date.now()): ParsedResponseCookie | null {
  const segments = value
    .split(';')
    .map(segment => segment.trim())
    .filter(Boolean)
  if (segments.length === 0) {
    return null
  }

  const nameValueSeparatorIndex = segments[0].indexOf('=')
  if (nameValueSeparatorIndex <= 0) {
    return null
  }

  const name = segments[0].slice(0, nameValueSeparatorIndex).trim()
  const cookieValue = segments[0].slice(nameValueSeparatorIndex + 1)
  if (!name || /[\s;=]/u.test(name)) {
    return null
  }

  let domain = requestUrl.hostname.toLowerCase()
  let hostOnly = true
  let path = defaultCookiePath(requestUrl.pathname)
  let secure = false
  let httpOnly = false
  let sameSite: CookieSameSite | null = null
  let expiresAt: number | null = null
  let maxAgeSeconds: number | null = null
  let expiresValue: string | null = null

  for (const attribute of segments.slice(1)) {
    const separatorIndex = attribute.indexOf('=')
    const attributeName = (separatorIndex === -1 ? attribute : attribute.slice(0, separatorIndex)).trim().toLowerCase()
    const attributeValue = separatorIndex === -1 ? '' : attribute.slice(separatorIndex + 1).trim()

    if (attributeName === 'domain') {
      const normalizedDomain = normalizeCookieDomain(attributeValue)
      if (!normalizedDomain || !hostnameMatchesDomain(requestUrl.hostname, normalizedDomain)) {
        return null
      }

      domain = normalizedDomain
      hostOnly = false
    } else if (attributeName === 'path') {
      path = normalizeCookiePath(attributeValue)
    } else if (attributeName === 'secure') {
      secure = true
    } else if (attributeName === 'httponly') {
      httpOnly = true
    } else if (attributeName === 'samesite') {
      sameSite = normalizeSameSite(attributeValue)
    } else if (attributeName === 'max-age') {
      const parsedMaxAge = Number.parseInt(attributeValue, 10)
      if (Number.isFinite(parsedMaxAge)) {
        maxAgeSeconds = parsedMaxAge
      }
    } else if (attributeName === 'expires') {
      expiresValue = attributeValue
    }
  }

  if (maxAgeSeconds !== null) {
    expiresAt = maxAgeSeconds <= 0 ? now - 1 : now + maxAgeSeconds * 1000
  } else if (expiresValue) {
    const parsedExpiresAt = Date.parse(expiresValue)
    expiresAt = Number.isFinite(parsedExpiresAt) ? parsedExpiresAt : null
  }

  return {
    name,
    value: cookieValue,
    domain,
    path,
    hostOnly,
    secure,
    httpOnly,
    sameSite,
    expiresAt,
  }
}

export function cookieMatchesUrl(cookie: Pick<CookieRecord, 'domain' | 'path' | 'hostOnly' | 'secure' | 'expiresAt'>, url: URL) {
  if (cookie.expiresAt !== null && cookie.expiresAt <= Date.now()) {
    return false
  }

  if (cookie.secure && url.protocol !== 'https:') {
    return false
  }

  if (cookie.hostOnly) {
    if (url.hostname.toLowerCase() !== cookie.domain.toLowerCase()) {
      return false
    }
  } else if (!hostnameMatchesDomain(url.hostname, cookie.domain)) {
    return false
  }

  return pathMatches(url.pathname || '/', cookie.path)
}

function normalizeEditableCookie(input: CreateCookieInput | UpdateCookieInput) {
  const name = input.name.trim()
  if (!name) {
    throw new Error('Cookie name is required')
  }

  if (/[\s;=]/u.test(name)) {
    throw new Error('Cookie name contains invalid characters')
  }

  const domain = normalizeCookieDomain(input.domain)
  if (!domain) {
    throw new Error('Cookie domain is required')
  }

  const path = normalizeCookiePath(input.path)
  if (input.expiresAt !== null && (!Number.isFinite(input.expiresAt) || !Number.isInteger(input.expiresAt))) {
    throw new Error('Cookie expiration must be a valid timestamp')
  }

  return {
    name,
    value: input.value,
    domain,
    path,
    hostOnly: input.hostOnly,
    secure: input.secure,
    httpOnly: input.httpOnly,
    sameSite: normalizeSameSite(input.sameSite),
    expiresAt: input.expiresAt,
  }
}

function normalizeCookieMutationError(error: unknown): GenericResult<never> {
  if (error instanceof Error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return GenericError.Message('A cookie with the same name, domain, path, and host mode already exists')
    }

    return GenericError.Message(error.message)
  }

  return GenericError.Unknown(error)
}

function toCookieRecord(cookie: CookieRow): CookieRecord {
  return {
    id: cookie.id,
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: cookie.path,
    hostOnly: cookie.hostOnly,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: normalizeSameSite(cookie.sameSite),
    expiresAt: cookie.expiresAt,
    createdAt: cookie.createdAt,
    updatedAt: cookie.updatedAt,
  }
}

function pruneExpiredCookies() {
  getDb().delete(cookies).where(lte(cookies.expiresAt, Date.now())).run()
}

function parseHttpUrl(value: string) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return null
    }

    return url
  } catch {
    return null
  }
}

function normalizeCookieDomain(value: string) {
  const trimmed = value.trim().toLowerCase().replace(/^\.+/u, '')
  if (!trimmed || /[\s/;]/u.test(trimmed)) {
    return null
  }

  return trimmed
}

function normalizeCookiePath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return '/'
  }

  return trimmed.startsWith('/') ? trimmed : '/'
}

function normalizeSameSite(value: string | null | undefined): CookieSameSite | null {
  if (!value) {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (normalized === 'strict' || normalized === 'lax' || normalized === 'none') {
    return normalized
  }

  return null
}

function hostnameMatchesDomain(hostname: string, domain: string) {
  const normalizedHostname = hostname.toLowerCase()
  const normalizedDomain = domain.toLowerCase()
  return normalizedHostname === normalizedDomain || normalizedHostname.endsWith(`.${normalizedDomain}`)
}

function pathMatches(requestPath: string, cookiePath: string) {
  if (requestPath === cookiePath) {
    return true
  }

  if (!requestPath.startsWith(cookiePath)) {
    return false
  }

  if (cookiePath.endsWith('/')) {
    return true
  }

  return requestPath.charAt(cookiePath.length) === '/'
}

function defaultCookiePath(pathname: string) {
  if (!pathname || !pathname.startsWith('/')) {
    return '/'
  }

  if (pathname === '/') {
    return '/'
  }

  const lastSlashIndex = pathname.lastIndexOf('/')
  return lastSlashIndex <= 0 ? '/' : pathname.slice(0, lastSlashIndex)
}

function splitCombinedSetCookieHeader(value: string) {
  const parts: string[] = []
  let start = 0
  let inExpires = false

  for (let index = 0; index < value.length; index += 1) {
    if (!inExpires && value.slice(index, index + 8).toLowerCase() === 'expires=') {
      inExpires = true
      index += 7
      continue
    }

    if (inExpires && value[index] === ';') {
      inExpires = false
      continue
    }

    if (value[index] !== ',' || inExpires) {
      continue
    }

    const nextCookieStart = index + 1
    const nextEqualsIndex = value.indexOf('=', nextCookieStart)
    if (nextEqualsIndex === -1) {
      continue
    }

    const nextToken = value.slice(nextCookieStart, nextEqualsIndex).trim()
    if (!nextToken || /[\s;,]/u.test(nextToken)) {
      continue
    }

    parts.push(value.slice(start, index).trim())
    start = nextCookieStart
  }

  const lastPart = value.slice(start).trim()
  if (lastPart) {
    parts.push(lastPart)
  }

  return parts
}

function emitCookiesUpdated() {
  emitGenericEvent({ type: 'cookies-updated' })
}
