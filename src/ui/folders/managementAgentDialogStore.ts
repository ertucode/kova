import { createStore } from '@xstate/store'
import { errorResponseToMessage } from '@common/GenericError'
import type { ManagementAgentScope, ManagementAgentWorkspaceState } from '@common/ManagementAgent'
import { Typescript } from '@common/Typescript'
import { getWindowElectron } from '@/getWindowElectron'

export type ManagementAgentDialogEntry = {
  prompt: string
  promptHistory: string[]
  workspaceState: ManagementAgentWorkspaceState | null
  isLoading: boolean
  isSubmitting: boolean
  errorMessage: string | null
  selectedModel: string
  selectedSessionId: string | null
}

type ManagementAgentDialogContext = {
  entriesByScopeKey: Record<string, ManagementAgentDialogEntry>
}

export const managementAgentDialogStore = createStore({
  context: {
    entriesByScopeKey: {},
  } as ManagementAgentDialogContext,
  on: {
    entryPatched: (context, event: { scopeKey: string; patch: Partial<ManagementAgentDialogEntry> }) => ({
      ...context,
      entriesByScopeKey: {
        ...context.entriesByScopeKey,
        [event.scopeKey]: {
          ...getManagementAgentDialogEntry(context, event.scopeKey),
          ...event.patch,
        },
      },
    }),
    workspaceStateReceived: (context, event: { scopeKey: string; workspaceState: ManagementAgentWorkspaceState }) => {
      const entry = getManagementAgentDialogEntry(context, event.scopeKey)
      const nextSelectedSessionId =
        entry.selectedSessionId && event.workspaceState.sessions.some(sessionState => sessionState.session.id === entry.selectedSessionId)
          ? entry.selectedSessionId
          : event.workspaceState.sessions[0]?.session.id ?? null
      const nextSelectedSession = event.workspaceState.sessions.find(sessionState => sessionState.session.id === nextSelectedSessionId)?.session ?? null

      return {
        ...context,
        entriesByScopeKey: {
          ...context.entriesByScopeKey,
          [event.scopeKey]: {
            ...entry,
            workspaceState: event.workspaceState,
            selectedSessionId: nextSelectedSessionId,
            selectedModel: entry.selectedModel || nextSelectedSession?.selectedModel || '',
            isLoading: false,
          },
        },
      }
    },
    promptChanged: (context, event: { scopeKey: string; prompt: string }) => ({
      ...context,
      entriesByScopeKey: {
        ...context.entriesByScopeKey,
        [event.scopeKey]: {
          ...getManagementAgentDialogEntry(context, event.scopeKey),
          prompt: event.prompt,
        },
      },
    }),
    promptSubmitted: (context, event: { scopeKey: string; prompt: string }) => ({
      ...context,
      entriesByScopeKey: {
        ...context.entriesByScopeKey,
        [event.scopeKey]: {
          ...getManagementAgentDialogEntry(context, event.scopeKey),
          prompt: '',
          promptHistory: [...getManagementAgentDialogEntry(context, event.scopeKey).promptHistory, event.prompt],
        },
      },
    }),
  },
})

export namespace ManagementAgentDialogCoordinator {
  export async function loadWorkspace(scope: ManagementAgentScope) {
    const scopeKey = getManagementAgentScopeKey(scope)
    const entry = getEntry(scopeKey)
    if (entry.isLoading) {
      return
    }

    managementAgentDialogStore.trigger.entryPatched({
      scopeKey,
      patch: {
        isLoading: true,
        errorMessage: null,
      },
    })

    const result = await getWindowElectron().loadManagementAgentWorkspace(scope)
    if (!result.success) {
      managementAgentDialogStore.trigger.entryPatched({
        scopeKey,
        patch: {
          isLoading: false,
          errorMessage: errorResponseToMessage(result.error),
        },
      })
      return
    }

    applyWorkspaceState(result.data)
  }

  export function applyWorkspaceState(workspaceState: ManagementAgentWorkspaceState) {
    managementAgentDialogStore.trigger.workspaceStateReceived({
      scopeKey: getManagementAgentScopeKey(workspaceState),
      workspaceState,
    })

    managementAgentDialogStore.trigger.entryPatched({
      scopeKey: getManagementAgentScopeKey(workspaceState),
      patch: {
        isSubmitting: false,
      },
    })
  }

  export async function createSession(scope: ManagementAgentScope) {
    const scopeKey = getManagementAgentScopeKey(scope)
    const entry = getEntry(scopeKey)

    managementAgentDialogStore.trigger.entryPatched({
      scopeKey,
      patch: {
        errorMessage: null,
        isSubmitting: true,
      },
    })

    const existingSessionIds = new Set((entry.workspaceState?.sessions ?? []).map(sessionState => sessionState.session.id))
    const result = await getWindowElectron().createManagementAgentSession({ ...scope, model: entry.selectedModel || null })
    if (!result.success) {
      managementAgentDialogStore.trigger.entryPatched({
        scopeKey,
        patch: {
          isSubmitting: false,
          errorMessage: errorResponseToMessage(result.error),
        },
      })
      return null
    }

    const createdSessionId =
      result.data.sessions.find(sessionState => !existingSessionIds.has(sessionState.session.id))?.session.id
      ?? result.data.sessions[0]?.session.id
      ?? null

    managementAgentDialogStore.trigger.entryPatched({
      scopeKey,
      patch: {
        prompt: '',
        promptHistory: [],
        selectedSessionId: createdSessionId,
      },
    })
    applyWorkspaceState(result.data)
    return createdSessionId
  }

  export async function sendPrompt(scope: ManagementAgentScope) {
    const scopeKey = getManagementAgentScopeKey(scope)
    const entry = getEntry(scopeKey)
    const trimmedPrompt = entry.prompt.trim()
    if (!trimmedPrompt) {
      return false
    }

    managementAgentDialogStore.trigger.entryPatched({
      scopeKey,
      patch: {
        errorMessage: null,
        isSubmitting: true,
      },
    })

    const nextSessionId = entry.selectedSessionId ?? (await createSession(scope))
    if (!nextSessionId) {
      managementAgentDialogStore.trigger.promptChanged({ scopeKey, prompt: trimmedPrompt })
      managementAgentDialogStore.trigger.entryPatched({
        scopeKey,
        patch: {
          isSubmitting: false,
        },
      })
      return false
    }

    managementAgentDialogStore.trigger.entryPatched({
      scopeKey,
      patch: {
        errorMessage: null,
        isSubmitting: true,
      },
    })
    managementAgentDialogStore.trigger.promptSubmitted({ scopeKey, prompt: trimmedPrompt })

    const refreshedEntry = getEntry(scopeKey)
    const result = await getWindowElectron().sendManagementAgentMessage({
      sessionId: nextSessionId,
      message: trimmedPrompt,
      model: refreshedEntry.selectedModel || null,
    })

    if (!result.success) {
      managementAgentDialogStore.trigger.promptChanged({ scopeKey, prompt: trimmedPrompt })
      managementAgentDialogStore.trigger.entryPatched({
        scopeKey,
        patch: {
          isSubmitting: false,
          errorMessage: errorResponseToMessage(result.error),
        },
      })
      return false
    }

    applyWorkspaceState(result.data)
    return true
  }

  export async function abortSelectedSession(scope: ManagementAgentScope) {
    const scopeKey = getManagementAgentScopeKey(scope)
    const entry = getEntry(scopeKey)
    if (!entry.selectedSessionId) {
      return
    }

    managementAgentDialogStore.trigger.entryPatched({
      scopeKey,
      patch: {
        errorMessage: null,
      },
    })

    const result = await getWindowElectron().abortManagementAgentSession({ sessionId: entry.selectedSessionId })
    if (!result.success) {
      managementAgentDialogStore.trigger.entryPatched({
        scopeKey,
        patch: {
          errorMessage: errorResponseToMessage(result.error),
        },
      })
      return
    }

    applyWorkspaceState(result.data)
  }

  export async function applyDraft(scope: ManagementAgentScope) {
    const scopeKey = getManagementAgentScopeKey(scope)
    const entry = getEntry(scopeKey)
    if (!entry.selectedSessionId) {
      return false
    }

    managementAgentDialogStore.trigger.entryPatched({
      scopeKey,
      patch: {
        errorMessage: null,
        isSubmitting: true,
      },
    })

    const result = await getWindowElectron().applyManagementAgentPlan({ sessionId: entry.selectedSessionId })
    if (!result.success) {
      managementAgentDialogStore.trigger.entryPatched({
        scopeKey,
        patch: {
          isSubmitting: false,
          errorMessage: errorResponseToMessage(result.error),
        },
      })
      return false
    }

    applyWorkspaceState(result.data)
    return true
  }

  export function selectSession(scopeKey: string, sessionId: string | null) {
    managementAgentDialogStore.trigger.entryPatched({
      scopeKey,
      patch: {
        selectedSessionId: sessionId,
      },
    })
  }

  export function setSelectedModel(scopeKey: string, model: string) {
    managementAgentDialogStore.trigger.entryPatched({
      scopeKey,
      patch: {
        selectedModel: model,
      },
    })
  }
}

function getManagementAgentDialogEntry(context: ManagementAgentDialogContext, scopeKey: string): ManagementAgentDialogEntry {
  return context.entriesByScopeKey[scopeKey] ?? createManagementAgentDialogEntry()
}

function createManagementAgentDialogEntry(): ManagementAgentDialogEntry {
  return {
    prompt: '',
    promptHistory: [],
    workspaceState: null,
    isLoading: false,
    isSubmitting: false,
    errorMessage: null,
    selectedModel: '',
    selectedSessionId: null,
  }
}

function getEntry(scopeKey: string) {
  return getManagementAgentDialogEntry(managementAgentDialogStore.getSnapshot().context, scopeKey)
}

export function getManagementAgentScopeKey(scope: ManagementAgentScope) {
  switch (scope.scopeType) {
    case 'request':
      return `request:${scope.targetRequestId ?? 'no-request'}`
    case 'workspace':
      return 'workspace'
    case 'folder':
      return `folder:${scope.targetFolderId ?? 'no-folder'}`
    default:
      return Typescript.assertUnreachable(scope.scopeType)
  }
}
