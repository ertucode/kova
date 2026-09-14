import type { HttpSseStreamState, WebSocketSessionRecord } from './Requests.js'
import type { FolderRunRecord, FolderRunRequest, FolderRunSummary, FolderRunStatus } from './FolderRuns.js'
import type { ScriptAiWorkspaceState } from './ScriptAi.js'
import type { ManagementAgentWorkspaceState } from './ManagementAgent.js'
import type { ScriptCallRequestRequest, ScriptMakeRequestRequest } from './ScriptMakeRequest.js'
import type { ScriptPromptRequest } from './ScriptPrompt.js'
import type { ScriptToastOptions } from './ScriptToast.js'
import type { SendRequestMetadata } from './Requests.js'
import type { RequestBatchRowStatus, RequestBatchStatus, RequestBatchSummary } from './RequestBatches.js'

export type GenericEvent =
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
      type: 'cookies-updated'
    }
  | {
      type: 'environments-updated'
      environmentIds: string[]
    }
  | {
      type: 'websocket-session-updated'
      session: WebSocketSessionRecord
    }
  | {
      type: 'websocket-session-cleared'
      requestId: string
    }
  | {
      type: 'http-sse-stream-updated'
      stream: HttpSseStreamState
    }
  | {
      type: 'http-sse-stream-cleared'
      requestId: string
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
      requestId: string
      requestMetadata: SendRequestMetadata
    }
  | {
      type: 'folder-run-started'
      run: FolderRunRecord
    }
  | {
      type: 'folder-run-request-started'
      runId: string
      folderId: string
      requestId: string
      startedAt: number
      summary: FolderRunSummary
    }
  | {
      type: 'folder-run-request-completed'
      runId: string
      folderId: string
      request: FolderRunRequest
      summary: FolderRunSummary
    }
  | {
      type: 'folder-run-completed'
      runId: string
      folderId: string
      status: FolderRunStatus
      completedAt: number
      summary: FolderRunSummary
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
