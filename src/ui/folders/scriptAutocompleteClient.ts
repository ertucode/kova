import type { ScriptAutocompletePhase } from './scriptRuntimeDeclarations'
import type { ScriptAutocompleteRequest, ScriptAutocompleteResponse, ScriptAutocompleteSuccess } from './scriptAutocompleteTypes'

class ScriptAutocompleteClient {
  private readonly worker = new Worker(new URL('./scriptAutocomplete.worker.ts', import.meta.url), { type: 'module' })
  private nextRequestId = 1
  private readonly pending = new Map<number, { resolve: (value: ScriptAutocompleteSuccess | null) => void; reject: (reason?: unknown) => void }>()

  constructor() {
    this.worker.addEventListener('message', this.handleMessage)
    this.worker.addEventListener('error', this.handleError)
  }

  request(input: { phase: ScriptAutocompletePhase; code: string; position: number; signal?: AbortSignal }) {
    const requestId = this.nextRequestId++
    const payload: ScriptAutocompleteRequest = {
      requestId,
      phase: input.phase,
      code: input.code,
      position: input.position,
    }

    return new Promise<ScriptAutocompleteSuccess | null>((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject })

      const onAbort = () => {
        this.pending.delete(requestId)
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

  private readonly handleMessage = (event: MessageEvent<ScriptAutocompleteResponse>) => {
    const result = event.data
    const pending = this.pending.get(result.requestId)
    if (!pending) {
      return
    }

    this.pending.delete(result.requestId)
    if (result.success) {
      pending.resolve(result)
      return
    }

    pending.reject(new Error(result.error))
  }

  private readonly handleError = (event: ErrorEvent) => {
    const error = event.error instanceof Error ? event.error : new Error(event.message || 'Script autocomplete worker failed')
    for (const pending of this.pending.values()) {
      pending.reject(error)
    }
    this.pending.clear()
  }
}

let client: ScriptAutocompleteClient | null = null

export function requestScriptAutocomplete(input: { phase: ScriptAutocompletePhase; code: string; position: number; signal?: AbortSignal }) {
  client ??= new ScriptAutocompleteClient()
  return client.request(input)
}
