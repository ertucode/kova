import { afterEach, describe, expect, it } from 'vitest'
import { requestExecutionStore } from './requestExecutionStore'
import type { WebSocketSessionRecord } from '@common/Requests'

const TAB_IDS = ['response-tab-a', 'response-tab-b'] as const

afterEach(() => {
  for (const tabId of TAB_IDS) {
    requestExecutionStore.trigger.tabExecutionStateCleared({ tabId })
  }
})

describe('tab-scoped request execution state', () => {
  it('isolates simultaneous executions of the same request', () => {
    requestExecutionStore.trigger.requestStarted({
      tabId: TAB_IDS[0],
      requestId: 'shared-request',
      executionId: 'execution-a',
      sentAt: 1,
    })
    requestExecutionStore.trigger.requestStarted({
      tabId: TAB_IDS[1],
      requestId: 'shared-request',
      executionId: 'execution-b',
      sentAt: 2,
    })
    requestExecutionStore.trigger.requestFailed({
      tabId: TAB_IDS[0],
      requestId: 'shared-request',
      executionId: 'execution-a',
      error: 'First pane failed',
    })

    const state = requestExecutionStore.getSnapshot().context
    expect(state.httpExecutionByTabId[TAB_IDS[0]]).toMatchObject({
      isSending: false,
      error: 'First pane failed',
    })
    expect(state.httpExecutionByTabId[TAB_IDS[1]]).toMatchObject({
      isSending: true,
      activeExecutionId: 'execution-b',
      error: null,
    })
  })

  it('ignores stale completion events within a tab', () => {
    requestExecutionStore.trigger.requestStarted({
      tabId: TAB_IDS[0],
      requestId: 'shared-request',
      executionId: 'new-execution',
      sentAt: 1,
    })
    requestExecutionStore.trigger.requestFailed({
      tabId: TAB_IDS[0],
      requestId: 'shared-request',
      executionId: 'old-execution',
      error: 'Stale failure',
    })

    expect(requestExecutionStore.getSnapshot().context.httpExecutionByTabId[TAB_IDS[0]]).toMatchObject({
      isSending: true,
      activeExecutionId: 'new-execution',
      error: null,
    })
  })

  it('isolates WebSocket sessions by tab and ignores an older replaced session', () => {
    const firstSession = createWebSocketSession('session-a', 'shared-request', 1)
    const secondSession = createWebSocketSession('session-b', 'shared-request', 2)
    requestExecutionStore.trigger.websocketSessionUpdated({ tabId: TAB_IDS[0], session: firstSession })
    requestExecutionStore.trigger.websocketSessionUpdated({ tabId: TAB_IDS[1], session: secondSession })
    requestExecutionStore.trigger.websocketSessionUpdated({
      tabId: TAB_IDS[0],
      session: { ...createWebSocketSession('session-new', 'shared-request', 3), connectionState: 'connecting' },
    })
    requestExecutionStore.trigger.websocketSessionUpdated({
      tabId: TAB_IDS[0],
      session: { ...firstSession, connectionState: 'closed', disconnectedAt: 4 },
    })

    const sessions = requestExecutionStore.getSnapshot().context.websocketSessionByTabId
    expect(sessions[TAB_IDS[0]]?.id).toBe('session-new')
    expect(sessions[TAB_IDS[1]]?.id).toBe('session-b')
  })
})

function createWebSocketSession(id: string, requestId: string, connectedAt: number): WebSocketSessionRecord {
  return {
    itemType: 'websocket',
    id,
    requestId,
    requestName: 'Request',
    url: 'wss://example.com',
    requestHeaders: '',
    requestVariables: {},
    connectionState: 'open',
    connectedAt,
    disconnectedAt: null,
    closeCode: null,
    closeReason: null,
    responseError: null,
    historySizeBytes: 0,
    messages: [],
  }
}
