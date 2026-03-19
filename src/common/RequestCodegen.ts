export type GenerateRequestCodeInput = {
  requestId: string
  activeEnvironmentIds: string[]
}

export type GenerateRequestCodeResponse = {
  curl: string
  fetch: string
}
