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
