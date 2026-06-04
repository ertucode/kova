import fs from 'node:fs'
import path from 'node:path'
import SwaggerParser from '@apidevtools/swagger-parser'
import { createDefaultHttpAuth, type HttpAuth } from '../common/Auth.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { stringifyKeyValueRows, type KeyValueRow } from '../common/KeyValueRows.js'
import { syncUrlWithSearchParams } from '../common/PathParams.js'
import {
  type AnalyzeOpenApiSpecInput,
  type AnalyzeOpenApiSpecResponse,
  type ImportOpenApiSpecInput,
  type ImportOpenApiSpecResponse,
  type OpenApiImportWarning,
  type OpenApiImportWarningCode,
  type PickOpenApiSpecFileResponse,
} from '../common/OpenApiImport.js'
import { Result } from '../common/Result.js'
import { Typescript } from '../common/Typescript.js'
import { getDb } from './db/index.js'
import { folders, requests } from './db/schema.js'
import { ensureParentFolderExists, insertTreeItem } from './db/tree-items.js'

type SupportedRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

type OpenApiDocument = {
  openapi?: string
  info?: { title?: string }
  servers?: OpenApiServer[]
  security?: OpenApiSecurityRequirement[]
  paths?: Record<string, OpenApiPathItem | undefined>
  components?: {
    securitySchemes?: Record<string, OpenApiSecurityScheme | undefined>
  }
  webhooks?: Record<string, unknown>
}

type OpenApiServer = {
  url?: string
  variables?: Record<string, { default?: string; enum?: string[] } | undefined>
}

type OpenApiPathItem = {
  parameters?: OpenApiParameter[]
  servers?: OpenApiServer[]
  callbacks?: Record<string, unknown>
  get?: OpenApiOperation
  post?: OpenApiOperation
  put?: OpenApiOperation
  patch?: OpenApiOperation
  delete?: OpenApiOperation
  head?: OpenApiOperation
  options?: OpenApiOperation
  trace?: OpenApiOperation
}

type OpenApiOperation = {
  tags?: string[]
  summary?: string
  operationId?: string
  parameters?: OpenApiParameter[]
  requestBody?: OpenApiRequestBody
  security?: OpenApiSecurityRequirement[]
  servers?: OpenApiServer[]
  callbacks?: Record<string, unknown>
}

type OpenApiSecurityRequirement = Record<string, string[]>

type OpenApiSecurityScheme = {
  type?: string
  scheme?: string
  name?: string
  in?: string
}

type OpenApiRequestBody = {
  content?: Record<string, OpenApiMediaType | undefined>
}

type OpenApiMediaType = {
  schema?: OpenApiSchema
  example?: unknown
  examples?: Record<string, { value?: unknown } | undefined>
}

type OpenApiParameter = {
  name?: string
  in?: 'path' | 'query' | 'header' | 'cookie'
  description?: string
  example?: unknown
  examples?: Record<string, { value?: unknown } | undefined>
  schema?: OpenApiSchema
}

type OpenApiSchema = {
  type?: string
  format?: string
  properties?: Record<string, OpenApiSchema | undefined>
  items?: OpenApiSchema
  example?: unknown
  default?: unknown
  enum?: unknown[]
  oneOf?: OpenApiSchema[]
  anyOf?: OpenApiSchema[]
  allOf?: OpenApiSchema[]
}

type WarningAccumulator = Map<OpenApiImportWarningCode, { count: number; examples: string[] }>

type OperationPlan = {
  name: string
  folderPath: string[]
  method: SupportedRequestMethod
  url: string
  pathParams: string
  searchParams: string
  headers: string
  body: string
  bodyType: 'raw' | 'x-www-form-urlencoded' | 'form-data' | 'none'
  rawType: 'json' | 'text'
  auth: HttpAuth
}

type ImportPlan = {
  specName: string
  suggestedRootFolderName: string
  folderCount: number
  requestCount: number
  hasServers: boolean
  hasSecuritySchemes: boolean
  usesTags: boolean
  warnings: OpenApiImportWarning[]
  operations: OperationPlan[]
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

const OPERATION_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options', 'trace'] as const
const SUPPORTED_REQUEST_METHODS = new Set<SupportedRequestMethod>(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

export async function pickOpenApiSpecFile(): Promise<GenericResult<PickOpenApiSpecFileResponse>> {
  return GenericError.Message('File picker is handled in main process')
}

export async function analyzeOpenApiSpec(input: AnalyzeOpenApiSpecInput): Promise<GenericResult<AnalyzeOpenApiSpecResponse>> {
  try {
    const document = await readOpenApiDocument(input.filePath)
    const analysis = analyzeOpenApiDocument(document)

    return Result.Success({
      filePath: input.filePath,
      specName: analysis.specName,
      suggestedRootFolderName: analysis.suggestedRootFolderName,
      folderCount: analysis.folderCount,
      requestCount: analysis.requestCount,
      warningCount: analysis.warnings.reduce((sum, warning) => sum + warning.count, 0),
      hasServers: analysis.hasServers,
      hasSecuritySchemes: analysis.hasSecuritySchemes,
      usesTags: analysis.usesTags,
      warnings: analysis.warnings,
    })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function importOpenApiSpec(input: ImportOpenApiSpecInput): Promise<GenericResult<ImportOpenApiSpecResponse>> {
  const rootFolderName = input.rootFolderName?.trim() ?? ''

  if (input.target === 'new-folder' && !rootFolderName) {
    return GenericError.Message('Root folder name is required')
  }

  if (input.target === 'existing-folder' && !input.targetFolderId) {
    return GenericError.Message('Target folder is required')
  }

  try {
    const document = await readOpenApiDocument(input.filePath)
    const plan = buildImportPlan(document)
    const importResult = importOpenApiDocument(plan, {
      target: input.target,
      targetFolderId: input.target === 'existing-folder' ? input.targetFolderId ?? null : null,
      rootFolderName,
    })

    return Result.Success({
      createdRootFolderId: importResult.createdRootFolderId,
      createdRootFolderName: importResult.createdRootFolderName,
      targetFolderId: importResult.targetFolderId,
      primaryImportedItem: importResult.primaryImportedItem,
      folderCount: plan.folderCount + (importResult.createdRootFolderId ? 1 : 0),
      requestCount: plan.requestCount,
      warningCount: plan.warnings.reduce((sum, warning) => sum + warning.count, 0),
      warnings: plan.warnings,
    })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export function analyzeOpenApiDocument(document: OpenApiDocument): Omit<ImportPlan, 'operations'> {
  const plan = buildImportPlan(document)
  return {
    specName: plan.specName,
    suggestedRootFolderName: plan.suggestedRootFolderName,
    folderCount: plan.folderCount,
    requestCount: plan.requestCount,
    hasServers: plan.hasServers,
    hasSecuritySchemes: plan.hasSecuritySchemes,
    usesTags: plan.usesTags,
    warnings: plan.warnings,
  }
}

export function buildImportPlan(document: OpenApiDocument): ImportPlan {
  assertOpenApiV3Document(document)

  const warnings = new Map<OpenApiImportWarningCode, { count: number; examples: string[] }>()
  const specName = sanitizeName(document.info?.title, 'Imported OpenAPI Spec')
  const folderKeys = new Set<string>()
  const operations: OperationPlan[] = []
  let usesTags = false

  const webhookCount = Object.keys(document.webhooks ?? {}).length
  if (webhookCount > 0) {
    addWarning(warnings, 'webhooks-ignored', webhookCount, [specName])
  }

  for (const [pathName, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem) {
      continue
    }

    const pathCallbacks = Object.keys(pathItem.callbacks ?? {}).length
    if (pathCallbacks > 0) {
      addWarning(warnings, 'callbacks-ignored', pathCallbacks, [pathName])
    }

    for (const method of OPERATION_METHODS) {
      const operation = pathItem[method]
      if (!operation) {
        continue
      }

      const methodName = method.toUpperCase()
      const operationLabel = `${methodName} ${pathName}`

      if (!SUPPORTED_REQUEST_METHODS.has(methodName as SupportedRequestMethod)) {
        addWarning(warnings, 'unsupported-http-method', 1, [operationLabel])
        continue
      }

      const callbackCount = Object.keys(operation.callbacks ?? {}).length
      if (callbackCount > 0) {
        addWarning(warnings, 'callbacks-ignored', callbackCount, [operationLabel])
      }

      const folderPath = buildFolderPath(operation.tags, pathName, warnings, operationLabel)
      usesTags = usesTags || folderPath.usesTags
      registerFolderPath(folderKeys, folderPath.segments)

      const parameters = mergeParameters(pathItem.parameters ?? [], operation.parameters ?? [])
      const mappedParameters = mapParameters(parameters, warnings, operationLabel)
      const serverUrl = resolveServerUrl(document.servers, pathItem.servers, operation.servers, warnings, operationLabel)
      const requestBody = mapRequestBody(operation.requestBody, warnings, operationLabel)
      const serializedSearchParams = stringifyKeyValueRows(mappedParameters.queryRows)

      operations.push({
        name: buildOperationName(operation, methodName as SupportedRequestMethod, pathName),
        folderPath: folderPath.segments,
        method: methodName as SupportedRequestMethod,
        url: syncUrlWithSearchParams(buildRequestUrl(serverUrl, pathName), serializedSearchParams),
        pathParams: stringifyKeyValueRows(mappedParameters.pathRows),
        searchParams: serializedSearchParams,
        headers: stringifyKeyValueRows(mappedParameters.headerRows),
        body: requestBody.body,
        bodyType: requestBody.bodyType,
        rawType: requestBody.rawType,
        auth: mapSecurity(document.components?.securitySchemes ?? {}, document.security, operation.security, warnings, operationLabel),
      })
    }
  }

  return {
    specName,
    suggestedRootFolderName: specName,
    folderCount: folderKeys.size,
    requestCount: operations.length,
    hasServers: hasConfiguredServers(document),
    hasSecuritySchemes: Object.keys(document.components?.securitySchemes ?? {}).length > 0,
    usesTags,
    warnings: buildWarnings(warnings),
    operations,
  }
}

export function importOpenApiDocument(
  plan: ImportPlan,
  input: { target: ImportOpenApiSpecInput['target']; targetFolderId: string | null; rootFolderName: string }
): ImportResult {
  const db = getDb()

  return db.transaction(tx => {
    const now = Date.now()
    let targetFolderId = input.target === 'existing-folder' ? input.targetFolderId : null
    let createdRootFolderId: string | undefined
    let createdRootFolderName: string | undefined
    let primaryImportedItem: ImportedItemSelection | undefined
    const folderIds = new Map<string, string>()

    if (input.target === 'new-folder') {
      const rootFolderId = crypto.randomUUID()
      tx.insert(folders)
        .values({
          id: rootFolderId,
          parentId: null,
          name: input.rootFolderName,
          description: '',
          headers: '',
          authJson: JSON.stringify(createDefaultHttpAuth()),
          preRequestScript: '',
          postRequestScript: '',
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

    for (const operation of plan.operations) {
      const parentFolderId = ensureImportFolderPath(tx, targetFolderId, operation.folderPath, folderIds, now)
      const requestId = crypto.randomUUID()
      tx.insert(requests)
        .values({
          id: requestId,
          name: operation.name,
          requestType: 'http',
          method: operation.method,
          url: operation.url,
          pathParams: operation.pathParams,
          searchParams: operation.searchParams,
          authJson: JSON.stringify(operation.auth),
          preRequestScript: '',
          postRequestScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw',
          headers: operation.headers,
          body: operation.body,
          bodyType: operation.bodyType,
          rawType: operation.rawType,
          websocketSubprotocols: '',
          websocketOnOpenMessage: '',
          websocketAutoSendEnabled: false,
          websocketAutoSendMessage: '',
          websocketAutoSendIntervalSeconds: 0,
          saveToHistory: true,
          createdAt: now,
          deletedAt: null,
        })
        .run()
      insertTreeItem(tx, { parentFolderId, itemType: 'request', itemId: requestId })

      if (!primaryImportedItem) {
        primaryImportedItem = { itemType: 'request', id: requestId }
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

async function readOpenApiDocument(filePath: string) {
  const absolutePath = path.resolve(filePath)
  if (!fs.existsSync(absolutePath)) {
    throw new Error('OpenAPI spec file does not exist')
  }

  const value = await SwaggerParser.dereference(absolutePath)
  if (!value || typeof value !== 'object') {
    throw new Error('Invalid OpenAPI spec file')
  }

  return value as OpenApiDocument
}

function assertOpenApiV3Document(document: OpenApiDocument) {
  const version = document.openapi?.trim()
  if (!version?.startsWith('3.')) {
    throw new Error('Only OpenAPI v3 specs are supported')
  }
}

function buildFolderPath(
  tags: string[] | undefined,
  pathName: string,
  warnings: WarningAccumulator,
  operationLabel: string
) {
  const normalizedTags = (tags ?? []).map(tag => tag.trim()).filter(Boolean)
  if (normalizedTags.length > 0) {
    if (normalizedTags.length > 1) {
      addWarning(warnings, 'multiple-tags-first-used', 1, [operationLabel])
    }

    return { segments: [sanitizeName(normalizedTags[0], 'Tagged Operations')], usesTags: true }
  }

  return {
    segments: pathName.split('/').map(segment => decodePathSegment(segment.trim())).filter(Boolean),
    usesTags: false,
  }
}

function mergeParameters(pathParameters: OpenApiParameter[], operationParameters: OpenApiParameter[]) {
  const merged = new Map<string, OpenApiParameter>()

  for (const parameter of pathParameters) {
    const key = `${parameter.in ?? ''}:${parameter.name ?? ''}`
    merged.set(key, parameter)
  }

  for (const parameter of operationParameters) {
    const key = `${parameter.in ?? ''}:${parameter.name ?? ''}`
    merged.set(key, parameter)
  }

  return Array.from(merged.values())
}

function mapParameters(parameters: OpenApiParameter[], warnings: WarningAccumulator, operationLabel: string) {
  const pathRows: KeyValueRow[] = []
  const queryRows: KeyValueRow[] = []
  const headerRows: KeyValueRow[] = []

  for (const [index, parameter] of parameters.entries()) {
    const row = {
      id: `parameter-${index}`,
      enabled: true,
      key: parameter.name ?? '',
      value: serializeScalarValue(readExampleValue(parameter.example, parameter.examples, parameter.schema)),
      description: parameter.description ?? '',
    } satisfies KeyValueRow

    switch (parameter.in) {
      case 'path':
        pathRows.push(row)
        break
      case 'query':
        queryRows.push(row)
        break
      case 'header':
        headerRows.push(row)
        break
      case 'cookie':
        addWarning(warnings, 'unsupported-parameter-location', 1, [`${operationLabel}: cookie ${parameter.name ?? ''}`.trim()])
        break
      case undefined:
        break
      default:
        return Typescript.assertUnreachable(parameter.in)
    }
  }

  return { pathRows, queryRows, headerRows }
}

function resolveServerUrl(
  documentServers: OpenApiServer[] | undefined,
  pathServers: OpenApiServer[] | undefined,
  operationServers: OpenApiServer[] | undefined,
  warnings: WarningAccumulator,
  operationLabel: string
) {
  const servers = operationServers?.length ? operationServers : pathServers?.length ? pathServers : documentServers ?? []
  if (servers.length > 1) {
    addWarning(warnings, 'multiple-servers-first-used', 1, [operationLabel])
  }

  return resolveServerTemplate(servers[0])
}

function mapRequestBody(requestBody: OpenApiRequestBody | undefined, warnings: WarningAccumulator, operationLabel: string) {
  const content = requestBody?.content ?? {}
  const contentTypes = Object.keys(content)
  const selected = selectContentType(contentTypes)
  if (!selected) {
    if (contentTypes.length > 0) {
      addWarning(warnings, 'unsupported-content-type', 1, [`${operationLabel}: ${contentTypes.join(', ')}`])
    }

    return { body: '', bodyType: 'none' as const, rawType: 'json' as const }
  }

  const mediaType = content[selected.contentType]
  const exampleValue = readExampleValue(mediaType?.example, mediaType?.examples, mediaType?.schema)

  switch (selected.kind) {
    case 'json':
      return {
        body: serializeJsonValue(exampleValue),
        bodyType: 'raw' as const,
        rawType: 'json' as const,
      }
    case 'text':
      return {
        body: serializeScalarValue(exampleValue),
        bodyType: 'raw' as const,
        rawType: 'text' as const,
      }
    case 'urlencoded':
      return {
        body: stringifyKeyValueRows(buildFormRows(mediaType?.schema, exampleValue, false)),
        bodyType: 'x-www-form-urlencoded' as const,
        rawType: 'json' as const,
      }
    case 'form-data':
      return {
        body: stringifyKeyValueRows(buildFormRows(mediaType?.schema, exampleValue, true)),
        bodyType: 'form-data' as const,
        rawType: 'json' as const,
      }
  }

  throw new Error('Unhandled OpenAPI request body content type')
}

function mapSecurity(
  securitySchemes: Record<string, OpenApiSecurityScheme | undefined>,
  documentSecurity: OpenApiSecurityRequirement[] | undefined,
  operationSecurity: OpenApiSecurityRequirement[] | undefined,
  warnings: WarningAccumulator,
  operationLabel: string
): HttpAuth {
  const effectiveSecurity = operationSecurity ?? documentSecurity
  if (!effectiveSecurity) {
    return { type: 'noauth' }
  }

  if (effectiveSecurity.length === 0) {
    return { type: 'noauth' }
  }

  for (const requirement of effectiveSecurity) {
    for (const schemeName of Object.keys(requirement)) {
      const scheme = securitySchemes[schemeName]
      const auth = mapSecurityScheme(scheme)
      if (auth) {
        return auth
      }

      addWarning(warnings, 'unsupported-security-scheme', 1, [`${operationLabel}: ${schemeName}`])
    }
  }

  return { type: 'noauth' }
}

function mapSecurityScheme(scheme: OpenApiSecurityScheme | undefined): HttpAuth | null {
  const type = scheme?.type?.toLowerCase()

  if (type === 'http') {
    const httpScheme = scheme?.scheme?.toLowerCase()
    if (httpScheme === 'bearer') {
      return { type: 'bearer', token: '' }
    }
    if (httpScheme === 'basic') {
      return { type: 'basic', username: '', password: '' }
    }
    return null
  }

  if (type === 'apikey') {
    if (!scheme?.name?.trim()) {
      return null
    }

    if (scheme.in === 'header' || scheme.in === 'query') {
      return {
        type: 'apikey',
        key: scheme.name,
        value: '',
        addTo: scheme.in,
      }
    }

    return null
  }

  return null
}

function selectContentType(contentTypes: string[]) {
  for (const contentType of contentTypes) {
    if (contentType === 'application/json' || contentType.endsWith('+json')) {
      return { contentType, kind: 'json' as const }
    }
  }

  for (const contentType of contentTypes) {
    switch (contentType) {
      case 'text/plain':
        return { contentType, kind: 'text' as const }
      case 'application/x-www-form-urlencoded':
        return { contentType, kind: 'urlencoded' as const }
      case 'multipart/form-data':
        return { contentType, kind: 'form-data' as const }
      default:
        break
    }
  }

  return null
}

function buildFormRows(schema: OpenApiSchema | undefined, exampleValue: unknown, supportsFileRows: boolean): KeyValueRow[] {
  const exampleObject = isRecord(exampleValue) ? exampleValue : {}
  const properties = schema?.properties ?? {}
  const propertyNames = new Set([...Object.keys(properties), ...Object.keys(exampleObject)])

  return Array.from(propertyNames).map((propertyName, index) => {
    const propertySchema = properties[propertyName]
    const propertyExample = propertyName in exampleObject ? exampleObject[propertyName] : buildSchemaExample(propertySchema)
    const type = supportsFileRows && isFileSchema(propertySchema) ? 'file' : undefined

    return {
      id: `body-${index}`,
      enabled: true,
      key: propertyName,
      type,
      value: serializeScalarValue(propertyExample),
      description: '',
    }
  })
}

function readExampleValue(example: unknown, examples: Record<string, { value?: unknown } | undefined> | undefined, schema: OpenApiSchema | undefined) {
  if (example !== undefined) {
    return example
  }

  for (const namedExample of Object.values(examples ?? {})) {
    if (namedExample?.value !== undefined) {
      return namedExample.value
    }
  }

  return buildSchemaExample(schema)
}

function buildSchemaExample(schema: OpenApiSchema | undefined, visited = new Set<OpenApiSchema>()): unknown {
  if (!schema || visited.has(schema)) {
    return undefined
  }

  visited.add(schema)

  if (schema.example !== undefined) {
    return schema.example
  }
  if (schema.default !== undefined) {
    return schema.default
  }
  if ((schema.enum?.length ?? 0) > 0) {
    return schema.enum?.[0]
  }
  if ((schema.oneOf?.length ?? 0) > 0) {
    return buildSchemaExample(schema.oneOf?.[0], visited)
  }
  if ((schema.anyOf?.length ?? 0) > 0) {
    return buildSchemaExample(schema.anyOf?.[0], visited)
  }
  if ((schema.allOf?.length ?? 0) > 0) {
    const merged = schema.allOf?.map(item => buildSchemaExample(item, visited)).filter(isRecord)
    return merged && merged.length > 0 ? Object.assign({}, ...merged) : undefined
  }

  if (schema.type === 'array' || schema.items) {
    const itemExample = buildSchemaExample(schema.items, visited)
    return itemExample === undefined ? [] : [itemExample]
  }

  if (schema.type === 'object' || schema.properties) {
    const result: Record<string, unknown> = {}
    for (const [key, propertySchema] of Object.entries(schema.properties ?? {})) {
      const propertyExample = buildSchemaExample(propertySchema, visited)
      if (propertyExample !== undefined) {
        result[key] = propertyExample
      }
    }
    return result
  }

  switch (schema.type) {
    case 'boolean':
      return false
    case 'integer':
    case 'number':
      return 0
    case 'string':
      return ''
    case undefined:
      return undefined
    default:
      return Typescript.assertUnreachable(schema.type as never)
  }
}

function buildOperationName(operation: OpenApiOperation, method: SupportedRequestMethod, pathName: string) {
  return sanitizeName(operation.summary, sanitizeName(operation.operationId, `${method} ${pathName}`))
}

function buildRequestUrl(serverUrl: string, pathName: string) {
  const normalizedPath = pathName.replace(/\{([^}]+)\}/g, ':$1')
  if (!serverUrl) {
    return normalizedPath
  }

  return `${serverUrl.replace(/\/+$/g, '')}${normalizedPath.startsWith('/') ? '' : '/'}${normalizedPath}`
}

function resolveServerTemplate(server: OpenApiServer | undefined) {
  const url = server?.url?.trim() ?? ''
  if (!url) {
    return ''
  }

  return url.replace(/\{([^}]+)\}/g, (_match, variableName: string) => {
    const variable = server?.variables?.[variableName]
    return variable?.default ?? variable?.enum?.[0] ?? ''
  })
}

function registerFolderPath(folderKeys: Set<string>, segments: string[]) {
  for (let index = 0; index < segments.length; index += 1) {
    folderKeys.add(segments.slice(0, index + 1).join('\u0000'))
  }
}

function ensureImportFolderPath(
  db: ReturnType<typeof getDb>,
  baseParentFolderId: string | null,
  segments: string[],
  folderIds: Map<string, string>,
  now: number
) {
  let parentFolderId = baseParentFolderId
  let folderKey = ''

  for (const segment of segments) {
    folderKey = folderKey ? `${folderKey}\u0000${segment}` : segment
    const existingFolderId = folderIds.get(folderKey)
    if (existingFolderId) {
      parentFolderId = existingFolderId
      continue
    }

    ensureParentFolderExists(db, parentFolderId)
    const folderId = crypto.randomUUID()
    db.insert(folders)
      .values({
        id: folderId,
        parentId: parentFolderId,
        name: segment,
        description: '',
        headers: '',
        authJson: JSON.stringify(createDefaultHttpAuth()),
        preRequestScript: '',
        postRequestScript: '',
        position: 0,
        createdAt: now,
        deletedAt: null,
      })
      .run()
    insertTreeItem(db, { parentFolderId, itemType: 'folder', itemId: folderId })
    folderIds.set(folderKey, folderId)
    parentFolderId = folderId
  }

  return parentFolderId
}

function hasConfiguredServers(document: OpenApiDocument) {
  if ((document.servers?.length ?? 0) > 0) {
    return true
  }

  return Object.values(document.paths ?? {}).some(pathItem => {
    if (!pathItem) {
      return false
    }

    if ((pathItem.servers?.length ?? 0) > 0) {
      return true
    }

    return OPERATION_METHODS.some(method => (pathItem[method]?.servers?.length ?? 0) > 0)
  })
}

function buildWarnings(warnings: WarningAccumulator): OpenApiImportWarning[] {
  return Array.from(warnings.entries())
    .map(([code, value]) => {
      const severity: OpenApiImportWarning['severity'] = code === 'unsupported-http-method'
        || code === 'unsupported-security-scheme'
        || code === 'unsupported-content-type'
        || code === 'unsupported-parameter-location'
        ? 'warning'
        : 'info'

      return {
        code,
        severity,
        message: warningMessageByCode[code],
        count: value.count,
        examples: value.examples,
      }
    })
    .sort((left, right) => right.count - left.count || left.message.localeCompare(right.message))
}

function addWarning(warnings: WarningAccumulator, code: OpenApiImportWarningCode, count: number, examples: string[]) {
  const current = warnings.get(code) ?? { count: 0, examples: [] }
  current.count += count

  for (const example of examples) {
    if (example && !current.examples.includes(example) && current.examples.length < 5) {
      current.examples.push(example)
    }
  }

  warnings.set(code, current)
}

function serializeJsonValue(value: unknown) {
  if (value === undefined) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }

  return JSON.stringify(value, null, 2)
}

function serializeScalarValue(value: unknown) {
  if (value === undefined || value === null) {
    return ''
  }
  if (typeof value === 'string') {
    return value
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  return JSON.stringify(value)
}

function sanitizeName(value: string | undefined, fallback: string) {
  const name = value?.trim()
  return name ? name : fallback
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFileSchema(schema: OpenApiSchema | undefined) {
  return schema?.type === 'string' && (schema.format === 'binary' || schema.format === 'base64')
}

const warningMessageByCode: Record<OpenApiImportWarningCode, string> = {
  'multiple-tags-first-used': 'Operations with multiple tags use only the first tag during import.',
  'multiple-servers-first-used': 'When multiple servers are defined, only the first server is used during import.',
  'unsupported-http-method': 'Unsupported HTTP methods are skipped during import.',
  'unsupported-security-scheme': 'Some security schemes are not supported and will not be imported as working auth configs.',
  'unsupported-content-type': 'Some request body content types are not supported and will be imported without their original body details.',
  'unsupported-parameter-location': 'Some parameter locations are not supported and will be ignored during import.',
  'callbacks-ignored': 'OpenAPI callbacks are ignored during import.',
  'webhooks-ignored': 'OpenAPI webhooks are ignored during import.',
}
