export type ScriptMakeRequestRequest = {
  id: string
  requestId: string
  path: string[]
}

export type ScriptMakeRequestResponse = {
  id: string
  error: string | null
}
