import { createStore } from '@xstate/store'
import { errorResponseToMessage } from '@common/GenericError'
import {
  getScriptAiTargetKey,
  type ScriptAiMessagePatchDiff,
  type ScriptAiTarget,
  type ScriptAiWorkspaceState,
} from '@common/ScriptAi'
import { getWindowElectron } from '@/getWindowElectron'

type OnApply = (
  nextCode: string,
  options?: {
    skipFormatting?: boolean
    skipSync?: boolean
  }
) => Promise<boolean | void> | boolean | void

export type ScriptAiMessagePatchDiffState = {
  isLoading: boolean
  errorMessage: string | null
  diffs: ScriptAiMessagePatchDiff[] | null
}

export type ScriptAiReviewEntry = {
  prompt: string
  promptHistory: string[]
  workspaceState: ScriptAiWorkspaceState | null
  isLoading: boolean
  isSubmitting: boolean
  errorMessage: string | null
  selectedModel: string
  selectedSessionId: string | null
  currentCode: string
  onApply: OnApply | null
  lastAutoAppliedCode: string | null
  autoApplyCodeInFlight: string | null
  lastSyncedEditorCode: string | null
  patchDiffsByMessageKey: Record<string, ScriptAiMessagePatchDiffState>
}

type ScriptAiReviewContext = {
  entriesByTargetKey: Record<string, ScriptAiReviewEntry>
}

const pendingEditorSyncByTargetKey = new Map<string, Promise<void>>()

export const scriptAiReviewStore = createStore({
  context: {
    entriesByTargetKey: {},
  } as ScriptAiReviewContext,
  on: {
    entryPatched: (context, event: { targetKey: string; patch: Partial<ScriptAiReviewEntry> }) => ({
      ...context,
      entriesByTargetKey: {
        ...context.entriesByTargetKey,
        [event.targetKey]: {
          ...getScriptAiReviewEntry(context, event.targetKey),
          ...event.patch,
        },
      },
    }),
    workspaceStateReceived: (context, event: { targetKey: string; workspaceState: ScriptAiWorkspaceState }) => {
      const entry = getScriptAiReviewEntry(context, event.targetKey)
      const didActiveSessionChange =
        event.workspaceState.activeSessionId !== null && event.workspaceState.activeSessionId !== entry.workspaceState?.activeSessionId
      const nextSelectedSessionId =
        didActiveSessionChange && event.workspaceState.sessions.some(session => session.id === event.workspaceState.activeSessionId)
          ? event.workspaceState.activeSessionId
          : entry.selectedSessionId && event.workspaceState.sessions.some(session => session.id === entry.selectedSessionId)
          ? entry.selectedSessionId
          : event.workspaceState.activeSessionId ?? event.workspaceState.sessions[0]?.id ?? null

      return {
        ...context,
        entriesByTargetKey: {
          ...context.entriesByTargetKey,
          [event.targetKey]: {
            ...entry,
            workspaceState: event.workspaceState,
            selectedSessionId: nextSelectedSessionId,
            isLoading: false,
          },
        },
      }
    },
    promptChanged: (context, event: { targetKey: string; prompt: string }) => ({
      ...context,
      entriesByTargetKey: {
        ...context.entriesByTargetKey,
        [event.targetKey]: {
          ...getScriptAiReviewEntry(context, event.targetKey),
          prompt: event.prompt,
        },
      },
    }),
    promptSubmitted: (context, event: { targetKey: string; prompt: string }) => ({
      ...context,
      entriesByTargetKey: {
        ...context.entriesByTargetKey,
        [event.targetKey]: {
          ...getScriptAiReviewEntry(context, event.targetKey),
          prompt: '',
          promptHistory: [...getScriptAiReviewEntry(context, event.targetKey).promptHistory, event.prompt],
        },
      },
    }),
  },
})

export namespace ScriptAiReviewCoordinator {
  export function registerTarget(input: {
    target: ScriptAiTarget
    currentCode: string
    onApply: OnApply
    defaultModel: string | null
  }) {
    const targetKey = getScriptAiTargetKey(input.target)
    const entry = getEntry(targetKey)

    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        currentCode: input.currentCode,
        onApply: input.onApply,
        selectedModel: entry.selectedModel || input.defaultModel || '',
      },
    })

  }

  export async function loadWorkspace(target: ScriptAiTarget, currentCode: string) {
    const targetKey = getScriptAiTargetKey(target)
    const entry = getEntry(targetKey)
    if (entry.isLoading) {
      return
    }

    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        isLoading: true,
        errorMessage: null,
        currentCode,
      },
    })

    const result = await getWindowElectron().loadScriptAiWorkspace({ target, currentCode })
    if (!result.success) {
      scriptAiReviewStore.trigger.entryPatched({
        targetKey,
        patch: {
          isLoading: false,
          errorMessage: errorResponseToMessage(result.error),
        },
      })
      return
    }

    ScriptAiReviewCoordinator.applyWorkspaceState(result.data)
  }

  export async function createSession(target: ScriptAiTarget) {
    const targetKey = getScriptAiTargetKey(target)

    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        errorMessage: null,
        isSubmitting: true,
      },
    })

    try {
      await createSessionRequest(target)
    } finally {
      scriptAiReviewStore.trigger.entryPatched({
        targetKey,
        patch: {
          isSubmitting: false,
        },
      })
    }
  }

  export async function sendPrompt(target: ScriptAiTarget, documentation: string) {
    const targetKey = getScriptAiTargetKey(target)
    const entry = getEntry(targetKey)
    const trimmedPrompt = entry.prompt.trim()
    if (!trimmedPrompt) {
      scriptAiReviewStore.trigger.entryPatched({
        targetKey,
        patch: {
          errorMessage: 'Describe what you want the script to do first.',
        },
      })
      return false
    }

    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        errorMessage: null,
        isSubmitting: true,
      },
    })
    scriptAiReviewStore.trigger.promptSubmitted({ targetKey, prompt: trimmedPrompt })

    try {
      const ensuredSessionId = entry.selectedSessionId ?? (await createSessionRequest(target))
      if (!ensuredSessionId) {
        scriptAiReviewStore.trigger.promptChanged({ targetKey, prompt: trimmedPrompt })
        return false
      }

      const refreshedEntry = getEntry(targetKey)
      const result = await getWindowElectron().sendScriptAiMessage({
        target,
        currentCode: refreshedEntry.currentCode,
        sessionId: ensuredSessionId,
        message: trimmedPrompt,
        model: refreshedEntry.selectedModel || null,
        documentation,
      })

      if (!result.success) {
        scriptAiReviewStore.trigger.entryPatched({
          targetKey,
          patch: {
            errorMessage: errorResponseToMessage(result.error),
          },
        })
        scriptAiReviewStore.trigger.promptChanged({ targetKey, prompt: trimmedPrompt })
        return false
      }

      ScriptAiReviewCoordinator.applyWorkspaceState(result.data)
      return true
    } finally {
      scriptAiReviewStore.trigger.entryPatched({
        targetKey,
        patch: {
          isSubmitting: false,
        },
      })
    }
  }

  export async function abortSelectedSession(target: ScriptAiTarget) {
    const targetKey = getScriptAiTargetKey(target)
    const entry = getEntry(targetKey)
    if (!entry.selectedSessionId) {
      return
    }

    const result = await getWindowElectron().abortScriptAiSession({ target, sessionId: entry.selectedSessionId })
    if (!result.success) {
      scriptAiReviewStore.trigger.entryPatched({
        targetKey,
        patch: {
          errorMessage: errorResponseToMessage(result.error),
        },
      })
      return
    }

    ScriptAiReviewCoordinator.applyWorkspaceState(result.data)
  }

  export async function ensureMessagePatchDiff(target: ScriptAiTarget, sessionId: string, messageId: string) {
    const targetKey = getScriptAiTargetKey(target)
    const patchDiffKey = getPatchDiffKey(sessionId, messageId)
    const entry = getEntry(targetKey)
    if (entry.patchDiffsByMessageKey[patchDiffKey]) {
      return
    }

    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        patchDiffsByMessageKey: {
          ...entry.patchDiffsByMessageKey,
          [patchDiffKey]: {
            isLoading: true,
            errorMessage: null,
            diffs: null,
          },
        },
      },
    })

    const result = await getWindowElectron().loadScriptAiMessagePatchDiff({ target, sessionId, messageId })
    if (!result.success) {
      const nextEntry = getEntry(targetKey)
      scriptAiReviewStore.trigger.entryPatched({
        targetKey,
        patch: {
          patchDiffsByMessageKey: {
            ...nextEntry.patchDiffsByMessageKey,
            [patchDiffKey]: {
              isLoading: false,
              errorMessage: errorResponseToMessage(result.error),
              diffs: null,
            },
          },
        },
      })
      return
    }

    const nextEntry = getEntry(targetKey)
    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        patchDiffsByMessageKey: {
          ...nextEntry.patchDiffsByMessageKey,
          [patchDiffKey]: {
            isLoading: false,
            errorMessage: null,
            diffs: result.data.diffs,
          },
        },
      },
    })
  }

  export function selectSession(targetKey: string, sessionId: string) {
    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        selectedSessionId: sessionId,
      },
    })
  }

  export function setSelectedModel(targetKey: string, model: string) {
    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        selectedModel: model,
      },
    })
  }

  export async function syncEditorCode(target: ScriptAiTarget, code: string) {
    const targetKey = getScriptAiTargetKey(target)
    const pendingSync = pendingEditorSyncByTargetKey.get(targetKey) ?? Promise.resolve()
    const nextSync = pendingSync
      .catch(() => undefined)
      .then(async () => {
        const entry = getEntry(targetKey)
        if (entry.lastSyncedEditorCode === code) {
          return
        }

        // Do not overwrite the Script AI workspace while OpenCode is still editing it.
        if (isScriptAiReviewEntryBusy(entry)) {
          return
        }

        const result = await getWindowElectron().syncScriptAiWorkspace({ target, code })
        if (!result.success || !result.data.didSync) {
          return
        }

        scriptAiReviewStore.trigger.entryPatched({
          targetKey,
          patch: {
            lastSyncedEditorCode: code,
          },
        })

        if (result.data.workspaceState) {
          ScriptAiReviewCoordinator.applyWorkspaceState(result.data.workspaceState)
        }
      })

    pendingEditorSyncByTargetKey.set(targetKey, nextSync)
    await nextSync

    if (pendingEditorSyncByTargetKey.get(targetKey) === nextSync) {
      pendingEditorSyncByTargetKey.delete(targetKey)
    }
  }

  export async function updateWorkspaceCode(target: ScriptAiTarget, code: string) {
    const targetKey = getScriptAiTargetKey(target)
    const result = await getWindowElectron().applyScriptAiWorkspace({ target, code })
    if (!result.success) {
      scriptAiReviewStore.trigger.entryPatched({
        targetKey,
        patch: {
          errorMessage: errorResponseToMessage(result.error),
        },
      })
      return false
    }

    const entry = getEntry(targetKey)
    if (entry.workspaceState) {
      scriptAiReviewStore.trigger.workspaceStateReceived({
        targetKey,
        workspaceState: {
          ...entry.workspaceState,
          workspaceCode: code,
        },
      })
    }

    return await autoApplyCode(targetKey, code)
  }

  export function applyWorkspaceState(workspaceState: ScriptAiWorkspaceState) {
    const targetKey = workspaceState.targetKey
    const previousEntry = getEntry(targetKey)

    scriptAiReviewStore.trigger.workspaceStateReceived({ targetKey, workspaceState })

    if (didAssistantTurnFinish(previousEntry.workspaceState, workspaceState)) {
      void autoApplyCode(targetKey, workspaceState.workspaceCode)
    }
  }
}

function getScriptAiReviewEntry(context: ScriptAiReviewContext, targetKey: string): ScriptAiReviewEntry {
  return context.entriesByTargetKey[targetKey] ?? createScriptAiReviewEntry()
}

function createScriptAiReviewEntry(): ScriptAiReviewEntry {
  return {
    prompt: '',
    promptHistory: [],
    workspaceState: null,
    isLoading: false,
    isSubmitting: false,
    errorMessage: null,
    selectedModel: '',
    selectedSessionId: null,
    currentCode: '',
    onApply: null,
    lastAutoAppliedCode: null,
    autoApplyCodeInFlight: null,
    lastSyncedEditorCode: null,
    patchDiffsByMessageKey: {},
  }
}

function getEntry(targetKey: string) {
  return getScriptAiReviewEntry(scriptAiReviewStore.getSnapshot().context, targetKey)
}

export function isScriptAiReviewEntryBusy(entry: ScriptAiReviewEntry | null) {
  return Boolean(entry?.workspaceState?.sessions.some(session => session.status === 'busy' || session.status === 'retry'))
}

async function createSessionRequest(target: ScriptAiTarget) {
  const targetKey = getScriptAiTargetKey(target)
  const entry = getEntry(targetKey)
  const result = await getWindowElectron().createScriptAiSession({
    target,
    currentCode: entry.currentCode,
    model: entry.selectedModel || null,
  })

  if (!result.success) {
    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        errorMessage: errorResponseToMessage(result.error),
      },
    })
    return null
  }

  ScriptAiReviewCoordinator.applyWorkspaceState(result.data)
  return result.data.activeSessionId
}

function didAssistantTurnFinish(previousState: ScriptAiWorkspaceState | null, nextState: ScriptAiWorkspaceState) {
  if (!previousState) {
    return false
  }

  return previousState.sessions.some(previousSession => {
    if (previousSession.status === 'idle') {
      return false
    }

    const nextSession = nextState.sessions.find(session => session.id === previousSession.id)
    return nextSession?.status === 'idle'
  })
}

async function autoApplyCode(targetKey: string, code: string) {
  const entry = getEntry(targetKey)
  if (entry.currentCode === code) {
    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        lastAutoAppliedCode: code,
        autoApplyCodeInFlight: null,
        lastSyncedEditorCode: code,
      },
    })
    return true
  }

  if (!entry.onApply || entry.autoApplyCodeInFlight === code || entry.lastAutoAppliedCode === code) {
    return true
  }

  scriptAiReviewStore.trigger.entryPatched({
    targetKey,
    patch: {
      autoApplyCodeInFlight: code,
      errorMessage: null,
    },
  })

  try {
    const applied = await entry.onApply(code, { skipFormatting: true, skipSync: true })
    if (applied === false) {
      scriptAiReviewStore.trigger.entryPatched({
        targetKey,
        patch: {
          autoApplyCodeInFlight: null,
          errorMessage: 'Failed to apply the latest AI workspace changes.',
        },
      })
      return false
    }

    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        autoApplyCodeInFlight: null,
        lastAutoAppliedCode: code,
        lastSyncedEditorCode: code,
      },
    })
    return true
  } catch (error) {
    scriptAiReviewStore.trigger.entryPatched({
      targetKey,
      patch: {
        autoApplyCodeInFlight: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      },
    })
    return false
  }
}

export function getPatchDiffKey(sessionId: string, messageId: string) {
  return `${sessionId}:${messageId}`
}
