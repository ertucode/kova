export type ScriptAiPhase = 'pre-request' | 'post-request' | 'response-visualizer' | 'view-runtime'

export type GenerateScriptWithAiInput = {
  phase: ScriptAiPhase
  currentCode: string
  userPrompt: string
  documentation: string
  model: string | null
}

export type GenerateScriptWithAiResponse = {
  code: string
  rawText: string
}

export type ListOpenCodeModelsResponse = {
  models: string[]
}
