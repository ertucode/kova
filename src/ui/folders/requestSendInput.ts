import type { SendRequestInput, SendRequestMetadata } from '@common/Requests'
import type { ScriptCallRequestOverrides } from '@common/ScriptMakeRequest'
import type { RequestDetailsDraft } from './folderExplorerTypes'

export function buildSendRequestInput({
  requestId,
  draft,
  activeEnvironmentIds,
  historyKeepLast,
  requestMetadata,
  callRequestOverrides,
  executionId,
}: {
  requestId: string
  draft: RequestDetailsDraft
  activeEnvironmentIds: string[]
  historyKeepLast: number
  requestMetadata?: SendRequestMetadata
  callRequestOverrides?: ScriptCallRequestOverrides
  executionId?: string
}): SendRequestInput {
  return {
    executionId,
    requestId,
    method: draft.method,
    url: draft.url,
    pathParams: draft.pathParams,
    searchParams: draft.searchParams,
    auth: draft.auth,
    preRequestScript: draft.preRequestScript,
    postRequestScript: draft.postRequestScript,
    testScript: draft.testScript,
    headers: draft.headers,
    body: draft.body,
    bodyType: draft.bodyType,
    rawType: draft.rawType,
    graphqlQuery: draft.graphqlQuery,
    graphqlVariables: draft.graphqlVariables,
    tlsVerificationMode: draft.tlsVerificationMode,
    activeEnvironmentIds,
    saveToHistory: draft.saveToHistory,
    historyKeepLast,
    requestMetadata,
    callRequestOverrides,
  }
}
