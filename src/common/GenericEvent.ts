import type { HttpSseStreamState, WebSocketSessionRecord } from './Requests.js'
import type { FolderRunCampaignSummary, FolderRunRecord, FolderRunStatus } from './FolderRuns.js'
import type { ScriptAiWorkspaceState } from './ScriptAi.js'
import type { ManagementAgentWorkspaceState } from './ManagementAgent.js'
import type { ScriptCallRequestRequest, ScriptMakeRequestRequest } from './ScriptMakeRequest.js'
import type { ScriptPromptRequest } from './ScriptPrompt.js'
import type { ScriptToastOptions } from './ScriptToast.js'
import type { SendRequestMetadata } from './Requests.js'
import type { RequestBatchRowStatus, RequestBatchStatus, RequestBatchSummary } from './RequestBatches.js'
import type { RequestFinalValueTarget } from './Requests.js'

export type GenericEvent =
  | {
      type: 'folder-run-progress'
      runId: string
      folderId: string
      summary: FolderRunCampaignSummary
      iterations: FolderRunRecord['iterations']
    }
  | {
      type: 'reload-path'
      path: string
      fileToSelect?: $Maybe<string>
    }
  | {
      type: 'fix-request-search-param-value'
      rowId: string
    }
  | {
      type: 'copy-request-final-value'
      target: RequestFinalValueTarget
      template?: string
    }
  | {
      type: 'cookies-updated'
    }
  | {
      type: 'environments-updated'
      environmentIds: string[]
    }
  | {
      type: 'websocket-session-updated'
      tabId: string
      session: WebSocketSessionRecord
    }
  | {
      type: 'websocket-session-cleared'
      tabId: string
    }
  | {
      type: 'http-sse-stream-updated'
      tabId: string
      stream: HttpSseStreamState
    }
  | {
      type: 'http-sse-stream-cleared'
      tabId: string
    }
  | {
      type: 'script-toast-show'
      toast: ScriptToastOptions
    }
  | {
      type: 'script-toast-hide'
      id: string
    }
  | {
      type: 'script-prompt-request'
      prompt: ScriptPromptRequest
    }
  | {
      type: 'script-make-request'
      request: ScriptMakeRequestRequest
    }
  | {
      type: 'script-call-request'
      request: ScriptCallRequestRequest
    }
  | {
      type: 'retry-request'
      tabId?: string
      requestId: string
      requestMetadata: SendRequestMetadata
    }
  | {
      type: 'folder-run-started'
      run: FolderRunRecord
    }
  | {
      type: 'folder-run-completed'
      runId: string
      folderId: string
      status: FolderRunStatus
      completedAt: number
      summary: FolderRunCampaignSummary
    }
  | {
      type: 'request-batch-updated'
      batchId: string
      status: RequestBatchStatus
      summary: RequestBatchSummary
      startedAt: number | null
      completedAt: number | null
    }
  | {
      type: 'request-batch-row-updated'
      batchId: string
      rowId: string
      status: RequestBatchRowStatus
      historyId: string | null
      errorMessage: string | null
      startedAt: number | null
      completedAt: number | null
    }
  | {
      type: 'script-ai-state-updated'
      state: ScriptAiWorkspaceState
    }
  | {
      type: 'management-agent-state-updated'
      state: ManagementAgentWorkspaceState
    }
