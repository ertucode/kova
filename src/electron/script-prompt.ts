import type { ScriptPromptTextOptions } from '../common/ScriptPrompt.js'

export type ScriptExecutionPauseController = {
  pause: () => void
  resume: () => void
}

export type ScriptPromptBridge = {
  text: (options: ScriptPromptTextOptions) => Promise<string | null>
}

export function createScriptPromptApi(
  promptBridge: ScriptPromptBridge | undefined,
  executionController: ScriptExecutionPauseController
) {
  return {
    text: async (options: ScriptPromptTextOptions) => {
      if (!promptBridge) {
        throw new Error('prompt.text is not available in this context')
      }

      const promptOptions = normalizeScriptPromptTextOptions(options)
      executionController.pause()
      try {
        const value = await promptBridge.text(promptOptions)
        if (promptOptions.required && (value === null || value.trim().length === 0)) {
          throw new Error('prompt.text value is required')
        }

        return value
      } finally {
        executionController.resume()
      }
    },
  }
}

function normalizeScriptPromptTextOptions(options: ScriptPromptTextOptions) {
  if (!isPlainObject(options)) {
    throw new Error('prompt.text requires an options object')
  }

  const title = normalizeOptionalPromptText(options.title, 'title')
  const message = normalizeOptionalPromptText(options.message, 'message')
  const defaultValue = normalizeOptionalPromptText(options.defaultValue, 'defaultValue')
  const placeholder = normalizeOptionalPromptText(options.placeholder, 'placeholder')
  const confirmText = normalizeOptionalPromptText(options.confirmText, 'confirmText')
  const cancelText = normalizeOptionalPromptText(options.cancelText, 'cancelText')
  const required = normalizeOptionalPromptBoolean(options.required, 'required')

  return {
    ...(title !== undefined ? { title } : {}),
    ...(message !== undefined ? { message } : {}),
    ...(defaultValue !== undefined ? { defaultValue } : {}),
    ...(placeholder !== undefined ? { placeholder } : {}),
    ...(confirmText !== undefined ? { confirmText } : {}),
    ...(cancelText !== undefined ? { cancelText } : {}),
    ...(required !== undefined ? { required } : {}),
  } satisfies ScriptPromptTextOptions
}

function normalizeOptionalPromptText(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string') {
    throw new Error(`prompt.text ${fieldName} must be a string`)
  }

  return value
}

function normalizeOptionalPromptBoolean(value: unknown, fieldName: string) {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'boolean') {
    throw new Error(`prompt.text ${fieldName} must be a boolean`)
  }

  return value
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
