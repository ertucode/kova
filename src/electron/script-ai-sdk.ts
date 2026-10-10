import { createHash } from 'node:crypto'
import path from 'node:path'
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  type OpenCodeClient,
  type SessionInfo,
  type SessionMessageAssistant,
  type SessionMessageAssistantTool,
  type SessionMessageInfo,
  type SessionStatus,
  type ToolContent,
  type V2Event,
} from '@opencode/client'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import { DEFAULT_SCRIPT_AI_SERVER_PORT } from '../common/AppSettings.js'
import {
  getPrimaryScriptAiPhase,
  getScriptAiFileName,
  getScriptAiTargetKey,
  type AbortScriptAiSessionInput,
  type ApplyScriptAiWorkspaceInput,
  type ApplyScriptAiWorkspaceResponse,
  type CreateScriptAiSessionInput,
  type LoadScriptAiMessagePatchDiffInput,
  type LoadScriptAiMessagePatchDiffResponse,
  type LoadScriptAiWorkspaceInput,
  type ScriptAiMessage,
  type ScriptAiMessagePart,
  type ScriptAiMessagePatchDiff,
  type ScriptAiSessionSummary,
  type ScriptAiTarget,
  type ScriptAiWorkspaceState,
  type SendScriptAiMessageInput,
  type SyncScriptAiWorkspaceInput,
  type SyncScriptAiWorkspaceResponse,
} from '../common/ScriptAi.js'
import { emitGenericEvent } from './generic-events.js'
import { getAppSettings } from './db/app-settings.js'
import { requireScriptAiDiagnosticsBridge } from './script-ai-diagnostics.js'
import { startOpenCodeServer, type OpenCodeServer } from './utils/opencode-v2-server.js'
import { getPreferredOpenCodeModel } from './utils/opencode-model-selection.js'

type TargetMeta = {
  version: 1
  targetKey: string
  activeSessionId: string | null
  knownSessionIds: string[]
}

type AssistantContent = SessionMessageAssistant['content'][number]

type TargetRuntime = {
  target: ScriptAiTarget
  targetKey: string
  workspacePath: string
  filePath: string
  fileName: string
  knownSessionIds: Set<string>
  activeSessionId: string | null
  sessions: Map<string, ScriptAiSessionSummary>
  messagesBySessionId: Map<string, ScriptAiMessage[]>
}

type ServerRuntime = {
  ownedServer: OpenCodeServer
  globalClient: OpenCodeClient
  eventLoopStarted: boolean
  eventLoopPromise: Promise<void> | null
  globalEventAbortController: AbortController
}

const SCRIPT_AI_META_FILE_NAME = 'meta.json'
const targetRuntimes = new Map<string, TargetRuntime>()
const sessionToTargetKey = new Map<string, string>()
const eventRefreshTimers = new Map<string, NodeJS.Timeout>()

let scriptAiBaseDirectory: string | null = null
let serverRuntimePromise: Promise<ServerRuntime> | null = null
let serverStartupAbortController: AbortController | null = null

export function configureScriptAiBaseDirectory(directory: string) {
  scriptAiBaseDirectory = directory
}

export async function loadScriptAiWorkspace(
  input: LoadScriptAiWorkspaceInput
): Promise<GenericResult<ScriptAiWorkspaceState>> {
  try {
    const runtime = await ensureTargetRuntime(input.target, input.currentCode)
    await refreshTargetRuntime(runtime)
    return Result.Success(toWorkspaceState(runtime, await readWorkspaceCode(runtime)))
  } catch (error) {
    return toGenericError(error)
  }
}

export async function createScriptAiSession(
  input: CreateScriptAiSessionInput
): Promise<GenericResult<ScriptAiWorkspaceState>> {
  try {
    const runtime = await ensureTargetRuntime(input.target, input.currentCode)
    const client = await getOpenCodeClient()
    const title = buildSessionTitle(input.target)
    const session = await client.session.create({
      title,
      location: { directory: runtime.workspacePath },
      model: await resolveSelectedModel(input.model),
    })

    runtime.knownSessionIds.add(session.id)
    runtime.activeSessionId = session.id
    runtime.sessions.set(session.id, toSessionSummary(session, { type: 'idle' }, 0, null))
    sessionToTargetKey.set(session.id, runtime.targetKey)

    await persistMeta(runtime)
    await refreshTargetRuntime(runtime)

    const state = toWorkspaceState(runtime, await readWorkspaceCode(runtime))
    emitScriptAiState(state)
    return Result.Success(state)
  } catch (error) {
    return toGenericError(error)
  }
}

export async function sendScriptAiMessage(
  input: SendScriptAiMessageInput
): Promise<GenericResult<ScriptAiWorkspaceState>> {
  try {
    const runtime = await ensureTargetRuntime(input.target, input.currentCode)
    if (!runtime.knownSessionIds.has(input.sessionId)) {
      return GenericError.Message('This OpenCode session does not belong to the current script target.')
    }
    runtime.activeSessionId = input.sessionId
    await persistMeta(runtime)

    const client = await getOpenCodeClient()
    const model = await resolveSelectedModel(input.model)
    if (model) {
      await client.session.switchModel({ sessionID: input.sessionId, model })
    }
    await client.session.prompt({
      sessionID: input.sessionId,
      text: `${buildSystemPrompt(input.target, runtime.fileName, input.documentation)}\n\nUser request:\n${input.message}`,
      metadata: { kovaDisplayText: input.message },
    })

    await refreshTargetRuntime(runtime)
    const state = toWorkspaceState(runtime, await readWorkspaceCode(runtime))
    emitScriptAiState(state)
    return Result.Success(state)
  } catch (error) {
    return toGenericError(error)
  }
}

export async function syncScriptAiWorkspace(
  input: SyncScriptAiWorkspaceInput
): Promise<GenericResult<SyncScriptAiWorkspaceResponse>> {
  try {
    const existingRuntime = targetRuntimes.get(getScriptAiTargetKey(input.target))
    if (!existingRuntime && !(await hasPersistedWorkspace(input.target))) {
      return Result.Success({ didSync: false, workspaceState: null })
    }

    const runtime = existingRuntime ?? (await ensureTargetRuntime(input.target, input.code))

    // A runtime restored from persisted metadata knows session IDs before it has fetched
    // their summaries/messages. Hydrate once here so the dialog sees sessions immediately.
    if (runtime.sessions.size === 0 && runtime.knownSessionIds.size > 0) {
      await refreshTargetRuntime(runtime)
    }

    await writeWorkspaceCode(runtime, input.code)

    const state = toWorkspaceState(runtime, await readWorkspaceCode(runtime))
    emitScriptAiState(state)
    return Result.Success({ didSync: true, workspaceState: state })
  } catch (error) {
    return toGenericError(error)
  }
}

export async function applyScriptAiWorkspace(
  input: ApplyScriptAiWorkspaceInput
): Promise<GenericResult<ApplyScriptAiWorkspaceResponse>> {
  try {
    const runtime = await ensureTargetRuntime(input.target, '')
    await writeWorkspaceCode(runtime, input.code)
    return Result.Success({ code: input.code })
  } catch (error) {
    return toGenericError(error)
  }
}

export async function getScriptAiWorkspaceSnapshot(target: ScriptAiTarget) {
  const runtime = await ensureTargetRuntime(target, '')

  return {
    workspacePath: runtime.workspacePath,
    filePath: runtime.filePath,
    fileName: runtime.fileName,
    workspaceCode: await readWorkspaceCode(runtime),
  }
}

export async function abortScriptAiSession(
  input: AbortScriptAiSessionInput
): Promise<GenericResult<ScriptAiWorkspaceState>> {
  try {
    const runtime = await ensureTargetRuntime(input.target, '')
    if (!runtime.knownSessionIds.has(input.sessionId)) {
      return GenericError.Message('This OpenCode session does not belong to the current script target.')
    }

    const client = await getOpenCodeClient()
    await client.session.interrupt({ sessionID: input.sessionId })
    await refreshTargetRuntime(runtime)

    const state = toWorkspaceState(runtime, await readWorkspaceCode(runtime))
    emitScriptAiState(state)
    return Result.Success(state)
  } catch (error) {
    return toGenericError(error)
  }
}

export async function loadScriptAiMessagePatchDiff(
  input: LoadScriptAiMessagePatchDiffInput
): Promise<GenericResult<LoadScriptAiMessagePatchDiffResponse>> {
  try {
    const runtime = await ensureTargetRuntime(input.target, '')
    if (!runtime.knownSessionIds.has(input.sessionId)) {
      return GenericError.Message('This OpenCode session does not belong to the current script target.')
    }

    const client = await getOpenCodeClient()
    const diffs = await client.session.diff({ sessionID: input.sessionId, to: input.messageId })

    return Result.Success({
      diffs: diffs.map(toScriptAiPatchDiff),
    })
  } catch (error) {
    return toGenericError(error)
  }
}

async function ensureTargetRuntime(target: ScriptAiTarget, initialCode: string) {
  const targetKey = getScriptAiTargetKey(target)
  const existingRuntime = targetRuntimes.get(targetKey)
  if (existingRuntime) {
    return existingRuntime
  }

  const baseDirectory = getScriptAiBaseDirectory()
  const workspacePath = path.join(baseDirectory, hashTargetKey(targetKey))
  const fileName = getScriptAiFileName(target.runtimeContext)
  const filePath = path.join(workspacePath, fileName)

  await mkdir(workspacePath, { recursive: true })

  const meta = await readTargetMeta(workspacePath, targetKey)
  const workspaceCode = await ensureWorkspaceFile(filePath, initialCode)

  const runtime: TargetRuntime = {
    target,
    targetKey,
    workspacePath,
    filePath,
    fileName,
    knownSessionIds: new Set(meta.knownSessionIds),
    activeSessionId: meta.activeSessionId,
    sessions: new Map(),
    messagesBySessionId: new Map(),
  }

  targetRuntimes.set(targetKey, runtime)

  for (const sessionId of runtime.knownSessionIds) {
    sessionToTargetKey.set(sessionId, targetKey)
  }

  await persistMeta(runtime)
  emitScriptAiState(toWorkspaceState(runtime, workspaceCode))
  return runtime
}

async function refreshTargetRuntime(runtime: TargetRuntime) {
  const client = await getOpenCodeClient()
  const [allSessions, activeSessions] = await Promise.all([
    loadOpenCodeSessions(client, runtime.workspacePath),
    client.session.active(),
  ])
  const sessions = allSessions.filter(session =>
    runtime.knownSessionIds.has(session.id)
  )

  runtime.sessions = new Map(
    await Promise.all(
      sessions
        .sort((left, right) => right.time.updated - left.time.updated)
        .map(async session => {
          const messages = await loadSessionMessages(client, session.id)
          runtime.messagesBySessionId.set(session.id, messages)
          return [
            session.id,
            toSessionSummary(
              session,
              activeSessions[session.id] ? { type: 'busy' } : { type: 'idle' },
              messages.length,
              getLatestErrorMessage(messages)
            ),
          ] as const
        })
    )
  )

  const knownSessionIds = new Set(sessions.map(session => session.id))
  runtime.knownSessionIds = knownSessionIds
  runtime.messagesBySessionId = new Map(
    [...runtime.messagesBySessionId].filter(([sessionId]) => knownSessionIds.has(sessionId))
  )

  if (runtime.activeSessionId && !knownSessionIds.has(runtime.activeSessionId)) {
    runtime.activeSessionId = sessions[0]?.id ?? null
  }

  for (const session of sessions) {
    sessionToTargetKey.set(session.id, runtime.targetKey)
  }

  await persistMeta(runtime)
}

async function loadSessionMessages(client: OpenCodeClient, sessionId: string) {
  const messages = await loadOpenCodeMessages(client, sessionId)
  return messages.flatMap(message => {
    const converted = toScriptAiMessage(message)
    return converted ? [converted] : []
  })
}

async function loadOpenCodeSessions(client: OpenCodeClient, directory: string) {
  const sessions: SessionInfo[] = []
  let cursor: string | undefined

  do {
    const page = await client.session.list({
      directory,
      limit: 200,
      ...(cursor ? { cursor } : { order: 'asc' }),
    })
    sessions.push(...page.data)
    cursor = page.cursor.next ?? undefined
  } while (cursor)

  return sessions
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

async function getServerRuntime() {
  if (!serverRuntimePromise) {
    serverRuntimePromise = createServerRuntime().catch(error => {
      serverRuntimePromise = null
      throw error
    })
  }

  return await serverRuntimePromise
}

export async function shutdownScriptAiServer() {
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
  } finally {
    serverRuntimePromise = null
  }
}

async function createServerRuntime(): Promise<ServerRuntime> {
  const scriptAiServerPort = await getConfiguredScriptAiServerPort()
  const startupAbortController = new AbortController()
  serverStartupAbortController = startupAbortController

  try {
    const ownedServer = await startOpenCodeServer(scriptAiServerPort, startupAbortController.signal)
    const runtime: ServerRuntime = {
      ownedServer,
      globalClient: ownedServer.client,
      eventLoopStarted: false,
      eventLoopPromise: null,
      globalEventAbortController: new AbortController(),
    }

    startGlobalEventLoop(runtime)
    return runtime
  } finally {
    if (serverStartupAbortController === startupAbortController) {
      serverStartupAbortController = null
    }
  }
}

function startGlobalEventLoop(runtime: ServerRuntime) {
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
        console.error('Script AI global event loop failed', error)
      }
    }
  })()
}

async function handleGlobalEvent(event: V2Event) {
  const sessionId = getEventSessionId(event)
  if (!sessionId) {
    return
  }

  const targetKey = sessionToTargetKey.get(sessionId)
  if (!targetKey) {
    return
  }

  const runtime = targetRuntimes.get(targetKey)
  if (!runtime) {
    return
  }

  if (event.type === 'session.status') {
    const session = runtime.sessions.get(sessionId)
    if (session) {
      session.status = toUiSessionStatus(event.data.status)
    }
  } else if (event.type === 'session.idle') {
    const session = runtime.sessions.get(sessionId)
    if (session) {
      session.status = 'idle'
    }
  } else if (event.type === 'session.deleted') {
    runtime.knownSessionIds.delete(sessionId)
    runtime.sessions.delete(sessionId)
    runtime.messagesBySessionId.delete(sessionId)
    sessionToTargetKey.delete(sessionId)
    if (runtime.activeSessionId === sessionId) {
      runtime.activeSessionId = runtime.sessions.keys().next().value ?? null
    }
    await persistMeta(runtime)
  } else if (event.type === 'session.execution.failed') {
    const session = runtime.sessions.get(sessionId)
    if (session) {
      session.latestErrorMessage = event.data.error.message
    }
  } else {
    scheduleTargetRefresh(runtime)
    return
  }

  const state = toWorkspaceState(runtime, await readWorkspaceCode(runtime))
  emitScriptAiState(state)
}

function scheduleTargetRefresh(runtime: TargetRuntime) {
  if (eventRefreshTimers.has(runtime.targetKey)) {
    return
  }
  const timer = setTimeout(() => {
    eventRefreshTimers.delete(runtime.targetKey)
    void refreshTargetRuntime(runtime)
      .then(async () => emitScriptAiState(toWorkspaceState(runtime, await readWorkspaceCode(runtime))))
      .catch(error => console.error('Failed to refresh Script AI state from OpenCode', error))
  }, 75)
  eventRefreshTimers.set(runtime.targetKey, timer)
}

async function getOpenCodeClient() {
  const runtime = await getServerRuntime()
  return runtime.globalClient
}

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === 'AbortError'
}

async function getConfiguredScriptAiServerPort() {
  const settings = await getAppSettings()
  return settings.scriptAiServerPort ?? DEFAULT_SCRIPT_AI_SERVER_PORT
}

async function readTargetMeta(workspacePath: string, targetKey: string): Promise<TargetMeta> {
  const metaPath = path.join(workspacePath, SCRIPT_AI_META_FILE_NAME)

  try {
    const rawMeta = await readFile(metaPath, 'utf8')
    const parsedMeta = JSON.parse(rawMeta) as Partial<TargetMeta>
    return {
      version: 1,
      targetKey,
      activeSessionId: typeof parsedMeta.activeSessionId === 'string' ? parsedMeta.activeSessionId : null,
      knownSessionIds: Array.isArray(parsedMeta.knownSessionIds) ? parsedMeta.knownSessionIds.filter(isString) : [],
    }
  } catch {
    return {
      version: 1,
      targetKey,
      activeSessionId: null,
      knownSessionIds: [],
    }
  }
}

async function persistMeta(runtime: TargetRuntime) {
  const metaPath = path.join(runtime.workspacePath, SCRIPT_AI_META_FILE_NAME)
  const meta: TargetMeta = {
    version: 1,
    targetKey: runtime.targetKey,
    activeSessionId: runtime.activeSessionId,
    knownSessionIds: [...runtime.knownSessionIds],
  }

  await writeFile(metaPath, `${JSON.stringify(meta, null, 2)}\n`, 'utf8')
}

async function ensureWorkspaceFile(filePath: string, initialCode: string) {
  try {
    return await readFile(filePath, 'utf8')
  } catch {
    await writeFile(filePath, initialCode, 'utf8')
    return initialCode
  }
}

async function writeWorkspaceCode(runtime: TargetRuntime, code: string) {
  await writeFile(runtime.filePath, code, 'utf8')
}

async function readWorkspaceCode(runtime: TargetRuntime) {
  return await readFile(runtime.filePath, 'utf8')
}

async function hasPersistedWorkspace(target: ScriptAiTarget) {
  const { filePath } = getWorkspacePaths(target)

  try {
    await access(filePath)
    return true
  } catch {
    return false
  }
}

function buildSessionTitle(target: ScriptAiTarget) {
  return `${target.ownerType}:${target.ownerId} ${getPrimaryScriptAiPhase(target.runtimeContext)}`
}

function buildSystemPrompt(target: ScriptAiTarget, fileName: string, documentation: string) {
  const diagnosticsBridge = requireScriptAiDiagnosticsBridge()
  const diagnosticsTargetJson = JSON.stringify(target)

  return [
    `You are editing exactly one runtime script file named ${fileName}.`,
    `Only update ${fileName}.`,
    'Do not inspect, reference, or rely on files outside the current workspace.',
    'Do not create unrelated files.',
    'The source of truth is the script file in the workspace.',
    'Use the existing file contents as the starting point for edits.',
    'When you finish, ensure the script file contains the complete final script source.',
    'Do not pass script source or code to diagnostics.',
    'Use the Kova runtime diagnostics bridge with target metadata only.',
    'After each edit pass and before any final response, call the diagnostics bridge exactly like this:',
    `curl -fsS -X POST ${JSON.stringify(`${diagnosticsBridge.url}/script-ai/diagnostics`)} -H ${JSON.stringify(`Authorization: Bearer ${diagnosticsBridge.token}`)} -H ${JSON.stringify('Content-Type: application/json')} --data ${JSON.stringify(JSON.stringify({ target }))}`,
    `The target metadata JSON is: ${diagnosticsTargetJson}`,
    'If the diagnostics call fails, or the diagnostics bridge returns a system or transport error, stop immediately and wait for further instructions.',
    'If the diagnostics response contains errors in diagnostics, fix them in the script, then rerun diagnostics.',
    'Repeat that edit-and-rerun loop until diagnostics returns no errors.',
    'Only give a final response after diagnostics succeeds and returns no errors.',
    '',
    'Runtime documentation:',
    documentation.trim(),
  ].join('\n')
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

function toWorkspaceState(runtime: TargetRuntime, workspaceCode: string): ScriptAiWorkspaceState {
  return {
    target: runtime.target,
    targetKey: runtime.targetKey,
    fileName: runtime.fileName,
    workspaceCode,
    activeSessionId: runtime.activeSessionId,
    sessions: [...runtime.sessions.values()].sort((left, right) => right.updatedAt - left.updatedAt),
    messagesBySessionId: Object.fromEntries(runtime.messagesBySessionId),
  }
}

function toSessionSummary(
  session: SessionInfo,
  status: SessionStatus,
  messageCount: number,
  latestErrorMessage: string | null
): ScriptAiSessionSummary {
  const inputTokens = session.tokens.input
  const outputTokens = session.tokens.output
  const reasoningTokens = session.tokens.reasoning
  const cacheReadTokens = session.tokens.cache.read
  const cacheWriteTokens = session.tokens.cache.write

  return {
    id: session.id,
    title: session.title ?? 'Untitled session',
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    status: toUiSessionStatus(status),
    messageCount,
    latestErrorMessage,
    modelId: getSessionModelId(session),
    spent: session.cost,
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

function getSessionModelId(session: SessionInfo) {
  if (!session.model?.providerID || !session.model.id) {
    return null
  }

  return `${session.model.providerID}/${session.model.id}`
}

function toUiSessionStatus(status: SessionStatus): ScriptAiSessionSummary['status'] {
  switch (status.type) {
    case 'idle':
      return 'idle'
    case 'busy':
      return 'busy'
    case 'retry':
      return 'retry'
  }
}

function getLatestErrorMessage(messages: ScriptAiMessage[]) {
  return [...messages].reverse().find(message => message.errorMessage)?.errorMessage ?? null
}

function toScriptAiMessage(
  message: SessionMessageInfo
): ScriptAiMessage | null {
  if (message.type !== 'user' && message.type !== 'assistant') {
    return null
  }

  const usage = message.type === 'assistant' ? getAssistantMessageUsage(message) : null
  const parts = message.type === 'assistant'
    ? [
        ...message.content.map((part, index) => toScriptAiMessagePart(part, `${message.id}-${String(index)}`)),
        ...(message.error
          ? [{ id: `${message.id}-error`, type: 'text' as const, text: `OpenCode error: ${message.error.message}` }]
          : []),
      ]
    : [
        { id: `${message.id}-text`, type: 'text' as const, text: getDisplayText(message) },
        ...(message.files ?? []).map((file, index) => ({
          id: `${message.id}-file-${String(index)}`,
          type: 'file' as const,
          filename: file.name ?? null,
          path: file.source.type === 'uri' ? file.source.uri : null,
        })),
      ]

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

function toScriptAiMessagePart(part: AssistantContent, id: string): ScriptAiMessagePart {
  switch (part.type) {
    case 'text':
      return { id, type: 'text', text: part.text }
    case 'reasoning':
      return { id, type: 'reasoning', text: part.text }
    case 'tool':
      return toScriptAiToolPart(part)
  }
}

function toScriptAiPatchDiff(diff: {
  file?: string
  patch?: string
  additions: number
  deletions: number
  status?: 'added' | 'deleted' | 'modified'
}): ScriptAiMessagePatchDiff {
  return {
    file: diff.file ?? null,
    patch: diff.patch ?? null,
    additions: diff.additions,
    deletions: diff.deletions,
    status: diff.status ?? null,
  }
}

function toScriptAiToolPart(part: SessionMessageAssistantTool): ScriptAiMessagePart {
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

function getEventSessionId(event: V2Event) {
  if (!('data' in event) || typeof event.data !== 'object' || event.data === null || !('sessionID' in event.data)) {
    return null
  }
  return typeof event.data.sessionID === 'string' ? event.data.sessionID : null
}

function hashTargetKey(targetKey: string) {
  return createHash('sha1').update(targetKey).digest('hex')
}

function getWorkspacePaths(target: ScriptAiTarget) {
  const targetKey = getScriptAiTargetKey(target)
  const baseDirectory = getScriptAiBaseDirectory()
  const workspacePath = path.join(baseDirectory, hashTargetKey(targetKey))
  const fileName = getScriptAiFileName(target.runtimeContext)

  return {
    targetKey,
    workspacePath,
    filePath: path.join(workspacePath, fileName),
  }
}

function getScriptAiBaseDirectory() {
  if (!scriptAiBaseDirectory) {
    throw new Error('Script AI base directory is not configured.')
  }

  return scriptAiBaseDirectory
}

function emitScriptAiState(state: ScriptAiWorkspaceState) {
  emitGenericEvent({ type: 'script-ai-state-updated', state })
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

function toGenericError(error: unknown): GenericResult<never> {
  return GenericError.Message(error instanceof Error ? error.message : String(error))
}
