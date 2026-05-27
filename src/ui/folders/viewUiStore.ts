import { createStore } from '@xstate/store'
import { folderExplorerEditorStore } from './folderExplorerEditorStore'

const PERSISTED_SELECTED_VIEW_ID_KEY = 'views:selectedId'

type ViewRunRequest = {
  requestId: string
  viewId: string
}

export const viewUiStore = createStore({
  context: {
    selectedId: loadSelectedViewId(),
    pendingRunRequest: null as ViewRunRequest | null,
  },
  on: {
    selectedViewChanged: (context, event: { selectedId: string | null }) => ({
      ...context,
      selectedId: event.selectedId,
    }),
    runRequested: (context, event: { viewId: string }) => ({
      ...context,
      pendingRunRequest: {
        requestId: crypto.randomUUID(),
        viewId: event.viewId,
      },
    }),
    runHandled: (context, event: { requestId: string }) => ({
      ...context,
      pendingRunRequest:
        context.pendingRunRequest?.requestId === event.requestId ? null : context.pendingRunRequest,
    }),
  },
})

viewUiStore.subscribe(state => {
  persistSelectedViewId(state.context.selectedId)
})

export const ViewUiHelpers = {
  selectView(selectedId: string | null) {
    console.debug('[views] selectView', { selectedId })
    viewUiStore.trigger.selectedViewChanged({ selectedId })
  },
  openView(viewId: string) {
    console.debug('[views] openView', { viewId })
    folderExplorerEditorStore.trigger.sidebarTabChanged({ sidebarTab: 'views' })
    viewUiStore.trigger.selectedViewChanged({ selectedId: viewId })
  },
  requestRun(viewId: string) {
    console.debug('[views] requestRun', { viewId })
    viewUiStore.trigger.runRequested({ viewId })
  },
  openViewAndRun(viewId: string) {
    console.debug('[views] openViewAndRun', { viewId })
    ViewUiHelpers.openView(viewId)
    ViewUiHelpers.requestRun(viewId)
  },
  markRunHandled(requestId: string) {
    console.debug('[views] markRunHandled', { requestId })
    viewUiStore.trigger.runHandled({ requestId })
  },
}

function loadSelectedViewId() {
  try {
    return localStorage.getItem(PERSISTED_SELECTED_VIEW_ID_KEY)
  } catch {
    return null
  }
}

function persistSelectedViewId(value: string | null) {
  try {
    if (value) {
      localStorage.setItem(PERSISTED_SELECTED_VIEW_ID_KEY, value)
      return
    }

    localStorage.removeItem(PERSISTED_SELECTED_VIEW_ID_KEY)
  } catch {
    return
  }
}
