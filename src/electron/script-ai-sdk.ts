import { createHash } from 'node:crypto'
import path from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import {
  createOpencodeClient,
  createOpencodeServer,
  type AssistantMessage,
  type Event,
  type GlobalEvent,
  type Message,
  type OpencodeClient,
  type Part,
  type Session,
  type SessionStatus,
  type ToolPart,
} from '@opencode-ai/sdk'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import { DEFAULT_SCRIPT_AI_SERVER_PORT } from '../common/AppSettings.js'
import {
  getScriptAiFileName,
  getScriptAiTargetKey,
  type AbortScriptAiSessionInput,
  type ApplyScriptAiWorkspaceInput,
  type ApplyScriptAiWorkspaceResponse,
  type CreateScriptAiSessionInput,
  type LoadScriptAiWorkspaceInput,
  type ScriptAiMessage,
  type ScriptAiMessagePart,
  type ScriptAiSessionSummary,
  type ScriptAiTarget,
  type ScriptAiWorkspaceState,
  type SendScriptAiMessageInput,
} from '../common/ScriptAi.js'
import { emitGenericEvent } from './generic-events.js'
import { getAppSettings } from './db/app-settings.js'
import { resolveOpenCodeSpawnConfig } from './utils/opencode-command.js'

type TargetMeta = {
  version: 1
  targetKey: string
  activeSessionId: string | null
  knownSessionIds: string[]
}

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
  baseUrl: string
  ownedServer: {
    url: string
    close(): void
  } | null
  globalClient: OpencodeClient
  clientsByDirectory: Map<string, OpencodeClient>
  eventLoopStarted: boolean
  eventLoopPromise: Promise<void> | null
  globalEventAbortController: AbortController
}

const SCRIPT_AI_META_FILE_NAME = 'meta.json'
const targetRuntimes = new Map<string, TargetRuntime>()
const sessionToTargetKey = new Map<string, string>()

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
    await writeWorkspaceCode(runtime, input.currentCode)
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
    await writeWorkspaceCode(runtime, input.currentCode)
    const client = await getClientForDirectory(runtime.workspacePath)
    const title = buildSessionTitle(input.target)
    const sessionResult = await client.session.create({ body: { title } })
    const session = requireSdkData(sessionResult.data, 'OpenCode did not return the created session.')

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

    await writeWorkspaceCode(runtime, input.currentCode)
    runtime.activeSessionId = input.sessionId
    await persistMeta(runtime)

    const client = await getClientForDirectory(runtime.workspacePath)
    await client.session.prompt({
      path: { id: input.sessionId },
      body: {
        model: parseSelectedModel(input.model),
        system: buildSystemPrompt(runtime.fileName, input.documentation),
        parts: [{ type: 'text', text: input.message }],
      },
    })

    await refreshTargetRuntime(runtime)
    const state = toWorkspaceState(runtime, await readWorkspaceCode(runtime))
    emitScriptAiState(state)
    return Result.Success(state)
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

export async function abortScriptAiSession(
  input: AbortScriptAiSessionInput
): Promise<GenericResult<ScriptAiWorkspaceState>> {
  try {
    const runtime = await ensureTargetRuntime(input.target, '')
    if (!runtime.knownSessionIds.has(input.sessionId)) {
      return GenericError.Message('This OpenCode session does not belong to the current script target.')
    }

    const client = await getClientForDirectory(runtime.workspacePath)
    await client.session.abort({ path: { id: input.sessionId } })
    await refreshTargetRuntime(runtime)

    const state = toWorkspaceState(runtime, await readWorkspaceCode(runtime))
    emitScriptAiState(state)
    return Result.Success(state)
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
  const fileName = getScriptAiFileName(target.phase)
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
  const client = await getClientForDirectory(runtime.workspacePath)
  const [sessionsResult, statusesResult] = await Promise.all([client.session.list(), client.session.status()])
  const sessions = requireSdkData(sessionsResult.data, 'OpenCode did not return the session list.').filter(session =>
    runtime.knownSessionIds.has(session.id)
  )
  const statuses = requireSdkData(statusesResult.data, 'OpenCode did not return the session statuses.')

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
              statuses[session.id] ?? { type: 'idle' },
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

async function loadSessionMessages(client: OpencodeClient, sessionId: string) {
  const messagesResult = await client.session.messages({ path: { id: sessionId } })
  return requireSdkData(messagesResult.data, 'OpenCode did not return the session messages.').map(message =>
    toScriptAiMessage(message.info, message.parts)
  )
}

function upsertMessage(runtime: TargetRuntime, sessionId: string, message: ScriptAiMessage) {
  const existingMessages = runtime.messagesBySessionId.get(sessionId)
  if (!existingMessages) {
    runtime.messagesBySessionId.set(sessionId, [message])
    return
  }

  const existingIndex = existingMessages.findIndex(existingMessage => existingMessage.id === message.id)
  if (existingIndex === -1) {
    existingMessages.push(message)
  } else {
    existingMessages[existingIndex] = {
      ...existingMessages[existingIndex],
      ...message,
      parts: existingMessages[existingIndex].parts,
    }
  }
}

function upsertMessagePart(runtime: TargetRuntime, sessionId: string, messageId: string, part: ScriptAiMessagePart) {
  const messages = runtime.messagesBySessionId.get(sessionId)
  if (!messages) {
    runtime.messagesBySessionId.set(sessionId, [
      { id: messageId, role: 'assistant', createdAt: Date.now(), completedAt: null, errorMessage: null, parts: [part] },
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

function removeMessagePart(runtime: TargetRuntime, sessionId: string, messageId: string, partId: string) {
  const messages = runtime.messagesBySessionId.get(sessionId)
  const message = messages?.find(candidate => candidate.id === messageId)
  if (!message) {
    return
  }

  message.parts = message.parts.filter(part => part.id !== partId)
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
    const runtime = await serverRuntimePromise
    runtime.globalEventAbortController.abort()
    await runtime.eventLoopPromise?.catch(() => undefined)
    runtime.ownedServer?.close()
  } finally {
    serverRuntimePromise = null
  }
}

async function createServerRuntime(): Promise<ServerRuntime> {
  const spawnConfig = await resolveOpenCodeSpawnConfig()
  const scriptAiServerPort = await getConfiguredScriptAiServerPort()
  process.env.PATH = spawnConfig.env.PATH
  process.env.OPENCODE_DISABLE_CLAUDE_CODE = 'true'
  process.env.OPENCODE_DISABLE_CLAUDE_CODE_PROMPT = 'true'
  process.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = 'true'

  const startupAbortController = new AbortController()
  serverStartupAbortController = startupAbortController

  const baseUrl = `http://127.0.0.1:${String(scriptAiServerPort)}`
  let ownedServer: ServerRuntime['ownedServer'] = null

  try {
    ownedServer = await createOpencodeServer({
      hostname: '127.0.0.1',
      port: scriptAiServerPort,
      timeout: 10_000,
      signal: startupAbortController.signal,
    })
  } catch (error) {
    if (!(await tryReuseExistingServer(baseUrl, scriptAiServerPort, error))) {
      throw error
    }
  } finally {
    if (serverStartupAbortController === startupAbortController) {
      serverStartupAbortController = null
    }
  }

  const resolvedBaseUrl = ownedServer?.url ?? baseUrl

  const runtime: ServerRuntime = {
    baseUrl: resolvedBaseUrl,
    ownedServer,
    globalClient: createOpencodeClient({ baseUrl: resolvedBaseUrl }),
    clientsByDirectory: new Map(),
    eventLoopStarted: false,
    eventLoopPromise: null,
    globalEventAbortController: new AbortController(),
  }

  startGlobalEventLoop(runtime)
  return runtime
}

function startGlobalEventLoop(runtime: ServerRuntime) {
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
        console.error('Script AI global event loop failed', error)
      }
    }
  })()
}

async function handleGlobalEvent(event: GlobalEvent) {
  const payload = event.payload
  const sessionId = getEventSessionId(payload)
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

  if (payload.type === 'session.status') {
    const session = runtime.sessions.get(sessionId)
    if (session) {
      session.status = toUiSessionStatus(payload.properties.status)
    }
  } else if (payload.type === 'session.idle') {
    const session = runtime.sessions.get(sessionId)
    if (session) {
      session.status = 'idle'
    }
  } else if (payload.type === 'session.updated' || payload.type === 'session.created') {
    const existingMessageCount = runtime.messagesBySessionId.get(sessionId)?.length ?? 0
    const existingErrorMessage = runtime.sessions.get(sessionId)?.latestErrorMessage ?? null
    runtime.sessions.set(
      sessionId,
      toSessionSummary(payload.properties.info, { type: 'idle' }, existingMessageCount, existingErrorMessage)
    )
    runtime.knownSessionIds.add(sessionId)
    sessionToTargetKey.set(sessionId, targetKey)
    await persistMeta(runtime)
  } else if (payload.type === 'session.deleted') {
    runtime.knownSessionIds.delete(sessionId)
    runtime.sessions.delete(sessionId)
    runtime.messagesBySessionId.delete(sessionId)
    sessionToTargetKey.delete(sessionId)
    if (runtime.activeSessionId === sessionId) {
      runtime.activeSessionId = runtime.sessions.keys().next().value ?? null
    }
    await persistMeta(runtime)
  } else if (payload.type === 'message.updated') {
    const sessionMessages = runtime.messagesBySessionId.get(sessionId) ?? []
    runtime.messagesBySessionId.set(sessionId, sessionMessages)
    upsertMessage(
      runtime,
      sessionId,
      toScriptAiMessage(
        payload.properties.info,
        sessionMessages.find(message => message.id === payload.properties.info.id)?.parts ?? []
      )
    )
    updateSessionSummaryFromMessages(runtime, sessionId)
  } else if (payload.type === 'message.part.updated') {
    upsertMessagePart(
      runtime,
      sessionId,
      payload.properties.part.messageID,
      toScriptAiMessagePart(payload.properties.part)
    )
    updateSessionSummaryFromMessages(runtime, sessionId)
  } else if (payload.type === 'message.part.removed') {
    removeMessagePart(runtime, sessionId, payload.properties.messageID, payload.properties.partID)
    updateSessionSummaryFromMessages(runtime, sessionId)
  } else if (payload.type === 'message.removed') {
    const messages = runtime.messagesBySessionId.get(sessionId)
    if (messages) {
      runtime.messagesBySessionId.set(
        sessionId,
        messages.filter(message => message.id !== payload.properties.messageID)
      )
      updateSessionSummaryFromMessages(runtime, sessionId)
    }
  } else if (payload.type === 'session.error') {
    const session = runtime.sessions.get(sessionId)
    if (session) {
      session.latestErrorMessage = getSdkErrorMessage(payload.properties.error) ?? 'OpenCode session failed.'
    }
  }

  const state = toWorkspaceState(runtime, await readWorkspaceCode(runtime))
  emitScriptAiState(state)
}

function requireSdkData<T>(value: T | undefined, message: string) {
  if (value === undefined) {
    throw new Error(message)
  }

  return value
}

function updateSessionSummaryFromMessages(runtime: TargetRuntime, sessionId: string) {
  const session = runtime.sessions.get(sessionId)
  if (!session) {
    return
  }

  const messages = runtime.messagesBySessionId.get(sessionId) ?? []
  session.messageCount = messages.length
  session.updatedAt = messages.at(-1)?.completedAt ?? messages.at(-1)?.createdAt ?? session.updatedAt
  session.latestErrorMessage = getLatestErrorMessage(messages)
}

async function getClientForDirectory(directory: string) {
  const runtime = await getServerRuntime()
  const existingClient = runtime.clientsByDirectory.get(directory)
  if (existingClient) {
    return existingClient
  }

  const client = createOpencodeClient({ baseUrl: runtime.baseUrl, directory })
  runtime.clientsByDirectory.set(directory, client)
  return client
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

function isPortInUseServerError(error: unknown, port: number) {
  return error instanceof Error && error.message.includes(`Is port ${String(port)} in use?`)
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

function buildSessionTitle(target: ScriptAiTarget) {
  return `${target.ownerType}:${target.ownerId} ${target.phase}`
}

function buildSystemPrompt(fileName: string, documentation: string) {
  return [
    `You are editing exactly one runtime script file named ${fileName}.`,
    `Only update ${fileName}.`,
    'Do not inspect, reference, or rely on files outside the current workspace.',
    'Do not create unrelated files.',
    'The source of truth is the script file in the workspace.',
    'Use the existing file contents as the starting point for edits.',
    'When you finish, ensure the script file contains the complete final script source.',
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
    modelID: value.slice(separatorIndex + 1),
  }
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
  session: Session,
  status: SessionStatus,
  messageCount: number,
  latestErrorMessage: string | null
): ScriptAiSessionSummary {
  return {
    id: session.id,
    title: session.title,
    createdAt: session.time.created,
    updatedAt: session.time.updated,
    status: toUiSessionStatus(status),
    messageCount,
    latestErrorMessage,
  }
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
  message: Message | AssistantMessage,
  parts: ScriptAiMessagePart[] | Part[]
): ScriptAiMessage {
  return {
    id: message.id,
    role: message.role,
    createdAt: message.time.created,
    completedAt: message.role === 'assistant' ? (message.time.completed ?? null) : null,
    errorMessage: message.role === 'assistant' ? getSdkErrorMessage(message.error) : null,
    parts: parts.map(part => ('messageID' in part ? toScriptAiMessagePart(part) : part)),
  }
}

function toScriptAiMessagePart(part: Part): ScriptAiMessagePart {
  switch (part.type) {
    case 'text':
      return { id: part.id, type: 'text', text: part.text }
    case 'reasoning':
      return { id: part.id, type: 'reasoning', text: part.text }
    case 'tool':
      return toScriptAiToolPart(part)
    case 'file':
      return {
        id: part.id,
        type: 'file',
        filename: part.filename ?? null,
        path: part.source?.path ?? null,
      }
    case 'step-start':
      return { id: part.id, type: 'step-start' }
    case 'step-finish':
      return { id: part.id, type: 'step-finish' }
    case 'snapshot':
      return { id: part.id, type: 'snapshot' }
    case 'patch':
      return { id: part.id, type: 'patch' }
    case 'agent':
      return { id: part.id, type: 'agent', name: part.name }
    case 'subtask':
      return {
        id: part.id,
        type: 'subtask',
        description: part.description,
        prompt: part.prompt,
        agent: part.agent,
      }
    case 'retry':
      return { id: part.id, type: 'retry' }
    case 'compaction':
      return { id: part.id, type: 'compaction' }
  }
}

function toScriptAiToolPart(part: ToolPart): ScriptAiMessagePart {
  switch (part.state.status) {
    case 'pending':
      return {
        id: part.id,
        type: 'tool',
        toolName: part.tool,
        status: 'pending',
        title: null,
        input: part.state.raw,
        output: null,
        errorMessage: null,
      }
    case 'running':
      return {
        id: part.id,
        type: 'tool',
        toolName: part.tool,
        status: 'running',
        title: part.state.title ?? null,
        input: JSON.stringify(part.state.input, null, 2),
        output: null,
        errorMessage: null,
      }
    case 'completed':
      return {
        id: part.id,
        type: 'tool',
        toolName: part.tool,
        status: 'completed',
        title: part.state.title,
        input: JSON.stringify(part.state.input, null, 2),
        output: part.state.output,
        errorMessage: null,
      }
    case 'error':
      return {
        id: part.id,
        type: 'tool',
        toolName: part.tool,
        status: 'error',
        title: null,
        input: JSON.stringify(part.state.input, null, 2),
        output: null,
        errorMessage: part.state.error,
      }
  }
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

function hashTargetKey(targetKey: string) {
  return createHash('sha1').update(targetKey).digest('hex')
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
