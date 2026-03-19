import fs from 'node:fs'
import path from 'node:path'
import { parseKeyValueRows } from '../common/KeyValueRows.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import {
  type AnalyzePostmanCollectionExportInput,
  type AnalyzePostmanCollectionExportResponse,
  type ExportPostmanCollectionInput,
  type ExportPostmanCollectionResponse,
  type PickPostmanCollectionExportFileResponse,
  type PostmanExportWarning,
  type PostmanExportWarningCode,
} from '../common/PostmanExport.js'
import type { HttpAuth } from '../common/Auth.js'
import type { FolderRecord } from '../common/Folders.js'
import type { ExplorerItem } from '../common/Explorer.js'
import type { RequestExampleRecord } from '../common/RequestExamples.js'
import type { HttpRequestRecord, RequestBodyType, RequestRawType } from '../common/Requests.js'
import { Result } from '../common/Result.js'
import { listExplorerItems } from './db/explorer.js'
import { getFolder } from './db/folders.js'
import { listRequestExamplesByRequestIds } from './db/request-examples.js'
import { getRequest } from './db/requests.js'

type FolderExportRecord = FolderRecord & {
  parentFolderId: string | null
  position: number
}

type RequestExportRecord = HttpRequestRecord & {
  parentFolderId: string | null
  position: number
}

type CollectionExportSource = {
  scope: 'workspace' | 'folder' | 'request'
  folderId: string | null
  requestId: string | null
  suggestedCollectionName: string
  folders: FolderExportRecord[]
  requests: RequestExportRecord[]
  examplesByRequestId: Map<string, RequestExampleRecord[]>
  orderedItems: ExplorerItem[]
}

type PostmanCollectionDocument = {
  info: {
    name: string
    schema: string
  }
  description?: string
  auth?: PostmanAuth
  event?: PostmanEvent[]
  item: PostmanItem[]
  _kova?: {
    exportedByKova?: true
    folderHeaders?: string
  }
}

type PostmanItem = {
  name: string
  description?: string
  item?: PostmanItem[]
  request?: PostmanRequest
  response?: PostmanResponse[]
  auth?: PostmanAuth
  event?: PostmanEvent[]
  _kova?: {
    folderHeaders?: string
  }
}

type PostmanRequest = {
  method: string
  header?: PostmanKeyValue[]
  url: {
    raw: string
    query?: PostmanKeyValue[]
    variable?: PostmanKeyValue[]
  }
  body?: PostmanBody
  auth?: PostmanAuth
  description?: string
}

type PostmanResponse = {
  name: string
  code: number
  status: string
  header?: PostmanKeyValue[]
  body: string
  originalRequest?: PostmanRequest
}

type PostmanBody =
  | {
      mode: 'raw'
      raw: string
      options: { raw: { language: 'json' | 'text' } }
    }
  | {
      mode: 'urlencoded'
      urlencoded: PostmanKeyValue[]
    }
  | {
      mode: 'formdata'
      formdata: Array<PostmanKeyValue & { type: 'text' }>
    }

type PostmanKeyValue = {
  key: string
  value: string
  disabled?: boolean
  description?: string
}

type PostmanAuth = {
  type: 'noauth' | 'bearer' | 'basic' | 'apikey'
  bearer?: Array<{ key: 'token'; value: string }>
  basic?: Array<{ key: 'username' | 'password'; value: string }>
  apikey?: Array<{ key: 'key' | 'value' | 'in'; value: string }>
}

type PostmanEvent = {
  listen: 'prerequest' | 'test'
  script: {
    exec: string[]
    type: 'text/javascript'
  }
}

type ExportAnalysis = {
  scope: 'workspace' | 'folder' | 'request'
  folderId: string | null
  requestId: string | null
  suggestedCollectionName: string
  folderCount: number
  requestCount: number
  exampleCount: number
  warnings: PostmanExportWarning[]
}

export async function pickPostmanCollectionExportFile(): Promise<GenericResult<PickPostmanCollectionExportFileResponse>> {
  return GenericError.Message('Save dialog is handled in main process')
}

export async function analyzePostmanCollectionExport(input: AnalyzePostmanCollectionExportInput): Promise<GenericResult<AnalyzePostmanCollectionExportResponse>> {
  try {
    const source = await loadCollectionExportSource(input)
    const analysis = analyzeCollectionExportSource(source)

    return Result.Success({
      scope: analysis.scope,
      folderId: analysis.folderId,
      requestId: analysis.requestId,
      suggestedCollectionName: analysis.suggestedCollectionName,
      folderCount: analysis.folderCount,
      requestCount: analysis.requestCount,
      exampleCount: analysis.exampleCount,
      warningCount: analysis.warnings.reduce((sum, warning) => sum + warning.count, 0),
      warnings: analysis.warnings,
    })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function exportPostmanCollection(input: ExportPostmanCollectionInput): Promise<GenericResult<ExportPostmanCollectionResponse>> {
  const collectionName = input.collectionName.trim()
  if (!collectionName) {
    return GenericError.Message('Collection name is required')
  }

  try {
    const source = await loadCollectionExportSource(input)
    const analysis = analyzeCollectionExportSource(source)
    const document = buildCollectionExportDocument(source, collectionName)
    const filePath = path.resolve(input.filePath)
    fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

    return Result.Success({
      filePath,
      collectionName,
      folderCount: analysis.folderCount,
      requestCount: analysis.requestCount,
      exampleCount: analysis.exampleCount,
      warningCount: analysis.warnings.reduce((sum, warning) => sum + warning.count, 0),
      warnings: analysis.warnings,
    })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export function analyzeCollectionExportSource(source: CollectionExportSource): ExportAnalysis {
  const warnings = new Map<PostmanExportWarningCode, { count: number; examples: string[] }>()
  const foldersWithHeaders = source.folders.filter(folder => parseKeyValueRows(folder.headers).some(row => row.key.trim() || row.value.trim() || row.description.trim()))

  if (foldersWithHeaders.length > 0) {
    addWarning(
      warnings,
      'folder-headers-stored-in-metadata',
      foldersWithHeaders.length,
      foldersWithHeaders.slice(0, 5).map(folder => folder.name)
    )
  }

  return {
    scope: source.scope,
    folderId: source.folderId,
    requestId: source.requestId,
    suggestedCollectionName: source.suggestedCollectionName,
    folderCount: source.folders.length,
    requestCount: source.requests.length,
    exampleCount: Array.from(source.examplesByRequestId.values()).reduce((sum, examples) => sum + examples.length, 0),
    warnings: buildWarnings(warnings),
  }
}

export function buildCollectionExportDocument(source: CollectionExportSource, collectionName: string): PostmanCollectionDocument {
  const folderById = new Map(source.folders.map(folder => [folder.id, folder]))
  const requestById = new Map(source.requests.map(request => [request.id, request]))
  const childrenByParentId = new Map<string | null, ExplorerItem[]>()
  const rootFolder = source.scope === 'folder' && source.folderId ? folderById.get(source.folderId) ?? null : null
  const collectionHeaders = rootFolder?.headers ?? ''
  const rootParentFolderId = rootFolder?.id ?? null

  for (const item of source.orderedItems) {
    if (item.itemType === 'example') {
      continue
    }

    const key = item.parentFolderId
    const siblings = childrenByParentId.get(key) ?? []
    siblings.push(item)
    childrenByParentId.set(key, siblings)
  }

  const buildItems = (parentFolderId: string | null): PostmanItem[] => {
    return (childrenByParentId.get(parentFolderId) ?? []).flatMap(item => {
      if (item.itemType === 'folder') {
        const folder = folderById.get(item.id)
        if (!folder) {
          return []
        }

        return [buildFolderItem(folder, buildItems(folder.id))]
      }

      const request = requestById.get(item.id)
      if (!request) {
        return []
      }

      return [buildRequestItem(request, source.examplesByRequestId.get(request.id) ?? [])]
    })
  }

  return {
    info: {
      name: collectionName,
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
    },
    description: rootFolder?.description.trim() ? rootFolder.description : undefined,
    auth: rootFolder ? mapAuth(rootFolder.auth) : undefined,
    event: rootFolder ? buildEvents(rootFolder.preRequestScript, rootFolder.postRequestScript) : undefined,
    item: buildItems(rootParentFolderId),
    _kova: {
      exportedByKova: true,
      folderHeaders: parseKeyValueRows(collectionHeaders).some(row => row.key.trim() || row.value.trim() || row.description.trim())
        ? collectionHeaders
        : undefined,
    },
  }
}

async function loadCollectionExportSource(target: AnalyzePostmanCollectionExportInput | ExportPostmanCollectionInput): Promise<CollectionExportSource> {
  const items = await listExplorerItems()
  const folderItems = items.filter((item): item is Extract<ExplorerItem, { itemType: 'folder' }> => item.itemType === 'folder')
  const requestItems = items.filter((item): item is Extract<ExplorerItem, { itemType: 'request' }> => item.itemType === 'request')

  const folders = await Promise.all(folderItems.map(async item => {
    const result = await getFolder({ id: item.id })
    if (!result.success) {
      throw new Error(`Folder not found: ${item.id}`)
    }

    return {
      ...result.data,
      parentFolderId: item.parentFolderId,
      position: item.position,
    } satisfies FolderExportRecord
  }))

  const requests = await Promise.all(requestItems.map(async item => {
    const result = await getRequest({ id: item.id })
    if (!result.success) {
      throw new Error(`Request not found: ${item.id}`)
    }

    return {
      ...result.data,
      parentFolderId: item.parentFolderId,
      position: item.position,
    } satisfies RequestExportRecord
  }))

  const filtered = filterExportItems(target, items, folders, requests)
  const examples = await listRequestExamplesByRequestIds(filtered.requests.map(request => request.id))
  const examplesByRequestId = new Map<string, RequestExampleRecord[]>()
  for (const example of examples) {
    const rows = examplesByRequestId.get(example.requestId) ?? []
    rows.push(example)
    examplesByRequestId.set(example.requestId, rows)
  }

  const topLevelFolders = filtered.folders.filter(folder => folder.parentFolderId === null)
  const topLevelRequests = filtered.requests.filter(request => request.parentFolderId === null)

  return {
    scope: target.scope,
    folderId: target.scope === 'folder' ? target.folderId : null,
    requestId: target.scope === 'request' ? target.requestId : null,
    suggestedCollectionName: target.scope === 'folder'
      ? filtered.rootFolderName ?? 'Exported Folder'
      : target.scope === 'request'
        ? filtered.rootRequestName ?? 'Exported Request'
        : topLevelFolders.length === 1 && topLevelRequests.length === 0 ? topLevelFolders[0].name : 'Kova Collection',
    folders: filtered.folders,
    requests: filtered.requests,
    examplesByRequestId,
    orderedItems: filtered.orderedItems,
  }
}

function filterExportItems(
  target: AnalyzePostmanCollectionExportInput | ExportPostmanCollectionInput,
  items: ExplorerItem[],
  folders: FolderExportRecord[],
  requests: RequestExportRecord[]
) {
  if (target.scope === 'workspace') {
    return {
      rootFolderName: null,
      rootRequestName: null,
      folders,
      requests,
      orderedItems: items,
    }
  }

  const folderById = new Map(folders.map(folder => [folder.id, folder]))
  const requestById = new Map(requests.map(request => [request.id, request]))

  if (target.scope === 'request') {
    const rootRequest = requestById.get(target.requestId)
    if (!rootRequest) {
      throw new Error('Request not found')
    }

    return {
      rootFolderName: null,
      rootRequestName: rootRequest.name,
      folders: [],
      requests: [{ ...rootRequest, parentFolderId: null }],
      orderedItems: items
        .filter((item): item is Extract<ExplorerItem, { itemType: 'request' }> => item.itemType === 'request' && item.id === target.requestId)
        .map(item => ({ ...item, parentFolderId: null })),
    }
  }

  const rootFolder = folderById.get(target.folderId)
  if (!rootFolder) {
    throw new Error('Folder not found')
  }

  const includedFolderIds = new Set<string>([rootFolder.id])
  let changed = true
  while (changed) {
    changed = false
    for (const folder of folders) {
      if (folder.parentFolderId && includedFolderIds.has(folder.parentFolderId) && !includedFolderIds.has(folder.id)) {
        includedFolderIds.add(folder.id)
        changed = true
      }
    }
  }

  const scopedFolders = folders
    .filter(folder => includedFolderIds.has(folder.id))
    .map(folder => ({
      ...folder,
      parentFolderId: folder.id === rootFolder.id ? null : folder.parentFolderId,
    }))

  const scopedRequests = requests.filter(request => request.parentFolderId !== null && includedFolderIds.has(request.parentFolderId))
  const scopedRequestIds = new Set(scopedRequests.map(request => request.id))
  const scopedItems = items
    .filter(item => {
      if (item.itemType === 'folder') {
        return includedFolderIds.has(item.id)
      }

      if (item.itemType === 'request') {
        return scopedRequestIds.has(item.id)
      }

      return false
    })
    .map(item => {
      if (item.itemType === 'folder' && item.id === rootFolder.id) {
        return { ...item, parentFolderId: null }
      }

      return item
    })

  return {
    rootFolderName: rootFolder.name,
    rootRequestName: null,
    folders: scopedFolders,
    requests: scopedRequests,
    orderedItems: scopedItems,
  }
}

function buildFolderItem(folder: FolderExportRecord, children: PostmanItem[]): PostmanItem {
  const postmanItem: PostmanItem = {
    name: folder.name,
    item: children,
    auth: mapAuth(folder.auth),
    event: buildEvents(folder.preRequestScript, folder.postRequestScript),
  }

  if (folder.description.trim()) {
    postmanItem.description = folder.description
  }

  if (parseKeyValueRows(folder.headers).some(row => row.key.trim() || row.value.trim() || row.description.trim())) {
    postmanItem._kova = {
      folderHeaders: folder.headers,
    }
  }

  return postmanItem
}

function buildRequestItem(request: RequestExportRecord, examples: RequestExampleRecord[]): PostmanItem {
  return {
    name: request.name,
    request: mapRequest(request),
    response: examples.map(example => mapResponseExample(example, request)),
    auth: mapAuth(request.auth),
    event: buildEvents(request.preRequestScript, request.postRequestScript),
  }
}

function mapRequest(request: Pick<HttpRequestRecord, 'method' | 'url' | 'pathParams' | 'searchParams' | 'headers' | 'body' | 'bodyType' | 'rawType' | 'auth'>): PostmanRequest {
  const headers = parseKeyValueRows(request.headers)
  const pathVariables = parseKeyValueRows(request.pathParams)
  const searchParams = parseKeyValueRows(request.searchParams)
  const rawUrl = buildRawUrl(request.url, pathVariables, searchParams)

  const postmanRequest: PostmanRequest = {
    method: request.method,
    url: {
      raw: rawUrl,
    },
  }

  if (headers.length > 0) {
    postmanRequest.header = headers.map(mapKeyValueRow)
  }

  if (pathVariables.length > 0) {
    postmanRequest.url.variable = pathVariables.map(mapKeyValueRow)
  }

  if (searchParams.length > 0) {
    postmanRequest.url.query = searchParams.map(mapKeyValueRow)
  }

  const body = mapBody(request.body, request.bodyType, request.rawType)
  if (body) {
    postmanRequest.body = body
  }

  const auth = mapAuth(request.auth)
  if (auth) {
    postmanRequest.auth = auth
  }

  return postmanRequest
}

function mapResponseExample(example: RequestExampleRecord, request: RequestExportRecord): PostmanResponse {
  return {
    name: example.name,
    code: example.responseStatus,
    status: example.responseStatusText,
    header: parseKeyValueRows(example.responseHeaders).map(mapKeyValueRow),
    body: example.responseBody,
    originalRequest: hasExampleRequestSnapshotOverride(example, request)
      ? mapRequest({
          method: request.method,
          url: request.url,
          pathParams: request.pathParams,
          searchParams: request.searchParams,
          auth: request.auth,
          headers: example.requestHeaders,
          body: example.requestBody,
          bodyType: example.requestBodyType,
          rawType: example.requestRawType,
        })
      : undefined,
  }
}

function hasExampleRequestSnapshotOverride(example: RequestExampleRecord, request: RequestExportRecord) {
  return example.requestHeaders !== request.headers
    || example.requestBody !== request.body
    || example.requestBodyType !== request.bodyType
    || example.requestRawType !== request.rawType
}

function mapKeyValueRow(row: ReturnType<typeof parseKeyValueRows>[number]): PostmanKeyValue {
  const mapped: PostmanKeyValue = {
    key: row.key,
    value: row.value,
  }

  if (!row.enabled) {
    mapped.disabled = true
  }

  if (row.description.trim()) {
    mapped.description = row.description
  }

  return mapped
}

function buildRawUrl(url: string, pathRows: ReturnType<typeof parseKeyValueRows>, queryRows: ReturnType<typeof parseKeyValueRows>) {
  let rawUrl = url
  for (const row of pathRows) {
    const key = row.key.trim()
    if (!key) {
      continue
    }

    rawUrl = rawUrl.replaceAll(`:${key}`, `{{${key}}}`)
  }

  const enabledQuery = queryRows.filter(row => row.enabled && row.key.trim())
  if (enabledQuery.length === 0) {
    return rawUrl
  }

  const separator = rawUrl.includes('?') ? '&' : '?'
  return `${rawUrl}${separator}${enabledQuery.map(row => `${encodeURIComponent(row.key)}=${encodeURIComponent(row.value)}`).join('&')}`
}

function mapBody(body: string, bodyType: RequestBodyType, rawType: RequestRawType): PostmanBody | undefined {
  if (bodyType === 'raw') {
    return {
      mode: 'raw',
      raw: body,
      options: {
        raw: {
          language: rawType,
        },
      },
    }
  }

  if (bodyType === 'x-www-form-urlencoded') {
    return {
      mode: 'urlencoded',
      urlencoded: parseKeyValueRows(body).map(mapKeyValueRow),
    }
  }

  if (bodyType === 'form-data') {
    return {
      mode: 'formdata',
      formdata: parseKeyValueRows(body).map(row => ({ ...mapKeyValueRow(row), type: 'text' as const })),
    }
  }

  return undefined
}

function mapAuth(auth: HttpAuth): PostmanAuth | undefined {
  switch (auth.type) {
    case 'inherit':
      return undefined
    case 'noauth':
      return { type: 'noauth' }
    case 'bearer':
      return { type: 'bearer', bearer: [{ key: 'token', value: auth.token }] }
    case 'basic':
      return {
        type: 'basic',
        basic: [
          { key: 'username', value: auth.username },
          { key: 'password', value: auth.password },
        ],
      }
    case 'apikey':
      return {
        type: 'apikey',
        apikey: [
          { key: 'key', value: auth.key },
          { key: 'value', value: auth.value },
          { key: 'in', value: auth.addTo },
        ],
      }
  }
}

function buildEvents(preRequestScript: string, postRequestScript: string): PostmanEvent[] | undefined {
  const events: PostmanEvent[] = []

  if (preRequestScript.trim()) {
    events.push({
      listen: 'prerequest',
      script: {
        exec: preRequestScript.split('\n'),
        type: 'text/javascript',
      },
    })
  }

  if (postRequestScript.trim()) {
    events.push({
      listen: 'test',
      script: {
        exec: postRequestScript.split('\n'),
        type: 'text/javascript',
      },
    })
  }

  return events.length > 0 ? events : undefined
}

function addWarning(
  warnings: Map<PostmanExportWarningCode, { count: number; examples: string[] }>,
  code: PostmanExportWarningCode,
  count: number,
  examples: string[]
) {
  const current = warnings.get(code) ?? { count: 0, examples: [] }
  current.count += count

  for (const example of examples) {
    if (example && !current.examples.includes(example) && current.examples.length < 5) {
      current.examples.push(example)
    }
  }

  warnings.set(code, current)
}

function buildWarnings(warnings: Map<PostmanExportWarningCode, { count: number; examples: string[] }>): PostmanExportWarning[] {
  return Array.from(warnings.entries()).map(([code, value]) => ({
    code,
    severity: 'info',
    message: warningMessages[code],
    count: value.count,
    examples: value.examples,
  }))
}

const warningMessages: Record<PostmanExportWarningCode, string> = {
  'folder-headers-stored-in-metadata': 'Folder-level headers are stored in Kova metadata. Postman will ignore them unless you import the file back into Kova.',
}
