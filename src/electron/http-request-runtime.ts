import { getAuthHeaders, getAuthQueryParams, getAuthVariableSources, resolveAuth, resolveInheritedAuth, type HttpAuth } from '../common/Auth.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { normalizeJson5ToJson } from '../common/Json5.js'
import { parseKeyValueRows } from '../common/KeyValueRows.js'
import { applyPathParamsToUrl, applySearchParamsToUrl } from '../common/PathParams.js'
import { findMissingTemplateVariables, resolveTemplateVariables } from '../common/RequestVariables.js'
import type { RequestMethod, RequestRawType, SendRequestInput } from '../common/Requests.js'
import { Result } from '../common/Result.js'
import { getEnvironmentsByIds } from './db/environments.js'
import { getRequestParentFolderId } from './db/explorer.js'
import { getFolderAncestorChain } from './db/folders.js'
import { getRequest } from './db/requests.js'
import { createRequestScriptRuntime, type ScriptRuntime } from './request-script-runner.js'

const REQUEST_METHODS: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']

export type ResolvedRequestBody =
  | { kind: 'none' }
  | { kind: 'raw'; value: string }
  | { kind: 'form-data'; entries: Array<{ key: string; value: string }> }
  | { kind: 'x-www-form-urlencoded'; entries: Array<{ key: string; value: string }>; serialized: string }

export type PreparedHttpRequest = {
  requestId: string
  requestName: string
  runtime: ScriptRuntime
  variables: Record<string, string>
  method: RequestMethod
  url: string
  headers: Headers
  resolvedBody: ResolvedRequestBody
  requestBody: {
    body: BodyInit | undefined
    preview: string
  }
  postRequestScriptSources: Array<{ name: string; script: string }>
}

export async function prepareHttpRequest(input: SendRequestInput): Promise<GenericResult<PreparedHttpRequest>> {
  const requestResult = await getRequest({ id: input.requestId })
  if (!requestResult.success) {
    return requestResult
  }

  const [activeEnvironments, parentFolderId] = await Promise.all([
    getEnvironmentsByIds(input.activeEnvironmentIds),
    getRequestParentFolderId(input.requestId),
  ])

  if (requestResult.data.requestType !== 'http') {
    return GenericError.Message('Use the WebSocket connect flow for websocket requests')
  }

  const folders = await getFolderAncestorChain(parentFolderId)
  const runtime = createRequestScriptRuntime({
    request: {
      method: input.method,
      url: input.url,
      pathParams: input.pathParams,
      searchParams: input.searchParams,
      auth: input.auth,
      headers: mergeHeaderRows(folders.map(folder => folder.headers), input.headers),
      body: input.body,
      bodyType: input.bodyType,
      rawType: input.rawType,
    },
    environments: activeEnvironments,
  })

  await runtime.runPreRequestScripts([
    ...folders.map(folder => ({ name: `Folder: ${folder.name}`, script: folder.preRequestScript })),
    { name: `Request: ${requestResult.data.name}`, script: input.preRequestScript },
  ])

  const variables = runtime.getResolvedVariables()
  const missingVariables = collectMissingVariables(runtime.request, variables)
  if (missingVariables.length > 0) {
    return GenericError.Message(`Missing environment variables: ${missingVariables.join(', ')}. Define them before sending the request.`)
  }

  const urlWithTemplatesResolved = resolveTemplateVariables(runtime.request.url, variables).trim()
  const resolvedPathParams = resolveTemplateVariables(runtime.request.pathParams, variables)
  const { url: urlWithPathParams, missingNames: missingPathParamNames } = applyPathParamsToUrl(urlWithTemplatesResolved, resolvedPathParams)
  if (missingPathParamNames.length > 0) {
    return GenericError.Message(`Path variable values are required: ${missingPathParamNames.join(', ')}. Fill them in before sending the request.`)
  }

  const effectiveAuth = resolveInheritedAuth(folders.map(folder => folder.auth), runtime.request.auth)
  const missingAuthVariables = getAuthVariableSources(effectiveAuth).flatMap(source => findMissingTemplateVariables(source, variables))
  if (missingAuthVariables.length > 0) {
    return GenericError.Message(
      `Missing environment variables: ${Array.from(new Set(missingAuthVariables)).join(', ')}. Define them before sending the request.`
    )
  }

  const resolvedAuth = resolveAuth(effectiveAuth, variables)
  const url = applyAuthToUrl(applySearchParamsToUrl(urlWithPathParams, runtime.request.searchParams, variables), resolvedAuth)
  if (!url) {
    return GenericError.Message('Request URL is required')
  }

  try {
    new URL(url)
  } catch {
    return GenericError.Message('Request URL is invalid')
  }

  if (!REQUEST_METHODS.includes(runtime.request.method)) {
    return GenericError.Message('Invalid request method')
  }

  const headers = new Headers()
  applyAuthHeaders(headers, resolvedAuth)
  applyResolvedHeaders(headers, parseKeyValueRows(runtime.request.headers), variables)

  const resolvedBodyResult = buildResolvedRequestBody(runtime.request, variables)
  if (!resolvedBodyResult.success) {
    return resolvedBodyResult
  }

  const resolvedBody = resolvedBodyResult.data
  applyDefaultBodyHeaders(headers, runtime.request.rawType, resolvedBody)

  return Result.Success({
    requestId: input.requestId,
    requestName: requestResult.data.name,
    runtime,
    variables,
    method: runtime.request.method,
    url,
    headers,
    resolvedBody,
    requestBody: buildRuntimeRequestBody(resolvedBody),
    postRequestScriptSources: [
      { name: `Request: ${requestResult.data.name}`, script: input.postRequestScript },
      ...folders
        .slice()
        .reverse()
        .map(folder => ({ name: `Folder: ${folder.name}`, script: folder.postRequestScript })),
    ],
  })
}

export function buildCurlCommand(input: Pick<PreparedHttpRequest, 'method' | 'url' | 'headers' | 'resolvedBody'>) {
  const parts = ['curl']

  if (input.method !== 'GET') {
    parts.push(`--request ${shellQuote(input.method)}`)
  }

  for (const [key, value] of input.headers.entries()) {
    parts.push(`--header ${shellQuote(`${key}: ${value}`)}`)
  }

  switch (input.resolvedBody.kind) {
    case 'none':
      break
    case 'raw':
      parts.push(`--data-raw ${shellQuote(input.resolvedBody.value)}`)
      break
    case 'x-www-form-urlencoded':
      parts.push(`--data-raw ${shellQuote(input.resolvedBody.serialized)}`)
      break
    case 'form-data':
      for (const entry of input.resolvedBody.entries) {
        parts.push(`--form ${shellQuote(`${entry.key}=${entry.value}`)}`)
      }
      break
  }

  parts.push(shellQuote(input.url))

  return parts.join(' \\\n+  ')
}

export function buildFetchSnippet(input: Pick<PreparedHttpRequest, 'method' | 'url' | 'headers' | 'resolvedBody'>) {
  const optionLines = [
    `method: ${serializeJsString(input.method)}`,
    `headers: ${formatJsObject(Array.from(input.headers.entries()))}`,
  ]
  let setup = ''

  switch (input.resolvedBody.kind) {
    case 'none':
      break
    case 'raw':
      optionLines.push(`body: ${serializeJsString(input.resolvedBody.value)}`)
      break
    case 'x-www-form-urlencoded':
      setup = [
        'const searchParams = new URLSearchParams()',
        ...input.resolvedBody.entries.map(entry => `searchParams.append(${serializeJsString(entry.key)}, ${serializeJsString(entry.value)})`),
        '',
      ].join('\n')
      optionLines.push('body: searchParams')
      break
    case 'form-data':
      setup = [
        'const formData = new FormData()',
        ...input.resolvedBody.entries.map(entry => `formData.append(${serializeJsString(entry.key)}, ${serializeJsString(entry.value)})`),
        '',
      ].join('\n')
      optionLines.push('body: formData')
      break
  }

  return [
    setup,
    `const response = await fetch(${serializeJsString(input.url)}, {`,
    ...optionLines.map(line => `  ${line},`),
    '})',
    '',
    'const data = await response.text()',
    'console.log(data)',
  ].filter(Boolean).join('\n')
}

function buildResolvedRequestBody(
  input: Pick<SendRequestInput, 'bodyType' | 'body' | 'rawType'>,
  variables: Record<string, string>
): GenericResult<ResolvedRequestBody> {
  switch (input.bodyType) {
    case 'none':
      return Result.Success({ kind: 'none' })
    case 'raw': {
      const resolvedBody = resolveTemplateVariables(input.body, variables)

      if (input.rawType !== 'json') {
        return Result.Success({ kind: 'raw', value: resolvedBody })
      }

      try {
        return Result.Success({ kind: 'raw', value: normalizeJson5ToJson(resolvedBody) })
      } catch (error) {
        return GenericError.Message(getInvalidJsonBodyMessage(error))
      }
    }
    case 'form-data': {
      const entries = resolveKeyValueEntries(input.body, variables)
      return Result.Success({ kind: 'form-data', entries })
    }
    case 'x-www-form-urlencoded': {
      const entries = resolveKeyValueEntries(input.body, variables)
      const searchParams = new URLSearchParams()
      for (const entry of entries) {
        searchParams.append(entry.key, entry.value)
      }
      return Result.Success({ kind: 'x-www-form-urlencoded', entries, serialized: searchParams.toString() })
    }
  }
}

function getInvalidJsonBodyMessage(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return `Invalid JSON body: ${error.message.trim()}`
  }

  return 'Invalid JSON body'
}

function buildRuntimeRequestBody(input: ResolvedRequestBody) {
  switch (input.kind) {
    case 'none':
      return { body: undefined, preview: '' }
    case 'raw':
      return { body: input.value, preview: input.value }
    case 'form-data': {
      const formData = new FormData()
      for (const entry of input.entries) {
        formData.append(entry.key, entry.value)
      }
      return {
        body: formData,
        preview: input.entries.map(entry => `${entry.key}: ${entry.value}`).join('\n'),
      }
    }
    case 'x-www-form-urlencoded':
      return {
        body: new URLSearchParams(input.serialized),
        preview: input.serialized,
      }
  }
}

function resolveKeyValueEntries(value: string, variables: Record<string, string>) {
  return parseKeyValueRows(value)
    .map(row => ({
      enabled: row.enabled,
      key: resolveTemplateVariables(row.key, variables).trim(),
      value: resolveTemplateVariables(row.value, variables),
    }))
    .filter(row => row.enabled && row.key)
    .map(row => ({ key: row.key, value: row.value }))
}

function collectMissingVariables(
  input: Pick<SendRequestInput, 'url' | 'pathParams' | 'searchParams' | 'auth' | 'headers' | 'body' | 'bodyType'>,
  variables: Record<string, string>
) {
  const missingVariables = new Set<string>()

  for (const variableName of findMissingTemplateVariables(input.url, variables)) {
    missingVariables.add(variableName)
  }

  for (const row of parseKeyValueRows(input.pathParams)) {
    if (!row.enabled) {
      continue
    }

    for (const variableName of findMissingTemplateVariables(row.value, variables)) {
      missingVariables.add(variableName)
    }
  }

  for (const row of parseKeyValueRows(input.searchParams)) {
    if (!row.enabled) {
      continue
    }

    for (const variableName of findMissingTemplateVariables(row.key, variables)) {
      missingVariables.add(variableName)
    }

    for (const variableName of findMissingTemplateVariables(row.value, variables)) {
      missingVariables.add(variableName)
    }
  }

  for (const source of getAuthVariableSources(input.auth)) {
    for (const variableName of findMissingTemplateVariables(source, variables)) {
      missingVariables.add(variableName)
    }
  }

  for (const row of parseKeyValueRows(input.headers)) {
    if (!row.enabled) {
      continue
    }

    for (const variableName of findMissingTemplateVariables(row.key, variables)) {
      missingVariables.add(variableName)
    }

    for (const variableName of findMissingTemplateVariables(row.value, variables)) {
      missingVariables.add(variableName)
    }
  }

  if (input.bodyType === 'raw') {
    for (const variableName of findMissingTemplateVariables(input.body, variables)) {
      missingVariables.add(variableName)
    }
  }

  if (input.bodyType === 'form-data' || input.bodyType === 'x-www-form-urlencoded') {
    for (const row of parseKeyValueRows(input.body)) {
      if (!row.enabled) {
        continue
      }

      for (const variableName of findMissingTemplateVariables(row.key, variables)) {
        missingVariables.add(variableName)
      }

      for (const variableName of findMissingTemplateVariables(row.value, variables)) {
        missingVariables.add(variableName)
      }
    }
  }

  return Array.from(missingVariables).sort((left, right) => left.localeCompare(right))
}

function applyResolvedHeaders(headers: Headers, rows: ReturnType<typeof parseKeyValueRows>, variables: Record<string, string>) {
  for (const row of rows) {
    const key = resolveTemplateVariables(row.key, variables).trim()
    if (!row.enabled || !key) {
      continue
    }

    headers.set(key, resolveTemplateVariables(row.value, variables))
  }
}

function applyAuthHeaders(headers: Headers, auth: HttpAuth) {
  for (const entry of getAuthHeaders(auth)) {
    headers.set(entry.key, entry.value)
  }
}

function applyAuthToUrl(url: string, auth: HttpAuth) {
  const entries = getAuthQueryParams(auth)
  if (entries.length === 0) {
    return url
  }

  const nextUrl = new URL(url)
  for (const entry of entries) {
    nextUrl.searchParams.set(entry.key, entry.value)
  }

  return nextUrl.toString()
}

function mergeHeaderRows(folderHeaders: string[], requestHeaders: string) {
  const mergedRows: Array<{ key: string; value: string; enabled: boolean }> = []

  const pushRows = (value: string) => {
    for (const row of parseKeyValueRows(value)) {
      const key = row.key.trim()
      if (!row.enabled || !key) {
        continue
      }

      const existingIndex = mergedRows.findIndex(entry => entry.key.toLowerCase() === key.toLowerCase())
      const nextEntry = { key: row.key, value: row.value, enabled: row.enabled }
      if (existingIndex >= 0) {
        mergedRows[existingIndex] = nextEntry
      } else {
        mergedRows.push(nextEntry)
      }
    }
  }

  for (const value of folderHeaders) {
    pushRows(value)
  }

  pushRows(requestHeaders)

  return mergedRows.map(row => `${row.key}:${row.value}`).join('\n')
}

function applyDefaultBodyHeaders(headers: Headers, rawType: RequestRawType, resolvedBody: ResolvedRequestBody) {
  if (headers.has('content-type')) {
    return
  }

  if (resolvedBody.kind === 'raw' && resolvedBody.value) {
    headers.set('content-type', rawType === 'json' ? 'application/json' : 'text/plain')
  }

  if (resolvedBody.kind === 'x-www-form-urlencoded') {
    headers.set('content-type', 'application/x-www-form-urlencoded')
  }
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function serializeJsString(value: string) {
  return JSON.stringify(value)
}

function formatJsObject(entries: Array<[string, string]>) {
  if (entries.length === 0) {
    return '{}'
  }

  return [
    '{',
    ...entries.map(([key, value]) => `    ${JSON.stringify(key)}: ${JSON.stringify(value)},`),
    '  }',
  ].join('\n')
}
