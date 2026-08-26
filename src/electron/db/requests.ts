import { createDefaultHttpAuth, parseHttpAuth, serializeHttpAuth } from '../../common/Auth.js'
import { and, eq, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  CreateRequestInput,
  DeleteRequestInput,
  DeleteRequestResponse,
  DuplicateRequestInput,
  GetRequestInput,
  HttpRequestRecord,
  ResponseBodyView,
  RequestBodyType,
  RequestMethod,
  RequestRawType,
  RequestTlsVerificationMode,
  RequestType,
  McpTransport,
  UpdateRequestInput,
  UpdateRequestResponseBodyViewPreferenceInput,
} from '../../common/Requests.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { markRequestExamplesDeleted } from './request-examples.js'
import { markWebSocketExamplesDeleted } from './websocket-examples.js'
import { insertOperation } from './operations.js'
import { mcpRequestDetails, requests, treeItems } from './schema.js'
import { ensureParentFolderExists, insertTreeItem, insertTreeItemAtPosition, markTreeItemDeleted } from './tree-items.js'

type RequestRow = typeof requests.$inferSelect
type McpRequestDetailsRow = typeof mcpRequestDetails.$inferSelect

const REQUEST_METHODS: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const REQUEST_BODY_TYPES: RequestBodyType[] = ['raw', 'form-data', 'x-www-form-urlencoded', 'none', 'graphql']
const REQUEST_RAW_TYPES: RequestRawType[] = ['json', 'text']
const REQUEST_TYPES: RequestType[] = ['http', 'websocket', 'mcp']
const MCP_TRANSPORTS: McpTransport[] = ['http']
const RESPONSE_BODY_VIEWS: ResponseBodyView[] = ['raw', 'table', 'visualizer']
const REQUEST_TLS_VERIFICATION_MODES: RequestTlsVerificationMode[] = ['inherit', 'strict', 'disable-for-localhost', 'disable']

export async function createRequest(input: CreateRequestInput): Promise<GenericResult<HttpRequestRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Request name is required')
  }

  if (!REQUEST_TYPES.includes(input.requestType)) {
    return GenericError.Message('Invalid request type')
  }

  try {
    const request = db.transaction(tx => {
      ensureParentFolderExists(tx, input.parentFolderId)

      const now = Date.now()
      const request: RequestRow = {
          id: crypto.randomUUID(),
          name,
        requestType: input.requestType,
        method: 'GET',
        url: '',
        pathParams: '',
        searchParams: '',
        authJson: serializeHttpAuth(createDefaultHttpAuth()),
        preRequestScript: '',
        postRequestScript: '',
        testScript: '',
        responseVisualizer: '',
        responseTableAccessor: '',
        preferredResponseBodyView: 'raw',
        prefersResponseVisualizer: false,
        headers: '',
        body: '',
        bodyType: 'none',
        rawType: 'json',
        graphqlQuery: '',
        graphqlVariables: '',
        graphqlSchema: '',
        tlsVerificationMode: 'inherit',
        websocketSubprotocols: '',
        websocketOnOpenMessage: '',
        websocketAutoSendEnabled: false,
        websocketAutoSendMessage: '',
        websocketAutoSendIntervalSeconds: 0,
        saveToHistory: true,
        createdAt: now,
        deletedAt: null,
      }

      tx.insert(requests).values(request).run()
      if (request.requestType === 'mcp') {
        tx.insert(mcpRequestDetails).values(createDefaultMcpRequestDetailsRow(request.id)).run()
      }
      insertTreeItem(tx, { parentFolderId: input.parentFolderId, itemType: 'request', itemId: request.id })
      return request
    })

    return Result.Success(toRequestRecord(request, request.requestType === 'mcp' ? createDefaultMcpRequestDetailsRow(request.id) : null))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function getRequest(input: GetRequestInput): Promise<GenericResult<HttpRequestRecord>> {
  const db = getDb()

  try {
    const request = db.select().from(requests).where(and(eq(requests.id, input.id), isNull(requests.deletedAt))).get()

    if (!request) {
      return GenericError.Message('Request not found')
    }

    return Result.Success(toRequestRecord(request, getMcpRequestDetailsOrNull(db, request.id, request.requestType as RequestType)))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateRequest(input: UpdateRequestInput): Promise<GenericResult<HttpRequestRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Request name is required')
  }

  try {
    const existingRequest = db
      .select()
      .from(requests)
      .where(and(eq(requests.id, input.id), isNull(requests.deletedAt)))
      .get()

    if (!existingRequest) {
      return GenericError.Message('Request not found')
    }

    if (!REQUEST_METHODS.includes(input.method)) {
      return GenericError.Message('Invalid request method')
    }

    if (!REQUEST_TYPES.includes(input.requestType) || input.requestType !== existingRequest.requestType) {
      return GenericError.Message('Request type cannot be changed')
    }

    if (!REQUEST_BODY_TYPES.includes(input.bodyType)) {
      return GenericError.Message('Invalid request body type')
    }

    if (!REQUEST_RAW_TYPES.includes(input.rawType)) {
      return GenericError.Message('Invalid request raw type')
    }

    if (!RESPONSE_BODY_VIEWS.includes(input.preferredResponseBodyView)) {
      return GenericError.Message('Invalid preferred response body view')
    }

    if (!REQUEST_TLS_VERIFICATION_MODES.includes(input.tlsVerificationMode)) {
      return GenericError.Message('Invalid TLS verification mode')
    }

    const mcpTransport = input.mcpTransport ?? 'http'
    if (!MCP_TRANSPORTS.includes(mcpTransport)) {
      return GenericError.Message('Invalid MCP transport')
    }

    const mcpServerUrl = input.mcpServerUrl ?? ''
    const mcpAccessToken = input.mcpAccessToken ?? ''
    const mcpSelectedToolName = input.mcpSelectedToolName ?? ''
    const mcpSelectedResourceUri = input.mcpSelectedResourceUri ?? ''
    const mcpSelectedPromptName = input.mcpSelectedPromptName ?? ''
    const mcpArguments = input.mcpArguments ?? ''
    const mcpIntrospection = input.mcpIntrospection ?? ''

    const result = db.transaction(tx => {
      const updateResult = tx
        .update(requests)
        .set({
          name,
          requestType: input.requestType,
          method: input.method,
          url: input.url,
          pathParams: input.pathParams,
          searchParams: input.searchParams,
          authJson: serializeHttpAuth(input.auth),
          preRequestScript: input.preRequestScript,
          postRequestScript: input.postRequestScript,
          testScript: input.testScript,
          responseVisualizer: input.responseVisualizer,
          responseTableAccessor: input.responseTableAccessor,
          preferredResponseBodyView: input.preferredResponseBodyView,
          headers: input.headers,
          body: input.body,
          bodyType: input.bodyType,
          rawType: input.rawType,
          graphqlQuery: input.graphqlQuery,
          graphqlVariables: input.graphqlVariables,
          graphqlSchema: input.graphqlSchema,
          tlsVerificationMode: input.tlsVerificationMode,
          websocketSubprotocols: input.websocketSubprotocols,
          websocketOnOpenMessage: input.websocketOnOpenMessage,
          websocketAutoSendEnabled: input.websocketAutoSendEnabled,
          websocketAutoSendMessage: input.websocketAutoSendMessage,
          websocketAutoSendIntervalSeconds: input.websocketAutoSendIntervalSeconds,
          saveToHistory: input.saveToHistory,
        })
        .where(and(eq(requests.id, input.id), isNull(requests.deletedAt)))
        .run()

      if (input.requestType === 'mcp') {
        tx
          .insert(mcpRequestDetails)
          .values({
            requestId: input.id,
            transport: mcpTransport,
            serverUrl: mcpServerUrl,
            accessToken: mcpAccessToken,
            selectedToolName: mcpSelectedToolName,
            selectedResourceUri: mcpSelectedResourceUri,
            selectedPromptName: mcpSelectedPromptName,
            argumentsJson: mcpArguments,
            introspectionJson: mcpIntrospection,
          })
          .onConflictDoUpdate({
            target: mcpRequestDetails.requestId,
            set: {
              transport: mcpTransport,
              serverUrl: mcpServerUrl,
              accessToken: mcpAccessToken,
              selectedToolName: mcpSelectedToolName,
              selectedResourceUri: mcpSelectedResourceUri,
              selectedPromptName: mcpSelectedPromptName,
              argumentsJson: mcpArguments,
              introspectionJson: mcpIntrospection,
            },
          })
          .run()
      }

      return updateResult
    })

    if (result.changes === 0) {
      return GenericError.Message('Request not found')
    }

    const request = db.select().from(requests).where(and(eq(requests.id, input.id), isNull(requests.deletedAt))).get()

    if (!request) {
      return GenericError.Message('Request not found')
    }

    return Result.Success(toRequestRecord(request, getMcpRequestDetailsOrNull(db, request.id, request.requestType as RequestType)))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateRequestResponseBodyViewPreference(
  input: UpdateRequestResponseBodyViewPreferenceInput
): Promise<GenericResult<HttpRequestRecord>> {
  const db = getDb()

  if (!RESPONSE_BODY_VIEWS.includes(input.preferredResponseBodyView)) {
    return GenericError.Message('Invalid preferred response body view')
  }

  try {
    const result = db
      .update(requests)
      .set({ preferredResponseBodyView: input.preferredResponseBodyView })
      .where(and(eq(requests.id, input.id), isNull(requests.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Request not found')
    }

    const request = db.select().from(requests).where(and(eq(requests.id, input.id), isNull(requests.deletedAt))).get()

    if (!request) {
      return GenericError.Message('Request not found')
    }

    return Result.Success(toRequestRecord(request, getMcpRequestDetailsOrNull(db, request.id, request.requestType as RequestType)))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteRequest(input: DeleteRequestInput): Promise<GenericResult<DeleteRequestResponse>> {
  const db = getDb()

  try {
    const deleted = db.transaction(tx => {
      return {
        operation: deleteRequestWithOperation(tx, input.id),
      }
    })

    return Result.Success(deleted)
  } catch (error) {
    if (error instanceof Error && error.message === 'Request not found') {
      return GenericError.Message(error.message)
    }
    return GenericError.Unknown(error)
  }
}

export function deleteRequestWithOperation(tx: ReturnType<typeof getDb>, requestId: string) {
  const request = tx
    .select({ id: requests.id, name: requests.name })
    .from(requests)
    .where(and(eq(requests.id, requestId), isNull(requests.deletedAt)))
    .get()

  if (!request) {
    throw new Error('Request not found')
  }

  const now = Date.now()
  const operation = insertOperation(tx, {
    operationType: 'delete-request',
    title: `Deleted request ${request.name}`,
    summary: 'Request deleted.',
    createdAt: now,
    metadata: {
      rootItemType: 'request',
      rootItemId: request.id,
      rootItemName: request.name,
      deletedAt: now,
      folderIds: [],
      requestIds: [request.id],
    },
  })

  const result = tx
    .update(requests)
    .set({ deletedAt: now })
    .where(and(eq(requests.id, requestId), isNull(requests.deletedAt)))
    .run()

  if (result.changes === 0) {
    throw new Error('Request not found')
  }

  tx.delete(mcpRequestDetails).where(eq(mcpRequestDetails.requestId, requestId)).run()

  markTreeItemDeleted(tx, { itemType: 'request', itemId: requestId, deletedAt: now })
  markRequestExamplesDeleted(requestId, now, tx)
  markWebSocketExamplesDeleted(requestId, now, tx)

  return operation
}

export async function duplicateRequest(input: DuplicateRequestInput): Promise<GenericResult<HttpRequestRecord>> {
  const db = getDb()

  try {
    const duplicated = db.transaction(tx => {
      const sourceRequest = tx
        .select()
        .from(requests)
        .where(and(eq(requests.id, input.id), isNull(requests.deletedAt)))
        .get()

      if (!sourceRequest) {
        throw new Error('Request not found')
      }

      const sourceTreeItem = tx
        .select({ rowId: treeItems.id, parentFolderId: treeItems.parentFolderId, position: treeItems.position })
        .from(treeItems)
        .where(and(eq(treeItems.itemType, 'request'), eq(treeItems.itemId, input.id), isNull(treeItems.deletedAt)))
        .get()

      if (!sourceTreeItem) {
        throw new Error('Request tree item not found')
      }

      const siblingTreeItems = tx
        .select({ rowId: treeItems.id })
        .from(treeItems)
        .where(
          sourceTreeItem.parentFolderId
            ? and(eq(treeItems.parentFolderId, sourceTreeItem.parentFolderId), isNull(treeItems.deletedAt))
            : and(isNull(treeItems.parentFolderId), isNull(treeItems.deletedAt))
        )
        .orderBy(treeItems.position, treeItems.createdAt)
        .all()
      const sourceIndex = siblingTreeItems.findIndex(sibling => sibling.rowId === sourceTreeItem.rowId)

      if (sourceIndex < 0) {
        throw new Error('Request tree item order not found')
      }

      const now = Date.now()
      const request: RequestRow = {
        ...sourceRequest,
        id: crypto.randomUUID(),
        name: buildDuplicateRequestName(tx, sourceTreeItem.parentFolderId, sourceRequest.name),
        createdAt: now,
        deletedAt: null,
      }

      tx.insert(requests).values(request).run()
      if (request.requestType === 'mcp') {
        const sourceMcpRequestDetails = tx
          .select()
          .from(mcpRequestDetails)
          .where(eq(mcpRequestDetails.requestId, sourceRequest.id))
          .get()
        tx
          .insert(mcpRequestDetails)
          .values(
            sourceMcpRequestDetails
              ? {
                  ...sourceMcpRequestDetails,
                  requestId: request.id,
                }
              : createDefaultMcpRequestDetailsRow(request.id)
          )
          .run()
      }
      insertTreeItemAtPosition(tx, {
        parentFolderId: sourceTreeItem.parentFolderId,
        itemType: 'request',
        itemId: request.id,
        position: sourceIndex + 1,
      })
      return request
    })

    return Result.Success(
      toRequestRecord(duplicated, duplicated.requestType === 'mcp' ? getMcpRequestDetailsOrNull(db, duplicated.id, 'mcp') : null)
    )
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function toRequestRecord(request: RequestRow, mcpDetails: McpRequestDetailsRow | null): HttpRequestRecord {
  return {
    id: request.id,
    name: request.name,
    method: request.method as RequestMethod,
    requestType: request.requestType as RequestType,
    url: request.url,
    pathParams: request.pathParams,
    searchParams: request.searchParams,
    auth: parseHttpAuth(request.authJson),
    preRequestScript: request.preRequestScript,
    postRequestScript: request.postRequestScript,
    testScript: request.testScript,
    responseVisualizer: request.responseVisualizer,
    responseTableAccessor: request.responseTableAccessor,
    preferredResponseBodyView: (RESPONSE_BODY_VIEWS.includes(request.preferredResponseBodyView as ResponseBodyView)
      ? request.preferredResponseBodyView
      : 'raw') as ResponseBodyView,
    headers: request.headers,
    body: request.body,
    bodyType: request.bodyType as RequestBodyType,
    rawType: request.rawType as RequestRawType,
    graphqlQuery: request.graphqlQuery,
    graphqlVariables: request.graphqlVariables,
    graphqlSchema: request.graphqlSchema,
    tlsVerificationMode: REQUEST_TLS_VERIFICATION_MODES.includes(
      request.tlsVerificationMode as RequestTlsVerificationMode
    )
      ? (request.tlsVerificationMode as RequestTlsVerificationMode)
      : 'inherit',
    websocketSubprotocols: request.websocketSubprotocols,
    websocketOnOpenMessage: request.websocketOnOpenMessage,
    websocketAutoSendEnabled: request.websocketAutoSendEnabled,
    websocketAutoSendMessage: request.websocketAutoSendMessage,
    websocketAutoSendIntervalSeconds: request.websocketAutoSendIntervalSeconds,
    mcpTransport: mcpDetails ? toMcpTransport(mcpDetails.transport) : 'http',
    mcpServerUrl: mcpDetails?.serverUrl ?? '',
    mcpAccessToken: mcpDetails?.accessToken ?? '',
    mcpSelectedToolName: mcpDetails?.selectedToolName ?? '',
    mcpSelectedResourceUri: mcpDetails?.selectedResourceUri ?? '',
    mcpSelectedPromptName: mcpDetails?.selectedPromptName ?? '',
    mcpArguments: mcpDetails?.argumentsJson ?? '',
    mcpIntrospection: mcpDetails?.introspectionJson ?? '',
    saveToHistory: request.saveToHistory,
    createdAt: request.createdAt,
    deletedAt: request.deletedAt,
  }
}

function createDefaultMcpRequestDetailsRow(requestId: string): McpRequestDetailsRow {
  return {
    requestId,
    transport: 'http',
    serverUrl: '',
    accessToken: '',
    selectedToolName: '',
    selectedResourceUri: '',
    selectedPromptName: '',
    argumentsJson: '',
    introspectionJson: '',
  }
}

function getMcpRequestDetailsOrNull(db: ReturnType<typeof getDb>, requestId: string, requestType: RequestType) {
  if (requestType !== 'mcp') {
    return null
  }

  return db.select().from(mcpRequestDetails).where(eq(mcpRequestDetails.requestId, requestId)).get() ?? null
}

function toMcpTransport(value: string): McpTransport {
  return MCP_TRANSPORTS.includes(value as McpTransport) ? (value as McpTransport) : 'http'
}

function buildDuplicateRequestName(db: ReturnType<typeof getDb>, parentFolderId: string | null, sourceName: string) {
  const siblingRequestNames = db
    .select({ name: requests.name })
    .from(requests)
    .innerJoin(treeItems, and(eq(treeItems.itemId, requests.id), eq(treeItems.itemType, 'request'), isNull(treeItems.deletedAt)))
    .where(
      and(
        isNull(requests.deletedAt),
        parentFolderId ? eq(treeItems.parentFolderId, parentFolderId) : isNull(treeItems.parentFolderId)
      )
    )
    .all()
    .map(row => row.name)

  const baseName = sourceName.replace(/ \(\d+\)$/u, '')
  let index = 2

  while (siblingRequestNames.includes(`${baseName} (${index})`)) {
    index += 1
  }

  return `${baseName} (${index})`
}
