import type { ScriptAutocompletePhase, ScriptRuntimeContext } from './scriptRuntimeDeclarations'
import type {
  ScriptAutocompleteRequest,
  ScriptAutocompletePackage,
  ScriptAutocompleteResponse,
  ScriptHoverRequest,
  ScriptHoverResponse,
  ScriptHoverSuccess,
  ScriptAutocompleteSharedScript,
  ScriptAutocompleteSuccess,
  ScriptDiagnosticsRequest,
  ScriptDiagnosticsResponse,
  ScriptDiagnosticsSuccess,
} from './scriptAutocompleteTypes'

class ScriptAutocompleteClient {
  private readonly worker = new Worker(new URL('generated/script-autocomplete/scriptAutocomplete.worker.js', document.baseURI), {
    type: 'module',
  })
  private nextRequestId = 1
  private readonly pendingAutocomplete = new Map<
    number,
    { resolve: (value: ScriptAutocompleteSuccess | null) => void; reject: (reason?: unknown) => void }
  >()
  private readonly pendingDiagnostics = new Map<
    number,
    { resolve: (value: ScriptDiagnosticsSuccess | null) => void; reject: (reason?: unknown) => void }
  >()
  private readonly pendingHover = new Map<number, { resolve: (value: ScriptHoverSuccess | null) => void; reject: (reason?: unknown) => void }>()

  constructor() {
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleError)
  }

  dispose() {
    this.worker.removeEventListener('message', this.handleMessage)
    this.worker.removeEventListener('error', this.handleError)
    this.worker.terminate()
  }

  request(input: {
    phase?: ScriptAutocompletePhase
    runtimeContext?: ScriptRuntimeContext
    code: string
    position: number
    requestPaths?: string[][]
    sharedScripts?: ScriptAutocompleteSharedScript[]
    packages?: ScriptAutocompletePackage[]
    signal?: AbortSignal
  }) {
    const requestId = this.nextRequestId++
    const payload: ScriptAutocompleteRequest = {
      type: 'autocomplete',
      requestId,
      runtimeContext: input.runtimeContext ?? { phase: input.phase ?? 'pre-request' },
      code: input.code,
      position: input.position,
      requestPaths: input.requestPaths,
      sharedScripts: input.sharedScripts,
      packages: input.packages,
    }

    return new Promise<ScriptAutocompleteSuccess | null>((resolve, reject) => {
      this.pendingAutocomplete.set(requestId, { resolve, reject })

      const onAbort = () => {
        this.pendingAutocomplete.delete(requestId)
        resolve(null)
      }

      if (input.signal) {
        if (input.signal.aborted) {
          onAbort()
          return
        }

        input.signal.addEventListener('abort', onAbort, { once: true })
      }

      this.worker.postMessage(payload)
    })
  }

  requestDiagnostics(input: {
    phase?: ScriptAutocompletePhase
    runtimeContext?: ScriptRuntimeContext
    code: string
    requestPaths?: string[][]
    sharedScripts?: ScriptAutocompleteSharedScript[]
    packages?: ScriptAutocompletePackage[]
    signal?: AbortSignal
  }) {
    const requestId = this.nextRequestId++
    const payload: ScriptDiagnosticsRequest = {
      type: 'diagnostics',
      requestId,
      runtimeContext: input.runtimeContext ?? { phase: input.phase ?? 'pre-request' },
      code: input.code,
      requestPaths: input.requestPaths,
      sharedScripts: input.sharedScripts,
      packages: input.packages,
    }

    return new Promise<ScriptDiagnosticsSuccess | null>((resolve, reject) => {
      this.pendingDiagnostics.set(requestId, { resolve, reject })

      const onAbort = () => {
        this.pendingDiagnostics.delete(requestId)
        resolve(null)
      }

      if (input.signal) {
        if (input.signal.aborted) {
          onAbort()
          return
        }

        input.signal.addEventListener('abort', onAbort, { once: true })
      }

      this.worker.postMessage(payload)
    })
  }

  requestHover(input: {
    phase?: ScriptAutocompletePhase
    runtimeContext?: ScriptRuntimeContext
    code: string
    position: number
    requestPaths?: string[][]
    sharedScripts?: ScriptAutocompleteSharedScript[]
    packages?: ScriptAutocompletePackage[]
    signal?: AbortSignal
  }) {
    const requestId = this.nextRequestId++
    const payload: ScriptHoverRequest = {
      type: 'hover',
      requestId,
      runtimeContext: input.runtimeContext ?? { phase: input.phase ?? 'pre-request' },
      code: input.code,
      position: input.position,
      requestPaths: input.requestPaths,
      sharedScripts: input.sharedScripts,
      packages: input.packages,
    }

    return new Promise<ScriptHoverSuccess | null>((resolve, reject) => {
      this.pendingHover.set(requestId, { resolve, reject })

      const onAbort = () => {
        this.pendingHover.delete(requestId)
        resolve(null)
      }

      if (input.signal) {
        if (input.signal.aborted) {
          onAbort()
          return
        }

        input.signal.addEventListener('abort', onAbort, { once: true })
      }

      this.worker.postMessage(payload)
    })
  }

  private readonly handleMessage = (event: MessageEvent<ScriptAutocompleteResponse | ScriptDiagnosticsResponse | ScriptHoverResponse>) => {
    const result = event.data
    const pendingAutocomplete = this.pendingAutocomplete.get(result.requestId)
    if (pendingAutocomplete) {
      this.pendingAutocomplete.delete(result.requestId)
      if (result.success && 'options' in result) {
        pendingAutocomplete.resolve(result)
        return
      }

      pendingAutocomplete.reject(new Error(!result.success ? result.error : 'Mismatched autocomplete worker response'))
      return
    }

    const pendingHover = this.pendingHover.get(result.requestId)
    if (pendingHover) {
      this.pendingHover.delete(result.requestId)
      if (result.success && 'hover' in result) {
        pendingHover.resolve(result)
        return
      }

      pendingHover.reject(new Error(!result.success ? result.error : 'Mismatched hover worker response'))
      return
    }

    const pendingDiagnostics = this.pendingDiagnostics.get(result.requestId)
    if (!pendingDiagnostics) {
      return
    }

    this.pendingDiagnostics.delete(result.requestId)
    if (result.success && 'diagnostics' in result) {
      pendingDiagnostics.resolve(result)
      return
    }

    pendingDiagnostics.reject(new Error(!result.success ? result.error : 'Mismatched diagnostics worker response'))
  }

  private readonly handleError = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || 'Script autocomplete worker failed')
    for (const pending of this.pendingAutocomplete.values()) {
      pending.reject(error)
    }
    for (const pending of this.pendingDiagnostics.values()) {
      pending.reject(error)
    }
    for (const pending of this.pendingHover.values()) {
      pending.reject(error)
    }
    this.pendingAutocomplete.clear()
    this.pendingDiagnostics.clear()
    this.pendingHover.clear()
  }
}

let client: ScriptAutocompleteClient | null = null

function getClient() {
  client ??= new ScriptAutocompleteClient()
  return client
}

function resetClient() {
  client?.dispose()
  client = null
}

export function requestScriptAutocomplete(input: {
  phase?: ScriptAutocompletePhase
  runtimeContext?: ScriptRuntimeContext
  code: string
  position: number
  requestPaths?: string[][]
  sharedScripts?: ScriptAutocompleteSharedScript[]
  packages?: ScriptAutocompletePackage[]
  signal?: AbortSignal
}) {
  return requestWithRetry(currentClient => currentClient.request(input))
}

export function requestScriptDiagnostics(input: {
  phase?: ScriptAutocompletePhase
  runtimeContext?: ScriptRuntimeContext
  code: string
  requestPaths?: string[][]
  sharedScripts?: ScriptAutocompleteSharedScript[]
  packages?: ScriptAutocompletePackage[]
  signal?: AbortSignal
}) {
  return requestWithRetry(currentClient => currentClient.requestDiagnostics(input))
}

export function requestScriptHover(input: {
  phase?: ScriptAutocompletePhase
  runtimeContext?: ScriptRuntimeContext
  code: string
  position: number
  requestPaths?: string[][]
  sharedScripts?: ScriptAutocompleteSharedScript[]
  packages?: ScriptAutocompletePackage[]
  signal?: AbortSignal
}) {
  return requestWithRetry(currentClient => currentClient.requestHover(input))
}

async function requestWithRetry<T>(request: (client: ScriptAutocompleteClient) => Promise<T>) {
  try {
    return await request(getClient())
  } catch (error) {
    console.warn('[script-autocomplete] request failed, resetting worker and retrying once', error)
    resetClient()
    return await request(getClient())
  }
}
