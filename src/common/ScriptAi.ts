export type ScriptAiPhase = 'pre-request' | 'post-request' | 'response-visualizer' | 'view-runtime'

export type ScriptAiOwnerType = 'request' | 'folder' | 'view'

export type ScriptAiTarget = {
  ownerType: ScriptAiOwnerType
  ownerId: string
  phase: ScriptAiPhase
}

export type ScriptAiSessionSummary = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  status: 'idle' | 'busy' | 'retry'
  messageCount: number
  latestErrorMessage: string | null
}

export type ScriptAiMessagePart = {
  id: string
  type: 'text'
  text: string
} | {
  id: string
  type: 'reasoning'
  text: string
} | {
  id: string
  type: 'tool'
  toolName: string
  status: 'pending' | 'running' | 'completed' | 'error'
  title: string | null
  input: string | null
  output: string | null
  errorMessage: string | null
} | {
  id: string
  type: 'file'
  filename: string | null
  path: string | null
} | {
  id: string
  type: 'step-start'
} | {
  id: string
  type: 'step-finish'
} | {
  id: string
  type: 'snapshot'
} | {
  id: string
  type: 'patch'
} | {
  id: string
  type: 'agent'
  name: string
} | {
  id: string
  type: 'subtask'
  description: string
  prompt: string
  agent: string
} | {
  id: string
  type: 'retry'
} | {
  id: string
  type: 'compaction'
}

export type ScriptAiMessage = {
  id: string
  role: 'user' | 'assistant'
  createdAt: number
  completedAt: number | null
  errorMessage: string | null
  parts: ScriptAiMessagePart[]
}

export type ScriptAiWorkspaceState = {
  target: ScriptAiTarget
  targetKey: string
  fileName: string
  workspaceCode: string
  activeSessionId: string | null
  sessions: ScriptAiSessionSummary[]
  messagesBySessionId: Record<string, ScriptAiMessage[]>
}

export type LoadScriptAiWorkspaceInput = {
  target: ScriptAiTarget
  currentCode: string
}

export type CreateScriptAiSessionInput = {
  target: ScriptAiTarget
  currentCode: string
  model: string | null
}

export type SendScriptAiMessageInput = {
  target: ScriptAiTarget
  currentCode: string
  sessionId: string
  message: string
  model: string | null
  documentation: string
}

export type ApplyScriptAiWorkspaceInput = {
  target: ScriptAiTarget
  code: string
}

export type ApplyScriptAiWorkspaceResponse = {
  code: string
}

export type AbortScriptAiSessionInput = {
  target: ScriptAiTarget
  sessionId: string
}

export type ListOpenCodeModelsResponse = {
  models: string[]
}

export function getScriptAiTargetKey(target: ScriptAiTarget) {
  return `${target.ownerType}:${target.ownerId}:${target.phase}`
}

export function getScriptAiFileName(phase: ScriptAiPhase) {
  switch (phase) {
    case 'pre-request':
      return 'script.js'
    case 'post-request':
      return 'script.js'
    case 'response-visualizer':
      return 'script.jsx'
    case 'view-runtime':
      return 'script.jsx'
  }
}
