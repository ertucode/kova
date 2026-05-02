export type ScriptPromptTextOptions = {
  title?: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  required?: boolean
}

export type ScriptPromptRequest = {
  id: string
  kind: 'text'
  options: ScriptPromptTextOptions
}

export type ScriptPromptResponse = {
  id: string
  value: string | null
}
