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
  normalizeImportAgentPlan,
  type AbortImportAgentSessionInput,
  type ApplyImportAgentPlanInput,
  type CreateImportAgentSessionInput,
  type ImportAgentMessage,
  type ImportAgentPlan,
  type ImportAgentScope,
  type ImportAgentWorkspaceState,
  type LoadImportAgentWorkspaceInput,
  type SendImportAgentMessageInput,
} from '../common/ImportAgent.js'
import { Result } from '../common/Result.js'
import { emitGenericEvent } from './generic-events.js'
import { getAppSettings } from './db/app-settings.js'
import {
  applyImportAgentDraftPlan,
  createImportAgentSessionRecord,
  getImportAgentSession,
  getImportAgentSessionByOpenCodeSessionId,
  loadImportAgentWorkspaceState,
  updateImportAgentSession,
} from './db/import-agent.js'
import { listEnvironments } from './db/environments.js'
import { resolveOpenCodeSpawnConfig } from './utils/opencode-command.js'
import { requireImportAgentToolBridge } from './import-agent-bridge-state.js'

type RawImportAgentSession = Session & {
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

type ImportAgentServerRuntime = {
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
}

let importAgentBaseDirectory: string | null = null
let serverRuntimePromise: Promise<ImportAgentServerRuntime> | null = null
let serverStartupAbortController: AbortController | null = null
const liveMessagesBySessionId = new Map<string, ImportAgentMessage[]>()

export function configureImportAgentBaseDirectory(directory: string) {
  importAgentBaseDirectory = directory
}

export async function shutdownImportAgentServer() {
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
  } finally {
    serverRuntimePromise = null
    liveMessagesBySessionId.clear()
  }
}

export async function loadImportAgentWorkspace(
  input: LoadImportAgentWorkspaceInput
): Promise<GenericResult<ImportAgentWorkspaceState>> {
  try {
    return Result.Success(await loadImportAgentWorkspaceStateWithOpenCode(input))
  } catch (error) {
    return toGenericError(error)
  }
}

export async function createImportAgentSession(
  input: CreateImportAgentSessionInput
): Promise<GenericResult<ImportAgentWorkspaceState>> {
  try {
    const state = await createImportAgentSessionRecord({
      scopeType: input.scopeType,
      targetFolderId: input.targetFolderId,
      title: buildImportAgentSessionTitle(input),
      selectedModel: input.model,
    })
    emitImportAgentState(state)
    return Result.Success(state)
  } catch (error) {
    return toGenericError(error)
  }
}

export async function sendImportAgentMessage(
  input: SendImportAgentMessageInput
): Promise<GenericResult<ImportAgentWorkspaceState>> {
  try {
    const session = getImportAgentSession(input.sessionId)
    if (!session) {
      return GenericError.Message('Import session not found.')
    }

    const opencodeSessionId = await ensureOpencodeSessionId(session.id, input.model)

    updateImportAgentSession(session.id, {
      opencodeSessionId,
      selectedModel: input.model,
      status: 'busy',
      latestErrorMessage: null,
    })
    const busyState = await loadImportAgentWorkspaceStateWithOpenCode(toScope(session))
    emitImportAgentState(busyState)

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
    const session = getImportAgentSession(input.sessionId)
    if (session) {
      updateImportAgentSession(session.id, {
        status: 'error',
        latestErrorMessage: error instanceof Error ? error.message : String(error),
      })
      emitImportAgentState(await loadImportAgentWorkspaceStateWithOpenCode(toScope(session)).catch(() => loadImportAgentWorkspaceState(toScope(session))))
    }
    return toGenericError(error)
  }
}

export async function abortImportAgentSession(
  input: AbortImportAgentSessionInput
): Promise<GenericResult<ImportAgentWorkspaceState>> {
  try {
    const session = getImportAgentSession(input.sessionId)
    if (!session) {
      return GenericError.Message('Import session not found.')
    }

    if (session.opencodeSessionId) {
      const client = await getClientForSession(session.id)
      await client.session.abort({ path: { id: session.opencodeSessionId } })
    }

    const messagesBySessionId = await syncImportAgentSessionFromOpenCode(session.id)
    const state = await loadImportAgentWorkspaceStateWithOpenCode(toScope(session), { messagesBySessionId })
    emitImportAgentState(state)
    return Result.Success(state)
  } catch (error) {
    return toGenericError(error)
  }
}

export async function applyImportAgentPlan(
  input: ApplyImportAgentPlanInput
): Promise<GenericResult<ImportAgentWorkspaceState>> {
  try {
    const state = await applyImportAgentDraftPlan(input.sessionId)
    emitGenericEvent({ type: 'environments-updated', environmentIds: (await listEnvironments()).map(environment => environment.id) })
    emitImportAgentState(state)
    return Result.Success(state)
  } catch (error) {
    return toGenericError(error)
  }
}

async function syncImportAgentSessionFromOpenCode(sessionId: string) {
  const session = getImportAgentSession(sessionId)
  if (!session?.opencodeSessionId) {
    return {} as Record<string, ImportAgentMessage[]>
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
    toImportAgentMessage(message.info, message.parts)
  )

  updateImportAgentSession(session.id, {
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
  const session = getImportAgentSession(sessionId)
  if (!session) {
    throw new Error('Import session not found.')
  }

  if (session.opencodeSessionId) {
    if (selectedModel !== session.selectedModel) {
      updateImportAgentSession(session.id, { selectedModel })
    }
    return session.opencodeSessionId
  }

  const client = await getClientForSession(session.id)
  const result = await client.session.create({ body: { title: session.title } })
  const opencodeSession = requireSdkData(result.data, 'OpenCode did not return the created session.')
  updateImportAgentSession(session.id, {
    opencodeSessionId: opencodeSession.id,
    selectedModel,
    status: 'idle',
  })
  return opencodeSession.id
}

async function buildSystemPrompt(sessionId: string) {
  const bridge = requireImportAgentToolBridge()
  const session = getImportAgentSession(sessionId)
  if (!session) {
    throw new Error('Import session not found.')
  }

  const scopeLabel = session.scopeType === 'folder'
    ? `folder scope rooted at ${session.targetFolderId}`
    : 'workspace scope'
  const baseQuery = `sessionId=${encodeURIComponent(session.id)}`

  return [
    'You are Kova\'s Import with Agent assistant.',
    'Your job is to inspect the current Kova workspace, understand the user\'s API import request, and keep the live draft import plan up to date.',
    'The Kova draft plan is the only source of truth for pending changes. Do not return final JSON in chat as the source of truth.',
    'Never mutate Kova data directly. You may inspect workspace state and replace or clear the current draft plan only through the Kova bridge commands below.',
    'Do not edit files, create files, or use unrelated shell commands. Prefer the Kova bridge commands over anything else.',
    `Current import scope: ${scopeLabel}. When the draft uses parentFolderId: null, it means the root of this import scope.`,
    'When you update the draft, replace the entire plan with one complete PUT request.',
    'If the agent is unsure which environment should receive variables, keep the draft apply-safe by adding explicit questions instead of guessing.',
    '',
    'Use bash with exact curl commands like these:',
    `List explorer items: curl -fsS ${JSON.stringify(`${bridge.url}/import-agent/explorer?${baseQuery}`)} -H ${JSON.stringify(`Authorization: Bearer ${bridge.token}`)}`,
    `List explorer subtree by folderId: curl -fsS ${JSON.stringify(`${bridge.url}/import-agent/explorer?${baseQuery}&folderId=<FOLDER_ID>`)} -H ${JSON.stringify(`Authorization: Bearer ${bridge.token}`)}`,
    `Get a request: curl -fsS ${JSON.stringify(`${bridge.url}/import-agent/request?${baseQuery}&requestId=<REQUEST_ID>`)} -H ${JSON.stringify(`Authorization: Bearer ${bridge.token}`)}`,
    `List environments: curl -fsS ${JSON.stringify(`${bridge.url}/import-agent/environments?${baseQuery}`)} -H ${JSON.stringify(`Authorization: Bearer ${bridge.token}`)}`,
    `Get current draft: curl -fsS ${JSON.stringify(`${bridge.url}/import-agent/draft?${baseQuery}`)} -H ${JSON.stringify(`Authorization: Bearer ${bridge.token}`)}`,
    `Set current draft: curl -fsS -X PUT ${JSON.stringify(`${bridge.url}/import-agent/draft?${baseQuery}`)} -H ${JSON.stringify(`Authorization: Bearer ${bridge.token}`)} -H ${JSON.stringify('Content-Type: application/json')} --data '<PLAN_JSON>'`,
    `Clear current draft: curl -fsS -X DELETE ${JSON.stringify(`${bridge.url}/import-agent/draft?${baseQuery}`)} -H ${JSON.stringify(`Authorization: Bearer ${bridge.token}`)}`,
    `List applied plans: curl -fsS ${JSON.stringify(`${bridge.url}/import-agent/plans/applied?${baseQuery}`)} -H ${JSON.stringify(`Authorization: Bearer ${bridge.token}`)}`,
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
  const workspaceState = await loadImportAgentWorkspaceStateWithOpenCode(toScope(requireSession(sessionId)))
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
    return existingClient
  }

  const client = createOpencodeClient({ baseUrl: runtime.baseUrl, directory })
  runtime.clientsByDirectory.set(directory, client)
  return client
}

async function getServerRuntime(): Promise<ImportAgentServerRuntime> {
  if (!serverRuntimePromise) {
    serverRuntimePromise = createServerRuntime().catch(error => {
      serverRuntimePromise = null
      throw error
    })
  }

  return await serverRuntimePromise
}

async function createServerRuntime(): Promise<ImportAgentServerRuntime> {
  const spawnConfig = await resolveOpenCodeSpawnConfig()
  const importAgentServerPort = await getConfiguredOpenCodeServerPort()
  process.env.PATH = spawnConfig.env.PATH
  process.env.OPENCODE_DISABLE_CLAUDE_CODE = 'true'
  process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = 'true'
  process.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = 'true'

  const startupAbortController = new AbortController()
  serverStartupAbortController = startupAbortController

  const baseUrl = `http://127.0.0.1:${String(importAgentServerPort)}`
  let ownedServer: ImportAgentServerRuntime['ownedServer'] = null
  try {
    ownedServer = await createOpencodeServer({
      hostname: '127.0.0.1',
      port: importAgentServerPort,
      timeout: 10_000,
      signal: startupAbortController.signal,
      config: {
        permission: {
          edit: 'deny',
          bash: 'allow',
          webfetch: 'deny',
          doom_loop: 'deny',
          external_directory: 'deny',
        },
      },
    })
  } catch (error) {
    if (!(await tryReuseExistingServer(baseUrl, importAgentServerPort, error))) {
      throw error
    }
  } finally {
    if (serverStartupAbortController === startupAbortController) {
      serverStartupAbortController = null
    }
  }

  const runtime: ImportAgentServerRuntime = {
    baseUrl: ownedServer?.url ?? baseUrl,
    ownedServer,
    globalClient: createOpencodeClient({ baseUrl: ownedServer?.url ?? baseUrl }),
    clientsByDirectory: new Map(),
    eventLoopStarted: false,
    eventLoopPromise: null,
    globalEventAbortController: new AbortController(),
  }

  startGlobalEventLoop(runtime)
  return runtime
}

function startGlobalEventLoop(runtime: ImportAgentServerRuntime) {
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
  const baseDirectory = getImportAgentBaseDirectory()
  const directory = path.join(baseDirectory, hashValue(sessionId))
  await mkdir(directory, { recursive: true })
  return directory
}

function buildImportAgentSessionTitle(scope: ImportAgentScope) {
  return scope.scopeType === 'folder' ? `Folder import ${scope.targetFolderId}` : 'Workspace import'
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

function getLatestErrorMessage(messages: ImportAgentMessage[]) {
  return [...messages].reverse().find(message => message.errorMessage)?.errorMessage ?? null
}

function toImportAgentMessage(message: Message | AssistantMessage, parts: Part[]): ImportAgentMessage {
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
    parts: parts.map(toImportAgentMessagePart),
  }
}

function toImportAgentMessageWithExistingParts(
  message: Message | AssistantMessage,
  parts: ImportAgentMessage['parts']
): ImportAgentMessage {
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

function toImportAgentMessagePart(part: Part): ImportAgentMessage['parts'][number] {
  switch (part.type) {
    case 'text':
      return { id: part.id, type: 'text', text: part.text }
    case 'reasoning':
      return { id: part.id, type: 'reasoning', text: part.text }
    case 'tool':
      return toImportAgentToolPart(part)
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

function toImportAgentToolPart(part: ToolPart): ImportAgentMessage['parts'][number] {
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

function toScope(session: { scopeType: string; targetFolderId: string | null }): ImportAgentScope {
  return {
    scopeType: session.scopeType as ImportAgentScope['scopeType'],
    targetFolderId: session.targetFolderId,
  }
}

function requireSession(sessionId: string) {
  const session = getImportAgentSession(sessionId)
  if (!session) {
    throw new Error('Import session not found.')
  }

  return session
}

function hashValue(value: string) {
  return createHash('sha1').update(value).digest('hex')
}

function getImportAgentBaseDirectory() {
  if (!importAgentBaseDirectory) {
    throw new Error('Import agent base directory is not configured.')
  }

  return importAgentBaseDirectory
}

function emitImportAgentState(state: ImportAgentWorkspaceState) {
  emitGenericEvent({ type: 'import-agent-state-updated', state })
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
        parts: [
          ...(input.syntheticContext ? [{ type: 'text' as const, text: input.syntheticContext, synthetic: true }] : []),
          { type: 'text' as const, text: input.message },
        ],
      },
    })
  } catch (error) {
    const session = getImportAgentSession(input.sessionId)
    if (session) {
      updateImportAgentSession(session.id, {
        status: 'error',
        latestErrorMessage: error instanceof Error ? error.message : String(error),
      })
    }
  } finally {
    await emitLiveSessionState(input.sessionId).catch(() => undefined)
  }
}

async function emitLiveSessionState(sessionId: string) {
  const session = getImportAgentSession(sessionId)
  if (!session) {
    return null
  }

  const messagesBySessionId = await syncImportAgentSessionFromOpenCode(session.id).catch(() => ({} as Record<string, ImportAgentMessage[]>))
  const state = await loadImportAgentWorkspaceStateWithOpenCode(toScope(session), { messagesBySessionId })
  emitImportAgentState(state)
  return state
}

async function handleGlobalEvent(event: GlobalEvent) {
  const payload = event.payload
  const opencodeSessionId = getEventSessionId(payload)
  if (!opencodeSessionId) {
    return
  }

  const session = getImportAgentSessionByOpenCodeSessionId(opencodeSessionId)
  if (!session) {
    return
  }

  if (payload.type === 'session.status') {
    updateImportAgentSession(session.id, { status: toUiSessionStatus(payload.properties.status) })
  } else if (payload.type === 'session.idle') {
    updateImportAgentSession(session.id, { status: 'idle' })
  } else if (payload.type === 'session.updated' || payload.type === 'session.created') {
    const existingMessages = liveMessagesBySessionId.get(session.id) ?? []
    updateImportAgentSession(session.id, {
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
      toImportAgentMessageWithExistingParts(
        payload.properties.info,
        sessionMessages.find(message => message.id === payload.properties.info.id)?.parts ?? []
      )
    )
    updateLiveSessionSummary(session.id)
  } else if (payload.type === 'message.part.updated') {
    upsertMessagePart(session.id, payload.properties.part.messageID, toImportAgentMessagePart(payload.properties.part))
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
    updateImportAgentSession(session.id, {
      status: 'error',
      latestErrorMessage: getSdkErrorMessage(payload.properties.error) ?? 'OpenCode session failed.',
    })
  }

  await emitLiveSessionState(session.id)
}

function upsertMessage(sessionId: string, message: ImportAgentMessage) {
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

function upsertMessagePart(sessionId: string, messageId: string, part: ImportAgentMessage['parts'][number]) {
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
  const session = getImportAgentSession(sessionId)
  if (!session) {
    return
  }

  const messages = liveMessagesBySessionId.get(session.id) ?? []
  updateImportAgentSession(session.id, {
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

async function loadImportAgentWorkspaceStateWithOpenCode(
  scope: ImportAgentScope,
  options?: {
    messagesBySessionId?: Record<string, ImportAgentMessage[]>
  }
) {
  const workspaceState = await loadImportAgentWorkspaceState(scope)
  const messagesBySessionId: Record<string, ImportAgentMessage[]> = {
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
      ).map(message => toImportAgentMessage(message.info, message.parts))
      liveMessagesBySessionId.set(session.id, messagesBySessionId[session.id] ?? [])
    })
  )

  return await loadImportAgentWorkspaceState(scope, { messagesBySessionId })
}

function toGenericError(error: unknown): GenericResult<never> {
  return GenericError.Message(error instanceof Error ? error.message : String(error))
}
