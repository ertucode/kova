import type {
  ScriptCallRequestPayload,
  ScriptCallRequestRequest,
  ScriptCallRequestResponse,
  ScriptMakeRequestRequest,
  ScriptMakeRequestResponse,
} from '../common/ScriptMakeRequest.js'
import type { ScriptPromptResponse, ScriptPromptTextOptions } from '../common/ScriptPrompt.js'
import type { ScriptToastOptions } from '../common/ScriptToast.js'
import { emitGenericEventTo } from './generic-events.js'

export function createScriptToastBridge(webContents: Electron.WebContents) {
  return {
    show: (toast: ScriptToastOptions) => {
      emitGenericEventTo(webContents, { type: 'script-toast-show', toast })
    },
    hide: (id: string) => {
      emitGenericEventTo(webContents, { type: 'script-toast-hide', id })
    },
  }
}

export function createScriptPromptRegistry() {
  const pendingScriptPrompts = new Map<string, { webContentsId: number; resolve: (value: string | null) => void }>()

  return {
    createBridge(webContents: Electron.WebContents) {
      return {
        text: (options: ScriptPromptTextOptions) => {
          const promptId = crypto.randomUUID()

          return new Promise<string | null>(resolve => {
            pendingScriptPrompts.set(promptId, { webContentsId: webContents.id, resolve })
            emitGenericEventTo(webContents, {
              type: 'script-prompt-request',
              prompt: {
                id: promptId,
                kind: 'text',
                options,
              },
            })
          })
        },
      }
    },
    resolveResponse(input: ScriptPromptResponse, sender: Electron.WebContents) {
      const pendingPrompt = pendingScriptPrompts.get(input.id)
      if (!pendingPrompt) {
        return
      }

      if (pendingPrompt.webContentsId !== sender.id) {
        throw new Error('Script prompt response came from a different window')
      }

      pendingScriptPrompts.delete(input.id)
      pendingPrompt.resolve(input.value)
    },
  }
}

export function createScriptMakeRequestRegistry() {
  const pendingScriptRequests = new Map<
    string,
    { webContentsId: number; request: ScriptMakeRequestRequest; resolve: () => void; reject: (error: Error) => void }
  >()
  const pendingScriptCalls = new Map<
    string,
    {
      webContentsId: number
      request: ScriptCallRequestRequest
      resolve: (response: ScriptCallRequestPayload) => void
      reject: (error: Error) => void
    }
  >()

  return {
    createBridge(webContents: Electron.WebContents) {
      return {
        navigateAndCallRequest: (targetRequestId: string, path: string[]) => {
          const invocationId = crypto.randomUUID()
          const request: ScriptMakeRequestRequest = { id: invocationId, requestId: targetRequestId, path }

          return new Promise<void>((resolve, reject) => {
            pendingScriptRequests.set(invocationId, { webContentsId: webContents.id, request, resolve, reject })
            emitGenericEventTo(webContents, {
              type: 'script-make-request',
              request,
            })
          })
        },
        callRequest: (targetRequestId: string, path: string[]) => {
          const invocationId = crypto.randomUUID()
          const request: ScriptCallRequestRequest = { id: invocationId, requestId: targetRequestId, path }

          return new Promise<ScriptCallRequestPayload>((resolve, reject) => {
            pendingScriptCalls.set(invocationId, { webContentsId: webContents.id, request, resolve, reject })
            emitGenericEventTo(webContents, {
              type: 'script-call-request',
              request,
            })
          })
        },
      }
    },
    resolveResponse(input: ScriptMakeRequestResponse | ScriptCallRequestResponse, sender: Electron.WebContents) {
      const pendingRequest = pendingScriptRequests.get(input.id)
      if (pendingRequest) {
        if (pendingRequest.webContentsId !== sender.id) {
          throw new Error('Script navigateAndCallRequest response came from a different window')
        }

        pendingScriptRequests.delete(input.id)
        if (input.error) {
          pendingRequest.reject(new Error(input.error))
          return
        }

        pendingRequest.resolve()
        return
      }

      const pendingCall = pendingScriptCalls.get(input.id)
      if (!pendingCall) {
        return
      }

      if (pendingCall.webContentsId !== sender.id) {
        throw new Error('Script callRequest response came from a different window')
      }

      pendingScriptCalls.delete(input.id)
      if (input.error) {
        pendingCall.reject(new Error(input.error))
        return
      }

      if (!('response' in input) || !input.response) {
        pendingCall.reject(new Error('Script callRequest response was missing data'))
        return
      }

      pendingCall.resolve(input.response)
    },
  }
}
