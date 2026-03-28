import type { ScriptAutocompletePhase } from './scriptRuntimeDeclarations'
import type {
  ScriptAutocompleteRequest,
  ScriptAutocompleteResponse,
  ScriptAutocompleteSuccess,
  ScriptDiagnosticsRequest,
  ScriptDiagnosticsResponse,
  ScriptDiagnosticsSuccess,
} from './scriptAutocompleteTypes'

class ScriptAutocompleteClient {
  private readonly worker = new Worker(new URL('./scriptAutocomplete.worker.ts', import.meta.url), { type: 'module' })
  private nextRequestId = 1
  private readonly pendingAutocomplete = new Map<
    number,
    { resolve: (value: ScriptAutocompleteSuccess | null) => void; reject: (reason?: unknown) => void }
  >()
  private readonly pendingDiagnostics = new Map<
    number,
    { resolve: (value: ScriptDiagnosticsSuccess | null) => void; reject: (reason?: unknown) => void }
  >()

  constructor() {
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleError)
  }

  request(input: { phase: ScriptAutocompletePhase; code: string; position: number; signal?: AbortSignal }) {
    const requestId = this.nextRequestId++
    const payload: ScriptAutocompleteRequest = {
      type: 'autocomplete',
      requestId,
      phase: input.phase,
      code: input.code,
      position: input.position,
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

  requestDiagnostics(input: { phase: ScriptAutocompletePhase; code: string; signal?: AbortSignal }) {
    const requestId = this.nextRequestId++
    const payload: ScriptDiagnosticsRequest = {
      type: 'diagnostics',
      requestId,
      phase: input.phase,
      code: input.code,
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

  private readonly handleMessage = (event: MessageEvent<ScriptAutocompleteResponse | ScriptDiagnosticsResponse>) => {
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
    this.pendingAutocomplete.clear()
    this.pendingDiagnostics.clear()
  }
}

let client: ScriptAutocompleteClient | null = null

export function requestScriptAutocomplete(input: { phase: ScriptAutocompletePhase; code: string; position: number; signal?: AbortSignal }) {
  client ??= new ScriptAutocompleteClient()
  return client.request(input)
}

export function requestScriptDiagnostics(input: { phase: ScriptAutocompletePhase; code: string; signal?: AbortSignal }) {
  client ??= new ScriptAutocompleteClient()
  return client.requestDiagnostics(input)
}
