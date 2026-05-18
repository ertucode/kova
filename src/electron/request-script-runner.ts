import vm from 'node:vm'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { originalPositionFor, TraceMap } from '@jridgewell/trace-mapping'
import { z } from 'zod'
import { getAuthQueryParams, resolveAuth, type HttpAuth } from '../common/Auth.js'
import { buildEffectiveEnvironmentOwners, buildEnvironmentVariableMap, getResolvedEnvironmentValue } from '../common/EnvironmentVariables.js'
import { parseKeyValueRows, stringifyKeyValueRows, type KeyValueRow } from '../common/KeyValueRows.js'
import { applyPathParamsToUrl, applySearchParamsToUrl } from '../common/PathParams.js'
import { resolveTemplateExpressions as resolveTemplateExpressionTokens, resolveTemplateVariables } from '../common/RequestVariables.js'
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
import type { SharedScriptRecord } from '../common/SharedScripts.js'
import type { ScriptPromptTextOptions } from '../common/ScriptPrompt.js'
import { createScriptClipboardApi, type ScriptClipboardBridge } from './script-clipboard.js'
import { splitCombinedSetCookieHeader } from './db/cookies.js'
import {
  createScriptCallRequestApi,
  createScriptMakeRequestApi,
  type ScriptMakeRequestBridge,
} from './script-make-request.js'
import { createScriptPromptApi, type ScriptExecutionPauseController, type ScriptPromptBridge } from './script-prompt.js'
import { createScriptToastApi, type ScriptToastBridge } from './script-toast.js'
import { updateEnvironmentVariables } from './db/environments.js'
import type { CookieSameSite } from '../common/Cookies.js'
import { parseScriptPackageSpecifier } from '../common/ScriptPackages.js'

const SCRIPT_TIMEOUT_MS = 500

type ScriptSource = {
  name: string
  script: string
  globalBindings?: string[]
}

type CallRequestApi = ReturnType<typeof createScriptCallRequestApi>

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

type ScriptPathParam = {
  key: string
  value: string
  enabled: boolean
  description: string
}

type RequestApi = {
  method: RequestMethod
  url: string
  readonly bodyType: RequestBodyType
  readonly rawType: RequestRawType
  body: string
  pathParams: ScriptPathParam[]
  resolveUrl: () => string
  headers: HeaderApi
}

type RuntimeResponseState = {
  status: number
  statusText: string
  headers: string
  body: ScriptResponseBody
}

type RuntimeResponseApiState = {
  status: number
  statusText: string
  headers: HeaderApi
  body: ScriptResponseBody
}

type ScriptCookie = {
  name: string
  value: string
  domain: string | null
  path: string | null
  secure: boolean
  httpOnly: boolean
  sameSite: CookieSameSite | null
  expires: string | null
  maxAge: number | null
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

export type ScriptRuntimePackage = {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
  cacheDirectory: string | null
}

export type ScriptRuntime = {
  request: RuntimeRequestState
  requestScope: Map<string, string>
  getResolvedVariables: () => Record<string, string>
  getRequestScopeValues: () => Record<string, string>
  getUpdatedEnvironments: () => EnvironmentRecord[]
  getConsoleEntries: () => RequestConsoleEntry[]
   resolveTemplateExpressions: (value: string, sourceName: string) => Promise<string>
   resolveHttpAuthTemplateExpressions: (auth: HttpAuth, sourceName: string) => Promise<HttpAuth>
   resolveRequestTemplateExpressions: () => Promise<void>
  runPreRequestScripts: (sources: ScriptSource[]) => Promise<RequestScriptError[]>
  runPostRequestScripts: (
    sources: ScriptSource[],
    response: RuntimeResponseState
  ) => Promise<RequestScriptError[]>
}

export function createRequestScriptRuntime(input: {
  request: RuntimeRequestState
  environments: EnvironmentRecord[]
  sharedScripts?: SharedScriptRecord[]
  scriptPackages?: ScriptRuntimePackage[]
  toast?: ScriptToastBridge
  prompt?: ScriptPromptBridge
  clipboard?: ScriptClipboardBridge
  makeRequest?: ScriptMakeRequestBridge
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
    resolveTemplateExpressions: (value, sourceName) =>
      resolveTemplateExpressionTokens(value, expressionSource =>
        evaluateTemplateExpression({
          sourceName,
          expressionSource,
          runtimeRequest,
          requestScope,
          response: null,
          environmentContext: createEnvironmentContext(),
          consoleEntries,
          sharedScripts: input.sharedScripts ?? [],
          scriptPackages: input.scriptPackages ?? [],
          promptBridge: input.prompt,
          clipboardBridge: input.clipboard,
        })
      ),
    resolveHttpAuthTemplateExpressions: (auth, sourceName) =>
      resolveHttpAuthExpressions(auth, (value, fieldName) =>
        resolveTemplateExpressionTokens(value, expressionSource =>
          evaluateTemplateExpression({
            sourceName: `${sourceName} ${fieldName}`,
            expressionSource,
            runtimeRequest,
            requestScope,
            response: null,
            environmentContext: createEnvironmentContext(),
            consoleEntries,
            sharedScripts: input.sharedScripts ?? [],
            scriptPackages: input.scriptPackages ?? [],
            promptBridge: input.prompt,
            clipboardBridge: input.clipboard,
          })
        )
      ),
    resolveRequestTemplateExpressions: async () => {
      runtimeRequest.url = await resolveTemplateExpressionTokens(runtimeRequest.url, expressionSource =>
        evaluateTemplateExpression({
          sourceName: 'Request URL',
          expressionSource,
          runtimeRequest,
          requestScope,
          response: null,
          environmentContext: createEnvironmentContext(),
          consoleEntries,
          sharedScripts: input.sharedScripts ?? [],
          scriptPackages: input.scriptPackages ?? [],
          promptBridge: input.prompt,
          clipboardBridge: input.clipboard,
        })
      )
      runtimeRequest.pathParams = await resolveTemplateExpressionTokens(runtimeRequest.pathParams, expressionSource =>
        evaluateTemplateExpression({
          sourceName: 'Request Path Params',
          expressionSource,
          runtimeRequest,
          requestScope,
          response: null,
          environmentContext: createEnvironmentContext(),
          consoleEntries,
          sharedScripts: input.sharedScripts ?? [],
          scriptPackages: input.scriptPackages ?? [],
          promptBridge: input.prompt,
          clipboardBridge: input.clipboard,
        })
      )
      runtimeRequest.searchParams = await resolveTemplateExpressionTokens(runtimeRequest.searchParams, expressionSource =>
        evaluateTemplateExpression({
          sourceName: 'Request Search Params',
          expressionSource,
          runtimeRequest,
          requestScope,
          response: null,
          environmentContext: createEnvironmentContext(),
          consoleEntries,
          sharedScripts: input.sharedScripts ?? [],
          scriptPackages: input.scriptPackages ?? [],
          promptBridge: input.prompt,
        })
      )
      runtimeRequest.auth = await resolveHttpAuthExpressions(runtimeRequest.auth, (value, fieldName) =>
        resolveTemplateExpressionTokens(value, expressionSource =>
          evaluateTemplateExpression({
            sourceName: `Request Auth ${fieldName}`,
            expressionSource,
            runtimeRequest,
            requestScope,
            response: null,
            environmentContext: createEnvironmentContext(),
            consoleEntries,
            sharedScripts: input.sharedScripts ?? [],
            scriptPackages: input.scriptPackages ?? [],
            promptBridge: input.prompt,
            clipboardBridge: input.clipboard,
          })
        )
      )
      runtimeRequest.headers = await resolveTemplateExpressionTokens(runtimeRequest.headers, expressionSource =>
        evaluateTemplateExpression({
          sourceName: 'Request Headers',
          expressionSource,
          runtimeRequest,
          requestScope,
          response: null,
          environmentContext: createEnvironmentContext(),
          consoleEntries,
          sharedScripts: input.sharedScripts ?? [],
          scriptPackages: input.scriptPackages ?? [],
          promptBridge: input.prompt,
          clipboardBridge: input.clipboard,
        })
      )
      runtimeRequest.body = await resolveTemplateExpressionTokens(runtimeRequest.body, expressionSource =>
        evaluateTemplateExpression({
          sourceName: 'Request Body',
          expressionSource,
          runtimeRequest,
          requestScope,
          response: null,
          environmentContext: createEnvironmentContext(),
          consoleEntries,
          sharedScripts: input.sharedScripts ?? [],
          scriptPackages: input.scriptPackages ?? [],
          promptBridge: input.prompt,
          clipboardBridge: input.clipboard,
        })
      )
    },
    runPreRequestScripts: async sources => {
      const snapshot = createRuntimeSnapshot({ runtimeRequest, requestScope, environments, environmentValues, environmentOwners, pendingEnvironmentIds })
        const scriptErrors = await runScriptPhase({
          phase: 'pre-request',
          sources,
          sharedScripts: input.sharedScripts ?? [],
          runtimeRequest,
          requestScope,
          response: null,
          environmentContext: createEnvironmentContext(),
          consoleEntries,
          toastBridge: input.toast,
          promptBridge: input.prompt,
          clipboardBridge: input.clipboard,
          makeRequestBridge: input.makeRequest,
          scriptPackages: input.scriptPackages ?? [],
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
      const responseHeaders = createResponseHeaderEditor(response.headers)

      try {
        const scriptErrors = await runScriptPhase({
          phase: 'post-request',
          sources,
          sharedScripts: input.sharedScripts ?? [],
          runtimeRequest,
          requestScope,
          response: {
            ...response,
            headers: responseHeaders,
          },
          environmentContext: createEnvironmentContext(),
          consoleEntries,
          toastBridge: input.toast,
          promptBridge: input.prompt,
          clipboardBridge: input.clipboard,
          makeRequestBridge: input.makeRequest,
          scriptPackages: input.scriptPackages ?? [],
        })
        if (scriptErrors.length > 0) {
          ;({ environments, environmentValues, environmentOwners, pendingEnvironmentIds } = restoreRuntimeSnapshot(snapshot, runtimeRequest, requestScope))
          return scriptErrors
        }

        response.headers = responseHeaders.serialize()

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
  sharedScripts: SharedScriptRecord[]
  scriptPackages: ScriptRuntimePackage[]
  runtimeRequest: RuntimeRequestState
  requestScope: Map<string, string>
  response: RuntimeResponseApiState | null
  environmentContext: EnvironmentContext
  consoleEntries: RequestConsoleEntry[]
  toastBridge?: ScriptToastBridge
  promptBridge?: ScriptPromptBridge
  clipboardBridge?: ScriptClipboardBridge
  makeRequestBridge?: ScriptMakeRequestBridge
}) {
  const headerEditor = createHeaderEditor(input.runtimeRequest)
  const currentSourceName = { value: 'Script' }
  const currentPrompt = { value: createScriptPromptApi(input.promptBridge, createIdleScriptExecutionController()) }
  const currentMakeRequest = {
    value: createScriptMakeRequestApi(input.makeRequestBridge, createIdleScriptExecutionController()),
  }
  const currentCallRequest = {
    value: createScriptCallRequestApi(input.makeRequestBridge, createIdleScriptExecutionController()),
  }
  const sandboxGlobals = {
    request: createRequestApi(input.runtimeRequest, headerEditor, () => ({
      ...input.environmentContext.getValues(),
      ...Object.fromEntries(input.requestScope.entries()),
    })),
    response: input.response ? createResponseApi(input.response) : undefined,
    env: createEnvironmentApi(input.environmentContext),
    scope: createScopeApi(input.requestScope),
    toast: createScriptToastApi(input.toastBridge),
    clipboard: createScriptClipboardApi(input.clipboardBridge),
    crypto: createCryptoApi(),
    cookies: createCookiesApi(),
    prompt: createPromptProxy(() => currentPrompt.value),
    callRequest: createCallRequestProxy(() => currentCallRequest.value),
    ...(input.phase === 'post-request'
      ? {
          navigateAndCallRequest: createMakeRequestProxy(() => currentMakeRequest.value),
        }
      : {}),
    z,
  }
  const requirePackage = createInstalledPackageLoader(input.scriptPackages)
  const requireScript = createSharedModuleLoader({
    phase: input.phase,
    sharedScripts: input.sharedScripts,
    consoleEntries: input.consoleEntries,
    baseGlobals: sandboxGlobals,
    loadPackage: requirePackage,
  })
  const sharedModule = { exports: {} as Record<string, unknown> }
  const sharedContext = vm.createContext({
    module: sharedModule,
    exports: sharedModule.exports,
    ...sandboxGlobals,
    console: createSharedContextConsole(currentSourceName, input.consoleEntries),
    requireScript,
    require: requirePackage,
    loadPackage: requirePackage,
  })

  for (const source of [...getActiveGlobalScriptSources(input.sharedScripts, input.phase), ...input.sources]) {
    if (!source.script.trim()) {
      continue
    }

    const executionController = createScriptExecutionController()
    let compiledScript: CompiledRequestScript | null = null

    try {
      currentSourceName.value = source.name
      currentPrompt.value = createScriptPromptApi(input.promptBridge, executionController)
      currentMakeRequest.value = createScriptMakeRequestApi(input.makeRequestBridge, executionController)
      currentCallRequest.value = createScriptCallRequestApi(input.makeRequestBridge, executionController)
      compiledScript = compileRequestScript(
        source.globalBindings ? appendGlobalBindingAssignments(source.script, source.globalBindings) : source.script
      )
      await executeScriptInContext(compiledScript.code, sharedContext, executionController)
      input.runtimeRequest.headers = headerEditor.serialize()
    } catch (error) {
      return [buildScriptErrorDetails({
        phase: input.phase,
        sourceName: source.name,
        error,
        sourceCode: source.script,
        compiledScript,
      })]
    } finally {
      executionController.cancel()
    }
  }

  return []
}

function createScriptExecutionController(timeoutMs = SCRIPT_TIMEOUT_MS): ScriptExecutionPauseController & {
  timeoutPromise: Promise<never>
  cancel: () => void
} {
  let remainingMs = timeoutMs
  let pauseDepth = 0
  let startedAt = performance.now()
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  let isSettled = false
  let rejectTimeout: ((reason?: unknown) => void) | null = null

  const timeoutPromise = new Promise<never>((_, reject) => {
    rejectTimeout = reject
  })

  const rejectForTimeout = () => {
    if (isSettled) {
      return
    }

    isSettled = true
    timeoutHandle = null
    rejectTimeout?.(new Error(`Script execution timed out after ${timeoutMs}ms`))
  }

  const startTimer = () => {
    if (isSettled || pauseDepth > 0) {
      return
    }

    if (remainingMs <= 0) {
      rejectForTimeout()
      return
    }

    startedAt = performance.now()
    timeoutHandle = setTimeout(rejectForTimeout, remainingMs)
  }

  startTimer()

  return {
    timeoutPromise,
    pause() {
      if (isSettled) {
        return
      }

      pauseDepth += 1
      if (pauseDepth > 1 || timeoutHandle === null) {
        return
      }

      clearTimeout(timeoutHandle)
      timeoutHandle = null
      remainingMs = Math.max(0, remainingMs - (performance.now() - startedAt))
    },
    resume() {
      if (isSettled || pauseDepth === 0) {
        return
      }

      pauseDepth -= 1
      if (pauseDepth > 0 || timeoutHandle !== null) {
        return
      }

      startTimer()
    },
    cancel() {
      isSettled = true
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
        timeoutHandle = null
      }
    },
  }
}

function createIdleScriptExecutionController(): ScriptExecutionPauseController {
  return {
    pause() {},
    resume() {},
  }
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
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
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

function createCookiesApi() {
  return {
    parse(value: string) {
      if (typeof value !== 'string') {
        throw new Error('cookies.parse requires a string')
      }

      return splitCombinedSetCookieHeader(value).flatMap(parseSetCookieForScript)
    },
    stringify(cookies: ScriptCookie[]) {
      if (!Array.isArray(cookies)) {
        throw new Error('cookies.stringify requires an array')
      }

      return cookies.map(stringifyScriptCookie).join(', ')
    },
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

function createSharedContextConsole(sourceNameRef: { value: string }, consoleEntries: RequestConsoleEntry[]) {
  return {
    log: (...values: unknown[]) => pushConsoleEntry(consoleEntries, sourceNameRef.value, 'log', values),
    info: (...values: unknown[]) => pushConsoleEntry(consoleEntries, sourceNameRef.value, 'info', values),
    warn: (...values: unknown[]) => pushConsoleEntry(consoleEntries, sourceNameRef.value, 'warn', values),
    error: (...values: unknown[]) => pushConsoleEntry(consoleEntries, sourceNameRef.value, 'error', values),
    debug: (...values: unknown[]) => pushConsoleEntry(consoleEntries, sourceNameRef.value, 'debug', values),
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

function createRequestApi(
  runtimeRequest: RuntimeRequestState,
  headers: HeaderApi,
  getResolvedVariables: () => Record<string, string>
): RequestApi {
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
    get pathParams() {
      return createLiveScriptPathParams(runtimeRequest)
    },
    set pathParams(value: ScriptPathParam[]) {
      runtimeRequest.pathParams = serializeScriptPathParams(value)
    },
    resolveUrl() {
      return resolveRequestUrl(runtimeRequest, getResolvedVariables())
    },
    headers,
  }
}

function createLiveScriptPathParams(runtimeRequest: RuntimeRequestState): ScriptPathParam[] {
  return parseKeyValueRows(runtimeRequest.pathParams).map((_, index) => createScriptPathParamProxy(runtimeRequest, index))
}

function createScriptPathParamProxy(runtimeRequest: RuntimeRequestState, index: number): ScriptPathParam {
  return {
    get key() {
      return parseKeyValueRows(runtimeRequest.pathParams)[index]?.key ?? ''
    },
    set key(value: string) {
      updateScriptPathParam(runtimeRequest, index, { key: value })
    },
    get value() {
      return parseKeyValueRows(runtimeRequest.pathParams)[index]?.value ?? ''
    },
    set value(value: string) {
      updateScriptPathParam(runtimeRequest, index, { value })
    },
    get enabled() {
      return parseKeyValueRows(runtimeRequest.pathParams)[index]?.enabled ?? true
    },
    set enabled(value: boolean) {
      updateScriptPathParam(runtimeRequest, index, { enabled: value })
    },
    get description() {
      return parseKeyValueRows(runtimeRequest.pathParams)[index]?.description ?? ''
    },
    set description(value: string) {
      updateScriptPathParam(runtimeRequest, index, { description: value })
    },
  }
}

function updateScriptPathParam(runtimeRequest: RuntimeRequestState, index: number, partial: Partial<ScriptPathParam>) {
  const rows = parseKeyValueRows(runtimeRequest.pathParams)
  const currentRow = rows[index]
  if (!currentRow) {
    return
  }

  rows[index] = {
    ...currentRow,
    ...normalizeScriptPathParam({
      key: partial.key ?? currentRow.key,
      value: partial.value ?? currentRow.value,
      enabled: partial.enabled ?? currentRow.enabled,
      description: partial.description ?? currentRow.description,
    }),
  }

  runtimeRequest.pathParams = stringifyKeyValueRows(rows)
}

function serializeScriptPathParams(pathParams: ScriptPathParam[]) {
  const rows: KeyValueRow[] = pathParams.map((row, index) => ({
    id: `script-path-param-${index}`,
    ...normalizeScriptPathParam(row),
  }))

  return stringifyKeyValueRows(rows)
}

function normalizeScriptPathParam(row: Partial<ScriptPathParam>): Omit<KeyValueRow, 'id'> {
  return {
    key: typeof row.key === 'string' ? row.key : '',
    value: typeof row.value === 'string' ? row.value : '',
    enabled: typeof row.enabled === 'boolean' ? row.enabled : true,
    description: typeof row.description === 'string' ? row.description : '',
  }
}

function resolveRequestUrl(runtimeRequest: RuntimeRequestState, variables: Record<string, string>) {
  const urlWithTemplatesResolved = resolveTemplateVariables(runtimeRequest.url, variables).trim()
  const resolvedPathParams = resolveTemplateVariables(runtimeRequest.pathParams, variables)
  const { url: urlWithPathParams } = applyPathParamsToUrl(urlWithTemplatesResolved, resolvedPathParams)
  const urlWithSearchParams = applySearchParamsToUrl(urlWithPathParams, runtimeRequest.searchParams, variables)

  return applyAuthToUrl(urlWithSearchParams, resolveAuth(runtimeRequest.auth, variables))
}

function applyAuthToUrl(url: string, auth: HttpAuth) {
  const entries = getAuthQueryParams(auth)
  if (entries.length === 0 || !url) {
    return url
  }

  try {
    const nextUrl = new URL(url)
    for (const entry of entries) {
      nextUrl.searchParams.set(entry.key, entry.value)
    }

    return nextUrl.toString()
  } catch {
    return url
  }
}

function createResponseApi(response: RuntimeResponseApiState) {
  return {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    hasCookies() {
      return response.headers.has('set-cookie')
    },
    parseCookies() {
      return response.headers
        .entries()
        .filter(([key]) => key.trim().toLowerCase() === 'set-cookie')
        .flatMap(([, value]) => splitCombinedSetCookieHeader(value).flatMap(parseSetCookieForScript))
    },
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

function createPromptProxy(getPrompt: () => ReturnType<typeof createScriptPromptApi>) {
  return {
    text(options: ScriptPromptTextOptions) {
      return getPrompt().text(options)
    },
  }
}

function createMakeRequestProxy(getMakeRequest: () => ReturnType<typeof createScriptMakeRequestApi>) {
  return async (path: string[]) => getMakeRequest()(path)
}

function createCallRequestProxy(getCallRequest: () => CallRequestApi) {
  return async (path: string[], overrides?: Parameters<CallRequestApi>[1]) =>
    createResponseApi(createRuntimeResponseApiState(await getCallRequest()(path, overrides)))
}

function createRuntimeResponseApiState(response: RuntimeResponseState): RuntimeResponseApiState {
  return {
    ...response,
    headers: createResponseHeaderEditor(response.headers),
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

async function evaluateTemplateExpression(input: {
  sourceName: string
  expressionSource: string
  runtimeRequest: RuntimeRequestState
  requestScope: Map<string, string>
  response: RuntimeResponseApiState | null
  environmentContext: EnvironmentContext
  consoleEntries: RequestConsoleEntry[]
  sharedScripts: SharedScriptRecord[]
  scriptPackages: ScriptRuntimePackage[]
  promptBridge?: ScriptPromptBridge
  clipboardBridge?: ScriptClipboardBridge
}) {
  const headerEditor = createHeaderEditor(input.runtimeRequest)
  const executionController = createScriptExecutionController()
  const sandbox = {
    console: createScriptConsole(input.sourceName, input.consoleEntries),
    request: createRequestApi(input.runtimeRequest, headerEditor, () => ({
      ...input.environmentContext.getValues(),
      ...Object.fromEntries(input.requestScope.entries()),
    })),
    response: input.response ? createResponseApi(input.response) : undefined,
    env: createEnvironmentApi(input.environmentContext),
    scope: createScopeApi(input.requestScope),
    clipboard: createScriptClipboardApi(input.clipboardBridge),
    crypto: createCryptoApi(),
    cookies: createCookiesApi(),
    prompt: createPromptProxy(() => createScriptPromptApi(input.promptBridge, executionController)),
    z,
  }
  const requirePackage = createInstalledPackageLoader(input.scriptPackages)
  const requireScript = createSharedModuleLoader({
    phase: 'pre-request',
    sharedScripts: input.sharedScripts,
    consoleEntries: input.consoleEntries,
    baseGlobals: sandbox,
    loadPackage: requirePackage,
  })
  const runtimeModule = { exports: {} as Record<string, unknown> }

  let compiledScript: CompiledRequestScript | null = null

  try {
    compiledScript = compileTemplateExpressionScript(input.expressionSource)
    const result = await resolveTemplateExpressionResult(
      await executeScript(
        compiledScript.code,
        {
          module: runtimeModule,
          exports: runtimeModule.exports,
          ...sandbox,
          requireScript,
          require: requirePackage,
          loadPackage: requirePackage,
        },
        executionController
      )
    )
    input.runtimeRequest.headers = headerEditor.serialize()
    return stringifyTemplateExpressionResult(result)
  } catch (error) {
    const details = buildScriptErrorDetails({
      phase: 'pre-request',
      sourceName: input.sourceName,
      error,
      sourceCode: input.expressionSource,
      compiledScript,
    })

    throw new Error(`Template expression failed in ${input.sourceName}: ${details.message}`)
  }
}

async function resolveTemplateExpressionResult(value: unknown): Promise<unknown> {
  if (typeof value !== 'function') {
    return value
  }

  return await Promise.resolve(value())
}

function resolveHttpAuthExpressions(auth: HttpAuth, resolveValue: (value: string, fieldName: string) => Promise<string>) {
  switch (auth.type) {
    case 'inherit':
    case 'noauth':
      return Promise.resolve(auth)
    case 'bearer':
      return resolveValue(auth.token, 'Token').then(token => ({ type: 'bearer', token }) as const)
    case 'apikey':
      return Promise.all([resolveValue(auth.key, 'Key'), resolveValue(auth.value, 'Value')]).then(([key, value]) => ({
        type: 'apikey',
        key,
        value,
        addTo: auth.addTo,
      }) as const)
    case 'basic':
      return Promise.all([resolveValue(auth.username, 'Username'), resolveValue(auth.password, 'Password')]).then(
        ([username, password]) => ({
          type: 'basic',
          username,
          password,
        }) as const
      )
  }
}

async function executeScript(
  code: string,
  sandbox: Record<string, unknown>,
  executionController = createScriptExecutionController()
) {
  const context = vm.createContext(sandbox, {
    codeGeneration: {
      strings: false,
      wasm: false,
    },
  })

  return executeScriptInContext(code, context, executionController)
}

async function executeScriptInContext(
  code: string,
  context: vm.Context,
  executionController = createScriptExecutionController()
) {
  
  const script = new vm.Script(`(async () => {\n${code}\n})()`, { filename: 'request-script.js' })
  const result = script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS })

  try {
    return await Promise.race([Promise.resolve(result), executionController.timeoutPromise])
  } finally {
    executionController.cancel()
  }
}

function executeModuleScript(code: string, context: vm.Context) {
  const script = new vm.Script(code, { filename: 'request-shared-script.js' })
  return script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS })
}

function getActiveGlobalScriptSources(sharedScripts: SharedScriptRecord[], phase: 'pre-request' | 'post-request'): ScriptSource[] {
  return sharedScripts
    .filter(script => script.isActive && script.kind === 'global' && script.targets.includes(phase))
    .map(script => ({
      name: getSharedScriptDisplayName(script),
      script: script.code,
      globalBindings: collectTopLevelBindingNames(script.code),
    }))
}

function createSharedModuleLoader(input: {
  phase: 'pre-request' | 'post-request'
  sharedScripts: SharedScriptRecord[]
  consoleEntries: RequestConsoleEntry[]
  loadPackage: (specifier: string) => unknown
  baseGlobals: {
    request: RequestApi
    response: ReturnType<typeof createResponseApi> | undefined
    env: ReturnType<typeof createEnvironmentApi>
    scope: ReturnType<typeof createScopeApi>
    crypto: ReturnType<typeof createCryptoApi>
    z: typeof z
    toast?: ReturnType<typeof createScriptToastApi>
    prompt?: ReturnType<typeof createPromptProxy>
    navigateAndCallRequest?: ReturnType<typeof createMakeRequestProxy>
    callRequest?: ReturnType<typeof createCallRequestProxy>
    loadPackage?: (specifier: string) => unknown
  }
}) {
  const visibleModules = input.sharedScripts.filter(
    script => script.isActive && script.kind === 'module' && script.targets.includes(input.phase) && script.name.trim() !== ''
  )
  const modulesByName = new Map<string, SharedScriptRecord>()
  for (const script of visibleModules) {
    modulesByName.set(script.name, script)
  }

  const moduleCache = new Map<string, Record<string, unknown>>()
  const loadingStack: string[] = []

  const loadModule = (name: string): Record<string, unknown> => {
    const script = modulesByName.get(name)
    if (!script) {
      throw new Error(`Shared script module ${name} was not found`)
    }

    if (moduleCache.has(name)) {
      return moduleCache.get(name) ?? {}
    }

    if (loadingStack.includes(name)) {
      throw new Error(`Shared script cycle detected: ${[...loadingStack, name].join(' -> ')}`)
    }

    loadingStack.push(name)
    const module = { exports: {} as Record<string, unknown> }
    const exports = module.exports

    try {
      const compiled = compileRequestScript(script.code)
      const context = vm.createContext(
        {
          module,
          exports,
          require: input.loadPackage,
          requireScript: loadModule,
          loadPackage: input.loadPackage,
          console: createScriptConsole(getSharedScriptDisplayName(script), input.consoleEntries),
          ...input.baseGlobals,
        },
        {
          codeGeneration: {
            strings: false,
            wasm: false,
          },
        }
      )
      executeModuleScript(compiled.code, context)

      if (Object.keys(module.exports).filter(key => key !== '__esModule').length === 0) {
        throw new Error(`Shared script module ${name} must use explicit exports`)
      }

      moduleCache.set(name, module.exports)
      return module.exports
    } finally {
      loadingStack.pop()
    }
  }

  return loadModule
}

function createInstalledPackageLoader(scriptPackages: ScriptRuntimePackage[]) {
  const requireCache = new Map<string, NodeRequire>()

  return (specifier: string) => {
    const parsedSpecifier = parseScriptPackageSpecifier(specifier)
    if (!parsedSpecifier) {
      throw new Error(`Package specifier ${specifier} is invalid`)
    }

    const matchingPackages = scriptPackages.filter(pkg => pkg.packageName === parsedSpecifier.packageName)
    if (matchingPackages.length === 0) {
      throw new Error(`Package ${parsedSpecifier.packageName} is not available in this workspace`)
    }

    const selectedPackage = parsedSpecifier.version
      ? matchingPackages.find(pkg => pkg.packageVersion === parsedSpecifier.version)
      : matchingPackages.length === 1
        ? matchingPackages[0]
        : null

    if (!selectedPackage) {
      if (!parsedSpecifier.version) {
        throw new Error(`Multiple ${parsedSpecifier.packageName} versions are configured. Import an exact version.`)
      }

      throw new Error(`Package ${parsedSpecifier.packageName}@${parsedSpecifier.version} is not available in this workspace`)
    }

    if (!selectedPackage.cacheDirectory) {
      throw new Error(`Package ${selectedPackage.packageName}@${selectedPackage.packageVersion} is not downloaded`)
    }

    const cacheKey = `${selectedPackage.packageName}@${selectedPackage.packageVersion}`
    const packageRequire = requireCache.get(cacheKey) ?? createRequire(`${selectedPackage.cacheDirectory}/package.json`)
    requireCache.set(cacheKey, packageRequire)
    return packageRequire(`${selectedPackage.packageName}${parsedSpecifier.subpath}`)
  }
}

function getSharedScriptDisplayName(script: SharedScriptRecord) {
  if (script.name.trim()) {
    return `Shared Script: ${script.name}`
  }

  const firstMeaningfulLine = script.code
    .split('\n')
    .map(line => line.trim())
    .find(line => line.length > 0)

  return firstMeaningfulLine ? `Shared Script: ${firstMeaningfulLine.slice(0, 40)}` : 'Shared Script'
}

function appendGlobalBindingAssignments(sourceCode: string, bindingNames: string[]) {
  if (bindingNames.length === 0) {
    return sourceCode
  }

  const assignments = bindingNames.map(name => `globalThis.${name} = ${name}`).join('\n')
  return `${sourceCode}\n${assignments}`
}

function collectTopLevelBindingNames(sourceCode: string) {
  const sourceFile = ts.createSourceFile('request-global-script.ts', sourceCode, ts.ScriptTarget.ES2020, true)
  const names = new Set<string>()

  for (const statement of sourceFile.statements) {
    if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) {
      if (statement.name?.text) {
        names.add(statement.name.text)
      }
      continue
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        collectBindingElementNames(declaration.name, names)
      }
    }
  }

  return Array.from(names)
}

function collectBindingElementNames(name: ts.BindingName, names: Set<string>) {
  if (ts.isIdentifier(name)) {
    names.add(name.text)
    return
  }

  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) {
      continue
    }

    collectBindingElementNames(element.name, names)
  }
}

function compileTemplateExpressionScript(sourceCode: string): CompiledRequestScript {
  try {
    return compileRequestScript(`return (${sourceCode})`)
  } catch (error) {
    if (isScriptCompilerError(error)) {
      return compileRequestScript(normalizeTemplateExpressionSource(sourceCode))
    }

    throw error
  }
}

function normalizeTemplateExpressionSource(sourceCode: string) {
  const sourceFile = ts.createSourceFile('request-template-expression.ts', sourceCode, ts.ScriptTarget.ES2020, true)
  const lastStatement = sourceFile.statements[sourceFile.statements.length - 1]

  if (!lastStatement || !ts.isExpressionStatement(lastStatement)) {
    return sourceCode
  }

  const statementStart = lastStatement.getStart(sourceFile)
  const statementEnd = lastStatement.getEnd()
  const expressionText = lastStatement.expression.getText(sourceFile)

  return `${sourceCode.slice(0, statementStart)}return (${expressionText})${sourceCode.slice(statementEnd)}`
}

function stringifyTemplateExpressionResult(value: unknown) {
  if (value === null || value === undefined) {
    return ''
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value)
  }

  if (isDateLikeValue(value)) {
    return value.toISOString()
  }

  return JSON.stringify(value)
}

function isDateLikeValue(value: unknown): value is { toISOString: () => string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toISOString' in value &&
    typeof value.toISOString === 'function' &&
    Object.prototype.toString.call(value) === '[object Date]'
  )
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

function createResponseHeaderEditor(headers: string): HeaderApi {
  let entries = parseResponseHeaderEntries(headers)

  return {
    get(name) {
      const normalizedName = name.trim().toLowerCase()
      const entry = entries.find(([key]) => key.trim().toLowerCase() === normalizedName)
      return entry?.[1] ?? null
    },
    set(name, value) {
      const normalizedName = name.trim()
      const normalizedLowercaseName = normalizedName.toLowerCase()
      const firstMatch = entries.findIndex(([key]) => key.trim().toLowerCase() === normalizedLowercaseName)

      if (firstMatch === -1) {
        entries = [...entries, [normalizedName, value]]
        return
      }

      entries = entries.flatMap(([key, entryValue], index) => {
        if (key.trim().toLowerCase() !== normalizedLowercaseName) {
          return [[key, entryValue] satisfies [string, string]]
        }

        if (index !== firstMatch) {
          return []
        }

        return [[normalizedName, value] satisfies [string, string]]
      })
    },
    delete(name) {
      const normalizedName = name.trim().toLowerCase()
      entries = entries.filter(([key]) => key.trim().toLowerCase() !== normalizedName)
    },
    has(name) {
      const normalizedName = name.trim().toLowerCase()
      return entries.some(([key]) => key.trim().toLowerCase() === normalizedName)
    },
    entries() {
      return entries.map(([key, value]) => [key, value] satisfies [string, string])
    },
    toObject() {
      return Object.fromEntries(entries)
    },
    serialize() {
      return serializeResponseHeaderEntries(entries)
    },
  }
}

function parseResponseHeaderEntries(headers: string) {
  return headers
    .split('\n')
    .map(line => {
      const separatorIndex = line.indexOf(':')
      if (separatorIndex < 0) {
        return null
      }

      return [line.slice(0, separatorIndex).trim(), line.slice(separatorIndex + 1).trim()] satisfies [string, string]
    })
    .filter((entry): entry is [string, string] => entry !== null)
}

function serializeResponseHeaderEntries(entries: Array<[string, string]>) {
  return entries.map(([key, value]) => `${key}: ${value}`).join('\n')
}

function parseSetCookieForScript(value: string): ScriptCookie[] {
  const segments = value
    .split(';')
    .map(segment => segment.trim())
    .filter(Boolean)
  if (segments.length === 0) {
    return []
  }

  const separatorIndex = segments[0].indexOf('=')
  if (separatorIndex <= 0) {
    return []
  }

  const name = segments[0].slice(0, separatorIndex).trim()
  if (!name || /[\s;=]/u.test(name)) {
    return []
  }

  const cookie: ScriptCookie = {
    name,
    value: segments[0].slice(separatorIndex + 1),
    domain: null,
    path: null,
    secure: false,
    httpOnly: false,
    sameSite: null,
    expires: null,
    maxAge: null,
  }

  for (const attribute of segments.slice(1)) {
    const attributeSeparatorIndex = attribute.indexOf('=')
    const attributeName = (attributeSeparatorIndex === -1 ? attribute : attribute.slice(0, attributeSeparatorIndex)).trim().toLowerCase()
    const attributeValue = attributeSeparatorIndex === -1 ? '' : attribute.slice(attributeSeparatorIndex + 1).trim()

    if (attributeName === 'domain') {
      cookie.domain = attributeValue || null
    } else if (attributeName === 'path') {
      cookie.path = attributeValue || null
    } else if (attributeName === 'secure') {
      cookie.secure = true
    } else if (attributeName === 'httponly') {
      cookie.httpOnly = true
    } else if (attributeName === 'samesite') {
      cookie.sameSite = normalizeScriptCookieSameSite(attributeValue)
    } else if (attributeName === 'expires') {
      cookie.expires = attributeValue || null
    } else if (attributeName === 'max-age') {
      const parsed = Number.parseInt(attributeValue, 10)
      cookie.maxAge = Number.isFinite(parsed) ? parsed : null
    }
  }

  return [cookie]
}

function stringifyScriptCookie(cookie: ScriptCookie) {
  if (typeof cookie !== 'object' || cookie === null) {
    throw new Error('cookies.stringify expects cookie objects')
  }

  const name = typeof cookie.name === 'string' ? cookie.name.trim() : ''
  if (!name || /[\s;=]/u.test(name)) {
    throw new Error('cookies.stringify encountered a cookie with an invalid name')
  }

  const parts = [`${name}=${typeof cookie.value === 'string' ? cookie.value : ''}`]
  if (typeof cookie.domain === 'string' && cookie.domain.trim()) {
    parts.push(`Domain=${cookie.domain.trim()}`)
  }
  if (typeof cookie.path === 'string' && cookie.path.trim()) {
    parts.push(`Path=${cookie.path.trim()}`)
  }
  if (cookie.maxAge !== null && cookie.maxAge !== undefined) {
    if (!Number.isInteger(cookie.maxAge)) {
      throw new Error('cookies.stringify encountered a cookie with an invalid maxAge')
    }
    parts.push(`Max-Age=${cookie.maxAge}`)
  }
  if (typeof cookie.expires === 'string' && cookie.expires.trim()) {
    parts.push(`Expires=${cookie.expires.trim()}`)
  }
  if (cookie.secure) {
    parts.push('Secure')
  }
  if (cookie.httpOnly) {
    parts.push('HttpOnly')
  }
  if (cookie.sameSite) {
    parts.push(`SameSite=${capitalizeCookieSameSite(cookie.sameSite)}`)
  }

  return parts.join('; ')
}

function normalizeScriptCookieSameSite(value: string): CookieSameSite | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'strict' || normalized === 'lax' || normalized === 'none') {
    return normalized
  }

  return null
}

function capitalizeCookieSameSite(value: CookieSameSite) {
  return value.charAt(0).toUpperCase() + value.slice(1)
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
