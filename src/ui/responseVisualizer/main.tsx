import '../App.css'
import './responseVisualizer.css'
import React, { type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import ts from 'typescript'
import { z } from 'zod'

type VisualizerResponseApi = {
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

type VisualizerPayload = {
  response: VisualizerResponseApi | null
  request: {
    method: string
    url: string
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
}

type VisualizerErrorDetails = {
  compactMessage: string
  detailedMessage: string
}

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
    renderVisualizer(code, payload ?? createEmptyPayload())
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

function renderVisualizer(source: string, payload: VisualizerPayload) {
  const transpiled = compileVisualizer(source)
  const rendered = runVisualizer(transpiled, payload)

  root.render(
    <VisualizerErrorBoundary source={source}>
      {rendered}
    </VisualizerErrorBoundary>
  )
}

function runVisualizer(code: string, payload: VisualizerPayload) {
  const module = { exports: {} as Record<string, unknown> }
  const exports = module.exports
  const requestHeaders = createHeaderApi(payload.request.headers)
  const request = {
    method: payload.request.method,
    url: payload.request.url,
    body: payload.request.body,
    bodyType: payload.request.bodyType,
    rawType: payload.request.rawType,
    headers: requestHeaders,
  }
  const env = createEnvironmentApi(payload.env)
  const scope = createScopeApi(payload.scope)
  const response = payload.response
  const Table = createTableComponent()
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
    'crypto',
    'z',
    'Table',
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
    crypto,
    z,
    Table
  )

  const component = module.exports.default || exports.default
  if (typeof component !== 'function') {
    throw new Error('Response visualizer must export default a component function.')
  }

  return React.createElement(component as React.ComponentType)
}

function renderError(error: VisualizerErrorDetails) {
  root.render(
    <pre className="error">
      {`${error.compactMessage}\n\n${error.detailedMessage}`.trim()}
    </pre>
  )
}

function formatVisualizerDiagnostic(diagnostic: ts.Diagnostic, source: string): VisualizerErrorDetails {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  const location = diagnostic.file && typeof diagnostic.start === 'number'
    ? diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    : null
  const line = location ? location.line + 1 : null
  const column = location ? location.character + 1 : null
  const sourceLine = line ? source.split('\n')[line - 1]?.trimEnd() ?? null : null
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
  const stack = error instanceof Error ? error.stack ?? '' : ''
  const location = extractVisualizerRuntimeLocation(stack, source)
  const compactMessage = location?.line ? `Response Visualizer:${location.line} ${message}` : `Response Visualizer ${message}`
  const detailedLines = ['Phase: Response Visualizer']

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
        throw new Error(environmentName ? 'Environment not found for env.set' : 'No active environment is available for env.set')
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
  }
}
