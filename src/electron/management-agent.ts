import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  isSessionNotFoundError,
  type OpenCodeClient,
  type SessionMessageAssistant,
  type SessionMessageAssistantTool,
  type SessionMessageInfo,
  type SessionStatus,
  type ToolContent,
  type V2Event,
} from '@opencode/client'
import { DEFAULT_SCRIPT_AI_SERVER_PORT } from '../common/AppSettings.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import {
  type AbortManagementAgentSessionInput,
  type ApplyManagementAgentPlanInput,
  type CreateManagementAgentSessionInput,
  type ManagementAgentMessage,
  type ManagementAgentScope,
  type ManagementAgentWorkspaceState,
  type LoadManagementAgentWorkspaceInput,
  type SendManagementAgentMessageInput,
} from '../common/ManagementAgent.js'
import { Result } from '../common/Result.js'
import { Typescript } from '../common/Typescript.js'
import { emitGenericEvent } from './generic-events.js'
import { getAppSettings } from './db/app-settings.js'
import {
  applyManagementAgentDraftPlan,
  createManagementAgentSessionRecord,
  getManagementAgentSession,
  getManagementAgentSessionByOpenCodeSessionId,
  loadManagementAgentWorkspaceState,
  updateManagementAgentSession,
} from './db/management-agent.js'
import { listEnvironments } from './db/environments.js'
import { getRequestParentFolderId, listExplorerItems } from './db/explorer.js'
import { getRequest } from './db/requests.js'
import { MANAGEMENT_AGENT_MCP_SERVER_NAME, startManagementAgentMcpServer } from './management-agent-mcp-server.js'
import { startOpenCodeServer, type OpenCodeServer } from './utils/opencode-v2-server.js'
import { getPreferredOpenCodeModel } from './utils/opencode-model-selection.js'

type ManagementAgentServerRuntime = {
  ownedServer: OpenCodeServer
  globalClient: OpenCodeClient
  eventLoopStarted: boolean
  eventLoopPromise: Promise<void> | null
  globalEventAbortController: AbortController
  mcpServer: Awaited<ReturnType<typeof startManagementAgentMcpServer>>
  mcpRegisteredDirectories: Set<string>
}

let managementAgentBaseDirectory: string | null = null
let serverRuntimePromise: Promise<ManagementAgentServerRuntime> | null = null
let serverStartupAbortController: AbortController | null = null
const liveMessagesBySessionId = new Map<string, ManagementAgentMessage[]>()
const eventRefreshTimers = new Map<string, NodeJS.Timeout>()

export function configureManagementAgentBaseDirectory(directory: string) {
  managementAgentBaseDirectory = directory
}

export async function shutdownManagementAgentServer() {
  serverStartupAbortController?.abort()
  serverStartupAbortController = null

  if (!serverRuntimePromise) {
    return
  }

  try {
    for (const timer of eventRefreshTimers.values()) {
      clearTimeout(timer)
    }
    eventRefreshTimers.clear()
    const runtime = await serverRuntimePromise
    runtime.globalEventAbortController.abort()
    await runtime.eventLoopPromise?.catch(() => undefined)
    runtime.ownedServer?.close()
    await runtime.mcpServer.close().catch(() => undefined)
  } finally {
    serverRuntimePromise = null
    liveMessagesBySessionId.clear()
  }
}

export async function loadManagementAgentWorkspace(
  input: LoadManagementAgentWorkspaceInput
): Promise<GenericResult<ManagementAgentWorkspaceState>> {
  try {
    return Result.Success(await loadManagementAgentWorkspaceStateWithOpenCode(input))
  } catch (error) {
    return toGenericError(error)
  }
}

export async function createManagementAgentSession(
  input: CreateManagementAgentSessionInput
): Promise<GenericResult<ManagementAgentWorkspaceState>> {
  try {
    const state = await createManagementAgentSessionRecord({
      scopeType: input.scopeType,
      targetFolderId: input.targetFolderId,
      targetRequestId: input.targetRequestId,
      title: buildManagementAgentSessionTitle(input),
      selectedModel: input.model,
    })
    emitManagementAgentState(state)
    return Result.Success(state)
  } catch (error) {
    return toGenericError(error)
  }
}

export async function sendManagementAgentMessage(
  input: SendManagementAgentMessageInput
): Promise<GenericResult<ManagementAgentWorkspaceState>> {
  try {
    const session = getManagementAgentSession(input.sessionId)
    if (!session) {
      return GenericError.Message('Management session not found.')
    }

    const opencodeSessionId = await ensureOpencodeSessionId(session.id, input.model)

    updateManagementAgentSession(session.id, {
      opencodeSessionId,
      selectedModel: input.model,
      status: 'busy',
      latestErrorMessage: null,
    })
    const busyState = await loadManagementAgentWorkspaceStateWithOpenCode(toScope(session))
    emitManagementAgentState(busyState)

    const client = await getClientForSession(session.id)
    const syntheticContext = await buildSyntheticAppliedContext(session.id)
    void runPromptInBackground({
      sessionId: session.id,
      opencodeSessionId,
      model: input.model,
      systemPrompt: await buildSystemPrompt(session.id),
      message: input.message,
      syntheticContext,
      client,
    })

    return Result.Success(busyState)
  } catch (error) {
    const session = getManagementAgentSession(input.sessionId)
    if (session) {
      updateManagementAgentSession(session.id, {
        status: 'error',
        latestErrorMessage: error instanceof Error ? error.message : String(error),
      })
      emitManagementAgentState(
        await loadManagementAgentWorkspaceStateWithOpenCode(toScope(session)).catch(() =>
          loadManagementAgentWorkspaceState(toScope(session))
        )
      )
    }
    return toGenericError(error)
  }
}

export async function abortManagementAgentSession(
  input: AbortManagementAgentSessionInput
): Promise<GenericResult<ManagementAgentWorkspaceState>> {
  try {
    const session = getManagementAgentSession(input.sessionId)
    if (!session) {
      return GenericError.Message('Management session not found.')
    }

    if (session.opencodeSessionId) {
      const client = await getClientForSession(session.id)
      await client.session.interrupt({ sessionID: session.opencodeSessionId })
    }

    const messagesBySessionId = await syncManagementAgentSessionFromOpenCode(session.id)
    const state = await loadManagementAgentWorkspaceStateWithOpenCode(toScope(session), { messagesBySessionId })
    emitManagementAgentState(state)
    return Result.Success(state)
  } catch (error) {
    return toGenericError(error)
  }
}

export async function applyManagementAgentPlan(
  input: ApplyManagementAgentPlanInput
): Promise<GenericResult<ManagementAgentWorkspaceState>> {
  try {
    const state = await applyManagementAgentDraftPlan(input.sessionId)
    emitGenericEvent({
      type: 'environments-updated',
      environmentIds: (await listEnvironments()).map(environment => environment.id),
    })
    emitManagementAgentState(state)
    return Result.Success(state)
  } catch (error) {
    return toGenericError(error)
  }
}

async function syncManagementAgentSessionFromOpenCode(sessionId: string) {
  const session = getManagementAgentSession(sessionId)
  if (!session?.opencodeSessionId) {
    return {} as Record<string, ManagementAgentMessage[]>
  }

  const client = await getClientForSession(session.id)
  let sdkSession: Awaited<ReturnType<OpenCodeClient['session']['get']>>
  let activeSessions: Awaited<ReturnType<OpenCodeClient['session']['active']>>
  let sdkMessages: SessionMessageInfo[]
  try {
    ;[sdkSession, activeSessions, sdkMessages] = await Promise.all([
      client.session.get({ sessionID: session.opencodeSessionId }),
      client.session.active(),
      loadOpenCodeMessages(client, session.opencodeSessionId),
    ])
  } catch (error) {
    if (!isSessionNotFoundError(error)) {
      throw error
    }
    resetMissingOpenCodeSession(session.id)
    return { [session.id]: [] }
  }
  const messages = sdkMessages.flatMap(message => {
    const converted = toManagementAgentMessage(message)
    return converted ? [converted] : []
  })
  const latestErrorMessage = getLatestErrorMessage(messages)

  updateManagementAgentSession(session.id, {
    title: sdkSession.title ?? session.title,
    status: activeSessions[session.opencodeSessionId] ? 'busy' : latestErrorMessage ? 'error' : 'idle',
    latestErrorMessage,
  })
  liveMessagesBySessionId.set(session.id, messages)

  return {
    [session.id]: messages,
  }
}

async function ensureOpencodeSessionId(sessionId: string, selectedModel: string | null) {
  const session = getManagementAgentSession(sessionId)
  if (!session) {
    throw new Error('Management session not found.')
  }

  if (session.opencodeSessionId) {
    const client = await getClientForSession(session.id)
    try {
      await client.session.get({ sessionID: session.opencodeSessionId })
      if (selectedModel !== session.selectedModel) {
        updateManagementAgentSession(session.id, { selectedModel })
      }
      return session.opencodeSessionId
    } catch (error) {
      if (!isSessionNotFoundError(error)) {
        throw error
      }
      resetMissingOpenCodeSession(session.id)
    }
  }

  const client = await getClientForSession(session.id)
  const directory = await getSessionWorkspaceDirectory(session.id)
  const opencodeSession = await client.session.create({
    title: session.title,
    location: { directory },
    model: await resolveSelectedModel(selectedModel),
    permissions: getManagementAgentPermissions(),
  })
  updateManagementAgentSession(session.id, {
    opencodeSessionId: opencodeSession.id,
    selectedModel,
    status: 'idle',
  })
  return opencodeSession.id
}

async function buildSystemPrompt(sessionId: string) {
  const session = getManagementAgentSession(sessionId)
  if (!session) {
    throw new Error('Management session not found.')
  }

  const requestContext = session.targetRequestId ? await getRequestContext(session.targetRequestId) : null
  const scopeLabel = getManagementScopeLabel(session, requestContext)
  const currentFolderId = await getScopeFolderId(session)
  const currentFolderPath = currentFolderId ? await getFolderPathById(currentFolderId) : []

  return [
    "You are Kova's Manage with AI assistant.",
    "Your job is to inspect the current Kova workspace, understand the user's management request, and keep the live draft plan up to date.",
    'The Kova draft plan is the only source of truth for pending changes. Do not return final JSON in chat as the source of truth.',
    'Never mutate Kova data directly. You may inspect workspace state and update, replace, or clear the current draft plan only through the available Kova management agent MCP tools.',
    'Do not edit files, create files, or use unrelated tools. Prefer the Kova management agent MCP tools over anything else.',
    `Current management scope: ${scopeLabel}. When the draft uses parentFolderId: null, it means the root of this scope.`,
    `Current scope folderId: ${currentFolderId ?? 'null'}.`,
    `Current scope folderPath from workspace root: ${JSON.stringify(currentFolderPath)}.`,
    `Current scope requestId: ${session.targetRequestId ?? 'null'}.`,
    `Current scope requestPath from workspace root: ${JSON.stringify(requestContext?.path ?? [])}.`,
    `Current scope request name: ${requestContext?.request.name ?? 'null'}.`,
    `Current scope request method: ${requestContext?.request.method ?? 'null'}.`,
    `Current scope request url: ${requestContext?.request.url ?? 'null'}.`,
    'When you update the draft, prefer the most targeted draft mutation tools available. Use full draft replacement only when you intentionally need to restructure the whole plan.',
    'If the agent is unsure which environment should receive variables, keep the draft apply-safe by adding explicit questions instead of guessing.',
    session.scopeType === 'request'
      ? 'This request scope is primarily a convenience scope: default to the current request and its folder path without asking the user to restate them, but you may propose changes anywhere in the workspace when needed.'
      : 'Use the current scope as your default starting point.',
    '',
    'Draft plan JSON shape:',
    JSON.stringify(
      {
        summary: 'short human summary',
        questions: [{ id: 'question-1', label: 'question title', details: 'what must be clarified' }],
        warnings: [{ id: 'warning-1', message: 'warning text' }],
        foldersToCreate: [{ id: 'folder-1', parentFolderId: null, name: 'Folder Name' }],
        foldersToUpdate: [
          {
            folderId: 'existing-folder-id',
            name: 'Updated Folder Name',
            description: '',
            headers: '',
            auth: { type: 'inherit' },
            preRequestScript: '',
            postRequestScript: '',
            runConfig: {
              selectionMode: 'tests-only',
              selectedRequestIds: [],
              executionMode: 'sequential',
              continueOnFailure: true,
              runMode: 'once',
              iterationCount: 1,
              concurrency: 1,
            },
          },
        ],
        requestsToCreate: [
          {
            id: 'request-1',
            parentFolderId: null,
            name: 'Create Order',
            method: 'POST',
            url: '{{baseUrl}}/orders',
            pathParams: '',
            searchParams: '',
            auth: { type: 'inherit' },
            headers: 'Content-Type:application/json',
            body: '{"name":"sample"}',
            bodyType: 'raw',
            rawType: 'json',
            graphqlQuery: '',
            graphqlVariables: '',
            preRequestScript: '',
            postRequestScript: '',
            testScript: '',
            responseVisualizer: '',
            responseTableAccessor: '',
            preferredResponseBodyView: 'raw',
            tlsVerificationMode: 'inherit',
            saveToHistory: true,
          },
        ],
        requestsToUpdate: [],
        requestsToDelete: [{ requestId: 'request-id' }],
        foldersToDelete: [{ folderId: 'folder-id' }],
        environmentUpdates: [
          {
            environmentId: 'env-id',
            environmentName: 'Local',
            variables: [{ key: 'baseUrl', value: 'https://api.example.com' }],
          },
        ],
      },
      null,
      2
    ),
  ].join('\n')
}

async function buildSyntheticAppliedContext(sessionId: string) {
  const workspaceState = await loadManagementAgentWorkspaceStateWithOpenCode(toScope(requireSession(sessionId)))
  const sessionState = workspaceState.sessions.find(item => item.session.id === sessionId) ?? null
  const latestAppliedPlan = sessionState?.appliedPlans[0] ?? null
  const activePlan = sessionState?.activePlan ?? null

  if (!latestAppliedPlan || activePlan) {
    return null
  }

  return [
    'Context note from Kova:',
    'The previous draft plan has already been applied to the workspace.',
    'Inspect current workspace state again before proposing more changes.',
    `Last applied summary: ${latestAppliedPlan.plan.summary || 'No summary provided.'}`,
  ].join('\n')
}

async function getClientForSession(sessionId: string) {
  const runtime = await getServerRuntime()
  const directory = await getSessionWorkspaceDirectory(sessionId)
  await ensureManagementAgentMcpRegistration(runtime.globalClient, runtime.mcpServer, directory, runtime, sessionId)
  return runtime.globalClient
}

async function getServerRuntime(): Promise<ManagementAgentServerRuntime> {
  if (!serverRuntimePromise) {
    serverRuntimePromise = createServerRuntime().catch(error => {
      serverRuntimePromise = null
      throw error
    })
  }

  return await serverRuntimePromise
}

async function createServerRuntime(): Promise<ManagementAgentServerRuntime> {
  const managementAgentServerPort = await getConfiguredOpenCodeServerPort()
  const mcpServer = await startManagementAgentMcpServer()
  const startupAbortController = new AbortController()
  serverStartupAbortController = startupAbortController
  try {
    const ownedServer = await startOpenCodeServer(managementAgentServerPort, startupAbortController.signal)
    const runtime: ManagementAgentServerRuntime = {
      ownedServer,
      globalClient: ownedServer.client,
      eventLoopStarted: false,
      eventLoopPromise: null,
      globalEventAbortController: new AbortController(),
      mcpServer,
      mcpRegisteredDirectories: new Set(),
    }

    startGlobalEventLoop(runtime)
    return runtime
  } catch (error) {
    await mcpServer.close().catch(() => undefined)
    throw error
  } finally {
    if (serverStartupAbortController === startupAbortController) {
      serverStartupAbortController = null
    }
  }

}

async function ensureManagementAgentMcpRegistration(
  client: OpenCodeClient,
  mcpServer: Awaited<ReturnType<typeof startManagementAgentMcpServer>>,
  directory?: string,
  runtime?: ManagementAgentServerRuntime,
  sessionId?: string
) {
  if (directory && runtime?.mcpRegisteredDirectories.has(directory)) {
    return
  }

  const mcpServerUrl = sessionId ? `${mcpServer.url}?sessionId=${encodeURIComponent(sessionId)}` : mcpServer.url

  await client.mcp.add({
    server: MANAGEMENT_AGENT_MCP_SERVER_NAME,
    location: directory ? { directory } : undefined,
    config: {
      type: 'remote',
      url: mcpServerUrl,
      headers: {
        Authorization: `Bearer ${mcpServer.token}`,
      },
      disabled: false,
      codemode: false,
      oauth: false,
      timeout: { startup: 10_000, catalog: 10_000, execution: 10_000 },
    },
  })
  const servers = await client.mcp.list({ location: directory ? { directory } : undefined })
  const server = servers.data.find(item => item.name === MANAGEMENT_AGENT_MCP_SERVER_NAME)
  if (server?.status.status === 'connected') {
    if (directory && runtime) {
      runtime.mcpRegisteredDirectories.add(directory)
    }
    return
  }

  await client.mcp.connect({
    server: MANAGEMENT_AGENT_MCP_SERVER_NAME,
    location: directory ? { directory } : undefined,
  })

  if (directory && runtime) {
    runtime.mcpRegisteredDirectories.add(directory)
  }
}

function startGlobalEventLoop(runtime: ManagementAgentServerRuntime) {
  if (runtime.eventLoopStarted) {
    return
  }

  runtime.eventLoopStarted = true
  runtime.eventLoopPromise = (async () => {
    try {
      for await (const event of runtime.globalClient.event.subscribe({ signal: runtime.globalEventAbortController.signal })) {
        if (runtime.globalEventAbortController.signal.aborted) {
          return
        }

        await handleGlobalEvent(event)
      }
    } catch (error) {
      if (!runtime.globalEventAbortController.signal.aborted && !isAbortError(error)) {
        console.error('Import Agent global event loop failed', error)
      }
    }
  })()
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

async function getConfiguredOpenCodeServerPort() {
  const settings = await getAppSettings()
  return settings.scriptAiServerPort ?? DEFAULT_SCRIPT_AI_SERVER_PORT
}

async function getSessionWorkspaceDirectory(sessionId: string) {
  const baseDirectory = getManagementAgentBaseDirectory()
  const directory = path.join(baseDirectory, hashValue(sessionId))
  await mkdir(directory, { recursive: true })
  return directory
}

function buildManagementAgentSessionTitle(scope: ManagementAgentScope) {
  switch (scope.scopeType) {
    case 'workspace':
      return 'Manage workspace'
    case 'folder':
      return `Manage folder ${scope.targetFolderId}`
    case 'request':
      return `Manage request ${scope.targetRequestId}`
    default:
      return Typescript.assertUnreachable(scope.scopeType)
  }
}

async function getRequestContext(requestId: string) {
  const requestResult = await getRequest({ id: requestId })
  if (!requestResult.success) {
    return null
  }

  const parentFolderId = await getRequestParentFolderId(requestId)
  const folderPath = parentFolderId ? await getFolderPathById(parentFolderId) : []

  return {
    request: requestResult.data,
    path: [...folderPath, requestResult.data.name],
    parentFolderId,
  }
}

function getManagementScopeLabel(
  session: { scopeType: string; targetFolderId: string | null; targetRequestId: string | null },
  requestContext: Awaited<ReturnType<typeof getRequestContext>>
) {
  switch (session.scopeType) {
    case 'workspace':
      return 'workspace scope'
    case 'folder':
      return `folder scope rooted at ${session.targetFolderId}`
    case 'request':
      return requestContext
        ? `request scope centered on ${requestContext.request.id} at path ${JSON.stringify(requestContext.path)}`
        : `request scope centered on ${session.targetRequestId}`
    default:
      return Typescript.assertUnreachable(session.scopeType as never)
  }
}

async function getScopeFolderId(session: {
  scopeType: string
  targetFolderId: string | null
  targetRequestId: string | null
}) {
  switch (session.scopeType) {
    case 'workspace':
      return null
    case 'folder':
      return session.targetFolderId
    case 'request':
      return session.targetRequestId ? await getRequestParentFolderId(session.targetRequestId) : null
    default:
      return Typescript.assertUnreachable(session.scopeType as never)
  }
}

async function getFolderPathById(folderId: string) {
  const explorer = await listExplorerItems()
  const folderMap = new Map(
    explorer
      .filter((item): item is Extract<(typeof explorer)[number], { itemType: 'folder' }> => item.itemType === 'folder')
      .map(item => [item.id, item] as const)
  )
  const pathSegments: string[] = []
  let currentFolderId: string | null = folderId

  while (currentFolderId) {
    const folder = folderMap.get(currentFolderId)
    if (!folder) {
      break
    }

    pathSegments.unshift(folder.name)
    currentFolderId = folder.parentFolderId
  }

  return pathSegments
}

function parseSelectedModel(value: string | null) {
  if (!value) {
    return undefined
  }

  const separatorIndex = value.indexOf('/')
  if (separatorIndex === -1) {
    return undefined
  }

  return {
    providerID: value.slice(0, separatorIndex),
    id: value.slice(separatorIndex + 1),
  }
}

async function resolveSelectedModel(value: string | null) {
  return parseSelectedModel(value) ?? await getPreferredOpenCodeModel()
}

function getManagementAgentPermissions() {
  return [
    { action: 'read', resource: '*', effect: 'deny' as const },
    { action: 'edit', resource: '*', effect: 'deny' as const },
    { action: 'glob', resource: '*', effect: 'deny' as const },
    { action: 'grep', resource: '*', effect: 'deny' as const },
    { action: 'shell', resource: '*', effect: 'deny' as const },
    { action: 'subagent', resource: '*', effect: 'deny' as const },
    { action: 'skill', resource: '*', effect: 'deny' as const },
    { action: 'question', resource: '*', effect: 'deny' as const },
    { action: 'webfetch', resource: '*', effect: 'deny' as const },
    { action: 'websearch', resource: '*', effect: 'deny' as const },
    { action: 'external_directory', resource: '*', effect: 'deny' as const },
    { action: 'execute', resource: '*', effect: 'deny' as const },
    { action: `${MANAGEMENT_AGENT_MCP_SERVER_NAME}_*`, resource: '*', effect: 'allow' as const },
  ]
}

function toUiSessionStatus(status: SessionStatus): 'idle' | 'busy' | 'error' {
  switch (status.type) {
    case 'idle':
      return 'idle'
    case 'busy':
    case 'retry':
      return 'busy'
  }
}

function getLatestErrorMessage(messages: ManagementAgentMessage[]) {
  return [...messages].reverse().find(message => message.errorMessage)?.errorMessage ?? null
}

function toManagementAgentMessage(message: SessionMessageInfo): ManagementAgentMessage | null {
  if (message.type !== 'user' && message.type !== 'assistant') {
    return null
  }
  const usage = message.type === 'assistant' ? getAssistantMessageUsage(message) : null
  const parts: ManagementAgentMessage['parts'] = message.type === 'assistant'
    ? [
        ...message.content.map((part, index) => toManagementAgentMessagePart(part, `${message.id}-${String(index)}`)),
        ...(message.error
          ? [{ id: `${message.id}-error`, type: 'text' as const, text: `OpenCode error: ${message.error.message}` }]
          : []),
      ]
    : [{ id: `${message.id}-text`, type: 'text', text: getDisplayText(message) }]

  return {
    id: message.id,
    role: message.type,
    createdAt: message.time.created,
    completedAt: message.type === 'assistant' ? (message.time.completed ?? null) : null,
    errorMessage: message.type === 'assistant' ? (message.error?.message ?? null) : null,
    cost: usage?.cost ?? null,
    modelId: usage?.modelId ?? null,
    providerId: usage?.providerId ?? null,
    tokens: usage?.tokens ?? null,
    parts,
  }
}

function getDisplayText(message: Extract<SessionMessageInfo, { type: 'user' }>) {
  const displayText = message.metadata?.kovaDisplayText
  return typeof displayText === 'string' ? displayText : message.text
}

function getAssistantMessageUsage(message: SessionMessageAssistant) {
  if (!message.tokens) {
    return null
  }
  const inputTokens = message.tokens.input
  const outputTokens = message.tokens.output
  const reasoningTokens = message.tokens.reasoning
  const cacheReadTokens = message.tokens.cache.read
  const cacheWriteTokens = message.tokens.cache.write

  return {
    cost: message.cost ?? null,
    modelId: message.model.id,
    providerId: message.model.providerID,
    tokens: {
      input: inputTokens,
      output: outputTokens,
      reasoning: reasoningTokens,
      cacheRead: cacheReadTokens,
      cacheWrite: cacheWriteTokens,
      total: inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens,
    },
  }
}

function toManagementAgentMessagePart(
  part: SessionMessageAssistant['content'][number],
  id: string
): ManagementAgentMessage['parts'][number] {
  switch (part.type) {
    case 'text':
      return { id, type: 'text', text: part.text }
    case 'reasoning':
      return { id, type: 'reasoning', text: part.text }
    case 'tool':
      return toManagementAgentToolPart(part)
  }
}

function toManagementAgentToolPart(part: SessionMessageAssistantTool): ManagementAgentMessage['parts'][number] {
  switch (part.state.status) {
    case 'streaming':
      return {
        id: part.id,
        type: 'tool',
        toolName: part.name,
        status: 'pending',
        title: null,
        input: part.state.input,
        output: null,
        errorMessage: null,
      }
    case 'running':
      return {
        id: part.id,
        type: 'tool',
        toolName: part.name,
        status: 'running',
        title: null,
        input: JSON.stringify(part.state.input, null, 2),
        output: null,
        errorMessage: null,
      }
    case 'completed':
      return {
        id: part.id,
        type: 'tool',
        toolName: part.name,
        status: 'completed',
        title: null,
        input: JSON.stringify(part.state.input, null, 2),
        output: formatToolContent(part.state.content),
        errorMessage: null,
      }
    case 'error':
      return {
        id: part.id,
        type: 'tool',
        toolName: part.name,
        status: 'error',
        title: null,
        input: JSON.stringify(part.state.input, null, 2),
        output: null,
        errorMessage: part.state.error.message,
      }
  }
}

function formatToolContent(content: ReadonlyArray<ToolContent>) {
  return content.map(item => item.type === 'text' ? item.text : item.uri).join('\n')
}

function toScope(session: {
  scopeType: string
  targetFolderId: string | null
  targetRequestId: string | null
}): ManagementAgentScope {
  return {
    scopeType: session.scopeType as ManagementAgentScope['scopeType'],
    targetFolderId: session.targetFolderId,
    targetRequestId: session.targetRequestId,
  }
}

function requireSession(sessionId: string) {
  const session = getManagementAgentSession(sessionId)
  if (!session) {
    throw new Error('Management session not found.')
  }

  return session
}

function hashValue(value: string) {
  return createHash('sha1').update(value).digest('hex')
}

function getManagementAgentBaseDirectory() {
  if (!managementAgentBaseDirectory) {
    throw new Error('Management agent base directory is not configured.')
  }

  return managementAgentBaseDirectory
}

function emitManagementAgentState(state: ManagementAgentWorkspaceState) {
  emitGenericEvent({ type: 'management-agent-state-updated', state })
}

async function runPromptInBackground(input: {
  sessionId: string
  opencodeSessionId: string
  model: string | null
  systemPrompt: string
  message: string
  syntheticContext: string | null
  client: Awaited<ReturnType<typeof getClientForSession>>
}) {
  try {
    const model = await resolveSelectedModel(input.model)
    if (model) {
      await input.client.session.switchModel({ sessionID: input.opencodeSessionId, model })
    }
    await input.client.session.update({
      sessionID: input.opencodeSessionId,
      permissions: getManagementAgentPermissions(),
    })
    const context = [input.systemPrompt, input.syntheticContext].filter(Boolean).join('\n\n')
    await input.client.session.prompt({
      sessionID: input.opencodeSessionId,
      text: `${context}\n\nUser request:\n${input.message}`,
      metadata: { kovaDisplayText: input.message },
    })
  } catch (error) {
    const session = getManagementAgentSession(input.sessionId)
    if (session) {
      updateManagementAgentSession(session.id, {
        status: 'error',
        latestErrorMessage: error instanceof Error ? error.message : String(error),
      })
    }
  } finally {
    await emitLiveSessionState(input.sessionId).catch(() => undefined)
  }
}

async function emitLiveSessionState(sessionId: string) {
  const session = getManagementAgentSession(sessionId)
  if (!session) {
    return null
  }

  const messagesBySessionId = await syncManagementAgentSessionFromOpenCode(session.id).catch(
    () => ({}) as Record<string, ManagementAgentMessage[]>
  )
  const state = await loadManagementAgentWorkspaceStateWithOpenCode(toScope(session), { messagesBySessionId })
  emitManagementAgentState(state)
  return state
}

async function handleGlobalEvent(event: V2Event) {
  const opencodeSessionId = getEventSessionId(event)
  if (!opencodeSessionId) {
    return
  }

  const session = getManagementAgentSessionByOpenCodeSessionId(opencodeSessionId)
  if (!session) {
    return
  }

  if (event.type === 'session.status') {
    updateManagementAgentSession(session.id, { status: toUiSessionStatus(event.data.status) })
  } else if (event.type === 'session.idle') {
    updateManagementAgentSession(session.id, { status: 'idle' })
  } else if (event.type === 'session.deleted') {
    liveMessagesBySessionId.delete(session.id)
  } else if (event.type === 'session.execution.failed') {
    updateManagementAgentSession(session.id, {
      status: 'error',
      latestErrorMessage: event.data.error.message,
    })
  }

  scheduleLiveSessionRefresh(session.id)
}

function scheduleLiveSessionRefresh(sessionId: string) {
  if (eventRefreshTimers.has(sessionId)) {
    return
  }
  const timer = setTimeout(() => {
    eventRefreshTimers.delete(sessionId)
    void emitLiveSessionState(sessionId).catch(error =>
      console.error('Failed to refresh management agent state from OpenCode', error)
    )
  }, 75)
  eventRefreshTimers.set(sessionId, timer)
}

function getEventSessionId(event: V2Event) {
  if (!('data' in event) || typeof event.data !== 'object' || event.data === null || !('sessionID' in event.data)) {
    return null
  }
  return typeof event.data.sessionID === 'string' ? event.data.sessionID : null
}

async function loadManagementAgentWorkspaceStateWithOpenCode(
  scope: ManagementAgentScope,
  options?: {
    messagesBySessionId?: Record<string, ManagementAgentMessage[]>
  }
) {
  const workspaceState = await loadManagementAgentWorkspaceState(scope)
  const messagesBySessionId: Record<string, ManagementAgentMessage[]> = {
    ...Object.fromEntries(liveMessagesBySessionId),
    ...(options?.messagesBySessionId ?? {}),
  }

  await Promise.all(
    workspaceState.sessions.map(async sessionState => {
      if (messagesBySessionId[sessionState.session.id]) {
        return
      }

      const session = sessionState.session
      if (!session.opencodeSessionId) {
        messagesBySessionId[session.id] = []
        return
      }

      const client = await getClientForSession(session.id)
      let sdkMessages: SessionMessageInfo[]
      try {
        sdkMessages = await loadOpenCodeMessages(client, session.opencodeSessionId)
      } catch (error) {
        if (!isSessionNotFoundError(error)) {
          throw error
        }
        resetMissingOpenCodeSession(session.id)
        messagesBySessionId[session.id] = []
        return
      }
      messagesBySessionId[session.id] = sdkMessages.flatMap(message => {
        const converted = toManagementAgentMessage(message)
        return converted ? [converted] : []
      })
      liveMessagesBySessionId.set(session.id, messagesBySessionId[session.id] ?? [])
    })
  )

  return await loadManagementAgentWorkspaceState(scope, { messagesBySessionId })
}

async function loadOpenCodeMessages(client: OpenCodeClient, sessionId: string) {
  const messages: SessionMessageInfo[] = []
  let cursor: string | undefined

  do {
    const page = await client.message.list({
      sessionID: sessionId,
      limit: 200,
      ...(cursor ? { cursor } : { order: 'asc' }),
    })
    messages.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (cursor)

  return messages
}

function resetMissingOpenCodeSession(sessionId: string) {
  liveMessagesBySessionId.delete(sessionId)
  updateManagementAgentSession(sessionId, {
    opencodeSessionId: null,
    status: 'idle',
    latestErrorMessage: null,
  })
}

function toGenericError(error: unknown): GenericResult<never> {
  return GenericError.Message(error instanceof Error ? error.message : String(error))
}
