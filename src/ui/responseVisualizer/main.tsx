import '../App.css'
import './responseVisualizer.css'
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

const READY_EVENT = 'kova-response-visualizer-ready'
const RENDER_EVENT = 'kova-response-visualizer-render'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Response visualizer root not found')
}
const root = rootElement

const Fragment = Symbol('Fragment')

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
    const transpiled = compileVisualizer(code)
    const rendered = runVisualizer(transpiled, payload ?? createEmptyPayload())
    renderIntoRoot(rendered)
  } catch (error) {
    renderError(error instanceof Error ? error.stack || error.message : String(error))
  }
})

window.parent.postMessage({ type: READY_EVENT }, '*')

function compileVisualizer(source: string) {
  const result = ts.transpileModule(source, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
      jsxFragmentFactory: 'Fragment',
      target: ts.ScriptTarget.ES2020,
      module: ts.ModuleKind.CommonJS,
    },
    reportDiagnostics: true,
  })

  const diagnostics = (result.diagnostics ?? [])
    .filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))

  if (diagnostics.length > 0) {
    throw new Error(diagnostics.join('\n\n'))
  }

  return result.outputText
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

  new Function(
    'module',
    'exports',
    'h',
    'Fragment',
    'console',
    'env',
    'scope',
    'request',
    'response',
    'crypto',
    'z',
    'Table',
    code
  )(module, exports, h, Fragment, console, env, scope, request, response, crypto, z, Table)

  const component = module.exports.default || exports.default
  if (typeof component !== 'function') {
    throw new Error('Response visualizer must export default a component function.')
  }

  return component({})
}

function h(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]) {
  const normalizedProps = props || {}
  const normalizedChildren: unknown[] = []

  for (const child of children) {
    if (Array.isArray(child)) {
      normalizedChildren.push(...child)
    } else {
      normalizedChildren.push(child)
    }
  }

  return { type, props: { ...normalizedProps, children: normalizedChildren } }
}

function renderIntoRoot(node: unknown) {
  root.replaceChildren(renderNode(node))
}

function renderNode(node: unknown): Node {
  if (node == null || node === false || node === true) {
    return document.createTextNode('')
  }

  if (Array.isArray(node)) {
    const fragment = document.createDocumentFragment()
    for (const child of node) {
      fragment.appendChild(renderNode(child))
    }
    return fragment
  }

  if (typeof node === 'string' || typeof node === 'number') {
    return document.createTextNode(String(node))
  }

  if (node instanceof Node) {
    return node
  }

  if (typeof node !== 'object' || !('type' in node)) {
    return document.createTextNode(String(node))
  }

  const renderableNode = node as {
    type: unknown
    props?: Record<string, unknown>
  }

  if (renderableNode.type === Fragment) {
    return renderNode(renderableNode.props?.children || [])
  }

  if (typeof renderableNode.type === 'function') {
    return renderNode(renderableNode.type(renderableNode.props || {}))
  }

  if (typeof renderableNode.type !== 'string') {
    throw new Error('Visualizer must return HTML-like JSX.')
  }

  const element = document.createElement(renderableNode.type)
  const props = (renderableNode.props || {}) as Record<string, unknown>

  for (const [key, value] of Object.entries(props)) {
    if (key === 'children' || value == null || value === false) {
      continue
    }

    if (key === 'className') {
      element.setAttribute('class', String(value))
      continue
    }

    if (key === 'style' && typeof value === 'object') {
      for (const [styleKey, styleValue] of Object.entries(value)) {
        element.style.setProperty(styleKey.replace(/[A-Z]/g, match => `-${match.toLowerCase()}`), String(styleValue))
      }
      continue
    }

    if (key === 'dangerouslySetInnerHTML' && typeof value === 'object' && '__html' in value) {
      element.innerHTML = String(value.__html || '')
      continue
    }

    if (key.startsWith('on') && typeof value === 'function') {
      element.addEventListener(key.slice(2).toLowerCase(), value as EventListener)
      continue
    }

    if (value === true) {
      element.setAttribute(key, '')
      continue
    }

    element.setAttribute(key, String(value))
  }

  if (!('dangerouslySetInnerHTML' in props)) {
    const children = Array.isArray(props.children) ? props.children : [props.children]
    for (const child of children) {
      element.appendChild(renderNode(child))
    }
  }

  return element
}

function renderError(message: string) {
  const element = document.createElement('pre')
  element.className = 'error'
  element.textContent = message
  root.replaceChildren(element)
}

function renderEmptyState() {
  const element = document.createElement('div')
  element.className = 'empty'
  element.textContent = 'Add a response visualizer to render custom JSX.'
  root.replaceChildren(element)
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
