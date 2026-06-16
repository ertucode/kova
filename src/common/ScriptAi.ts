import type { SharedScriptTarget } from './SharedScripts.js'

export type ScriptAiPhase = 'pre-request' | 'post-request' | 'response-visualizer' | 'view-runtime'

export type ScriptAiRuntimeContext =
  | { phase: ScriptAiPhase }
  | { templatePhase: 'pre-request' }
  | { targets: SharedScriptTarget[] }

export type ScriptAiOwnerType = 'request' | 'folder' | 'view' | 'shared-script'

export type ScriptAiTarget = {
  ownerType: ScriptAiOwnerType
  ownerId: string
  runtimeContext: ScriptAiRuntimeContext
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

export type SyncScriptAiWorkspaceInput = {
  target: ScriptAiTarget
  code: string
}

export type SyncScriptAiWorkspaceResponse = {
  didSync: boolean
  workspaceState: ScriptAiWorkspaceState | null
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
  return `${target.ownerType}:${target.ownerId}:${getScriptAiRuntimeContextKey(target.runtimeContext)}`
}

export function getScriptAiFileName(runtimeContext: ScriptAiRuntimeContext) {
  switch (getPrimaryScriptAiPhase(runtimeContext)) {
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

export function getPrimaryScriptAiPhase(runtimeContext: ScriptAiRuntimeContext): ScriptAiPhase {
  if ('phase' in runtimeContext) {
    return runtimeContext.phase
  }

  if ('templatePhase' in runtimeContext) {
    return runtimeContext.templatePhase
  }

  const targets = normalizeTargets(runtimeContext.targets)
  if (targets.length === 1) {
    return targets[0]
  }

  if (targets.includes('pre-request')) {
    return 'pre-request'
  }

  if (targets.includes('post-request')) {
    return 'post-request'
  }

  if (targets.includes('response-visualizer')) {
    return 'response-visualizer'
  }

  return 'view-runtime'
}

export function getScriptAiRuntimeContextTargets(runtimeContext: ScriptAiRuntimeContext): SharedScriptTarget[] {
  if ('phase' in runtimeContext) {
    return [runtimeContext.phase]
  }

  if ('templatePhase' in runtimeContext) {
    return [runtimeContext.templatePhase]
  }

  return normalizeTargets(runtimeContext.targets)
}

function getScriptAiRuntimeContextKey(runtimeContext: ScriptAiRuntimeContext) {
  if ('phase' in runtimeContext) {
    return `phase:${runtimeContext.phase}`
  }

  if ('templatePhase' in runtimeContext) {
    return `template:${runtimeContext.templatePhase}`
  }

  return `targets:${normalizeTargets(runtimeContext.targets).join(',')}`
}

function normalizeTargets(targets: SharedScriptTarget[]) {
  return Array.from(new Set(targets))
}
