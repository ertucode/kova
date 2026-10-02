import { createStore } from '@xstate/store'
import { errorResponseToMessage } from '@common/GenericError'
import type {
  FolderRunHistoryRecord,
  FolderRunCampaignSummary,
  FolderRunRecord,
  FolderRunStatus,
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

function getLatestFolderRunId(context: FolderRunContext, folderId: string) {
  const liveRuns = Object.values(context.runsById).filter(run => run.folderId === folderId)
  const historyRuns = context.historyByFolderId[folderId] ?? []
  const liveRunIds = new Set(liveRuns.map(run => run.id))

  const latestHistoryRun = historyRuns
    .filter(run => !liveRunIds.has(run.id))
    .sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id))[0]
  const latestLiveRun = liveRuns.sort(
    (left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id)
  )[0]
  const latestRun = [latestLiveRun, latestHistoryRun]
    .filter((run): run is FolderRunRecord | FolderRunHistoryRecord => run !== undefined)
    .sort((left, right) => right.startedAt - left.startedAt || right.id.localeCompare(left.id))[0]

  return latestRun?.id ?? null
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
    runProgressed: (
      context,
      event: { runId: string; summary: FolderRunCampaignSummary; iterations: FolderRunRecord['iterations'] }
    ) => {
      const run = context.runsById[event.runId]
      if (!run) return context
      return {
        ...context,
        runsById: {
          ...context.runsById,
          [event.runId]: { ...run, summary: event.summary, iterations: event.iterations },
        },
      }
    },
    runHydrated: (context, event: { history: FolderRunHistoryRecord; iterations: FolderRunRecord['iterations'] }) => ({
      ...context,
      runsById: {
        ...context.runsById,
        [event.history.id]: {
          id: event.history.id,
          folderId: event.history.folderId,
          folderName: event.history.folderName,
          config: event.history.config,
          status: event.history.status,
          summary: event.history.summary,
          iterations: event.iterations,
          overlappingFolderRunIds: context.runsById[event.history.id]?.overlappingFolderRunIds ?? [],
          startedAt: event.history.startedAt,
          completedAt: event.history.completedAt,
        },
      },
    }),
    runCompleted: (
      context,
      event: {
        runId: string
        folderId: string
        status: FolderRunStatus
        completedAt: number
        summary: FolderRunCampaignSummary
      }
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
    historyEntryDeleted: (context, event: { folderId: string; runId: string }) => {
      const nextRunsById = { ...context.runsById }
      delete nextRunsById[event.runId]

      const nextHistoryByFolderId = {
        ...context.historyByFolderId,
        [event.folderId]: (context.historyByFolderId[event.folderId] ?? []).filter(item => item.id !== event.runId),
      }

      const nextActiveRunIdByFolderId = { ...context.activeRunIdByFolderId }
      if (nextActiveRunIdByFolderId[event.folderId] === event.runId) {
        delete nextActiveRunIdByFolderId[event.folderId]
      }

      const nextContext = {
        ...context,
        runsById: nextRunsById,
        historyByFolderId: nextHistoryByFolderId,
        activeRunIdByFolderId: nextActiveRunIdByFolderId,
      }
      const nextLatestRunIdByFolderId = { ...context.latestRunIdByFolderId }
      const latestRunId = getLatestFolderRunId(nextContext, event.folderId)
      if (latestRunId) {
        nextLatestRunIdByFolderId[event.folderId] = latestRunId
      } else {
        delete nextLatestRunIdByFolderId[event.folderId]
      }

      return {
        ...nextContext,
        latestRunIdByFolderId: nextLatestRunIdByFolderId,
      }
    },
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

  export async function loadRunDetails(runId: string) {
    const result = await getWindowElectron().getFolderRunHistory({ id: runId })
    if (!result.success) return
    folderRunStore.trigger.runHydrated({ history: result.data.run, iterations: result.data.iterations })
  }

  export async function deleteHistoryEntry(folderId: string, runId: string) {
    const result = await getWindowElectron().deleteFolderRunHistory({ runId })
    if (!result.success) {
      toast.show(result)
      throw new Error(errorResponseToMessage(result.error))
    }

    folderRunStore.trigger.historyEntryDeleted({ folderId, runId })
  }
}
