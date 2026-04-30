export type ScriptToastSeverity = 'success' | 'error' | 'warning' | 'info'

export type ScriptToastLocation =
  | 'top-left'
  | 'top-right'
  | 'top-center'
  | 'bottom-left'
  | 'bottom-right'
  | 'bottom-center'

export type ScriptToastOptions = {
  id?: string
  title?: string
  message?: string
  severity: ScriptToastSeverity
  timeout?: number
  location?: ScriptToastLocation
}
