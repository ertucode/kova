import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import ts from 'typescript'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { z } from 'zod'
import type { HttpAuth } from '../common/Auth.js'
import { buildEffectiveEnvironmentOwners, buildEnvironmentVariableMap, getResolvedEnvironmentValue } from '../common/EnvironmentVariables.js'
import { parseKeyValueRows, stringifyKeyValueRows } from '../common/KeyValueRows.js'
import type { EnvironmentRecord } from '../common/Environments.js'
import type {
  RequestScriptError,
  RequestBodyType,
  RequestConsoleEntry,
  RequestConsoleLevel,
  RequestMethod,
  RequestRawType,
  ScriptResponseBody,
} from '../common/Requests.js'
import { updateEnvironmentVariables } from './db/environments.js'

const SCRIPT_TIMEOUT_MS = 500

type ScriptSource = {
  name: string
  script: string
}

type RuntimeRequestState = {
  method: RequestMethod
  url: string
  pathParams: string
  searchParams: string
  auth: HttpAuth
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
}

type HeaderApi = {
  get: (name: string) => string | null
  set: (name: string, value: string) => void
  delete: (name: string) => void
  has: (name: string) => boolean
  entries: () => Array<[string, string]>
  toObject: () => Record<string, string>
  serialize: () => string
}

type ScriptErrorDetails = {
  phase: 'pre-request' | 'post-request'
  sourceName: string
  message: string
  compactLabel: string
  compactMessage: string
  detailedMessage: string
  line: number | null
  column: number | null
  sourceLine: string | null
}

type CompiledRequestScript = {
  code: string
  sourceMap: TraceMap | null
  sourceCode: string
}

type ScriptCompilerError = {
  kind: 'compile-error'
  message: string
  line: number | null
  column: number | null
  sourceLine: string | null
}

type EnvironmentOwnerMap = Map<string, string>

type EnvironmentContext = {
  getValues: () => Record<string, string>
  getValueForEnvironment: (name: string, environmentName: string) => string | null
  hasValueForEnvironment: (name: string, environmentName: string) => boolean
  setValue: (name: string, value: string, environmentName?: string) => void
}

export type ScriptRuntime = {
  request: RuntimeRequestState
  requestScope: Map<string, string>
  getResolvedVariables: () => Record<string, string>
  getRequestScopeValues: () => Record<string, string>
  getUpdatedEnvironments: () => EnvironmentRecord[]
  getConsoleEntries: () => RequestConsoleEntry[]
  runPreRequestScripts: (sources: ScriptSource[]) => Promise<RequestScriptError[]>
  runPostRequestScripts: (
    sources: ScriptSource[],
    response: { status: number; statusText: string; headers: string; body: ScriptResponseBody }
  ) => Promise<RequestScriptError[]>
}

export function createRequestScriptRuntime(input: {
  request: RuntimeRequestState
  environments: EnvironmentRecord[]
}): ScriptRuntime {
  const requestScope = new Map<string, string>()
  const runtimeRequest: RuntimeRequestState = { ...input.request }
  let environments = input.environments
    .slice()
    .sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt)
    .map(environment => ({ ...environment }))
  let environmentValues = buildEnvironmentVariableMap(environments)
  let environmentOwners = buildEffectiveEnvironmentOwners(environments)
  let pendingEnvironmentIds = new Set<string>()
  const updatedEnvironmentIds = new Set<string>()
  const consoleEntries: RequestConsoleEntry[] = []

  return {
    request: runtimeRequest,
    requestScope,
    getResolvedVariables: () => ({ ...environmentValues, ...Object.fromEntries(requestScope.entries()) }),
    getRequestScopeValues: () => Object.fromEntries(requestScope.entries()),
    getUpdatedEnvironments: () => environments.filter(environment => updatedEnvironmentIds.has(environment.id)),
    getConsoleEntries: () => consoleEntries.slice(),
    runPreRequestScripts: async sources => {
      const snapshot = createRuntimeSnapshot({ runtimeRequest, requestScope, environments, environmentValues, environmentOwners, pendingEnvironmentIds })
      const scriptErrors = await runScriptPhase({
        phase: 'pre-request',
        sources,
        runtimeRequest,
        requestScope,
        response: null,
        environmentContext: createEnvironmentContext(),
        consoleEntries,
      })
      if (scriptErrors.length > 0) {
        ;({ environments, environmentValues, environmentOwners, pendingEnvironmentIds } = restoreRuntimeSnapshot(snapshot, runtimeRequest, requestScope))
        return scriptErrors
      }

      if (pendingEnvironmentIds.size > 0) {
        environments = await persistEnvironmentUpdates(environments, pendingEnvironmentIds)
        environmentValues = buildEnvironmentVariableMap(environments)
        environmentOwners = buildEffectiveEnvironmentOwners(environments)
        pendingEnvironmentIds.forEach(id => updatedEnvironmentIds.add(id))
        pendingEnvironmentIds = new Set<string>()
      }

      return []
    },
    runPostRequestScripts: async (sources, response) => {
      const snapshot = createRuntimeSnapshot({ runtimeRequest, requestScope, environments, environmentValues, environmentOwners, pendingEnvironmentIds })

      try {
        const scriptErrors = await runScriptPhase({
          phase: 'post-request',
          sources,
          runtimeRequest,
          requestScope,
          response,
          environmentContext: createEnvironmentContext(),
          consoleEntries,
        })
        if (scriptErrors.length > 0) {
          ;({ environments, environmentValues, environmentOwners, pendingEnvironmentIds } = restoreRuntimeSnapshot(snapshot, runtimeRequest, requestScope))
          return scriptErrors
        }

        if (pendingEnvironmentIds.size > 0) {
          environments = await persistEnvironmentUpdates(environments, pendingEnvironmentIds)
          environmentValues = buildEnvironmentVariableMap(environments)
          environmentOwners = buildEffectiveEnvironmentOwners(environments)
          pendingEnvironmentIds.forEach(id => updatedEnvironmentIds.add(id))
          pendingEnvironmentIds = new Set<string>()
        }

        return []
      } catch (error) {
        ;({ environments, environmentValues, environmentOwners, pendingEnvironmentIds } = restoreRuntimeSnapshot(snapshot, runtimeRequest, requestScope))

        return [toScriptErrorDetails(error, 'post-request')]
      }
    },
  }

  function createEnvironmentContext(): EnvironmentContext {
    return {
      getValues: () => environmentValues,
      getValueForEnvironment: (name, environmentName) => {
        const environment = findEnvironmentByName(environments, environmentName)
        if (!environment) {
          return null
        }

        return getResolvedEnvironmentValue(environment, name)
      },
      hasValueForEnvironment: (name, environmentName) => {
        const environment = findEnvironmentByName(environments, environmentName)
        if (!environment) {
          return false
        }

        return getResolvedEnvironmentValue(environment, name) !== null
      },
      setValue: (name, value, environmentName) => {
        const next = setEnvironmentValue({
          environments,
          owners: environmentOwners,
          name,
          value,
          environmentName,
        })
        environments = next.environments
        environmentOwners = next.owners
        environmentValues = next.values
        pendingEnvironmentIds.add(next.updatedEnvironmentId)
      },
    }
  }
}

function createRuntimeSnapshot(input: {
  runtimeRequest: RuntimeRequestState
  requestScope: Map<string, string>
  environments: EnvironmentRecord[]
  environmentValues: Record<string, string>
  environmentOwners: EnvironmentOwnerMap
  pendingEnvironmentIds: Set<string>
}) {
  return {
    runtimeRequest: { ...input.runtimeRequest },
    requestScope: new Map(input.requestScope),
    environments: input.environments.map(environment => ({ ...environment })),
    values: { ...input.environmentValues },
    owners: new Map(input.environmentOwners),
    pendingIds: new Set(input.pendingEnvironmentIds),
  }
}

function restoreRuntimeSnapshot(
  snapshot: ReturnType<typeof createRuntimeSnapshot>,
  runtimeRequest: RuntimeRequestState,
  requestScope: Map<string, string>
) {
  runtimeRequest.method = snapshot.runtimeRequest.method
  runtimeRequest.url = snapshot.runtimeRequest.url
  runtimeRequest.pathParams = snapshot.runtimeRequest.pathParams
  runtimeRequest.searchParams = snapshot.runtimeRequest.searchParams
  runtimeRequest.auth = snapshot.runtimeRequest.auth
  runtimeRequest.headers = snapshot.runtimeRequest.headers
  runtimeRequest.body = snapshot.runtimeRequest.body
  runtimeRequest.bodyType = snapshot.runtimeRequest.bodyType
  runtimeRequest.rawType = snapshot.runtimeRequest.rawType

  requestScope.clear()
  for (const [key, value] of snapshot.requestScope.entries()) {
    requestScope.set(key, value)
  }

  return {
    environments: snapshot.environments,
    environmentValues: snapshot.values,
    environmentOwners: snapshot.owners,
    pendingEnvironmentIds: snapshot.pendingIds,
  }
}

function toScriptErrorDetails(error: unknown, fallbackPhase: 'pre-request' | 'post-request'): ScriptErrorDetails {
  if (typeof error === 'object' && error !== null && 'sourceName' in error && 'message' in error) {
    return {
      phase: 'phase' in error && (error.phase === 'pre-request' || error.phase === 'post-request') ? error.phase : fallbackPhase,
      sourceName: String(error.sourceName),
      message: String(error.message),
      compactLabel:
        'compactLabel' in error ? String(error.compactLabel) : buildCompactScriptErrorLabel(fallbackPhase, null, null),
      compactMessage: 'compactMessage' in error ? String(error.compactMessage) : String(error.message),
      detailedMessage: 'detailedMessage' in error ? String(error.detailedMessage) : String(error.message),
      line: 'line' in error && typeof error.line === 'number' ? error.line : null,
      column: 'column' in error && typeof error.column === 'number' ? error.column : null,
      sourceLine: 'sourceLine' in error && typeof error.sourceLine === 'string' ? error.sourceLine : null,
    }
  }

  return {
    phase: fallbackPhase,
    sourceName: 'Script',
    message: error instanceof Error ? error.message : String(error),
    compactLabel: buildCompactScriptErrorLabel(fallbackPhase, null, null),
    compactMessage: error instanceof Error ? error.message : String(error),
    detailedMessage: error instanceof Error ? error.message : String(error),
    line: null,
    column: null,
    sourceLine: null,
  }
}

async function runScriptPhase(input: {
  phase: 'pre-request' | 'post-request'
  sources: ScriptSource[]
  runtimeRequest: RuntimeRequestState
  requestScope: Map<string, string>
  response: { status: number; statusText: string; headers: string; body: ScriptResponseBody } | null
  environmentContext: EnvironmentContext
  consoleEntries: RequestConsoleEntry[]
}) {
  for (const source of input.sources) {
    if (!source.script.trim()) {
      continue
    }

    const headerEditor = createHeaderEditor(input.runtimeRequest)
    const sandbox = {
      console: createScriptConsole(source.name, input.consoleEntries),
      request: createRequestApi(input.runtimeRequest, headerEditor),
      response: input.response ? createResponseApi(input.response) : undefined,
      env: createEnvironmentApi(input.environmentContext),
      scope: createScopeApi(input.requestScope),
      crypto: createCryptoApi(),
      z,
    }

    let compiledScript: CompiledRequestScript | null = null

    try {
      compiledScript = compileRequestScript(source.script)
      await executeScript(compiledScript.code, sandbox)
      input.runtimeRequest.headers = headerEditor.serialize()
    } catch (error) {
      return [buildScriptErrorDetails({
        phase: input.phase,
        sourceName: source.name,
        error,
        sourceCode: source.script,
        compiledScript,
      })]
    }
  }

  return []
}

function buildScriptErrorDetails(input: {
  phase: 'pre-request' | 'post-request'
  sourceName: string
  error: unknown
  sourceCode: string
  compiledScript: CompiledRequestScript | null
}): ScriptErrorDetails {
  const message = getScriptErrorMessage(input.error)
  const location = extractScriptLocation(input.error, input.sourceCode, input.compiledScript)
  const compactLabel = buildCompactScriptErrorLabel(input.phase, location?.line ?? null, location?.column ?? null)
  const detailedLines = [`Source: ${input.sourceName}`, `Phase: ${formatScriptPhase(input.phase)}`]

  if (location?.line !== undefined && location.line !== null) {
    detailedLines.push(
      location.column !== null ? `Location: line ${location.line}, column ${location.column}` : `Location: line ${location.line}`
    )
  }

  if (location?.sourceLine) {
    detailedLines.push(`Code: ${location.sourceLine}`)
  }

  detailedLines.push(`Error: ${message}`)

  return {
    phase: input.phase,
    sourceName: input.sourceName,
    message,
    compactLabel,
    compactMessage: message,
    detailedMessage: detailedLines.join('\n'),
    line: location?.line ?? null,
    column: location?.column ?? null,
    sourceLine: location?.sourceLine ?? null,
  }
}

function buildCompactScriptErrorLabel(
  phase: 'pre-request' | 'post-request',
  line: number | null,
  column: number | null
) {
  if (line === null) {
    return formatScriptPhase(phase)
  }

  return column === null ? `${formatScriptPhase(phase)}:${line}` : `${formatScriptPhase(phase)}:${line}:${column}`
}

function formatScriptPhase(phase: 'pre-request' | 'post-request') {
  return phase === 'pre-request' ? 'Pre-request' : 'Post-request'
}

function extractScriptLocation(error: unknown, sourceCode: string, compiledScript: CompiledRequestScript | null) {
  if (isScriptCompilerError(error)) {
    return {
      line: error.line,
      column: error.column,
      sourceLine: error.sourceLine,
    }
  }

  const stack = getScriptErrorStack(error)
  if (!stack) {
    return null
  }

  const runtimeMatch = stack.match(/request-script\.js:(\d+):(\d+)/)
  const syntaxMatch = stack.match(/request-script\.js:(\d+)(?!:)/)

  const rawLine = Number(runtimeMatch?.[1] ?? syntaxMatch?.[1])
  if (!Number.isFinite(rawLine)) {
    return null
  }

  const rawColumn = runtimeMatch ? Number(runtimeMatch[2]) : extractSyntaxErrorColumn(stack)
  const generatedLine = Math.max(1, rawLine - 1)
  const generatedColumn = typeof rawColumn === 'number' && Number.isFinite(rawColumn) ? Math.max(1, rawColumn) : null

  if (compiledScript?.sourceMap) {
    const originalPosition = originalPositionFor(compiledScript.sourceMap, {
      line: generatedLine,
      column: Math.max(0, (generatedColumn ?? 1) - 1),
    })

    if (originalPosition.line !== null) {
      const line = originalPosition.line
      const column = originalPosition.column === null ? null : originalPosition.column + 1
      const sourceLine = sourceCode.split('\n')[line - 1]?.trimEnd() ?? null

      return {
        line,
        column,
        sourceLine,
      }
    }
  }

  const line = generatedLine
  const column = generatedColumn
  const sourceLine = sourceCode.split('\n')[line - 1]?.trimEnd() ?? null

  return {
    line,
    column,
    sourceLine,
  }
}

function extractSyntaxErrorColumn(stack: string) {
  const lines = stack.split('\n')
  for (const line of lines) {
    const caretIndex = line.indexOf('^')
    if (caretIndex >= 0) {
      return caretIndex + 1
    }
  }

  return null
}

function getScriptErrorMessage(error: unknown) {
  if (isScriptCompilerError(error)) {
    return error.message
  }

  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }

  return String(error)
}

function getScriptErrorStack(error: unknown) {
  if (typeof error === 'object' && error !== null && 'stack' in error && typeof error.stack === 'string') {
    return error.stack
  }

  return null
}

function compileRequestScript(sourceCode: string): CompiledRequestScript {
  const result = ts.transpileModule(sourceCode, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      sourceMap: true,
      inlineSources: true,
      noImplicitAny: false,
      strict: true,
    },
    fileName: 'request-script.ts',
    reportDiagnostics: true,
  })

  const diagnostics = (result.diagnostics ?? []).filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
  if (diagnostics.length > 0) {
    throw toScriptCompilerError(diagnostics[0], sourceCode)
  }

  return {
    code: result.outputText,
    sourceMap: result.sourceMapText ? new TraceMap(result.sourceMapText) : null,
    sourceCode,
  }
}

function toScriptCompilerError(diagnostic: ts.Diagnostic, sourceCode: string): ScriptCompilerError {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  const location =
    diagnostic.file && typeof diagnostic.start === 'number'
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : null
  const line = location ? location.line + 1 : null
  const column = location ? location.character + 1 : null
  const sourceLine = line ? sourceCode.split('\n')[line - 1]?.trimEnd() ?? null : null

  return {
    kind: 'compile-error',
    message,
    line,
    column,
    sourceLine,
  }
}

function isScriptCompilerError(error: unknown): error is ScriptCompilerError {
  return typeof error === 'object' && error !== null && 'kind' in error && error.kind === 'compile-error'
}

function createCryptoApi() {
  return {
    randomUUID,
  }
}

function createScriptConsole(sourceName: string, consoleEntries: RequestConsoleEntry[]) {
  return {
    log: (...values: unknown[]) => pushConsoleEntry(consoleEntries, sourceName, 'log', values),
    info: (...values: unknown[]) => pushConsoleEntry(consoleEntries, sourceName, 'info', values),
    warn: (...values: unknown[]) => pushConsoleEntry(consoleEntries, sourceName, 'warn', values),
    error: (...values: unknown[]) => pushConsoleEntry(consoleEntries, sourceName, 'error', values),
    debug: (...values: unknown[]) => pushConsoleEntry(consoleEntries, sourceName, 'debug', values),
  }
}

function pushConsoleEntry(
  consoleEntries: RequestConsoleEntry[],
  sourceName: string,
  level: RequestConsoleLevel,
  values: unknown[]
) {
  consoleEntries.push({
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    level,
    sourceName,
    message: values.map(formatConsoleValue).join(' '),
  })
}

function formatConsoleValue(value: unknown) {
  if (typeof value === 'string') {
    return value
  }

  if (value instanceof Error) {
    return value.stack ?? value.message
  }

  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return Object.prototype.toString.call(value)
    }
  }

  return String(value)
}

function createRequestApi(runtimeRequest: RuntimeRequestState, headers: HeaderApi) {
  return {
    get method() {
      return runtimeRequest.method
    },
    set method(value: RequestMethod) {
      runtimeRequest.method = value
    },
    get url() {
      return runtimeRequest.url
    },
    set url(value: string) {
      runtimeRequest.url = value
    },
    get body() {
      return runtimeRequest.body
    },
    set body(value: string) {
      runtimeRequest.body = value
    },
    get bodyType() {
      return runtimeRequest.bodyType
    },
    get rawType() {
      return runtimeRequest.rawType
    },
    headers,
  }
}

function createResponseApi(response: { status: number; statusText: string; headers: string; body: ScriptResponseBody }) {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: parseResponseHeaders(response.headers),
    body: response.body,
  }
}

function createEnvironmentApi(environmentContext: EnvironmentContext) {
  return {
    get(name: string, environmentName?: string) {
      if (environmentName) {
        return environmentContext.getValueForEnvironment(name, environmentName)
      }

      return environmentContext.getValues()[name] ?? null
    },
    has(name: string, environmentName?: string) {
      if (environmentName) {
        return environmentContext.hasValueForEnvironment(name, environmentName)
      }

      return name in environmentContext.getValues()
    },
    set(name: string, value: string, environmentName?: string) {
      environmentContext.setValue(name, value, environmentName)
    },
  }
}

function createScopeApi(requestScope: Map<string, string>) {
  return {
    get(name: string) {
      return requestScope.get(name) ?? null
    },
    has(name: string) {
      return requestScope.has(name)
    },
    set(name: string, value: string) {
      requestScope.set(name, value)
    },
  }
}

async function executeScript(code: string, sandbox: Record<string, unknown>) {
  const context = vm.createContext(sandbox, {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  })

  const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: 'request-script.js' })
  const result = script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS })

  await Promise.race([
    Promise.resolve(result),
    new Promise((_, reject) => {
      setTimeout(() => reject(new Error(`Script execution timed out after ${SCRIPT_TIMEOUT_MS}ms`)), SCRIPT_TIMEOUT_MS)
    }),
  ])
}

function createHeaderEditor(runtimeRequest: RuntimeRequestState): HeaderApi {
  let rows = parseKeyValueRows(runtimeRequest.headers)

  return {
    get(name) {
      const row = rows.find(item => item.enabled && item.key.trim().toLowerCase() === name.trim().toLowerCase())
      return row?.value ?? null
    },
    set(name, value) {
      const normalizedName = name.trim()
      const existingIndex = rows.findIndex(item => item.key.trim().toLowerCase() === normalizedName.toLowerCase())
      if (existingIndex >= 0) {
        rows = rows.map((row, index) =>
          index === existingIndex ? { ...row, enabled: true, key: normalizedName, value, description: row.description } : row
        )
        return
      }

      rows = [...rows, { id: crypto.randomUUID(), enabled: true, key: normalizedName, value, description: '' }]
    },
    delete(name) {
      rows = rows.filter(item => item.key.trim().toLowerCase() !== name.trim().toLowerCase())
    },
    has(name) {
      return rows.some(item => item.enabled && item.key.trim().toLowerCase() === name.trim().toLowerCase())
    },
    entries() {
      return rows.filter(item => item.enabled).map(item => [item.key, item.value] satisfies [string, string])
    },
    toObject() {
      return Object.fromEntries(rows.filter(item => item.enabled).map(item => [item.key, item.value]))
    },
    serialize() {
      return stringifyKeyValueRows(rows)
    },
  }
}

function parseResponseHeaders(headers: string) {
  return Object.fromEntries(
    headers
      .split('\n')
      .map(line => {
        const separatorIndex = line.indexOf(':')
        if (separatorIndex < 0) {
          return null
        }

        return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()] satisfies [string, string]
      })
      .filter((entry): entry is [string, string] => entry !== null)
  )
}

function setEnvironmentValue(input: {
  environments: EnvironmentRecord[]
  owners: EnvironmentOwnerMap
  name: string
  value: string
  environmentName?: string
}) {
  const updatedEnvironmentId = input.environmentName
    ? findEnvironmentByName(input.environments, input.environmentName)?.id
    : (input.owners.get(input.name) ?? input.environments[0]?.id)

  if (!updatedEnvironmentId) {
    throw new Error(
      input.environmentName
        ? `Active environment "${input.environmentName}" was not found for env.set`
        : 'No active environment is available for env.set'
    )
  }

  const environments = input.environments.map(environment => {
    if (environment.id !== updatedEnvironmentId) {
      return environment
    }

    const rows = parseKeyValueRows(environment.variables)
    const existingIndex = rows.findIndex(row => row.enabled && row.key.trim() === input.name)
    const nextRows =
      existingIndex >= 0
        ? rows.map((row, index) => (index === existingIndex ? { ...row, value: input.value } : row))
        : [...rows, { id: crypto.randomUUID(), enabled: true, key: input.name, value: input.value, description: '' }]

    return {
      ...environment,
      variables: stringifyKeyValueRows(nextRows),
    }
  })

  return {
    environments,
    owners: buildEffectiveEnvironmentOwners(environments),
    values: buildEnvironmentVariableMap(environments),
    updatedEnvironmentId,
  }
}

function findEnvironmentByName(environments: EnvironmentRecord[], environmentName: string) {
  const normalizedName = environmentName.trim()
  return (
    environments.find(environment => environment.name.trim() === normalizedName) ??
    environments.find(environment => environment.name.trim().toLowerCase() === normalizedName.toLowerCase()) ??
    null
  )
}


async function persistEnvironmentUpdates(environments: EnvironmentRecord[], pendingEnvironmentIds: Set<string>) {
  const updatedById = new Map<string, EnvironmentRecord>()

  for (const environment of environments) {
    if (!pendingEnvironmentIds.has(environment.id)) {
      continue
    }

    const updated = await updateEnvironmentVariables({ id: environment.id, variables: environment.variables })
    updatedById.set(updated.id, updated)
  }

  return environments.map(environment => updatedById.get(environment.id) ?? environment)
}
