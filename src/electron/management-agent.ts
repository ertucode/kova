import path from 'node:path'
import { mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  createOpencodeClient,
  createOpencodeServer,
  type AssistantMessage,
  type Event,
  type GlobalEvent,
  type Message,
  type Part,
  type Session,
  type SessionStatus,
  type ToolPart,
} from '@opencode-ai/sdk'
import { DEFAULT_SCRIPT_AI_SERVER_PORT } from '../common/AppSettings.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import {
  type AbortManagementAgentSessionInput,
  type ApplyManagementAgentPlanInput,
  type CreateManagementAgentSessionInput,
  type ManagementAgentMessage,
  type ManagementAgentPlan,
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
import { resolveOpenCodeSpawnConfig } from './utils/opencode-command.js'

type RawManagementAgentSession = Session & {
  cost?: number
  tokens?: {
    input: number
    output: number
    reasoning: number
    cache?: {
      read: number
      write: number
    }
  }
  model?: {
    id: string
    providerID: string
  }
}

type ManagementAgentServerRuntime = {
  baseUrl: string
  ownedServer: {
    url: string
    close(): void
  } | null
  globalClient: ReturnType<typeof createOpencodeClient>
  clientsByDirectory: Map<string, ReturnType<typeof createOpencodeClient>>
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
      emitManagementAgentState(await loadManagementAgentWorkspaceStateWithOpenCode(toScope(session)).catch(() => loadManagementAgentWorkspaceState(toScope(session))))
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
      await client.session.abort({ path: { id: session.opencodeSessionId } })
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
    emitGenericEvent({ type: 'environments-updated', environmentIds: (await listEnvironments()).map(environment => environment.id) })
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
  const [sessionsResult, statusesResult, messagesResult] = await Promise.all([
    client.session.list(),
    client.session.status(),
    client.session.messages({ path: { id: session.opencodeSessionId } }),
  ])

  const sdkSession = requireSdkData(sessionsResult.data, 'OpenCode did not return the session list.').find(
    item => item.id === session.opencodeSessionId
  )
  const statuses = requireSdkData(statusesResult.data, 'OpenCode did not return the session statuses.')
  const messages = requireSdkData(messagesResult.data, 'OpenCode did not return the session messages.').map(message =>
    toManagementAgentMessage(message.info, message.parts)
  )

  updateManagementAgentSession(session.id, {
    title: sdkSession?.title ?? session.title,
    status: toUiSessionStatus(statuses[session.opencodeSessionId] ?? { type: 'idle' }),
    latestErrorMessage: getLatestErrorMessage(messages),
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
    if (selectedModel !== session.selectedModel) {
      updateManagementAgentSession(session.id, { selectedModel })
    }
    return session.opencodeSessionId
  }

  const client = await getClientForSession(session.id)
  const result = await client.session.create({ body: { title: session.title } })
  const opencodeSession = requireSdkData(result.data, 'OpenCode did not return the created session.')
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
    'You are Kova\'s Manage with AI assistant.',
    'Your job is to inspect the current Kova workspace, understand the user\'s management request, and keep the live draft plan up to date.',
    'The Kova draft plan is the only source of truth for pending changes. Do not return final JSON in chat as the source of truth.',
    'Never mutate Kova data directly. You may inspect workspace state and replace or clear the current draft plan only through the available Kova management agent MCP tools.',
    'Do not edit files, create files, or use unrelated tools. Prefer the Kova management agent MCP tools over anything else.',
    `Current management scope: ${scopeLabel}. When the draft uses parentFolderId: null, it means the root of this scope.`,
    `Current scope folderId: ${currentFolderId ?? 'null'}.`,
    `Current scope folderPath from workspace root: ${JSON.stringify(currentFolderPath)}.`,
    `Current scope requestId: ${session.targetRequestId ?? 'null'}.`,
    `Current scope requestPath from workspace root: ${JSON.stringify(requestContext?.path ?? [])}.`,
    `Current scope request name: ${requestContext?.request.name ?? 'null'}.`,
    `Current scope request method: ${requestContext?.request.method ?? 'null'}.`,
    `Current scope request url: ${requestContext?.request.url ?? 'null'}.`,
    'When you update the draft, replace the entire plan with one complete draft update.',
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
            saveToHistory: true,
          },
        ],
        requestsToUpdate: [],
        environmentUpdates: [{ environmentId: 'env-id', environmentName: 'Local', variables: [{ key: 'baseUrl', value: 'https://api.example.com' }] }],
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
  const existingClient = runtime.clientsByDirectory.get(directory)
  if (existingClient) {
    await ensureManagementAgentMcpRegistration(existingClient, runtime.mcpServer, directory, runtime, sessionId)
    return existingClient
  }

  const client = createOpencodeClient({ baseUrl: runtime.baseUrl, directory })
  await ensureManagementAgentMcpRegistration(client, runtime.mcpServer, directory, runtime, sessionId)
  runtime.clientsByDirectory.set(directory, client)
  return client
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
  const spawnConfig = await resolveOpenCodeSpawnConfig()
  const managementAgentServerPort = await getConfiguredOpenCodeServerPort()
  const mcpServer = await startManagementAgentMcpServer()
  process.env.PATH = spawnConfig.env.PATH
  process.env.OPENCODE_DISABLE_CLAUDE_CODE = 'true'
  process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = 'true'
  process.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = 'true'

  const startupAbortController = new AbortController()
  serverStartupAbortController = startupAbortController

  const baseUrl = `http://127.0.0.1:${String(managementAgentServerPort)}`
  let ownedServer: ManagementAgentServerRuntime['ownedServer'] = null
  try {
    ownedServer = await createOpencodeServer({
      hostname: '127.0.0.1',
        port: managementAgentServerPort,
      timeout: 10_000,
      signal: startupAbortController.signal,
      config: {
        permission: {
          edit: 'deny',
          bash: 'deny',
          webfetch: 'deny',
          doom_loop: 'deny',
          external_directory: 'deny',
        },
        tools: {
          '*': false,
          [`${MANAGEMENT_AGENT_MCP_SERVER_NAME}_*`]: true,
        },
      },
    })
  } catch (error) {
    if (!(await tryReuseExistingServer(baseUrl, managementAgentServerPort, error))) {
      await mcpServer.close().catch(() => undefined)
      throw error
    }
  } finally {
    if (serverStartupAbortController === startupAbortController) {
      serverStartupAbortController = null
    }
  }

  const runtime: ManagementAgentServerRuntime = {
    baseUrl: ownedServer?.url ?? baseUrl,
    ownedServer,
    globalClient: createOpencodeClient({ baseUrl: ownedServer?.url ?? baseUrl }),
    clientsByDirectory: new Map(),
    eventLoopStarted: false,
    eventLoopPromise: null,
    globalEventAbortController: new AbortController(),
    mcpServer,
    mcpRegisteredDirectories: new Set(),
  }

  try {
    startGlobalEventLoop(runtime)
    return runtime
  } catch (error) {
    runtime.globalEventAbortController.abort()
    runtime.ownedServer?.close()
    await runtime.mcpServer.close().catch(() => undefined)
    throw error
  }
}

async function ensureManagementAgentMcpRegistration(
  client: ReturnType<typeof createOpencodeClient>,
  mcpServer: Awaited<ReturnType<typeof startManagementAgentMcpServer>>,
  directory?: string,
  runtime?: ManagementAgentServerRuntime,
  sessionId?: string
) {
  if (directory && runtime?.mcpRegisteredDirectories.has(directory)) {
    return
  }

  const mcpServerUrl = sessionId ? `${mcpServer.url}?sessionId=${encodeURIComponent(sessionId)}` : mcpServer.url

  const result = await client.mcp.add({
    body: {
      name: MANAGEMENT_AGENT_MCP_SERVER_NAME,
      config: {
        type: 'remote',
        url: mcpServerUrl,
        headers: {
          Authorization: `Bearer ${mcpServer.token}`,
        },
        enabled: true,
        oauth: false,
        timeout: 10_000,
      },
    },
    ...(directory ? { query: { directory } } : {}),
  })

  const status = requireSdkData(result.data, 'OpenCode did not return the MCP server status.')[MANAGEMENT_AGENT_MCP_SERVER_NAME]
  if (status?.status === 'connected') {
    if (directory && runtime) {
      runtime.mcpRegisteredDirectories.add(directory)
    }
    return
  }

  await client.mcp.connect({
    path: { name: MANAGEMENT_AGENT_MCP_SERVER_NAME },
    ...(directory ? { query: { directory } } : {}),
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
      const events = await runtime.globalClient.global.event({ signal: runtime.globalEventAbortController.signal })

      for await (const event of events.stream) {
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

async function tryReuseExistingServer(baseUrl: string, port: number, error: unknown) {
  if (!isPortInUseServerError(error, port)) {
    return null
  }

  try {
    const response = await fetch(new URL('/global/health', baseUrl), {
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok) {
      return null
    }

    const health = (await response.json()) as { healthy?: boolean }
    return health.healthy === true ? baseUrl : null
  } catch {
    return null
  }
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

function isPortInUseServerError(error: unknown, port: number) {
  return error instanceof Error && error.message.includes(`Is port ${String(port)} in use?`)
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

async function getScopeFolderId(session: { scopeType: string; targetFolderId: string | null; targetRequestId: string | null }) {
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
    modelID: value.slice(separatorIndex + 1),
  }
}

function requireSdkData<T>(value: T | undefined, message: string) {
  if (value === undefined) {
    throw new Error(message)
  }

  return value
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

function toManagementAgentMessage(message: Message | AssistantMessage, parts: Part[]): ManagementAgentMessage {
  const usage = message.role === 'assistant' ? getAssistantMessageUsage(message) : null

  return {
    id: message.id,
    role: message.role,
    createdAt: message.time.created,
    completedAt: message.role === 'assistant' ? (message.time.completed ?? null) : null,
    errorMessage: message.role === 'assistant' ? getSdkErrorMessage(message.error) : null,
    cost: usage?.cost ?? null,
    modelId: usage?.modelId ?? null,
    providerId: usage?.providerId ?? null,
    tokens: usage?.tokens ?? null,
    parts: parts.map(toManagementAgentMessagePart),
  }
}

function toManagementAgentMessageWithExistingParts(
  message: Message | AssistantMessage,
  parts: ManagementAgentMessage['parts']
): ManagementAgentMessage {
  const usage = message.role === 'assistant' ? getAssistantMessageUsage(message) : null

  return {
    id: message.id,
    role: message.role,
    createdAt: message.time.created,
    completedAt: message.role === 'assistant' ? (message.time.completed ?? null) : null,
    errorMessage: message.role === 'assistant' ? getSdkErrorMessage(message.error) : null,
    cost: usage?.cost ?? null,
    modelId: usage?.modelId ?? null,
    providerId: usage?.providerId ?? null,
    tokens: usage?.tokens ?? null,
    parts,
  }
}

function getAssistantMessageUsage(message: AssistantMessage) {
  const inputTokens = message.tokens.input
  const outputTokens = message.tokens.output
  const reasoningTokens = message.tokens.reasoning
  const cacheReadTokens = message.tokens.cache.read
  const cacheWriteTokens = message.tokens.cache.write

  return {
    cost: message.cost,
    modelId: message.modelID,
    providerId: message.providerID,
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

function toManagementAgentMessagePart(part: Part): ManagementAgentMessage['parts'][number] {
  switch (part.type) {
    case 'text':
      return { id: part.id, type: 'text', text: part.text }
    case 'reasoning':
      return { id: part.id, type: 'reasoning', text: part.text }
    case 'tool':
      return toManagementAgentToolPart(part)
    case 'file':
      return { id: part.id, type: 'file', filename: part.filename ?? null, path: part.source?.path ?? null }
    case 'step-start':
      return { id: part.id, type: 'step-start' }
    case 'step-finish':
      return { id: part.id, type: 'step-finish' }
    case 'snapshot':
      return { id: part.id, type: 'snapshot' }
    case 'patch':
      return { id: part.id, type: 'patch', hash: part.hash, files: part.files }
    case 'agent':
      return { id: part.id, type: 'agent', name: part.name }
    case 'subtask':
      return { id: part.id, type: 'subtask', description: part.description, prompt: part.prompt, agent: part.agent }
    case 'retry':
      return { id: part.id, type: 'retry' }
    case 'compaction':
      return { id: part.id, type: 'compaction' }
  }
}

function toManagementAgentToolPart(part: ToolPart): ManagementAgentMessage['parts'][number] {
  switch (part.state.status) {
    case 'pending':
      return { id: part.id, type: 'tool', toolName: part.tool, status: 'pending', title: null, input: part.state.raw, output: null, errorMessage: null }
    case 'running':
      return { id: part.id, type: 'tool', toolName: part.tool, status: 'running', title: part.state.title ?? null, input: JSON.stringify(part.state.input, null, 2), output: null, errorMessage: null }
    case 'completed':
      return { id: part.id, type: 'tool', toolName: part.tool, status: 'completed', title: part.state.title, input: JSON.stringify(part.state.input, null, 2), output: part.state.output, errorMessage: null }
    case 'error':
      return { id: part.id, type: 'tool', toolName: part.tool, status: 'error', title: null, input: JSON.stringify(part.state.input, null, 2), output: null, errorMessage: part.state.error }
  }
}

function getSdkErrorMessage(error: unknown) {
  if (!error) {
    return null
  }

  if (
    typeof error === 'object' &&
    error !== null &&
    'data' in error &&
    typeof error.data === 'object' &&
    error.data !== null &&
    'message' in error.data &&
    typeof error.data.message === 'string'
  ) {
    return error.data.message
  }

  return error instanceof Error ? error.message : null
}

function toScope(session: { scopeType: string; targetFolderId: string | null; targetRequestId: string | null }): ManagementAgentScope {
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
    await input.client.session.prompt({
      path: { id: input.opencodeSessionId },
      body: {
        model: parseSelectedModel(input.model),
        system: input.systemPrompt,
        tools: {
          '*': false,
          [`${MANAGEMENT_AGENT_MCP_SERVER_NAME}_*`]: true,
        },
        parts: [
          ...(input.syntheticContext ? [{ type: 'text' as const, text: input.syntheticContext, synthetic: true }] : []),
          { type: 'text' as const, text: input.message },
        ],
      },
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

  const messagesBySessionId = await syncManagementAgentSessionFromOpenCode(session.id).catch(() => ({} as Record<string, ManagementAgentMessage[]>))
  const state = await loadManagementAgentWorkspaceStateWithOpenCode(toScope(session), { messagesBySessionId })
  emitManagementAgentState(state)
  return state
}

async function handleGlobalEvent(event: GlobalEvent) {
  const payload = event.payload
  const opencodeSessionId = getEventSessionId(payload)
  if (!opencodeSessionId) {
    return
  }

  const session = getManagementAgentSessionByOpenCodeSessionId(opencodeSessionId)
  if (!session) {
    return
  }

  if (payload.type === 'session.status') {
    updateManagementAgentSession(session.id, { status: toUiSessionStatus(payload.properties.status) })
  } else if (payload.type === 'session.idle') {
    updateManagementAgentSession(session.id, { status: 'idle' })
  } else if (payload.type === 'session.updated' || payload.type === 'session.created') {
    const existingMessages = liveMessagesBySessionId.get(session.id) ?? []
    updateManagementAgentSession(session.id, {
      title: payload.properties.info.title,
      status: 'idle',
      latestErrorMessage: getLatestErrorMessage(existingMessages),
    })
  } else if (payload.type === 'session.deleted') {
    liveMessagesBySessionId.delete(session.id)
  } else if (payload.type === 'message.updated') {
    const sessionMessages = liveMessagesBySessionId.get(session.id) ?? []
    liveMessagesBySessionId.set(session.id, sessionMessages)
    upsertMessage(
      session.id,
      toManagementAgentMessageWithExistingParts(
        payload.properties.info,
        sessionMessages.find(message => message.id === payload.properties.info.id)?.parts ?? []
      )
    )
    updateLiveSessionSummary(session.id)
  } else if (payload.type === 'message.part.updated') {
    upsertMessagePart(session.id, payload.properties.part.messageID, toManagementAgentMessagePart(payload.properties.part))
    updateLiveSessionSummary(session.id)
  } else if (payload.type === 'message.part.removed') {
    removeMessagePart(session.id, payload.properties.messageID, payload.properties.partID)
    updateLiveSessionSummary(session.id)
  } else if (payload.type === 'message.removed') {
    const messages = liveMessagesBySessionId.get(session.id)
    if (messages) {
      liveMessagesBySessionId.set(
        session.id,
        messages.filter(message => message.id !== payload.properties.messageID)
      )
      updateLiveSessionSummary(session.id)
    }
  } else if (payload.type === 'session.error') {
    updateManagementAgentSession(session.id, {
      status: 'error',
      latestErrorMessage: getSdkErrorMessage(payload.properties.error) ?? 'OpenCode session failed.',
    })
  }

  await emitLiveSessionState(session.id)
}

function upsertMessage(sessionId: string, message: ManagementAgentMessage) {
  const existingMessages = liveMessagesBySessionId.get(sessionId)
  if (!existingMessages) {
    liveMessagesBySessionId.set(sessionId, [message])
    return
  }

  const existingIndex = existingMessages.findIndex(existingMessage => existingMessage.id === message.id)
  if (existingIndex === -1) {
    existingMessages.push(message)
  } else {
    existingMessages[existingIndex] = {
      ...existingMessages[existingIndex],
      ...message,
      parts: existingMessages[existingIndex]?.parts ?? [],
    }
  }
}

function upsertMessagePart(sessionId: string, messageId: string, part: ManagementAgentMessage['parts'][number]) {
  const messages = liveMessagesBySessionId.get(sessionId)
  if (!messages) {
    liveMessagesBySessionId.set(sessionId, [
      {
        id: messageId,
        role: 'assistant',
        createdAt: Date.now(),
        completedAt: null,
        errorMessage: null,
        cost: null,
        modelId: null,
        providerId: null,
        tokens: null,
        parts: [part],
      },
    ])
    return
  }

  const messageIndex = messages.findIndex(message => message.id === messageId)
  if (messageIndex === -1) {
    messages.push({
      id: messageId,
      role: 'assistant',
      createdAt: Date.now(),
      completedAt: null,
      errorMessage: null,
      cost: null,
      modelId: null,
      providerId: null,
      tokens: null,
      parts: [part],
    })
    return
  }

  const message = messages[messageIndex]
  const partIndex = message.parts.findIndex(existingPart => existingPart.id === part.id)
  if (partIndex === -1) {
    message.parts.push(part)
    return
  }

  message.parts[partIndex] = part
}

function removeMessagePart(sessionId: string, messageId: string, partId: string) {
  const messages = liveMessagesBySessionId.get(sessionId)
  const message = messages?.find(candidate => candidate.id === messageId)
  if (!message) {
    return
  }

  message.parts = message.parts.filter(part => part.id !== partId)
}

function updateLiveSessionSummary(sessionId: string) {
  const session = getManagementAgentSession(sessionId)
  if (!session) {
    return
  }

  const messages = liveMessagesBySessionId.get(session.id) ?? []
  updateManagementAgentSession(session.id, {
    latestErrorMessage: getLatestErrorMessage(messages),
  })
}

function getEventSessionId(event: Event) {
  switch (event.type) {
    case 'message.updated':
      return event.properties.info.sessionID
    case 'message.removed':
      return event.properties.sessionID
    case 'message.part.updated':
      return event.properties.part.sessionID
    case 'message.part.removed':
      return event.properties.sessionID
    case 'session.status':
      return event.properties.sessionID
    case 'session.idle':
      return event.properties.sessionID
    case 'session.compacted':
      return event.properties.sessionID
    case 'session.updated':
      return event.properties.info.id
    case 'session.created':
      return event.properties.info.id
    case 'session.deleted':
      return event.properties.info.id
    case 'session.error':
      return event.properties.sessionID ?? null
    default:
      return null
  }
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
      const messagesResult = await client.session.messages({ path: { id: session.opencodeSessionId } })
      messagesBySessionId[session.id] = requireSdkData(
        messagesResult.data,
        'OpenCode did not return the session messages.'
      ).map(message => toManagementAgentMessage(message.info, message.parts))
      liveMessagesBySessionId.set(session.id, messagesBySessionId[session.id] ?? [])
    })
  )

  return await loadManagementAgentWorkspaceState(scope, { messagesBySessionId })
}

function toGenericError(error: unknown): GenericResult<never> {
  return GenericError.Message(error instanceof Error ? error.message : String(error))
}
