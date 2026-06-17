import '@tailwindcss/browser'
import '../App.css'
import '../responseVisualizer/responseVisualizer.css'
import React, { type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import ts from 'typescript'
import { z } from 'zod'
import { formatXml } from '@common/formatXml'
import { formatJson } from '@common/Json5'
import { parseScriptPackageSpecifier } from '@common/ScriptPackages'
import { CodeEditor } from '../folders/CodeEditor'
import {
  VIEW_RUNTIME_CLIPBOARD_WRITE_EVENT,
  VIEW_RUNTIME_CACHE_REQUEST_EVENT,
  VIEW_RUNTIME_CACHE_REQUEST_RESULT_EVENT,
  VIEW_RUNTIME_CALL_REQUEST_EVENT,
  VIEW_RUNTIME_CALL_REQUEST_RESULT_EVENT,
  VIEW_RUNTIME_READY_EVENT,
  VIEW_RUNTIME_RENDER_EVENT,
  VIEW_RUNTIME_TRIGGER_RUN_EVENT,
  type ViewRuntimeCacheRequestResultMessage,
  type ViewRuntimeCallRequestResultMessage,
  type ViewRuntimePayload,
  type ViewRuntimeScriptResponse,
} from '../folders/viewRuntimeProtocol'
import { transformViewRuntimeSource } from './viewRuntimeRefresh'
import { ensureTailwindRuntimeTheme } from '../tailwindRuntimeTheme'
import { createViewRuntimeClipboardApi } from './viewRuntimeClipboard'

type RuntimeErrorDetails = {
  compactMessage: string
  detailedMessage: string
}

type RuntimeCodeEditorComponent = React.ComponentType<React.ComponentProps<typeof CodeEditor>>
type RuntimeComponent = (props: object) => React.ReactElement | null

type RuntimeShellState = {
  source: string
  component: RuntimeComponent | null
  error: RuntimeErrorDetails | null
}

const noopCodeEditorOnChange = () => undefined

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('View runtime root not found')
}

ensureTailwindRuntimeTheme()

const root = createRoot(rootElement)
const pendingCallRequests = new Map<
  string,
  {
    resolve: (response: ReturnType<typeof createScriptResponseApi>) => void
    reject: (error: Error) => void
  }
>()
const pendingCacheRequests = new Map<
  string,
  {
    resolve: () => void
    reject: (error: Error) => void
  }
>()
let callRequestCounter = 0
let cacheRequestCounter = 0
const runtimeShellState: RuntimeShellState = {
  source: '',
  component: null,
  error: null,
}
const hotComponentRegistry = new Map<string, { wrapper: RuntimeComponent; current: RuntimeComponent }>()
let hasPendingRunTrigger = false
let pendingRunFrameId: number | null = null

renderRuntimeShell()

window.addEventListener('message', event => {
  if (event.data?.type === VIEW_RUNTIME_RENDER_EVENT) {
    const code = typeof event.data.code === 'string' ? event.data.code : ''
    const payload = event.data.payload as ViewRuntimePayload | undefined

    if (!code.trim()) {
      runtimeShellState.source = ''
      runtimeShellState.component = null
      runtimeShellState.error = null
      hasPendingRunTrigger = false
      cancelPendingRunFrame()
      renderRuntimeShell()
      return
    }

    try {
      void renderView(code, payload ?? createEmptyPayload()).catch(error => {
        runtimeShellState.error = formatRuntimeError(error, code)
        renderRuntimeShell()
      })
    } catch (error) {
      runtimeShellState.error = formatRuntimeError(error, code)
      renderRuntimeShell()
    }
    return
  }

  if (event.data?.type === VIEW_RUNTIME_TRIGGER_RUN_EVENT) {
    hasPendingRunTrigger = true
    flushPendingRunTrigger()
    return
  }

  if (event.data?.type === VIEW_RUNTIME_CACHE_REQUEST_RESULT_EVENT) {
    const message = event.data as ViewRuntimeCacheRequestResultMessage
    const pending = pendingCacheRequests.get(message.requestId)
    if (!pending) {
      return
    }

    pendingCacheRequests.delete(message.requestId)
    if (message.error) {
      pending.reject(new Error(message.error))
      return
    }

    pending.resolve()
    return
  }

  if (event.data?.type !== VIEW_RUNTIME_CALL_REQUEST_RESULT_EVENT) {
    return
  }

  const message = event.data as ViewRuntimeCallRequestResultMessage
  const pending = pendingCallRequests.get(message.requestId)
  if (!pending) {
    return
  }

  pendingCallRequests.delete(message.requestId)
  if (message.error) {
    pending.reject(new Error(message.error))
    return
  }

  if (!message.response) {
    pending.reject(new Error('View runtime callRequest returned no response'))
    return
  }

  pending.resolve(createScriptResponseApi(message.response))
})

window.parent.postMessage({ type: VIEW_RUNTIME_READY_EVENT }, '*')

function compileView(source: string, fileName: string) {
  const transformedSource = transformViewRuntimeSource(source, fileName)
  const result = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      jsxFactory: 'React.createElement',
      jsxFragmentFactory: 'React.Fragment',
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      inlineSourceMap: true,
      inlineSources: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
    fileName,
    reportDiagnostics: true,
  })

  const diagnostics = (result.diagnostics ?? [])
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
    .map(diagnostic => formatRuntimeDiagnostic(diagnostic, source))

  if (diagnostics.length > 0) {
    throw createRuntimeError({
      compactMessage: diagnostics[0]?.compactMessage ?? 'View Runtime Compile Error',
      detailedMessage: diagnostics.map(diagnostic => diagnostic.detailedMessage).join('\n\n'),
    })
  }

  const transformedResult = ts.transpileModule(transformedSource, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      jsxFactory: 'React.createElement',
      jsxFragmentFactory: 'React.Fragment',
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
      inlineSourceMap: true,
      inlineSources: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
    },
    fileName,
    reportDiagnostics: false,
  })

  return transformedResult.outputText
}

async function renderView(source: string, payload: ViewRuntimePayload) {
  const globalScripts = payload.sharedScripts.filter(
    script => script.isActive && script.kind === 'global' && script.targets.includes('view-runtime')
  )
  const combinedSource = [...globalScripts.map(script => script.code), source].filter(Boolean).join('\n\n')
  const transpiled = compileView(combinedSource, 'view-runtime.tsx')
  const component = await runView(transpiled, payload)

  runtimeShellState.source = source
  runtimeShellState.component = component
  runtimeShellState.error = null

  renderRuntimeShell()
  flushPendingRunTrigger()
}

async function runView(code: string, payload: ViewRuntimePayload) {
  const env = createEnvironmentApi(payload.env)
  const scope = createScopeApi(payload.scope)
  const cache = createViewCacheApi(payload.cache)
  const clipboard = createClipboardApi()
  const cookies = createCookiesApi()
  const callRequest = createCallRequestApi()
  const Table = createTableComponent()
  const RuntimeCodeEditor = createRuntimeCodeEditor()
  const {
    Fragment,
    startTransition,
    useDeferredValue,
    useEffect,
    useEffectEvent,
    useId,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
  } = React
  const requirePackage = createInstalledBrowserPackageLoader(payload.scriptPackages)
  const requireScript = createSharedScriptModuleLoader(payload, {
    React,
    Fragment,
    startTransition,
    useDeferredValue,
    useEffect,
    useEffectEvent,
    useId,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
    env,
    scope,
    cache,
    clipboard,
    cookies,
    Table,
    CodeEditor: RuntimeCodeEditor,
    callRequest,
  })

  const module = executeRuntimeModule({
    code,
    sourceUrl: 'view-runtime.js',
    globals: {
      React,
      Fragment,
      startTransition,
      useDeferredValue,
      useEffect,
      useEffectEvent,
      useId,
      useLayoutEffect,
      useMemo,
      useReducer,
      useRef,
      useState,
      env,
      scope,
      cache,
      clipboard,
      callRequest,
      requirePackage,
      requireScript,
      cookies,
      Table,
      CodeEditor: RuntimeCodeEditor,
    },
  })
  const component = module.exports.default
  if (typeof component !== 'function') {
    throw new Error('View runtime must export default a component function.')
  }

  return component as RuntimeComponent
}

function createSharedScriptModuleLoader(
  payload: ViewRuntimePayload,
  globals: {
    React: typeof React
    Fragment: typeof React.Fragment
    startTransition: typeof React.startTransition
    useDeferredValue: typeof React.useDeferredValue
    useEffect: typeof React.useEffect
    useEffectEvent: typeof React.useEffectEvent
    useId: typeof React.useId
    useLayoutEffect: typeof React.useLayoutEffect
    useMemo: typeof React.useMemo
    useReducer: typeof React.useReducer
    useRef: typeof React.useRef
    useState: typeof React.useState
    env: ReturnType<typeof createEnvironmentApi>
    scope: ReturnType<typeof createScopeApi>
    cache: ReturnType<typeof createViewCacheApi>
    clipboard: ReturnType<typeof createClipboardApi>
    cookies: ReturnType<typeof createCookiesApi>
    Table: ReturnType<typeof createTableComponent>
    CodeEditor: RuntimeCodeEditorComponent
    callRequest: ReturnType<typeof createCallRequestApi>
  }
) {
  const modulesByName = new Map(
    payload.sharedScripts
      .filter(
        script =>
          script.isActive && script.kind === 'module' && script.targets.includes('view-runtime') && script.name.trim()
      )
      .map(script => [script.name, script] as const)
  )
  const cache = new Map<string, Record<string, unknown>>()
  const loading = new Set<string>()
  const requirePackage = createInstalledBrowserPackageLoader(payload.scriptPackages)

  const loadModule = (name: string): Record<string, unknown> => {
    const script = modulesByName.get(name)
    if (!script) {
      throw new Error(`Shared script module ${name} was not found`)
    }

    const cached = cache.get(name)
    if (cached) {
      return cached
    }

    if (loading.has(name)) {
      throw new Error(`Shared script cycle detected while loading ${name}`)
    }

    loading.add(name)
    try {
      const compiled = compileView(script.code, `view-runtime-shared-${script.id}.tsx`)
      const module = executeRuntimeModule({
        code: compiled,
        sourceUrl: 'view-runtime-shared.js',
        globals: {
          React: globals.React,
          Fragment: globals.Fragment,
          startTransition: globals.startTransition,
          useDeferredValue: globals.useDeferredValue,
          useEffect: globals.useEffect,
          useEffectEvent: globals.useEffectEvent,
          useId: globals.useId,
          useLayoutEffect: globals.useLayoutEffect,
          useMemo: globals.useMemo,
          useReducer: globals.useReducer,
          useRef: globals.useRef,
          useState: globals.useState,
          env: globals.env,
          scope: globals.scope,
          cache: globals.cache,
          clipboard: globals.clipboard,
          callRequest: globals.callRequest,
          requirePackage,
          requireScript: loadModule,
          cookies: globals.cookies,
          Table: globals.Table,
          CodeEditor: globals.CodeEditor,
        },
      })

      const exportedKeys = Object.keys(module.exports).filter(key => key !== '__esModule')
      if (exportedKeys.length === 0) {
        throw new Error(`Shared script module ${name} must use explicit exports`)
      }

      cache.set(name, module.exports)
      return module.exports
    } finally {
      loading.delete(name)
    }
  }

  return loadModule
}

function createInstalledBrowserPackageLoader(scriptPackages: ViewRuntimePayload['scriptPackages']) {
  const moduleCache = new Map<string, Record<string, unknown>>()

  const loadPackage = (specifier: string) => {
    const parsedSpecifier = parseScriptPackageSpecifier(specifier)
    if (!parsedSpecifier) {
      throw new Error(`Package specifier ${specifier} is invalid`)
    }

    if (parsedSpecifier.subpath) {
      throw new Error(`Package subpath imports are not supported in the view runtime yet: ${specifier}`)
    }

    const matchingPackages = scriptPackages.filter(pkg => pkg.packageName === parsedSpecifier.packageName)
    if (matchingPackages.length === 0) {
      throw new Error(`Package ${parsedSpecifier.packageName} was not found`)
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

      throw new Error(`Package ${parsedSpecifier.packageName}@${parsedSpecifier.version} was not found`)
    }

    const cachedModule = moduleCache.get(selectedPackage.cacheKey)
    if (cachedModule) {
      return cachedModule
    }

    if (!selectedPackage.browserBundleCode) {
      throw new Error(`Package ${selectedPackage.packageName}@${selectedPackage.packageVersion} is not downloaded`)
    }

    const module = { exports: {} as Record<string, unknown> }
    const exports = module.exports
    new Function(
      'module',
      'exports',
      'require',
      `${selectedPackage.browserBundleCode}\n//# sourceURL=${selectedPackage.packageName}.bundle.js`
    )(module, exports, createExternalRequire(loadPackage))
    moduleCache.set(selectedPackage.cacheKey, module.exports)
    return module.exports
  }

  return loadPackage
}

function createExternalRequire(loadPackage: (specifier: string) => unknown) {
  const reactModule = {
    ...React,
    default: React,
  }
  const jsxRuntimeModule = {
    Fragment: React.Fragment,
    jsx: (type: React.ElementType, props: Record<string, unknown>, key?: string) =>
      React.createElement(type, { ...props, key }),
    jsxs: (type: React.ElementType, props: Record<string, unknown>, key?: string) =>
      React.createElement(type, { ...props, key }),
  }

  return (specifier: string) => {
    switch (specifier) {
      case 'react':
        return reactModule
      case 'react/jsx-runtime':
      case 'react/jsx-dev-runtime':
        return jsxRuntimeModule
      case 'react-dom':
        return { default: null }
      default:
        return loadPackage(specifier)
    }
  }
}

function createCallRequestApi() {
  return (
    path: readonly string[],
    overrides?: {
      method?: string
      url?: string
      headers?: Record<string, string | undefined>
      body?: string | undefined
    }
  ) => {
    if (!Array.isArray(path) || path.some(segment => typeof segment !== 'string')) {
      return Promise.reject(new Error('callRequest path must be an array of strings'))
    }

    const requestId = `view-runtime-request-${++callRequestCounter}`

    return new Promise<ReturnType<typeof createScriptResponseApi>>((resolve, reject) => {
      pendingCallRequests.set(requestId, { resolve, reject })
      window.parent.postMessage(
        {
          type: VIEW_RUNTIME_CALL_REQUEST_EVENT,
          requestId,
          path: [...path],
          overrides,
        },
        '*'
      )
    })
  }
}

function createClipboardApi() {
  return createViewRuntimeClipboardApi(message => {
    if (message.type !== VIEW_RUNTIME_CLIPBOARD_WRITE_EVENT) {
      return
    }

    window.parent.postMessage(message, '*')
  })
}

function createViewCacheApi(initialEntries: Record<string, string>) {
  const entries = new Map(Object.entries(initialEntries))
  const getItem = async (key: string) => {
    const normalizedKey = normalizeViewCacheKey(key)
    return entries.get(normalizedKey) ?? null
  }

  return {
    getItem,
    async getItemWithSchema<T>(key: string, schema: z.ZodType<T>) {
      const value = await getItem(key)
      if (value === null) {
        return null
      }

      const parsedJsonValue = tryParseViewCacheJson(value)
      if (parsedJsonValue !== VIEW_CACHE_PARSE_FAILED) {
        const jsonResult = schema.safeParse(parsedJsonValue)
        return jsonResult.success ? jsonResult.data : null
      }

      const rawResult = schema.safeParse(value)
      return rawResult.success ? rawResult.data : null
    },
    async setItem(key: string, value: string) {
      const normalizedKey = normalizeViewCacheKey(key)
      if (typeof value !== 'string') {
        throw new Error('cache.setItem value must be a string')
      }

      await persistViewCacheMutation({ operation: 'set', key: normalizedKey, value })
      entries.set(normalizedKey, value)
    },
    async getAll() {
      return Object.fromEntries(entries.entries())
    },
    async removeItem(key: string) {
      const normalizedKey = normalizeViewCacheKey(key)
      await persistViewCacheMutation({ operation: 'remove', key: normalizedKey })
      entries.delete(normalizedKey)
    },
  }
}

function persistViewCacheMutation(
  mutation:
    | {
        operation: 'set'
        key: string
        value: string
      }
    | {
        operation: 'remove'
        key: string
      }
) {
  const requestId = `view-runtime-cache-request-${++cacheRequestCounter}`

  return new Promise<void>((resolve, reject) => {
    pendingCacheRequests.set(requestId, { resolve, reject })
    window.parent.postMessage(
      {
        type: VIEW_RUNTIME_CACHE_REQUEST_EVENT,
        requestId,
        ...mutation,
      },
      '*'
    )
  })
}

const VIEW_CACHE_PARSE_FAILED = Symbol('view-cache-parse-failed')

function tryParseViewCacheJson(value: string) {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return VIEW_CACHE_PARSE_FAILED
  }
}

function normalizeViewCacheKey(key: string) {
  if (typeof key !== 'string') {
    throw new Error('cache key must be a string')
  }

  const normalizedKey = key.trim()
  if (!normalizedKey) {
    throw new Error('cache key is required')
  }

  return normalizedKey
}

function renderRuntimeShell() {
  root.render(<RuntimeShell state={runtimeShellState} />)
}

function formatRuntimeDiagnostic(diagnostic: ts.Diagnostic, source: string): RuntimeErrorDetails {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  const location =
    diagnostic.file && typeof diagnostic.start === 'number'
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : null
  const line = location ? location.line + 1 : null
  const column = location ? location.character + 1 : null
  const sourceLine = line ? (source.split('\n')[line - 1]?.trimEnd() ?? null) : null
  const compactMessage = line ? `View Runtime:${line} ${message}` : `View Runtime ${message}`
  const detailedLines = ['Phase: View Runtime']

  if (line !== null) {
    detailedLines.push(column !== null ? `Location: line ${line}, column ${column}` : `Location: line ${line}`)
  }
  if (sourceLine) {
    detailedLines.push(`Code: ${sourceLine}`)
  }
  detailedLines.push(`Error: ${message}`)

  return {
    compactMessage,
    detailedMessage: detailedLines.join('\n'),
  }
}

function formatRuntimeError(error: unknown, source: string): RuntimeErrorDetails {
  if (isRuntimeError(error)) {
    return error.details
  }

  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  const location = extractRuntimeLocation(stack, source)
  const compactMessage = location?.line ? `View Runtime:${location.line} ${message}` : `View Runtime ${message}`
  const detailedLines = ['Phase: View Runtime']

  if (location?.line !== undefined && location.line !== null) {
    detailedLines.push(
      location.column !== null
        ? `Location: line ${location.line}, column ${location.column}`
        : `Location: line ${location.line}`
    )
  }
  if (location?.sourceLine) {
    detailedLines.push(`Code: ${location.sourceLine}`)
  }
  detailedLines.push(`Error: ${message}`)

  return {
    compactMessage,
    detailedMessage: detailedLines.join('\n'),
  }
}

function extractRuntimeLocation(stack: string, source: string) {
  const match = stack.match(/(?:view-runtime\.(?:tsx|js)|<anonymous>):(\d+):(\d+)/)
  if (!match) {
    return null
  }

  const line = Number(match[1])
  const column = Number(match[2])
  if (!Number.isFinite(line) || !Number.isFinite(column)) {
    return null
  }

  return {
    line,
    column,
    sourceLine: source.split('\n')[line - 1]?.trimEnd() ?? null,
  }
}

function createRuntimeError(details: RuntimeErrorDetails) {
  const error = new Error(details.compactMessage)
  ;(error as Error & { details: RuntimeErrorDetails }).details = details
  return error
}

function isRuntimeError(error: unknown): error is Error & { details: RuntimeErrorDetails } {
  return typeof error === 'object' && error !== null && 'details' in error
}

function RuntimeShell({ state }: { state: RuntimeShellState }) {
  const Component = state.component

  return (
    <div style={{ position: 'relative', height: '100%' }}>
      {Component ? (
        <RuntimeErrorBoundary key={state.source} source={state.source}>
          <Component />
        </RuntimeErrorBoundary>
      ) : (
        <div className="empty">Add a view to render custom JSX and run request flows.</div>
      )}
      {state.error ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            padding: 12,
            pointerEvents: 'none',
            overflow: 'auto',
          }}
        >
          <pre className="error">{`${state.error.compactMessage}\n\n${state.error.detailedMessage}`.trim()}</pre>
        </div>
      ) : null}
    </div>
  )
}

type RuntimeErrorBoundaryProps = {
  source: string
  children: ReactNode
}

type RuntimeErrorBoundaryState = {
  error: RuntimeErrorDetails | null
}

class RuntimeErrorBoundary extends React.Component<RuntimeErrorBoundaryProps, RuntimeErrorBoundaryState> {
  state: RuntimeErrorBoundaryState = {
    error: null,
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const combinedStack = [error.stack, info.componentStack].filter(Boolean).join('\n')
    error.stack = combinedStack
    this.setState({
      error: formatRuntimeError(error, this.props.source),
    })
  }

  componentDidUpdate(previousProps: RuntimeErrorBoundaryProps) {
    if (previousProps.source !== this.props.source && this.state.error) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <pre className="error">
          {`${this.state.error.compactMessage}\n\n${this.state.error.detailedMessage}`.trim()}
        </pre>
      )
    }

    return this.props.children
  }
}

function executeRuntimeModule({
  code,
  sourceUrl,
  globals,
}: {
  code: string
  sourceUrl: string
  globals: {
    React: typeof React
    Fragment: typeof React.Fragment
    startTransition: typeof React.startTransition
    useDeferredValue: typeof React.useDeferredValue
    useEffect: typeof React.useEffect
    useEffectEvent: typeof React.useEffectEvent
    useId: typeof React.useId
    useLayoutEffect: typeof React.useLayoutEffect
    useMemo: typeof React.useMemo
    useReducer: typeof React.useReducer
    useRef: typeof React.useRef
    useState: typeof React.useState
    env: ReturnType<typeof createEnvironmentApi>
    scope: ReturnType<typeof createScopeApi>
    cache: ReturnType<typeof createViewCacheApi>
    clipboard: ReturnType<typeof createClipboardApi>
    callRequest: ReturnType<typeof createCallRequestApi>
    requirePackage: (specifier: string) => unknown
    requireScript: (specifier: string) => unknown
    cookies: ReturnType<typeof createCookiesApi>
    Table: ReturnType<typeof createTableComponent>
    CodeEditor: RuntimeCodeEditorComponent
  }
}) {
  const module = { exports: {} as Record<string, unknown> }
  const exports = module.exports
  new Function(
    'module',
    'exports',
    'React',
    'Fragment',
    'startTransition',
    'useDeferredValue',
    'useEffect',
    'useEffectEvent',
    'useId',
    'useLayoutEffect',
    'useMemo',
    'useReducer',
    'useRef',
    'useState',
    'console',
    'env',
    'scope',
    'cache',
    'clipboard',
    'callRequest',
    'require',
    'requireScript',
    'loadPackage',
    'crypto',
    'cookies',
    'z',
    'formatXml',
    'formatJson',
    'Table',
    'CodeEditor',
    '__registerHotComponent',
    `${code}\n//# sourceURL=${sourceUrl}`
  )(
    module,
    exports,
    globals.React,
    globals.Fragment,
    globals.startTransition,
    globals.useDeferredValue,
    globals.useEffect,
    globals.useEffectEvent,
    globals.useId,
    globals.useLayoutEffect,
    globals.useMemo,
    globals.useReducer,
    globals.useRef,
    globals.useState,
    console,
    globals.env,
    globals.scope,
    globals.cache,
    globals.clipboard,
    globals.callRequest,
    globals.requirePackage,
    globals.requireScript,
    globals.requirePackage,
    crypto,
    globals.cookies,
    z,
    formatXml,
    formatJson,
    globals.Table,
    globals.CodeEditor,
    registerHotComponent
  )

  return module
}

function registerHotComponent(id: string, component: RuntimeComponent) {
  const existing = hotComponentRegistry.get(id)
  if (existing) {
    existing.current = component
    return existing.wrapper
  }

  const record: { wrapper: RuntimeComponent; current: RuntimeComponent } = {
    current: component,
    wrapper(props: object) {
      return record.current(props)
    },
  }

  ;(record.wrapper as RuntimeComponent & { displayName?: string }).displayName =
    component.name || id.split(':').at(-1) || 'HotComponent'
  hotComponentRegistry.set(id, record)
  return record.wrapper
}

function createHeaderApi(initialHeaders: Array<{ key: string; value: string }>) {
  let rows = initialHeaders.map(row => ({ ...row }))

  return {
    get(name: string) {
      const row = rows.find(item => item.key.trim().toLowerCase() === name.trim().toLowerCase())
      return row ? row.value : null
    },
    set(name: string, value: string) {
      const normalizedName = name.trim()
      const index = rows.findIndex(item => item.key.trim().toLowerCase() === normalizedName.toLowerCase())
      if (index >= 0) {
        rows[index] = { key: normalizedName, value }
        return
      }

      rows.push({ key: normalizedName, value })
    },
    delete(name: string) {
      rows = rows.filter(item => item.key.trim().toLowerCase() !== name.trim().toLowerCase())
    },
    has(name: string) {
      return rows.some(item => item.key.trim().toLowerCase() === name.trim().toLowerCase())
    },
    entries() {
      return rows.map(item => [item.key, item.value] as [string, string])
    },
    toObject() {
      return Object.fromEntries(rows.map(item => [item.key, item.value]))
    },
  }
}

function createScriptResponseApi(response: ViewRuntimeScriptResponse) {
  const headers = createHeaderApi(parseHeadersToEntries(response.headers))
  return {
    status: response.status,
    statusText: response.statusText,
    headers,
    hasCookies() {
      return headers.has('set-cookie')
    },
    parseCookies() {
      return headers
        .entries()
        .filter(([key]) => key.trim().toLowerCase() === 'set-cookie')
        .flatMap(([, value]) => splitCombinedSetCookieHeader(value).flatMap(parseSetCookieForScript))
    },
    body: response.body,
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
    stringify(cookies: Array<ReturnType<typeof parseSetCookieForScript>[number]>) {
      if (!Array.isArray(cookies)) {
        throw new Error('cookies.stringify requires an array')
      }

      return cookies.map(stringifyScriptCookie).join(', ')
    },
  }
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

function parseSetCookieForScript(value: string) {
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

  const cookie = {
    name,
    value: segments[0].slice(separatorIndex + 1),
    domain: null as string | null,
    path: null as string | null,
    secure: false,
    httpOnly: false,
    sameSite: null as 'strict' | 'lax' | 'none' | null,
    expires: null as string | null,
    maxAge: null as number | null,
  }

  for (const attribute of segments.slice(1)) {
    const attributeSeparatorIndex = attribute.indexOf('=')
    const attributeName = (attributeSeparatorIndex === -1 ? attribute : attribute.slice(0, attributeSeparatorIndex))
      .trim()
      .toLowerCase()
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
      cookie.sameSite = normalizeCookieSameSite(attributeValue)
    } else if (attributeName === 'expires') {
      cookie.expires = attributeValue || null
    } else if (attributeName === 'max-age') {
      const parsed = Number.parseInt(attributeValue, 10)
      cookie.maxAge = Number.isFinite(parsed) ? parsed : null
    }
  }

  return [cookie]
}

function stringifyScriptCookie(cookie: ReturnType<typeof parseSetCookieForScript>[number]) {
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
    parts.push(`SameSite=${cookie.sameSite.charAt(0).toUpperCase() + cookie.sameSite.slice(1)}`)
  }

  return parts.join('; ')
}

function normalizeCookieSameSite(value: string) {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'strict' || normalized === 'lax' || normalized === 'none') {
    return normalized
  }

  return null
}

function createEnvironmentApi(snapshot: ViewRuntimePayload['env']) {
  const environments = snapshot.environments.map(environment => ({ ...environment, values: { ...environment.values } }))
  let activeValues = { ...snapshot.activeValues }
  const owners = new Map(Object.entries(snapshot.owners))
  let defaultEnvironmentId = snapshot.defaultEnvironmentId || environments[0]?.id || null

  const findEnvironmentByName = (environmentName: string) => {
    const normalizedName = environmentName.trim()
    return (
      environments.find(environment => environment.name.trim() === normalizedName) ||
      environments.find(environment => environment.name.trim().toLowerCase() === normalizedName.toLowerCase()) ||
      null
    )
  }

  return {
    get(name: string, environmentName?: string) {
      if (environmentName) {
        return findEnvironmentByName(environmentName)?.values[name] ?? null
      }

      return activeValues[name] ?? null
    },
    has(name: string, environmentName?: string) {
      return this.get(name, environmentName) !== null
    },
    set(name: string, value: string, environmentName?: string) {
      const targetEnvironment = environmentName
        ? findEnvironmentByName(environmentName)
        : environments.find(environment => environment.id === owners.get(name)) ||
          environments.find(environment => environment.id === defaultEnvironmentId) ||
          environments[0] ||
          null

      if (!targetEnvironment) {
        throw new Error(
          environmentName ? 'Environment not found for env.set' : 'No active environment is available for env.set'
        )
      }

      targetEnvironment.values[name] = value
      owners.set(name, targetEnvironment.id)
      if (!defaultEnvironmentId) {
        defaultEnvironmentId = targetEnvironment.id
      }
      activeValues = { ...activeValues, [name]: value }
    },
  }
}

function createScopeApi(snapshot: Record<string, string>) {
  const values = new Map(Object.entries(snapshot))

  return {
    get(name: string) {
      return values.get(name) ?? null
    },
    has(name: string) {
      return values.has(name)
    },
    set(name: string, value: string) {
      values.set(name, value)
    },
  }
}

function createTableComponent() {
  return function Table({
    list,
    columns,
    emptyMessage = 'No rows',
  }: {
    list: unknown
    columns?: string[]
    emptyMessage?: string
  }) {
    const rows = Array.isArray(list) ? list.filter(isRecordLike) : []
    const inferredColumns = rows[0] ? Object.keys(rows[0]) : []
    const visibleColumns = (columns && columns.length > 0 ? columns : inferredColumns).filter(Boolean)

    if (rows.length === 0 || visibleColumns.length === 0) {
      return (
        <div
          style={{
            border: '1px solid color-mix(in oklab, var(--color-base-content) 12%, transparent)',
            background: 'color-mix(in oklab, var(--color-base-200) 45%, transparent)',
            color: 'color-mix(in oklab, var(--color-base-content) 58%, transparent)',
            borderRadius: 14,
            padding: 16,
            fontSize: 13,
          }}
        >
          {emptyMessage}
        </div>
      )
    }

    return (
      <div
        style={{
          overflow: 'hidden',
          borderRadius: 16,
          border: '1px solid color-mix(in oklab, var(--color-base-content) 12%, transparent)',
          background: 'color-mix(in oklab, var(--color-base-200) 28%, transparent)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                {visibleColumns.map(column => (
                  <th
                    key={column}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      color: 'color-mix(in oklab, var(--color-base-content) 66%, transparent)',
                      background: 'color-mix(in oklab, var(--color-base-300) 42%, transparent)',
                      borderBottom: '1px solid color-mix(in oklab, var(--color-base-content) 10%, transparent)',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={String(row.id ?? row.key ?? index)}>
                  {visibleColumns.map(column => (
                    <td
                      key={`${index}-${column}`}
                      style={{
                        padding: '10px 12px',
                        fontSize: 13,
                        color: 'var(--color-base-content)',
                        borderBottom:
                          index === rows.length - 1
                            ? 'none'
                            : '1px solid color-mix(in oklab, var(--color-base-content) 8%, transparent)',
                        verticalAlign: 'top',
                      }}
                    >
                      {formatTableValue(row[column])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }
}

function createRuntimeCodeEditor(): RuntimeCodeEditorComponent {
  return function RuntimeCodeEditor({ onChange, ...props }: React.ComponentProps<typeof CodeEditor>) {
    return <CodeEditor {...props} onChange={onChange ?? noopCodeEditorOnChange} />
  }
}

function isRecordLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function formatTableValue(value: unknown) {
  if (value == null) {
    return ''
  }

  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function parseHeadersToEntries(rawHeaders: string) {
  return rawHeaders
    .split('\n')
    .map(line => {
      const separatorIndex = line.indexOf(':')
      if (separatorIndex < 0) {
        return null
      }

      return {
        key: line.slice(0, separatorIndex).trim(),
        value: line.slice(separatorIndex + 1).trim(),
      }
    })
    .filter((entry): entry is { key: string; value: string } => entry !== null)
}

function createEmptyPayload(): ViewRuntimePayload {
  return {
    env: {
      activeValues: {},
      environments: [],
      defaultEnvironmentId: null,
      owners: {},
    },
    scope: {},
    cache: {},
    sharedScripts: [],
    scriptPackages: [],
  }
}

function flushPendingRunTrigger() {
  if (!hasPendingRunTrigger) {
    return
  }

  console.debug('[view-runtime] flush pending run trigger')
  if (triggerRunner()) {
    hasPendingRunTrigger = false
    cancelPendingRunFrame()
    console.debug('[view-runtime] run trigger delivered')
    return
  }

  schedulePendingRunRetry()
}

function triggerRunner() {
  const runner = document.getElementById('runner')
  if (!(runner instanceof HTMLElement)) {
    console.debug('[view-runtime] runner not found')
    return false
  }

  console.debug('[view-runtime] clicking runner')
  runner.click()
  return true
}

function schedulePendingRunRetry() {
  if (pendingRunFrameId !== null) {
    return
  }

  pendingRunFrameId = window.requestAnimationFrame(() => {
    pendingRunFrameId = null
    flushPendingRunTrigger()
  })
}

function cancelPendingRunFrame() {
  if (pendingRunFrameId === null) {
    return
  }

  window.cancelAnimationFrame(pendingRunFrameId)
  pendingRunFrameId = null
}
