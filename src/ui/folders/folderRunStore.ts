import { createStore } from '@xstate/store'
import { errorResponseToMessage } from '@common/GenericError'
import type {
  FolderRunHistoryRecord,
  FolderRunRecord,
  FolderRunRequest,
  FolderRunStatus,
  FolderRunSummary,
  RunFolderRequestsInput,
} from '@common/FolderRuns'
import { getWindowElectron } from '@/getWindowElectron'
import { toast } from '@/lib/components/toast'

type FolderRunContext = {
  runsById: Record<string, FolderRunRecord>
  activeRunIdByFolderId: Record<string, string>
  latestRunIdByFolderId: Record<string, string>
  historyByFolderId: Record<string, FolderRunHistoryRecord[]>
  historyLoadingByFolderId: Record<string, boolean>
}

export const folderRunStore = createStore({
  context: {
    runsById: {},
    activeRunIdByFolderId: {},
    latestRunIdByFolderId: {},
    historyByFolderId: {},
    historyLoadingByFolderId: {},
  } as FolderRunContext,
  on: {
    runStarted: (context, event: { run: FolderRunRecord }) => ({
      ...context,
      runsById: { ...context.runsById, [event.run.id]: event.run },
      activeRunIdByFolderId: { ...context.activeRunIdByFolderId, [event.run.folderId]: event.run.id },
      latestRunIdByFolderId: { ...context.latestRunIdByFolderId, [event.run.folderId]: event.run.id },
    }),
    requestStarted: (context, event: { runId: string; requestId: string; startedAt: number; summary: FolderRunSummary }) => {
      const run = context.runsById[event.runId]
      if (!run) return context
      return {
        ...context,
        runsById: {
          ...context.runsById,
          [event.runId]: {
            ...run,
            summary: event.summary,
            requests: run.requests.map(request =>
              request.requestId === event.requestId
                ? { ...request, status: 'running' as const, startedAt: event.startedAt }
                : request
            ),
          },
        },
      }
    },
    requestCompleted: (context, event: { runId: string; request: FolderRunRequest; summary: FolderRunSummary }) => {
      const run = context.runsById[event.runId]
      if (!run) return context
      return {
        ...context,
        runsById: {
          ...context.runsById,
          [event.runId]: {
            ...run,
            summary: event.summary,
            requests: run.requests.map(request =>
              request.requestId === event.request.requestId ? event.request : request
            ),
          },
        },
      }
    },
    runCompleted: (
      context,
      event: { runId: string; folderId: string; status: FolderRunStatus; completedAt: number; summary: FolderRunSummary }
    ) => {
      const run = context.runsById[event.runId]
      const nextActive = { ...context.activeRunIdByFolderId }
      if (nextActive[event.folderId] === event.runId) {
        delete nextActive[event.folderId]
      }
      return {
        ...context,
        activeRunIdByFolderId: nextActive,
        runsById: run
          ? {
              ...context.runsById,
              [event.runId]: { ...run, status: event.status, completedAt: event.completedAt, summary: event.summary },
            }
          : context.runsById,
      }
    },
    historyLoadingStarted: (context, event: { folderId: string }) => ({
      ...context,
      historyLoadingByFolderId: { ...context.historyLoadingByFolderId, [event.folderId]: true },
    }),
    historyLoaded: (context, event: { folderId: string; items: FolderRunHistoryRecord[] }) => ({
      ...context,
      historyByFolderId: { ...context.historyByFolderId, [event.folderId]: event.items },
      historyLoadingByFolderId: { ...context.historyLoadingByFolderId, [event.folderId]: false },
    }),
    historyLoadFailed: (context, event: { folderId: string }) => ({
      ...context,
      historyLoadingByFolderId: { ...context.historyLoadingByFolderId, [event.folderId]: false },
    }),
  },
})

export namespace FolderRunCoordinator {
  export async function startRun(input: RunFolderRequestsInput) {
    const result = await getWindowElectron().runFolderRequests(input)
    if (!result.success) {
      toast.show(result)
      throw new Error(errorResponseToMessage(result.error))
    }

    if (result.data.overlappingRuns.length > 0) {
      toast.show({
        severity: 'warning',
        title: 'Overlapping folder run',
        message: 'This run overlaps an active ancestor or descendant folder run. Some requests may run more than once.',
      })
    }

    folderRunStore.trigger.runStarted({ run: result.data.run })
  }

  export async function cancelRun(runId: string) {
    const result = await getWindowElectron().cancelFolderRun({ runId })
    if (!result.success) {
      toast.show(result)
      return
    }
  }

  export async function loadHistory(folderId: string) {
    folderRunStore.trigger.historyLoadingStarted({ folderId })
    try {
      const result = await getWindowElectron().listFolderRunHistory({ folderId, offset: 0, limit: 20 })
      folderRunStore.trigger.historyLoaded({ folderId, items: result.items })
    } catch {
      folderRunStore.trigger.historyLoadFailed({ folderId })
    }
  }
}
