export const REQUEST_CODE_GENERATION_MODES = ['resolved', 'mask-auth', 'mask-variables'] as const

export type RequestCodeGenerationMode = (typeof REQUEST_CODE_GENERATION_MODES)[number]

export type GenerateRequestCodeInput = {
  requestId: string
  activeEnvironmentIds: string[]
  mode: RequestCodeGenerationMode
}

export type GenerateRequestCodeResponse = {
  curl: string
  fetch: string
}
