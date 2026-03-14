import vm from 'node:vm'
import type { HttpAuth } from '../common/Auth.js'
import { buildEffectiveEnvironmentOwners, buildEnvironmentVariableMap, getResolvedEnvironmentValue } from '../common/EnvironmentVariables.js'
import { parseKeyValueRows, stringifyKeyValueRows } from '../common/KeyValueRows.js'
import type { EnvironmentRecord } from '../common/Environments.js'
import type {
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
  sourceName: string
  message: string
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
  getUpdatedEnvironments: () => EnvironmentRecord[]
  getConsoleEntries: () => RequestConsoleEntry[]
  runPreRequestScripts: (sources: ScriptSource[]) => Promise<void>
  runPostRequestScripts: (
    sources: ScriptSource[],
    response: { status: number; statusText: string; headers: string; body: ScriptResponseBody }
  ) => Promise<ScriptErrorDetails[]>
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
    getUpdatedEnvironments: () => environments.filter(environment => updatedEnvironmentIds.has(environment.id)),
    getConsoleEntries: () => consoleEntries.slice(),
    runPreRequestScripts: async sources => {
      try {
        await runScriptPhase({
          sources,
          runtimeRequest,
          requestScope,
          response: null,
          environmentContext: createEnvironmentContext(),
          consoleEntries,
        })
      } catch (error) {
        const scriptError = toScriptErrorDetails(error)
        throw new Error(`${scriptError.sourceName}: ${scriptError.message}`)
      }

      if (pendingEnvironmentIds.size > 0) {
        environments = await persistEnvironmentUpdates(environments, pendingEnvironmentIds)
        environmentValues = buildEnvironmentVariableMap(environments)
        environmentOwners = buildEffectiveEnvironmentOwners(environments)
        pendingEnvironmentIds.forEach(id => updatedEnvironmentIds.add(id))
        pendingEnvironmentIds = new Set<string>()
      }
    },
    runPostRequestScripts: async (sources, response) => {
      const snapshot = {
        environments: environments.map(environment => ({ ...environment })),
        values: { ...environmentValues },
        owners: new Map(environmentOwners),
        pendingIds: new Set(pendingEnvironmentIds),
      }

      try {
        await runScriptPhase({
          sources,
          runtimeRequest,
          requestScope,
          response,
          environmentContext: createEnvironmentContext(),
          consoleEntries,
        })

        if (pendingEnvironmentIds.size > 0) {
          environments = await persistEnvironmentUpdates(environments, pendingEnvironmentIds)
          environmentValues = buildEnvironmentVariableMap(environments)
          environmentOwners = buildEffectiveEnvironmentOwners(environments)
          pendingEnvironmentIds.forEach(id => updatedEnvironmentIds.add(id))
          pendingEnvironmentIds = new Set<string>()
        }

        return []
      } catch (error) {
        environments = snapshot.environments
        environmentValues = snapshot.values
        environmentOwners = snapshot.owners
        pendingEnvironmentIds = snapshot.pendingIds

        const scriptError = toScriptErrorDetails(error)

        return [
          {
            sourceName: scriptError.sourceName,
            message: scriptError.message,
          },
        ]
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

function toScriptErrorDetails(error: unknown): ScriptErrorDetails {
  if (typeof error === 'object' && error !== null && 'sourceName' in error && 'message' in error) {
    return {
      sourceName: String(error.sourceName),
      message: String(error.message),
    }
  }

  return {
    sourceName: 'Script',
    message: error instanceof Error ? error.message : String(error),
  }
}

async function runScriptPhase(input: {
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
    }

    try {
      await executeScript(source.script, sandbox)
      input.runtimeRequest.headers = headerEditor.serialize()
    } catch (error) {
      throw {
        sourceName: source.name,
        message: error instanceof Error ? error.message : String(error),
      }
    }
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
