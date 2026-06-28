import type { ManagementAgentPlan } from '../../common/ManagementAgent.js'
import { createEmptyManagementAgentPlan, normalizeManagementAgentPlan } from '../../common/ManagementAgent.js'
import {
  getCurrentManagementAgentDraftPlan,
  getManagementAgentSession,
  setCurrentManagementAgentDraftPlan,
} from '../db/management-agent.js'

export type ManagementAgentMcpContext = {
  requireSessionId(): string
  requireSession(): NonNullable<ReturnType<typeof getManagementAgentSession>>
  toToolResult<T extends Record<string, unknown>>(value: T): {
    content: Array<{ type: 'text'; text: string }>
    structuredContent: T
  }
  updateDraft(
    updater: (draft: ManagementAgentPlan) => { draft: ManagementAgentPlan; result: Record<string, unknown> }
  ): Promise<{
    content: Array<{ type: 'text'; text: string }>
    structuredContent: Record<string, unknown>
  }>
}

export function createManagementAgentMcpContext(boundSessionId: string | null): ManagementAgentMcpContext {
  function requireSessionId() {
    if (boundSessionId) {
      return boundSessionId
    }

    throw new Error('Management session not found.')
  }

  function requireSession() {
    const session = getManagementAgentSession(requireSessionId())
    if (!session) {
      throw new Error('Management session not found.')
    }

    return session
  }

  function toToolResult<T extends Record<string, unknown>>(value: T) {
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
      structuredContent: value,
    }
  }

  async function updateDraft(
    updater: (draft: ManagementAgentPlan) => { draft: ManagementAgentPlan; result: Record<string, unknown> }
  ) {
    const sessionId = requireSessionId()
    requireSession()
    const currentDraft = getCurrentManagementAgentDraftPlan(sessionId)?.plan ?? createEmptyManagementAgentPlan()
    const updated = updater(currentDraft)
    setCurrentManagementAgentDraftPlan(sessionId, normalizeManagementAgentPlan(updated.draft))
    return toToolResult(updated.result)
  }

  return {
    requireSessionId,
    requireSession,
    toToolResult,
    updateDraft,
  }
}
