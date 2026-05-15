import '../App.css'
import './responseVisualizer.css'
import React, { type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import ts from 'typescript'
import { z } from 'zod'
import type { HttpAuth } from '@common/Auth'
import { getAuthQueryParams, resolveAuth } from '@common/Auth'
import { formatXml } from '@common/formatXml'
import { formatJson } from '@common/Json5'
import { parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'
import { applyPathParamsToUrl, applySearchParamsToUrl } from '@common/PathParams'
import { resolveTemplateVariables } from '@common/RequestVariables'
import { parseScriptPackageSpecifier, type ScriptPackageArtifact } from '@common/ScriptPackages'
import type { SharedScriptRecord } from '@common/SharedScripts'
import { CodeEditor } from '../folders/CodeEditor'

type VisualizerResponsePayload = {
  status: number
  statusText: string
  headers: Record<string, string>
  body:
    | {
        type: 'json'
        data: unknown
      }
    | {
        type: 'text'
        data: string
      }
}

type VisualizerResponseApi = {
  status: number
  statusText: string
  headers: ReturnType<typeof createHeaderApi>
  hasCookies: () => boolean
  parseCookies: () => Array<ReturnType<typeof parseSetCookieForScript>[number]>
  body:
    | {
        type: 'json'
        data: unknown
      }
    | {
        type: 'text'
        data: string
      }
}

type VisualizerPayload = {
  response: VisualizerResponsePayload | null
  request: {
    method: string
    url: string
    pathParams: string
    searchParams: string
    auth: HttpAuth
    body: string
    bodyType: string
    rawType: string
    headers: Array<{ key: string; value: string }>
  }
  env: {
    activeValues: Record<string, string>
    environments: Array<{
      id: string
      name: string
      values: Record<string, string>
    }>
    defaultEnvironmentId: string | null
    owners: Record<string, string>
  }
  scope: Record<string, string>
  sharedScripts: Array<Pick<SharedScriptRecord, 'id' | 'name' | 'kind' | 'code' | 'targets' | 'isActive'>>
  scriptPackages: Array<Pick<ScriptPackageArtifact, 'cacheKey' | 'packageName' | 'packageVersion' | 'browserBundleCode'>>
}

type VisualizerErrorDetails = {
  compactMessage: string
  detailedMessage: string
}

type VisualizerCodeEditorComponent = React.ComponentType<React.ComponentProps<typeof CodeEditor>>

const noopCodeEditorOnChange = () => undefined

const READY_EVENT = 'kova-response-visualizer-ready'
const RENDER_EVENT = 'kova-response-visualizer-render'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Response visualizer root not found')
}
const root = createRoot(rootElement)

window.addEventListener('message', event => {
  if (event.data?.type !== RENDER_EVENT) {
    return
  }

  const code = typeof event.data.code === 'string' ? event.data.code : ''
  const payload = event.data.payload as VisualizerPayload | undefined

  if (!code.trim()) {
    renderEmptyState()
    return
  }

  try {
    void renderVisualizer(code, payload ?? createEmptyPayload()).catch(error => {
      renderError(formatVisualizerError(error, code))
    })
  } catch (error) {
    renderError(formatVisualizerError(error, code))
  }
})

window.parent.postMessage({ type: READY_EVENT }, '*')

function compileVisualizer(source: string) {
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
    fileName: 'response-visualizer.tsx',
    reportDiagnostics: true,
  })

  const diagnostics = (result.diagnostics ?? [])
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
    .map(diagnostic => formatVisualizerDiagnostic(diagnostic, source))

  if (diagnostics.length > 0) {
    throw createVisualizerError({
      compactMessage: diagnostics[0]?.compactMessage ?? 'Response Visualizer Compile Error',
      detailedMessage: diagnostics.map(diagnostic => diagnostic.detailedMessage).join('\n\n'),
    })
  }

  return result.outputText
}

async function renderVisualizer(source: string, payload: VisualizerPayload) {
  const globalScripts = payload.sharedScripts.filter(
    script => script.isActive && script.kind === 'global' && script.targets.includes('response-visualizer')
  )
  const combinedSource = [...globalScripts.map(script => script.code), source].filter(Boolean).join('\n\n')
  const transpiled = compileVisualizer(combinedSource)
  const rendered = await runVisualizer(transpiled, payload)

  root.render(<VisualizerErrorBoundary source={source}>{rendered}</VisualizerErrorBoundary>)
}

async function runVisualizer(code: string, payload: VisualizerPayload) {
  const module = { exports: {} as Record<string, unknown> }
  const exports = module.exports
  const request = createRequestApi(payload)
  const env = createEnvironmentApi(payload.env)
  const scope = createScopeApi(payload.scope)
  const cookies = createCookiesApi()
  const response: VisualizerResponseApi | null = payload.response
    ? {
        ...payload.response,
        headers: createHeaderApi(Object.entries(payload.response.headers).map(([key, value]) => ({ key, value }))),
        hasCookies() {
          return this.headers.has('set-cookie')
        },
        parseCookies() {
          return this.headers
            .entries()
            .filter(([key]) => key.trim().toLowerCase() === 'set-cookie')
            .flatMap(([, value]) => splitCombinedSetCookieHeader(value).flatMap(parseSetCookieForScript))
        },
      }
    : null
  const Table = createTableComponent()
  const VisualizerCodeEditor = createVisualizerCodeEditor()
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
    request,
    response,
    cookies,
    Table,
    CodeEditor: VisualizerCodeEditor,
  })

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
    'request',
    'response',
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
    `${code}\n//# sourceURL=response-visualizer.js`
  )(
    module,
    exports,
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
    console,
    env,
    scope,
    request,
    response,
    requirePackage,
    requireScript,
    requirePackage,
    crypto,
    cookies,
    z,
    formatXml,
    formatJson,
    Table,
    VisualizerCodeEditor
  )

  const component = module.exports.default || exports.default
  if (typeof component !== 'function') {
    throw new Error('Response visualizer must export default a component function.')
  }

  return React.createElement(component as React.ComponentType)
}

function createSharedScriptModuleLoader(
  payload: VisualizerPayload,
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
    request: {
      method: string
      url: string
      body: string
      bodyType: string
      rawType: string
      headers: ReturnType<typeof createHeaderApi>
    }
    response: VisualizerResponseApi | null
    cookies: ReturnType<typeof createCookiesApi>
    Table: ReturnType<typeof createTableComponent>
    CodeEditor: VisualizerCodeEditorComponent
  }
) {
  const modulesByName = new Map(
    payload.sharedScripts
      .filter(
        script =>
          script.isActive &&
          script.kind === 'module' &&
          script.targets.includes('response-visualizer') &&
          script.name.trim()
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
      const compiled = compileVisualizer(script.code)
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
        'request',
        'response',
        'require',
        'requireScript',
        'loadPackage',
        'crypto',
        'z',
        'formatXml',
        'formatJson',
        'Table',
        'CodeEditor',
        `${compiled}\n//# sourceURL=response-visualizer-shared.js`
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
        globals.request,
        globals.response,
        requirePackage,
        loadModule,
        requirePackage,
        crypto,
        z,
        formatXml,
        formatJson,
        globals.Table,
        globals.CodeEditor
      )

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

function createInstalledBrowserPackageLoader(
  scriptPackages: VisualizerPayload['scriptPackages']
) {
  const moduleCache = new Map<string, Record<string, unknown>>()
  const loadPackage = (specifier: string) => {
    const parsedSpecifier = parseScriptPackageSpecifier(specifier)
    if (!parsedSpecifier) {
      throw new Error(`Package specifier ${specifier} is invalid`)
    }

    if (parsedSpecifier.subpath) {
      throw new Error(`Package subpath imports are not supported in the response visualizer yet: ${specifier}`)
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
    new Function('module', 'exports', 'require', `${selectedPackage.browserBundleCode}\n//# sourceURL=${selectedPackage.packageName}.bundle.js`)(
      module,
      exports,
      createVisualizerExternalRequire(loadPackage)
    )
    moduleCache.set(selectedPackage.cacheKey, module.exports)
    return module.exports
  }

  return loadPackage
}

function createVisualizerExternalRequire(loadPackage: (specifier: string) => unknown) {
  const reactModule = {
    ...React,
    default: React,
  }
  const jsxRuntimeModule = {
    Fragment: React.Fragment,
    jsx: (type: React.ElementType, props: Record<string, unknown>, key?: string) => React.createElement(type, { ...props, key }),
    jsxs: (type: React.ElementType, props: Record<string, unknown>, key?: string) => React.createElement(type, { ...props, key }),
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

function renderError(error: VisualizerErrorDetails) {
  root.render(<pre className="error">{`${error.compactMessage}\n\n${error.detailedMessage}`.trim()}</pre>)
}

function formatVisualizerDiagnostic(diagnostic: ts.Diagnostic, source: string): VisualizerErrorDetails {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  const location =
    diagnostic.file && typeof diagnostic.start === 'number'
      ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
      : null
  const line = location ? location.line + 1 : null
  const column = location ? location.character + 1 : null
  const sourceLine = line ? (source.split('\n')[line - 1]?.trimEnd() ?? null) : null
  const compactMessage = line ? `Response Visualizer:${line} ${message}` : `Response Visualizer ${message}`
  const detailedLines = ['Phase: Response Visualizer']

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

function formatVisualizerError(error: unknown, source: string): VisualizerErrorDetails {
  if (isVisualizerError(error)) {
    return error.details
  }

  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error ? (error.stack ?? '') : ''
  const location = extractVisualizerRuntimeLocation(stack, source)
  const compactMessage = location?.line
    ? `Response Visualizer:${location.line} ${message}`
    : `Response Visualizer ${message}`
  const detailedLines = ['Phase: Response Visualizer']

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

function extractVisualizerRuntimeLocation(stack: string, source: string) {
  const match = stack.match(/(?:response-visualizer\.(?:tsx|js)|<anonymous>):(\d+):(\d+)/)
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

function createVisualizerError(details: VisualizerErrorDetails) {
  const error = new Error(details.compactMessage)
  ;(error as Error & { details: VisualizerErrorDetails }).details = details
  return error
}

function isVisualizerError(error: unknown): error is Error & { details: VisualizerErrorDetails } {
  return typeof error === 'object' && error !== null && 'details' in error
}

function renderEmptyState() {
  root.render(<div className="empty">Add a response visualizer to render custom JSX.</div>)
}

type VisualizerErrorBoundaryProps = {
  source: string
  children: ReactNode
}

type VisualizerErrorBoundaryState = {
  error: VisualizerErrorDetails | null
}

class VisualizerErrorBoundary extends React.Component<VisualizerErrorBoundaryProps, VisualizerErrorBoundaryState> {
  state: VisualizerErrorBoundaryState = {
    error: null,
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    const combinedStack = [error.stack, info.componentStack].filter(Boolean).join('\n')
    error.stack = combinedStack
    this.setState({
      error: formatVisualizerError(error, this.props.source),
    })
  }

  componentDidUpdate(previousProps: VisualizerErrorBoundaryProps) {
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

function createEnvironmentApi(snapshot: VisualizerPayload['env']) {
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

function createRequestApi(payload: VisualizerPayload) {
  const state = {
    method: payload.request.method,
    url: payload.request.url,
    pathParams: payload.request.pathParams,
    searchParams: payload.request.searchParams,
    auth: payload.request.auth,
    body: payload.request.body,
    bodyType: payload.request.bodyType,
    rawType: payload.request.rawType,
  }

  const headers = createHeaderApi(payload.request.headers)

  return {
    get method() {
      return state.method
    },
    set method(value: string) {
      state.method = value
    },
    get url() {
      return state.url
    },
    set url(value: string) {
      state.url = value
    },
    get body() {
      return state.body
    },
    set body(value: string) {
      state.body = value
    },
    get bodyType() {
      return state.bodyType
    },
    get rawType() {
      return state.rawType
    },
    get pathParams() {
      return createLivePathParamsApi(state)
    },
    set pathParams(value: Array<{ key: string; value: string; enabled: boolean; description: string }>) {
      state.pathParams = stringifyKeyValueRows(
        value.map((row, index) => ({
          id: `visualizer-path-param-${index}`,
          key: row.key,
          value: row.value,
          enabled: row.enabled,
          description: row.description,
        }))
      )
    },
    resolveUrl() {
      return resolveRequestUrl(state, payload.env.activeValues)
    },
    headers,
  }
}

function createLivePathParamsApi(state: { pathParams: string }) {
  return parseKeyValueRows(state.pathParams).map((_, index) => ({
    get key() {
      return parseKeyValueRows(state.pathParams)[index]?.key ?? ''
    },
    set key(value: string) {
      updatePathParam(state, index, { key: value })
    },
    get value() {
      return parseKeyValueRows(state.pathParams)[index]?.value ?? ''
    },
    set value(value: string) {
      updatePathParam(state, index, { value })
    },
    get enabled() {
      return parseKeyValueRows(state.pathParams)[index]?.enabled ?? true
    },
    set enabled(value: boolean) {
      updatePathParam(state, index, { enabled: value })
    },
    get description() {
      return parseKeyValueRows(state.pathParams)[index]?.description ?? ''
    },
    set description(value: string) {
      updatePathParam(state, index, { description: value })
    },
  }))
}

function updatePathParam(
  state: { pathParams: string },
  index: number,
  partial: Partial<{ key: string; value: string; enabled: boolean; description: string }>
) {
  const rows = parseKeyValueRows(state.pathParams)
  const currentRow = rows[index]
  if (!currentRow) {
    return
  }

  rows[index] = {
    ...currentRow,
    key: partial.key ?? currentRow.key,
    value: partial.value ?? currentRow.value,
    enabled: partial.enabled ?? currentRow.enabled,
    description: partial.description ?? currentRow.description,
  }

  state.pathParams = stringifyKeyValueRows(rows)
}

function resolveRequestUrl(
  request: { url: string; pathParams: string; searchParams: string; auth: HttpAuth },
  variables: Record<string, string>
) {
  const urlWithTemplatesResolved = resolveTemplateVariables(request.url, variables).trim()
  const resolvedPathParams = resolveTemplateVariables(request.pathParams, variables)
  const { url: urlWithPathParams } = applyPathParamsToUrl(urlWithTemplatesResolved, resolvedPathParams)
  const urlWithSearchParams = applySearchParamsToUrl(urlWithPathParams, request.searchParams, variables)

  return applyAuthToUrl(urlWithSearchParams, resolveAuth(request.auth, variables))
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

function createVisualizerCodeEditor(): VisualizerCodeEditorComponent {
  return function VisualizerCodeEditor({ onChange, ...props }: React.ComponentProps<typeof CodeEditor>) {
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

function createEmptyPayload(): VisualizerPayload {
  return {
    response: null,
    request: {
      method: '',
      url: '',
      pathParams: '',
      searchParams: '',
      auth: { type: 'noauth' },
      body: '',
      bodyType: 'none',
      rawType: 'text',
      headers: [],
    },
    env: {
      activeValues: {},
      environments: [],
      defaultEnvironmentId: null,
      owners: {},
    },
    scope: {},
    sharedScripts: [],
    scriptPackages: [],
  }
}
