import fs from 'node:fs'
import path from 'node:path'
import { getAuthHeaders, getAuthQueryParams, resolveInheritedAuth, type HttpAuth } from '../common/Auth.js'
import { parseKeyValueRows } from '../common/KeyValueRows.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import type { ExplorerItem } from '../common/Explorer.js'
import type { FolderRecord } from '../common/Folders.js'
import {
  type AnalyzeOpenApiSpecExportInput,
  type AnalyzeOpenApiSpecExportResponse,
  type ExportOpenApiSpecInput,
  type ExportOpenApiSpecResponse,
  type OpenApiExportWarning,
  type OpenApiExportWarningCode,
  type OpenApiExportTarget,
  type PickOpenApiSpecExportFileResponse,
} from '../common/OpenApiExport.js'
import type { RequestExampleRecord } from '../common/RequestExamples.js'
import type { HttpRequestRecord } from '../common/Requests.js'
import { Result } from '../common/Result.js'
import { listExplorerItems } from './db/explorer.js'
import { getFolder, getFolderAncestorChain } from './db/folders.js'
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

type OpenApiExportSource = {
  scope: 'workspace' | 'folder' | 'request'
  folderId: string | null
  requestId: string | null
  suggestedSpecName: string
  folders: FolderExportRecord[]
  requests: RequestExportRecord[]
  examplesByRequestId: Map<string, RequestExampleRecord[]>
  ancestorFoldersByRequestId: Map<string, FolderRecord[]>
}

type ExportAnalysis = {
  scope: 'workspace' | 'folder' | 'request'
  folderId: string | null
  requestId: string | null
  suggestedSpecName: string
  folderCount: number
  requestCount: number
  exampleCount: number
  warnings: OpenApiExportWarning[]
}

type OpenApiDocument = {
  openapi: '3.0.3'
  info: {
    title: string
    version: string
  }
  servers?: Array<{ url: string }>
  paths: Record<string, OpenApiPathItem>
  components?: {
    securitySchemes?: Record<string, OpenApiSecurityScheme>
  }
}

type OpenApiPathItem = Partial<Record<Lowercase<HttpRequestRecord['method']>, OpenApiOperation>>

type OpenApiOperation = {
  tags?: string[]
  summary: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  responses: Record<string, OpenApiResponse>
  security?: Array<Record<string, []>>
  servers?: Array<{ url: string }>
}

type OpenApiSecurityScheme =
  | { type: 'http'; scheme: 'bearer' | 'basic' }
  | { type: 'apiKey'; name: string; in: 'header' | 'query' }

type OpenApiParameter = {
  name: string
  in: 'path' | 'query' | 'header'
  required?: boolean
  description?: string
  schema: OpenApiSchema
  example?: unknown
}

type OpenApiSchema = {
  type?: 'string' | 'object'
  format?: 'binary'
  properties?: Record<string, OpenApiSchema>
  additionalProperties?: boolean
}

type OpenApiRequestBody = {
  required: boolean
  content: Record<string, OpenApiMediaType>
}

type OpenApiMediaType = {
  schema?: OpenApiSchema
  example?: unknown
  examples?: Record<string, { value: unknown }>
}

type OpenApiResponse = {
  description: string
  content?: Record<string, OpenApiMediaType>
}

export async function pickOpenApiSpecExportFile(): Promise<GenericResult<PickOpenApiSpecExportFileResponse>> {
  return GenericError.Message('Save dialog is handled in main process')
}

export async function analyzeOpenApiSpecExport(input: AnalyzeOpenApiSpecExportInput): Promise<GenericResult<AnalyzeOpenApiSpecExportResponse>> {
  try {
    const source = await loadOpenApiExportSource(input)
    const analysis = analyzeOpenApiExportSource(source)

    return Result.Success({
      scope: analysis.scope,
      folderId: analysis.folderId,
      requestId: analysis.requestId,
      suggestedSpecName: analysis.suggestedSpecName,
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

export async function exportOpenApiSpec(input: ExportOpenApiSpecInput): Promise<GenericResult<ExportOpenApiSpecResponse>> {
  const specName = input.specName.trim()
  if (!specName) {
    return GenericError.Message('Spec name is required')
  }

  try {
    const source = await loadOpenApiExportSource(input)
    const analysis = analyzeOpenApiExportSource(source)
    const document = buildOpenApiExportDocument(source, specName)
    const filePath = path.resolve(input.filePath)
    fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

    return Result.Success({
      filePath,
      specName,
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

export function analyzeOpenApiExportSource(source: OpenApiExportSource): ExportAnalysis {
  const warnings = new Map<OpenApiExportWarningCode, { count: number; examples: string[] }>()
  const httpRequests = source.requests.filter(request => request.requestType === 'http')
  const graphqlRequests = httpRequests.filter(request => request.bodyType === 'graphql')
  const exportableHttpRequests = httpRequests.filter(request => request.bodyType !== 'graphql')
  const websocketRequests = source.requests.filter(request => request.requestType === 'websocket')
  const foldersWithHeaders = source.folders.filter(folder => hasKeyValueContent(folder.headers))
  const foldersWithScripts = source.folders.filter(folder => folder.preRequestScript.trim() || folder.postRequestScript.trim())
  const requestsWithScripts = exportableHttpRequests.filter(request => request.preRequestScript.trim() || request.postRequestScript.trim())
  const requestsWithVisualizer = exportableHttpRequests.filter(request => request.responseVisualizer.trim() || request.responseTableAccessor.trim())
  const requestsWithTokenRefresh = exportableHttpRequests.filter(request => {
    const effectiveAuth = getEffectiveAuth(source, request)
    return effectiveAuth.type === 'bearer' || effectiveAuth.type === 'apikey' || effectiveAuth.type === 'basic'
      ? Boolean(effectiveAuth.tokenRefreshRequestId)
      : false
  })
  const requestsWithDisabledRows = exportableHttpRequests.filter(request => countDisabledRowsForRequest(request) > 0)
  const servers = Array.from(new Set(exportableHttpRequests.map(request => splitRequestUrl(request.url).server).filter((value): value is string => Boolean(value))))
  const duplicateOperations = countDuplicateOperations(exportableHttpRequests)

  if (websocketRequests.length > 0) {
    addWarning(warnings, 'websocket-requests-skipped', websocketRequests.length, websocketRequests.slice(0, 5).map(request => request.name))
  }
  if (graphqlRequests.length > 0) {
    addWarning(warnings, 'graphql-requests-skipped', graphqlRequests.length, graphqlRequests.slice(0, 5).map(request => request.name))
  }
  if (foldersWithHeaders.length > 0) {
    addWarning(warnings, 'folder-headers-not-exported', foldersWithHeaders.length, foldersWithHeaders.slice(0, 5).map(folder => folder.name))
  }
  if (foldersWithScripts.length > 0) {
    addWarning(warnings, 'folder-scripts-not-exported', foldersWithScripts.length, foldersWithScripts.slice(0, 5).map(folder => folder.name))
  }
  if (requestsWithScripts.length > 0) {
    addWarning(warnings, 'request-scripts-not-exported', requestsWithScripts.length, requestsWithScripts.slice(0, 5).map(request => request.name))
  }
  if (requestsWithVisualizer.length > 0) {
    addWarning(warnings, 'response-visualizer-not-exported', requestsWithVisualizer.length, requestsWithVisualizer.slice(0, 5).map(request => request.name))
  }
  if (requestsWithTokenRefresh.length > 0) {
    addWarning(warnings, 'token-refresh-config-not-exported', requestsWithTokenRefresh.length, requestsWithTokenRefresh.slice(0, 5).map(request => request.name))
  }
  if (requestsWithDisabledRows.length > 0) {
    addWarning(warnings, 'disabled-rows-skipped', requestsWithDisabledRows.length, requestsWithDisabledRows.slice(0, 5).map(request => request.name))
  }
  if (servers.length > 1) {
    addWarning(warnings, 'mixed-servers-exported-with-operation-servers', servers.length, servers.slice(0, 5))
  }
  if (duplicateOperations.count > 0) {
    addWarning(warnings, 'duplicate-path-method-skipped', duplicateOperations.count, duplicateOperations.examples)
  }

  return {
    scope: source.scope,
    folderId: source.folderId,
    requestId: source.requestId,
    suggestedSpecName: source.suggestedSpecName,
    folderCount: source.folders.length,
    requestCount: exportableHttpRequests.length,
    exampleCount: Array.from(source.examplesByRequestId.values()).reduce((sum, examples) => sum + examples.length, 0),
    warnings: buildWarnings(warnings),
  }
}

export function buildOpenApiExportDocument(source: OpenApiExportSource, specName: string): OpenApiDocument {
  const paths: Record<string, OpenApiPathItem> = {}
  const securitySchemes: Record<string, OpenApiSecurityScheme> = {}
  const httpRequests = source.requests.filter(request => request.requestType === 'http' && request.bodyType !== 'graphql')
  const operationServers = new Set<string>()
  const useFolderTags = shouldUseImmediateFolderTags(source)

  for (const request of httpRequests) {
    const { pathName, server } = splitRequestUrl(request.url)
    const method = request.method.toLowerCase() as Lowercase<HttpRequestRecord['method']>

    if (paths[pathName]?.[method]) {
      continue
    }

    const operation = buildOperation(source, request, useFolderTags, securitySchemes, server)
    if (server) {
      operationServers.add(server)
    }

    const pathItem = paths[pathName] ?? {}
    pathItem[method] = operation
    paths[pathName] = pathItem
  }

  const sharedServers = Array.from(operationServers)
  const document: OpenApiDocument = {
    openapi: '3.0.3',
    info: {
      title: specName,
      version: '1.0.0',
    },
    paths,
  }

  if (sharedServers.length === 1) {
    document.servers = [{ url: sharedServers[0] }]

    for (const pathItem of Object.values(paths)) {
      for (const operation of Object.values(pathItem)) {
        if (!operation || operation.servers?.[0]?.url !== sharedServers[0]) {
          continue
        }

        delete operation.servers
      }
    }
  }

  if (Object.keys(securitySchemes).length > 0) {
    document.components = { securitySchemes }
  }

  return document
}

async function loadOpenApiExportSource(target: AnalyzeOpenApiSpecExportInput | ExportOpenApiSpecInput): Promise<OpenApiExportSource> {
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

  const filtered = filterExportItems(target, folders, requests)
  const httpRequests = filtered.requests.filter(request => request.requestType === 'http')
  const examples = await listRequestExamplesByRequestIds(httpRequests.map(request => request.id))
  const examplesByRequestId = new Map<string, RequestExampleRecord[]>()
  for (const example of examples) {
    const rows = examplesByRequestId.get(example.requestId) ?? []
    rows.push(example)
    examplesByRequestId.set(example.requestId, rows)
  }

  const ancestorFoldersByRequestId = new Map<string, FolderRecord[]>()
  for (const request of filtered.requests) {
    const ancestors = await getFolderAncestorChain(request.parentFolderId)
    ancestorFoldersByRequestId.set(request.id, trimAncestorsForScope(ancestors, target))
  }

  return {
    scope: target.scope,
    folderId: target.scope === 'folder' ? target.folderId : null,
    requestId: target.scope === 'request' ? target.requestId : null,
    suggestedSpecName: filtered.suggestedSpecName,
    folders: filtered.folders,
    requests: filtered.requests,
    examplesByRequestId,
    ancestorFoldersByRequestId,
  }
}

function filterExportItems(target: OpenApiExportTarget, folders: FolderExportRecord[], requests: RequestExportRecord[]) {
  if (target.scope === 'workspace') {
    const topLevelFolders = folders.filter(folder => folder.parentFolderId === null)
    const topLevelRequests = requests.filter(request => request.parentFolderId === null)

    return {
      suggestedSpecName: topLevelFolders.length === 1 && topLevelRequests.length === 0 ? topLevelFolders[0].name : 'Kova API',
      folders,
      requests,
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
      suggestedSpecName: rootRequest.name,
      folders: [],
      requests: [{ ...rootRequest, parentFolderId: rootRequest.parentFolderId }],
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

  return {
    suggestedSpecName: rootFolder.name,
    folders: folders
      .filter(folder => includedFolderIds.has(folder.id))
      .map(folder => ({
        ...folder,
        parentFolderId: folder.id === rootFolder.id ? null : folder.parentFolderId,
      })),
    requests: requests.filter(request => request.parentFolderId !== null && includedFolderIds.has(request.parentFolderId)),
  }
}

function trimAncestorsForScope(ancestors: FolderRecord[], target: OpenApiExportTarget) {
  if (target.scope !== 'folder') {
    return ancestors
  }

  const rootIndex = ancestors.findIndex(folder => folder.id === target.folderId)
  return rootIndex >= 0 ? ancestors.slice(rootIndex) : ancestors
}

function buildOperation(
  source: OpenApiExportSource,
  request: RequestExportRecord,
  useFolderTags: boolean,
  securitySchemes: Record<string, OpenApiSecurityScheme>,
  server: string | null
): OpenApiOperation {
  const pathParams = parseKeyValueRows(request.pathParams)
  const queryParams = parseKeyValueRows(request.searchParams)
  const headers = parseKeyValueRows(request.headers)
  const effectiveAuth = getEffectiveAuth(source, request)
  const parameters: OpenApiParameter[] = []

  for (const row of pathParams) {
    if (!row.enabled || !row.key.trim()) {
      continue
    }
    parameters.push({
      name: row.key.trim(),
      in: 'path',
      required: true,
      description: row.description.trim() || undefined,
      schema: { type: 'string' },
      example: row.value || undefined,
    })
  }

  for (const row of queryParams) {
    if (!row.enabled || !row.key.trim()) {
      continue
    }
    parameters.push({
      name: row.key.trim(),
      in: 'query',
      description: row.description.trim() || undefined,
      schema: { type: 'string' },
      example: row.value || undefined,
    })
  }

  for (const row of headers) {
    const key = row.key.trim()
    if (!row.enabled || !key || key.toLowerCase() === 'content-type') {
      continue
    }
    parameters.push({
      name: key,
      in: 'header',
      description: row.description.trim() || undefined,
      schema: { type: 'string' },
      example: row.value || undefined,
    })
  }

  for (const row of getAuthQueryParams(effectiveAuth)) {
    parameters.push({
      name: row.key,
      in: 'query',
      schema: { type: 'string' },
      example: row.value || undefined,
    })
  }

  for (const row of getAuthHeaders(effectiveAuth)) {
    if (parameters.some(parameter => parameter.in === 'header' && parameter.name.toLowerCase() === row.key.toLowerCase())) {
      continue
    }
    parameters.push({
      name: row.key,
      in: 'header',
      schema: { type: 'string' },
      example: row.value || undefined,
    })
  }

  const requestBody = buildRequestBody(request, source.examplesByRequestId.get(request.id) ?? [])
  const operation: OpenApiOperation = {
    summary: request.name,
    responses: buildResponses(source.examplesByRequestId.get(request.id) ?? []),
  }

  if (useFolderTags) {
    const immediateFolderName = source.ancestorFoldersByRequestId.get(request.id)?.at(-1)?.name?.trim()
    if (immediateFolderName) {
      operation.tags = [immediateFolderName]
    }
  }

  if (parameters.length > 0) {
    operation.parameters = parameters
  }

  if (requestBody) {
    operation.requestBody = requestBody
  }

  const security = buildSecurityRequirement(effectiveAuth, securitySchemes)
  if (security) {
    operation.security = [security]
  }

  if (server) {
    operation.servers = [{ url: server }]
  }

  return operation
}

function buildRequestBody(request: RequestExportRecord, examples: RequestExampleRecord[]): OpenApiRequestBody | undefined {
  if (request.bodyType === 'none') {
    return undefined
  }

  if (request.bodyType === 'raw') {
    const contentType = request.rawType === 'json' ? 'application/json' : 'text/plain'
    return {
      required: true,
      content: {
        [contentType]: {
          example: parseRawBodyExample(request.body, request.rawType),
          examples: buildRequestExampleMap(examples, request.rawType),
        },
      },
    }
  }

  const rows = parseKeyValueRows(request.body).filter(row => row.enabled && row.key.trim())
  const schema = buildObjectSchemaFromRows(rows)
  const example = buildObjectExampleFromRows(rows)
  const exampleMap = buildStructuredRequestExampleMap(examples)

  return {
    required: true,
    content: {
      [request.bodyType === 'form-data' ? 'multipart/form-data' : 'application/x-www-form-urlencoded']: {
        schema,
        example,
        examples: exampleMap,
      },
    },
  }
}

function buildResponses(examples: RequestExampleRecord[]): Record<string, OpenApiResponse> {
  if (examples.length === 0) {
    return {
      default: {
        description: 'Response',
      },
    }
  }

  const responses: Record<string, OpenApiResponse> = {}
  const examplesByStatus = new Map<number, RequestExampleRecord[]>()

  for (const example of examples) {
    const rows = examplesByStatus.get(example.responseStatus) ?? []
    rows.push(example)
    examplesByStatus.set(example.responseStatus, rows)
  }

  for (const [status, statusExamples] of examplesByStatus.entries()) {
    const firstExample = statusExamples[0]
    const contentType = inferResponseContentType(firstExample.responseHeaders, firstExample.responseBody)
    const response: OpenApiResponse = {
      description: firstExample.responseStatusText || 'Response',
    }

    if (firstExample.responseBody.trim()) {
      response.content = {
        [contentType]: {
          example: parseResponseBodyExample(firstExample.responseBody, contentType),
          examples: Object.fromEntries(statusExamples.map(example => [toExampleKey(example.name), { value: parseResponseBodyExample(example.responseBody, contentType) }])),
        },
      }
    }

    responses[String(status)] = response
  }

  return responses
}

function buildSecurityRequirement(auth: HttpAuth, securitySchemes: Record<string, OpenApiSecurityScheme>): Record<string, []> | null {
  switch (auth.type) {
    case 'inherit':
    case 'noauth':
      return null
    case 'bearer': {
      securitySchemes.bearerAuth = { type: 'http', scheme: 'bearer' }
      return { bearerAuth: [] }
    }
    case 'basic': {
      securitySchemes.basicAuth = { type: 'http', scheme: 'basic' }
      return { basicAuth: [] }
    }
    case 'apikey': {
      const schemeName = `apiKey${auth.addTo === 'header' ? 'Header' : 'Query'}${sanitizeSchemeKey(auth.key)}`
      securitySchemes[schemeName] = { type: 'apiKey', name: auth.key, in: auth.addTo }
      return { [schemeName]: [] }
    }
  }
}

function getEffectiveAuth(source: OpenApiExportSource, request: RequestExportRecord) {
  const folderAuths = (source.ancestorFoldersByRequestId.get(request.id) ?? []).map(folder => folder.auth)
  return resolveInheritedAuth(folderAuths, request.auth)
}

function shouldUseImmediateFolderTags(source: OpenApiExportSource) {
  if (source.scope !== 'folder' || !source.folderId) {
    return true
  }

  return !source.folders.some(folder => folder.parentFolderId !== null && folder.parentFolderId !== source.folderId)
}

function splitRequestUrl(url: string) {
  const match = url.match(/^([a-zA-Z][a-zA-Z\d+.-]*:\/\/[^/?#]+)?([^?#]*)(\?[^#]*)?(#.*)?$/)
  const server = match?.[1] ?? null
  const rawPath = match?.[2] ?? url
  const pathWithoutTrailingSlash = rawPath || '/'
  const normalizedPath = pathWithoutTrailingSlash.startsWith('/') ? pathWithoutTrailingSlash : `/${pathWithoutTrailingSlash}`

  return {
    server,
    pathName: normalizedPath.replace(/:([A-Za-z0-9._-]+)/g, '{$1}'),
  }
}

function hasKeyValueContent(value: string) {
  return parseKeyValueRows(value).some(row => row.key.trim() || row.value.trim() || row.description.trim())
}

function countDisabledRowsForRequest(request: RequestExportRecord) {
  const values = [request.pathParams, request.searchParams, request.headers]
  if (request.bodyType === 'form-data' || request.bodyType === 'x-www-form-urlencoded') {
    values.push(request.body)
  }

  return values.flatMap(parseKeyValueRows).filter(row => !row.enabled).length
}

function countDuplicateOperations(requests: RequestExportRecord[]) {
  const seen = new Set<string>()
  const examples: string[] = []

  for (const request of requests) {
    const { pathName } = splitRequestUrl(request.url)
    const key = `${request.method} ${pathName}`
    if (seen.has(key)) {
      if (!examples.includes(key) && examples.length < 5) {
        examples.push(key)
      }
      continue
    }

    seen.add(key)
  }

  return { count: requests.length - seen.size, examples }
}

function buildObjectSchemaFromRows(rows: ReturnType<typeof parseKeyValueRows>): OpenApiSchema {
  return {
    type: 'object',
    properties: Object.fromEntries(rows.map(row => [row.key.trim(), row.type === 'file' ? { type: 'string', format: 'binary' } : { type: 'string' }])),
    additionalProperties: false,
  }
}

function buildObjectExampleFromRows(rows: ReturnType<typeof parseKeyValueRows>) {
  return Object.fromEntries(rows.map(row => [row.key.trim(), row.value]))
}

function buildRequestExampleMap(examples: RequestExampleRecord[], rawType: RequestExportRecord['rawType']) {
  const entries = examples
    .filter(example => example.requestBody.trim())
    .map(example => [toExampleKey(example.name), { value: parseRawBodyExample(example.requestBody, rawType) }] satisfies [string, { value: unknown }])

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function buildStructuredRequestExampleMap(examples: RequestExampleRecord[]) {
  const entries = examples
    .filter(example => example.requestBody.trim())
    .map(example => [toExampleKey(example.name), { value: buildObjectExampleFromRows(parseKeyValueRows(example.requestBody).filter(row => row.enabled && row.key.trim())) }] satisfies [string, { value: unknown }])

  return entries.length > 0 ? Object.fromEntries(entries) : undefined
}

function parseRawBodyExample(value: string, rawType: RequestExportRecord['rawType']) {
  if (rawType === 'text') {
    return value
  }

  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function inferResponseContentType(responseHeaders: string, responseBody: string) {
  const contentTypeHeader = parseKeyValueRows(responseHeaders).find(row => row.enabled && row.key.trim().toLowerCase() === 'content-type')
  if (contentTypeHeader?.value.trim()) {
    return contentTypeHeader.value.split(';')[0]?.trim() || 'text/plain'
  }

  try {
    JSON.parse(responseBody)
    return 'application/json'
  } catch {
    return 'text/plain'
  }
}

function parseResponseBodyExample(value: string, contentType: string) {
  if (contentType.includes('json')) {
    try {
      return JSON.parse(value)
    } catch {
      return value
    }
  }

  return value
}

function sanitizeSchemeKey(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : 'Key'
}

function toExampleKey(value: string) {
  const normalized = value.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return normalized || 'example'
}

function addWarning(
  warnings: Map<OpenApiExportWarningCode, { count: number; examples: string[] }>,
  code: OpenApiExportWarningCode,
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

function buildWarnings(warnings: Map<OpenApiExportWarningCode, { count: number; examples: string[] }>): OpenApiExportWarning[] {
  return Array.from(warnings.entries()).map(([code, value]) => ({
    code,
    severity: code === 'duplicate-path-method-skipped' ? 'warning' : 'info',
    message: warningMessages[code],
    count: value.count,
    examples: value.examples,
  }))
}

const warningMessages: Record<OpenApiExportWarningCode, string> = {
  'websocket-requests-skipped': 'WebSocket requests are skipped because OpenAPI export only supports HTTP requests.',
  'graphql-requests-skipped': 'GraphQL requests are skipped because OpenAPI export in Kova only models generic HTTP request bodies.',
  'folder-headers-not-exported': 'Folder-level headers are not exported because OpenAPI has no equivalent folder header model.',
  'folder-scripts-not-exported': 'Folder scripts are not exported because OpenAPI has no script runtime model.',
  'request-scripts-not-exported': 'Request scripts are not exported because OpenAPI has no script runtime model.',
  'response-visualizer-not-exported': 'Response visualizer settings are not exported because OpenAPI has no equivalent visualization model.',
  'token-refresh-config-not-exported': 'Token refresh request links are not exported because OpenAPI has no equivalent token refresh linkage.',
  'disabled-rows-skipped': 'Disabled headers, params, or form rows are skipped because OpenAPI does not model disabled request fields.',
  'mixed-servers-exported-with-operation-servers': 'Requests use multiple servers, so the export writes per-operation servers instead of one shared server.',
  'duplicate-path-method-skipped': 'Duplicate path and method pairs are skipped because OpenAPI allows only one operation per path and method.',
}
