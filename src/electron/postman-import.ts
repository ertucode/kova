import fs from 'node:fs'
import path from 'node:path'
import { and, eq, isNull } from 'drizzle-orm'
import { createDefaultHttpAuth, type HttpAuth } from '../common/Auth.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { stringifyKeyValueRows, type KeyValueRow } from '../common/KeyValueRows.js'
import {
  type AnalyzePostmanCollectionInput,
  type AnalyzePostmanCollectionResponse,
  type ImportPostmanCollectionInput,
  type ImportPostmanCollectionResponse,
  type PickPostmanCollectionFileResponse,
  type PostmanImportWarning,
  type PostmanImportWarningCode,
} from '../common/PostmanImport.js'
import { Result } from '../common/Result.js'
import { getDb } from './db/index.js'
import { folders, requestExamples, requests } from './db/schema.js'
import { ensureParentFolderExists, insertTreeItem } from './db/tree-items.js'

type PostmanCollection = {
  info?: { name?: string }
  item?: PostmanItem[]
  event?: PostmanEvent[]
  auth?: PostmanAuth
  variable?: Array<{ key?: string }>
  protocolProfileBehavior?: unknown
  _kova?: {
    exportedByKova?: unknown
    folderHeaders?: unknown
  }
}

type PostmanItem = {
  name?: string
  description?: unknown
  item?: PostmanItem[]
  request?: PostmanRequest
  event?: PostmanEvent[]
  auth?: PostmanAuth
  protocolProfileBehavior?: unknown
  response?: PostmanResponse[]
  _kova?: {
    folderHeaders?: unknown
  }
}

type PostmanResponse = {
  name?: string
  code?: number
  status?: string
  header?: PostmanHeader[]
  body?: string
  originalRequest?: PostmanRequest
}

type PostmanRequest = {
  method?: string
  header?: PostmanHeader[]
  body?: PostmanBody
  url?: string | PostmanUrl
  auth?: PostmanAuth
  description?: unknown
  protocolProfileBehavior?: unknown
}

type PostmanUrl = {
  raw?: string
  protocol?: string
  host?: string[]
  path?: string[]
  query?: Array<{ key?: string; value?: string | null; disabled?: boolean; description?: string }>
  variable?: Array<{ key?: string; value?: string; disabled?: boolean; description?: string }>
}

type PostmanUrlQueryEntry = NonNullable<PostmanUrl['query']>[number]

type PostmanHeader = {
  key?: string
  value?: string
  disabled?: boolean
  description?: string
}

type PostmanBody = {
  mode?: string
  raw?: string
  urlencoded?: PostmanParam[]
  formdata?: PostmanParam[]
  options?: { raw?: { language?: string } }
}

type PostmanParam = {
  key?: string
  value?: string
  disabled?: boolean
  description?: string
  type?: string
}

type PostmanEvent = {
  listen?: string
  script?: {
    exec?: string[]
  }
}

type PostmanAuth = {
  type?: string
  bearer?: Array<{ key?: string; value?: string }>
  basic?: Array<{ key?: string; value?: string }>
  apikey?: Array<{ key?: string; value?: string }>
}

type WarningAccumulator = Map<PostmanImportWarningCode, { count: number; examples: string[] }>

type ImportAnalysis = {
  collectionName: string
  suggestedRootFolderName: string
  folderCount: number
  requestCount: number
  exportedByKova: boolean
  hasCollectionAuth: boolean
  hasCollectionScripts: boolean
  hasCollectionHeaders: boolean
  hasCollectionVariables: boolean
  hasCollectionProtocolProfileBehavior: boolean
  warnings: PostmanImportWarning[]
}

type ImportedItemSelection = {
  itemType: 'folder' | 'request'
  id: string
}

type ImportResult = {
  createdRootFolderId?: string
  createdRootFolderName?: string
  targetFolderId: string | null
  primaryImportedItem?: ImportedItemSelection
}

const SUPPORTED_REQUEST_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const SCRIPT_API_PATTERN = /\b(pm\.|postman\.|pm\(|require\(|setNextRequest|getNextRequest|pm\.test|pm\.expect|pm\.environment|pm\.globals|pm\.collectionVariables|pm\.iterationData|pm\.visualizer)/

export async function pickPostmanCollectionFile(): Promise<GenericResult<PickPostmanCollectionFileResponse>> {
  return GenericError.Message('File picker is handled in main process')
}

export async function analyzePostmanCollection(input: AnalyzePostmanCollectionInput): Promise<GenericResult<AnalyzePostmanCollectionResponse>> {
  try {
    const collection = readPostmanCollection(input.filePath)
    const analysis = analyzeCollectionDocument(collection)

    return Result.Success({
      filePath: input.filePath,
      collectionName: analysis.collectionName,
      suggestedRootFolderName: analysis.suggestedRootFolderName,
      folderCount: analysis.folderCount,
      requestCount: analysis.requestCount,
      warningCount: analysis.warnings.reduce((sum, warning) => sum + warning.count, 0),
      exportedByKova: analysis.exportedByKova,
      hasCollectionAuth: analysis.hasCollectionAuth,
      hasCollectionScripts: analysis.hasCollectionScripts,
      hasCollectionHeaders: analysis.hasCollectionHeaders,
      hasCollectionVariables: analysis.hasCollectionVariables,
      hasCollectionProtocolProfileBehavior: analysis.hasCollectionProtocolProfileBehavior,
      warnings: analysis.warnings,
    })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function importPostmanCollection(input: ImportPostmanCollectionInput): Promise<GenericResult<ImportPostmanCollectionResponse>> {
  const shouldCreateRootFolder = input.target === 'new-folder' && input.skipRootFolder !== true
  const rootFolderName = input.rootFolderName?.trim() ?? ''

  if (input.target === 'new-folder' && shouldCreateRootFolder && !rootFolderName) {
    return GenericError.Message('Root folder name is required')
  }

  if (input.target === 'existing-folder' && !input.targetFolderId) {
    return GenericError.Message('Target folder is required')
  }

  try {
    const collection = readPostmanCollection(input.filePath)
    const analysis = analyzeCollectionDocument(collection)
    const importResult = importCollectionDocument(collection, {
      target: input.target,
      targetFolderId: input.target === 'existing-folder' ? input.targetFolderId ?? null : null,
      rootFolderName,
      shouldCreateRootFolder,
    })

    return Result.Success({
      createdRootFolderId: importResult.createdRootFolderId,
      createdRootFolderName: importResult.createdRootFolderName,
      targetFolderId: importResult.targetFolderId,
      primaryImportedItem: importResult.primaryImportedItem,
      folderCount: analysis.folderCount + (importResult.createdRootFolderId ? 1 : 0),
      requestCount: analysis.requestCount,
      warningCount: analysis.warnings.reduce((sum, warning) => sum + warning.count, 0),
      warnings: analysis.warnings,
    })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export function analyzeCollectionDocument(collection: PostmanCollection): ImportAnalysis {
  const warnings = new Map<PostmanImportWarningCode, { count: number; examples: string[] }>()
  const collectionName = sanitizeName(collection.info?.name, 'Imported Collection')
  let folderCount = 0
  let requestCount = 0
  const exportedByKova = isKovaExportedCollection(collection)
  const hasCollectionVariables = (collection.variable?.length ?? 0) > 0
  const hasCollectionProtocolProfileBehavior = Boolean(collection.protocolProfileBehavior)
  const hasCollectionScripts = hasScripts(collection.event)
  const hasCollectionAuth = hasSupportedOrUnsupportedAuth(collection.auth)
  const hasCollectionHeaders = readCollectionHeaders(collection).trim() !== ''

  if (hasCollectionVariables) {
    addWarning(warnings, 'collection-variables-ignored', collection.variable?.length ?? 0, [collectionName])
  }

  if (hasCollectionProtocolProfileBehavior) {
    addWarning(warnings, 'protocol-profile-ignored', 1, [collectionName])
  }

  inspectEvents(warnings, `${collectionName} (collection)`, collection.event, exportedByKova)
  inspectAuth(warnings, `${collectionName} (collection)`, collection.auth)

  const visit = (items: PostmanItem[], parentPath: string[]) => {
    for (const item of items) {
      const name = sanitizeName(item.name, item.request ? 'Imported Request' : 'Imported Folder')
      const nextPath = [...parentPath, name]

      if (item.item?.length) {
        folderCount += 1
        inspectEvents(warnings, nextPath.join(' / '), item.event, exportedByKova)
        inspectAuth(warnings, nextPath.join(' / '), item.auth)
        if (item.protocolProfileBehavior) {
          addWarning(warnings, 'protocol-profile-ignored', 1, [nextPath.join(' / ')])
        }
        visit(item.item, nextPath)
        continue
      }

      if (!item.request) {
        continue
      }

      requestCount += 1
      inspectEvents(warnings, nextPath.join(' / '), item.event, exportedByKova)
      inspectAuth(warnings, nextPath.join(' / '), item.request.auth ?? item.auth)
      inspectRequestBody(warnings, nextPath.join(' / '), item.request.body)

      if (item.protocolProfileBehavior || item.request.protocolProfileBehavior) {
        addWarning(warnings, 'protocol-profile-ignored', 1, [nextPath.join(' / ')])
      }
    }
  }

  visit(collection.item ?? [], [collectionName])

  return {
    collectionName,
    suggestedRootFolderName: collectionName,
    folderCount,
    requestCount,
    exportedByKova,
    hasCollectionAuth,
    hasCollectionScripts,
    hasCollectionHeaders,
    hasCollectionVariables,
    hasCollectionProtocolProfileBehavior,
    warnings: buildWarnings(warnings),
  }
}

export function importCollectionDocument(
  collection: PostmanCollection,
  input: {
    target: ImportPostmanCollectionInput['target']
    targetFolderId: string | null
    rootFolderName: string
    shouldCreateRootFolder: boolean
  }
): ImportResult {
  const db = getDb()

  return db.transaction(tx => {
    const now = Date.now()
    let targetFolderId = input.target === 'existing-folder' ? input.targetFolderId : null
    let createdRootFolderId: string | undefined
    let createdRootFolderName: string | undefined
    let primaryImportedItem: ImportedItemSelection | undefined

    if (input.shouldCreateRootFolder) {
      const rootFolderId = crypto.randomUUID()
      tx.insert(folders)
        .values({
          id: rootFolderId,
          parentId: null,
          name: input.rootFolderName,
          description: '',
          headers: readCollectionHeaders(collection),
          authJson: JSON.stringify(mapAuth(collection.auth, false)),
          preRequestScript: mapScripts(collection.event, 'prerequest', isKovaExportedCollection(collection)),
          postRequestScript: mapScripts(collection.event, 'test', isKovaExportedCollection(collection)),
          position: 0,
          createdAt: now,
          deletedAt: null,
        })
        .run()
      insertTreeItem(tx, { parentFolderId: null, itemType: 'folder', itemId: rootFolderId })
      createdRootFolderId = rootFolderId
      createdRootFolderName = input.rootFolderName
      targetFolderId = rootFolderId
    }

    for (const item of collection.item ?? []) {
      const imported = importItem(tx, item, targetFolderId, isKovaExportedCollection(collection))
      if (!primaryImportedItem && imported) {
        primaryImportedItem = imported
      }
    }

    return {
      createdRootFolderId,
      createdRootFolderName,
      targetFolderId,
      primaryImportedItem,
    }
  })
}

function importItem(
  db: ReturnType<typeof getDb>,
  item: PostmanItem,
  parentFolderId: string | null,
  preserveScripts: boolean
): ImportedItemSelection | undefined {
  ensureParentFolderExists(db, parentFolderId)
  const now = Date.now()
  const name = sanitizeName(item.name, item.request ? 'Imported Request' : 'Imported Folder')

  if (item.item?.length) {
    const folderId = crypto.randomUUID()
    db.insert(folders)
      .values({
        id: folderId,
        parentId: parentFolderId,
        name,
        description: readFolderDescription(item.description),
        headers: readFolderHeaders(item._kova),
        authJson: JSON.stringify(mapAuth(item.auth, true)),
        preRequestScript: mapScripts(item.event, 'prerequest', preserveScripts),
        postRequestScript: mapScripts(item.event, 'test', preserveScripts),
        position: 0,
        createdAt: now,
        deletedAt: null,
      })
      .run()
    insertTreeItem(db, { parentFolderId, itemType: 'folder', itemId: folderId })

    for (const child of item.item) {
      importItem(db, child, folderId, preserveScripts)
    }
    return { itemType: 'folder', id: folderId }
  }

  if (!item.request) {
    return undefined
  }

  const requestId = crypto.randomUUID()
  const requestModel = mapRequest(item.request)
  db.insert(requests)
    .values({
      id: requestId,
      name,
      requestType: 'http',
      method: requestModel.method,
      url: requestModel.url,
      pathParams: requestModel.pathParams,
      searchParams: requestModel.searchParams,
      authJson: JSON.stringify(mapAuth(item.request.auth ?? item.auth, true)),
      preRequestScript: mapScripts(item.event, 'prerequest', preserveScripts),
      postRequestScript: mapScripts(item.event, 'test', preserveScripts),
      headers: requestModel.headers,
      body: requestModel.body,
      bodyType: requestModel.bodyType,
      rawType: requestModel.rawType,
      websocketSubprotocols: '',
      saveToHistory: true,
      createdAt: now,
      deletedAt: null,
    })
    .run()
  insertTreeItem(db, { parentFolderId, itemType: 'request', itemId: requestId })

  ;(item.response ?? []).forEach((response, index) => {
    const exampleRequestModel = mapExampleRequest(response.originalRequest, requestModel)
    db.insert(requestExamples)
      .values({
        id: crypto.randomUUID(),
        requestId,
        name: sanitizeName(response.name, `Example ${index + 1}`),
        position: index,
        requestHeaders: exampleRequestModel.headers,
        requestBody: exampleRequestModel.body,
        requestBodyType: exampleRequestModel.bodyType,
        requestRawType: exampleRequestModel.rawType,
        responseStatus: response.code ?? 200,
        responseStatusText: response.status ?? 'OK',
        responseHeaders: stringifyKeyValueRows(
          (response.header ?? []).map((header, headerIndex) => ({
            id: `response-header-${headerIndex}`,
            enabled: !header.disabled,
            key: header.key ?? '',
            value: header.value ?? '',
            description: header.description ?? '',
          }))
        ),
        responseBody: response.body ?? '',
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      })
      .run()
  })

  return { itemType: 'request', id: requestId }
}

function readPostmanCollection(filePath: string) {
  const absolutePath = path.resolve(filePath)
  const raw = fs.readFileSync(absolutePath, 'utf8')
  const value = JSON.parse(raw) as unknown

  if (!value || typeof value !== 'object') {
    throw new Error('Invalid Postman collection file')
  }

  return value as PostmanCollection
}

function inspectEvents(warnings: WarningAccumulator, pathLabel: string, events: PostmanEvent[] | undefined, exportedByKova: boolean) {
  const scripts = events
    ?.filter(event => event.listen === 'prerequest' || event.listen === 'test')
    .map(event => ({
      listen: event.listen as 'prerequest' | 'test',
      source: (event.script?.exec ?? []).join('\n').trim(),
    }))
    .filter(event => event.source !== '') ?? []

  if (scripts.length > 0 && !exportedByKova) {
    addWarning(warnings, 'scripts-commented', scripts.length, [pathLabel])
  }

  for (const script of scripts) {
    if (SCRIPT_API_PATTERN.test(script.source)) {
      addWarning(warnings, 'unsupported-script-api', 1, [`${pathLabel} (${script.listen})`])
    }
  }
}

function inspectAuth(warnings: WarningAccumulator, pathLabel: string, auth: PostmanAuth | undefined) {
  const type = auth?.type?.toLowerCase()
  if (!type || type === 'noauth' || type === 'bearer' || type === 'apikey' || type === 'basic') {
    return
  }

  addWarning(warnings, 'unsupported-auth', 1, [`${pathLabel}: ${type}`])
}

function inspectRequestBody(warnings: WarningAccumulator, pathLabel: string, body: PostmanBody | undefined) {
  const mode = body?.mode?.toLowerCase()
  if (!mode || mode === 'raw' || mode === 'urlencoded' || mode === 'formdata') {
    if (mode === 'formdata') {
      const fileRows = body?.formdata?.filter(row => row.type === 'file') ?? []
      if (fileRows.length > 0) {
        addWarning(warnings, 'file-form-data-ignored', fileRows.length, [pathLabel])
      }
    }
    return
  }

  addWarning(warnings, 'unsupported-body-mode', 1, [`${pathLabel}: ${mode}`])
}

function buildWarnings(warnings: WarningAccumulator): PostmanImportWarning[] {
  return Array.from(warnings.entries())
    .map(([code, value]) => ({
      code,
      severity: (code === 'unsupported-auth' || code === 'unsupported-body-mode' || code === 'unsupported-script-api'
        ? 'warning'
        : 'info') as PostmanImportWarning['severity'],
      message: warningMessageByCode[code],
      count: value.count,
      examples: value.examples,
    }))
    .sort((left, right) => right.count - left.count || left.message.localeCompare(right.message))
}

function addWarning(warnings: WarningAccumulator, code: PostmanImportWarningCode, count: number, examples: string[]) {
  const current = warnings.get(code) ?? { count: 0, examples: [] }
  current.count += count

  for (const example of examples) {
    if (example && !current.examples.includes(example) && current.examples.length < 5) {
      current.examples.push(example)
    }
  }

  warnings.set(code, current)
}

export function mapRequest(request: PostmanRequest) {
  const method = normalizeMethod(request.method)
  const urlParts = normalizeUrl(request.url)
  const headers = stringifyKeyValueRows(
    (request.header ?? []).map((header, index) => ({
      id: `header-${index}`,
      enabled: !header.disabled,
      key: header.key ?? '',
      value: header.value ?? '',
      description: header.description ?? '',
    }))
  )

  const body = mapBody(request.body)

  return {
    method,
    url: urlParts.url,
    pathParams: urlParts.pathParams,
    searchParams: urlParts.searchParams,
    headers,
    body: body.body,
    bodyType: body.bodyType,
    rawType: body.rawType,
  }
}

function normalizeMethod(value: string | undefined) {
  const method = (value ?? 'GET').toUpperCase()
  return SUPPORTED_REQUEST_METHODS.has(method) ? method : 'GET'
}

function normalizeUrl(value: string | PostmanUrl | undefined) {
  const postmanUrl = typeof value === 'string' ? { raw: value } : value
  const rawUrl = postmanUrl?.raw?.trim() || buildUrlFromParts(postmanUrl)
  const parsed = safelyParseUrl(rawUrl)
  const pathParams = (postmanUrl?.variable ?? []).map((entry, index) => ({
    id: `path-param-${index}`,
    enabled: !entry.disabled,
    key: entry.key ?? '',
    value: entry.value ?? '',
    description: entry.description ?? '',
  }))
  const searchParams = (postmanUrl?.query?.length ? postmanUrl.query : readQueryParamsFromRawUrl(rawUrl)).map((entry, index) => ({
    id: `search-param-${index}`,
    enabled: !entry.disabled,
    key: entry.key ?? '',
    value: entry.value ?? '',
    description: entry.description ?? '',
  }))

  let normalizedUrl = parsed.url
  for (const row of pathParams) {
    if (!row.key.trim()) {
      continue
    }
    normalizedUrl = normalizedUrl.replaceAll(`{{${row.key.trim()}}}`, `:${row.key.trim()}`)
  }

  return {
    url: normalizedUrl,
    pathParams: stringifyKeyValueRows(pathParams),
    searchParams: stringifyKeyValueRows(searchParams),
  }
}

function buildUrlFromParts(url: PostmanUrl | undefined) {
  if (!url) {
    return ''
  }

  const protocol = url.protocol ? `${url.protocol}://` : ''
  const host = url.host?.join('.') ?? ''
  const pathValue = (url.path ?? []).join('/')
  const query = (url.query ?? [])
    .filter(entry => entry.key)
    .map(entry => (entry.value == null ? encodeURIComponent(entry.key ?? '') : `${encodeURIComponent(entry.key ?? '')}=${encodeURIComponent(entry.value)}`))
    .join('&')

  return `${protocol}${host}${pathValue ? `/${pathValue}` : ''}${query ? `?${query}` : ''}`
}

function safelyParseUrl(rawUrl: string) {
  const hashIndex = rawUrl.indexOf('#')
  const withoutHash = hashIndex >= 0 ? rawUrl.slice(0, hashIndex) : rawUrl

  return {
    url: withoutHash,
  }
}

function readQueryParamsFromRawUrl(rawUrl: string) {
  const queryIndex = rawUrl.indexOf('?')
  if (queryIndex < 0) {
    return [] as PostmanUrlQueryEntry[]
  }

  const hashIndex = rawUrl.indexOf('#', queryIndex)
  const queryValue = rawUrl.slice(queryIndex + 1, hashIndex >= 0 ? hashIndex : undefined)
  if (!queryValue) {
    return [] as PostmanUrlQueryEntry[]
  }

  return queryValue.split('&').flatMap(part => {
    if (!part.trim()) {
      return []
    }

    const separatorIndex = part.indexOf('=')
    const key = decodeQueryComponent(separatorIndex >= 0 ? part.slice(0, separatorIndex) : part)
    const value = decodeQueryComponent(separatorIndex >= 0 ? part.slice(separatorIndex + 1) : '')
    if (!key.trim()) {
      return []
    }

    return [{ key, value, disabled: false, description: '' } satisfies PostmanUrlQueryEntry]
  })
}

function decodeQueryComponent(value: string) {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '))
  } catch {
    return value
  }
}

function mapBody(body: PostmanBody | undefined) {
  const mode = body?.mode?.toLowerCase()

  if (mode === 'raw') {
    return {
      body: body?.raw ?? '',
      bodyType: 'raw' as const,
      rawType: body?.options?.raw?.language === 'json' ? 'json' as const : 'text' as const,
    }
  }

  if (mode === 'urlencoded') {
    return {
      body: stringifyKeyValueRows(mapKeyValueRows(body?.urlencoded ?? [], 'body-url-encoded')),
      bodyType: 'x-www-form-urlencoded' as const,
      rawType: 'json' as const,
    }
  }

  if (mode === 'formdata') {
    return {
      body: stringifyKeyValueRows(mapKeyValueRows((body?.formdata ?? []).filter(row => row.type !== 'file'), 'body-form-data')),
      bodyType: 'form-data' as const,
      rawType: 'json' as const,
    }
  }

  return {
    body: '',
    bodyType: 'none' as const,
    rawType: 'json' as const,
  }
}

function mapKeyValueRows(rows: PostmanParam[], prefix: string): KeyValueRow[] {
  return rows.map((row, index) => ({
    id: `${prefix}-${index}`,
    enabled: !row.disabled,
    key: row.key ?? '',
    value: row.value ?? '',
    description: row.description ?? '',
  }))
}

export function mapAuth(auth: PostmanAuth | undefined, allowInherit: boolean): HttpAuth {
  const type = auth?.type?.toLowerCase()
  if (!type) {
    return allowInherit ? { type: 'inherit' } : createDefaultHttpAuth()
  }

  if (type === 'noauth') {
    return { type: 'noauth' }
  }

  if (type === 'bearer') {
    return {
      type: 'bearer',
      token: auth?.bearer?.find(entry => entry.key === 'token')?.value ?? '',
    }
  }

  if (type === 'basic') {
    return {
      type: 'basic',
      username: auth?.basic?.find(entry => entry.key === 'username')?.value ?? '',
      password: auth?.basic?.find(entry => entry.key === 'password')?.value ?? '',
    }
  }

  if (type === 'apikey') {
    return {
      type: 'apikey',
      key: auth?.apikey?.find(entry => entry.key === 'key')?.value ?? '',
      value: auth?.apikey?.find(entry => entry.key === 'value')?.value ?? '',
      addTo: auth?.apikey?.find(entry => entry.key === 'in')?.value === 'query' ? 'query' : 'header',
    }
  }

  return { type: 'noauth' }
}

export function mapScripts(events: PostmanEvent[] | undefined, listen: 'prerequest' | 'test', preserveScripts = false) {
  const scripts = events
    ?.filter(event => event.listen === listen)
    .map(event => (event.script?.exec ?? []).join('\n').trim())
    .filter(Boolean) ?? []

  if (scripts.length === 0) {
    return ''
  }

  if (preserveScripts) {
    return scripts.join('\n\n')
  }

  return [
    '// Imported from Postman. Review and rewrite for Kova runtime.',
    `// Original event: ${listen}`,
    '//',
    ...scripts.flatMap((script, index) => {
      const lines = script.split('\n')
      const prefix = index === 0 ? [] : ['//', `// Script ${index + 1}`, '//']
      return [...prefix, ...lines.map(line => `// ${line}`)]
    }),
  ].join('\n')
}

function sanitizeName(value: string | undefined, fallback: string) {
  const name = value?.trim()
  return name ? name : fallback
}

function readFolderDescription(value: unknown) {
  return typeof value === 'string' ? value : ''
}

function readFolderHeaders(metadata: PostmanItem['_kova']) {
  return typeof metadata?.folderHeaders === 'string' ? metadata.folderHeaders : ''
}

function readCollectionHeaders(collection: PostmanCollection) {
  return typeof collection._kova?.folderHeaders === 'string' ? collection._kova.folderHeaders : ''
}

function hasScripts(events: PostmanEvent[] | undefined) {
  return events?.some(event => {
    if (event.listen !== 'prerequest' && event.listen !== 'test') {
      return false
    }

    return (event.script?.exec ?? []).join('\n').trim() !== ''
  }) ?? false
}

function hasSupportedOrUnsupportedAuth(auth: PostmanAuth | undefined) {
  return Boolean(auth?.type?.trim())
}

function isKovaExportedCollection(collection: PostmanCollection) {
  return collection._kova?.exportedByKova === true
}

function mapExampleRequest(
  originalRequest: PostmanRequest | undefined,
  fallbackRequest: ReturnType<typeof mapRequest>
) {
  if (!originalRequest) {
    return fallbackRequest
  }

  return mapRequest(originalRequest)
}

const warningMessageByCode: Record<PostmanImportWarningCode, string> = {
  'scripts-commented': 'Postman scripts are imported as commented reference blocks so you can rewrite them safely.',
  'unsupported-script-api': 'Some scripts use Postman-specific APIs that do not exist in Kova.',
  'collection-variables-ignored': 'Collection variables are ignored during import.',
  'protocol-profile-ignored': 'protocolProfileBehavior settings are ignored.',
  'unsupported-auth': 'Some auth types are not supported and will not be imported as working auth configs.',
  'unsupported-body-mode': 'Some request body modes are not supported and will be imported without their original body behavior.',
  'file-form-data-ignored': 'Form-data file fields are ignored because Kova does not support Postman file form parts yet.',
}
