import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { SharedScriptTarget } from '../common/SharedScripts.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import type { SupermavenInlineSuggestion, SupermavenInlineSuggestionRequest, SupermavenStatus } from '../common/Supermaven.js'
import { getAppSettings } from './db/app-settings.js'
import {
  getScriptRuntimeDeclarations,
  type ScriptAutocompletePhase,
  type ScriptRuntimeContext,
} from '../ui/folders/scriptRuntimeDeclarations.js'

type SupermavenResponseItem =
  | { kind: 'text'; text: string }
  | { kind: 'dedent'; text: string }
  | { kind: 'delete'; verify: string }
  | { kind: 'end' }
  | { kind: 'barrier' }
  | { kind: 'finish_edit' }
  | { kind: 'jump'; fileName: string; lineNumber: number; verify: string; precede: string; follow: string; isCreateFile: boolean }
  | { kind: 'skip'; n: number }

type SupermavenMessage =
  | { kind: 'response'; stateId: string; items: SupermavenResponseItem[] }
  | { kind: 'metadata'; dustStrings?: string[] }
  | { kind: 'activation_request'; activateUrl: string }
  | { kind: 'activation_success' }
  | { kind: 'passthrough'; passthrough: SupermavenMessage }
  | { kind: 'service_tier'; display?: string }
  | { kind: 'connection_status'; is_connected: boolean; status_text: string | null }
  | { kind: 'user_status'; tier?: string; email?: string }
  | { kind: 'set_v2'; key: string; value: string }
  | { kind: 'popup' | 'task_status' | 'active_repo' | 'apology' | 'set' }

type QueryState = {
  completion: SupermavenResponseItem[]
}

type TextCompletion = {
  kind: 'text'
  text: string
  dedent: string
  isIncomplete: boolean
}

type AnyCompletion =
  | TextCompletion
  | { kind: 'delete' }
  | { kind: 'jump' }
  | { kind: 'skip' }

type CompletionParams = {
  lineBeforeCursor: string
  lineAfterCursor: string
  getFollowingLine: (index: number) => string
  dustStrings: string[]
  canShowPartialLine: boolean
  canRetry: boolean
}

type SupermavenConfig = {
  accepted_free_version?: string
  api_key?: string
}

type MaterializedSupermavenDocument = {
  path: string
  content: string
  cursorOffset: number
}

const POLL_INTERVAL_MS = 25
const STARTUP_WAIT_MS = 250
const SUGGESTION_WAIT_MS = 5000
const STATUS_WAIT_MS = 3000
const HARD_SIZE_LIMIT = 10e6

class SupermavenService {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private readonly stateMap = new Map<number, QueryState>()
  private currentStateId = 0
  private dustStrings: string[] = []
  private status: SupermavenStatus = { state: 'disabled', detail: null }
  private pendingStart: Promise<boolean> | null = null
  private stopRequested = false

  async getStatus() {
    const enabled = (await getAppSettings()).supermavenEnabled
    if (!enabled) {
      this.stop()
      this.status = { state: 'disabled', detail: null }
      return this.status
    }

    await this.ensureStarted()
    await this.waitForReadyStatus()

    return this.status
  }

  async requestInlineSuggestion(input: SupermavenInlineSuggestionRequest): Promise<GenericResult<SupermavenInlineSuggestion | null>> {
    const settings = await getAppSettings()
    if (!settings.supermavenEnabled) {
      return Result.Success(null)
    }

    if (input.content.length > HARD_SIZE_LIMIT) {
      return Result.Success(null)
    }

    const started = await this.ensureStarted()
    if (!started) {
      return Result.Success(null)
    }

    if (this.status.state === 'starting') {
      await delay(STARTUP_WAIT_MS)
    }

    if (this.status.state !== 'running-free' && this.status.state !== 'running-pro') {
      return Result.Success(null)
    }

    try {
      const stateId = this.submitQuery(input)
      const suggestion = await this.waitForSuggestion(stateId, input)
      return Result.Success(suggestion)
    } catch (error) {
      this.status = { state: 'error', detail: error instanceof Error ? error.message : String(error) }
      return GenericError.Unknown(error)
    }
  }

  setEnabled(enabled: boolean) {
    if (!enabled) {
      this.stop()
      this.status = { state: 'disabled', detail: null }
    }
  }

  private async ensureStarted(): Promise<boolean> {
    if (this.child && !this.child.killed) {
      return true
    }

    if (this.pendingStart) {
      return this.pendingStart
    }

    this.pendingStart = this.start()
    try {
      return await this.pendingStart
    } finally {
      this.pendingStart = null
    }
  }

  private async waitForReadyStatus() {
    const startedAt = Date.now()
    while (this.status.state === 'starting' && Date.now() - startedAt < STATUS_WAIT_MS) {
      await delay(POLL_INTERVAL_MS)
    }
  }

  private async start() {
    const binaryPath = getBinaryPath()
    if (!binaryPath) {
      this.status = { state: 'not-installed', detail: 'Supermaven binary was not found in ~/.supermaven.' }
      return false
    }

    if (!hasSupermavenAuth()) {
      this.status = { state: 'not-configured', detail: 'No shared Supermaven authentication was found.' }
      return false
    }

    this.stopRequested = false
    this.status = { state: 'starting', detail: 'Starting Supermaven agent...' }
    this.stdoutBuffer = ''
    this.stateMap.clear()
    this.dustStrings = []

    const child = spawn(binaryPath, ['stdio'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')

    child.stdout.on('data', (chunk: string) => {
      this.handleStdout(chunk)
    })

    child.stderr.on('data', (chunk: string) => {
      const message = chunk.trim()
      if (!message) {
        return
      }
    })

    child.on('error', error => {
      this.status = { state: 'error', detail: error.message }
    })

    child.on('exit', code => {
      this.child = null
      if (this.stopRequested) {
        return
      }

      this.status = {
        state: 'error',
        detail: code === null ? 'Supermaven exited unexpectedly.' : `Supermaven exited with code ${String(code)}.`,
      }
    })

    this.sendJson({ kind: 'greeting', allowGitignore: false })
    this.bootstrapStatusProbe()
    return true
  }

  private stop() {
    this.stopRequested = true
    if (this.child && !this.child.killed) {
      this.child.kill('SIGTERM')
    }
    this.child = null
    this.stdoutBuffer = ''
    this.stateMap.clear()
  }

  private handleStdout(chunk: string) {
    this.stdoutBuffer += chunk
    while (true) {
      const lineEnd = this.stdoutBuffer.indexOf('\n')
      if (lineEnd === -1) {
        return
      }

      const line = this.stdoutBuffer.slice(0, lineEnd)
      this.stdoutBuffer = this.stdoutBuffer.slice(lineEnd + 1)
      this.processLine(line)
    }
  }

  private processLine(line: string) {
    if (!line.startsWith('SM-MESSAGE ')) {
      return
    }

    try {
      const payload = JSON.parse(line.slice('SM-MESSAGE '.length)) as SupermavenMessage
      this.processMessage(payload)
    } catch (error) {
      this.status = { state: 'error', detail: error instanceof Error ? error.message : String(error) }
    }
  }

  private processMessage(message: SupermavenMessage) {
    if (message.kind === 'response') {
      const stateId = Number(message.stateId)
      const state = this.stateMap.get(stateId)
      if (!state) {
        return
      }

      state.completion.push(...message.items)
      return
    }

    if (message.kind === 'metadata') {
      this.dustStrings = message.dustStrings ?? []
      return
    }

    if (message.kind === 'activation_request') {
      this.status = { state: 'not-configured', detail: message.activateUrl }
      return
    }

    if (message.kind === 'activation_success') {
      this.status = { state: 'starting', detail: 'Supermaven authentication updated.' }
      return
    }

    if (message.kind === 'passthrough') {
      this.processMessage(message.passthrough)
      return
    }

    if (message.kind === 'service_tier') {
      const display = message.display?.trim()
      if (display && display.toLowerCase().includes('pro')) {
        this.status = { state: 'running-pro', detail: display }
        return
      }

      this.status = { state: 'running-free', detail: display ?? 'Free' }
      return
    }

    if (message.kind === 'connection_status') {
      if (!message.is_connected) {
        this.status = { state: 'starting', detail: message.status_text ?? 'Connecting to Supermaven...' }
      }
      return
    }

    if (message.kind === 'user_status') {
      const tier = message.tier?.trim()
      if (tier?.toLowerCase().includes('pro')) {
        this.status = {
          state: 'running-pro',
          detail: message.email ? `${tier} ${message.email}` : tier,
        }
        return
      }

      if (tier) {
        this.status = {
          state: 'running-free',
          detail: message.email ? `${tier} ${message.email}` : tier,
        }
      }
      return
    }
  }

  private bootstrapStatusProbe() {
    try {
      const document = materializeSupermavenDocument({
        documentPath: getBootstrapDocumentPath(),
        content: 'const probe = Math',
        cursorOffset: 13,
      })
      this.sendJson({ kind: 'inform_file_changed', path: document.path })
      this.sendJson({
        kind: 'state_update',
        newId: 'bootstrap',
        updates: [
          {
            kind: 'cursor_update',
            path: document.path,
            offset: document.cursorOffset,
          },
          {
            kind: 'file_update',
            path: document.path,
            content: document.content,
          },
        ],
      })
    } catch (error) {
      this.status = { state: 'error', detail: error instanceof Error ? error.message : String(error) }
    }
  }

  private submitQuery(input: SupermavenInlineSuggestionRequest) {
    const document = materializeSupermavenDocument(input)
    this.currentStateId += 1
    this.stateMap.set(this.currentStateId, { completion: [] })

    this.sendJson({ kind: 'inform_file_changed', path: document.path })
    this.sendJson({
      kind: 'state_update',
      newId: String(this.currentStateId),
      updates: [
        {
          kind: 'cursor_update',
          path: document.path,
          offset: document.cursorOffset,
        },
        {
          kind: 'file_update',
          path: document.path,
          content: document.content,
        },
      ],
    })

    return this.currentStateId
  }

  private async waitForSuggestion(stateId: number, input: SupermavenInlineSuggestionRequest) {
    const context = getSuggestionContext(input.content, input.cursorOffset)
    const params: CompletionParams = {
      lineBeforeCursor: context.lineBeforeCursor,
      lineAfterCursor: context.lineAfterCursor,
      getFollowingLine: index => context.lines[context.lineIndex + index] ?? '',
      dustStrings: this.dustStrings,
      canShowPartialLine: true,
      canRetry: true,
    }

    const startedAt = Date.now()
    while (Date.now() - startedAt <= SUGGESTION_WAIT_MS) {
      const completion = this.stateMap.get(stateId)?.completion ?? []
      const suggestion = normalizeSuggestion(deriveCompletion(completion, params), context.lineBeforeCursor)
      if (suggestion) {
        return suggestion
      }

      if (this.status.state !== 'starting' && this.status.state !== 'running-free' && this.status.state !== 'running-pro') {
        return null
      }

      await delay(POLL_INTERVAL_MS)
    }

    const completion = this.stateMap.get(stateId)?.completion ?? []
    return normalizeSuggestion(deriveCompletion(completion, params), context.lineBeforeCursor)
  }

  private sendJson(message: object) {
    if (!this.child?.stdin.writable) {
      throw new Error('Supermaven agent is not writable.')
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }
}

function normalizeSuggestion(completion: AnyCompletion | null, lineBeforeCursor: string): SupermavenInlineSuggestion | null {
  if (!completion || completion.kind !== 'text') {
    return null
  }

  if (completion.dedent.length > 0 && !lineBeforeCursor.endsWith(completion.dedent)) {
    return null
  }

  let text = completion.text
  let dedent = completion.dedent
  while (dedent.length > 0 && text.length > 0 && dedent[0] === text[0]) {
    dedent = dedent.slice(1)
    text = text.slice(1)
  }

  const normalizedText = trimEnd(text)
  if (!normalizedText) {
    return null
  }

  return {
    text: normalizedText,
    deleteCount: dedent.length,
  }
}

function deriveCompletion(completion: SupermavenResponseItem[], params: CompletionParams): AnyCompletion | null {
  let output = ''
  const deleteLines: string[] = []
  let dedent = ''

  for (const responseItem of completion) {
    if (responseItem.kind === 'end') {
      if (output.includes('\n')) {
        return forceComplete(output, dedent, params)
      }
      return null
    }

    if (deleteLines.length > 0 && responseItem.kind !== 'delete') {
      return { kind: 'delete' }
    }

    if (responseItem.kind === 'text') {
      output += responseItem.text
      continue
    }

    if (responseItem.kind === 'barrier' || responseItem.kind === 'finish_edit') {
      if (trim(output) !== '') {
        return forceComplete(output, dedent, params)
      }
      continue
    }

    if (responseItem.kind === 'dedent') {
      dedent += responseItem.text
      continue
    }

    if (responseItem.kind === 'jump') {
      return trim(output) !== '' ? { kind: 'jump' } : null
    }

    if (responseItem.kind === 'delete') {
      if (trim(output) !== '') {
        return forceComplete(output, dedent, params)
      }

      const followingLine = params.getFollowingLine(deleteLines.length)
      if (trimEnd(responseItem.verify) === trimEnd(followingLine)) {
        deleteLines.push(followingLine)
      }
      continue
    }

    if (responseItem.kind === 'skip') {
      if (trim(output) !== '') {
        return forceComplete(output, dedent, params)
      }

      return { kind: 'skip' }
    }
  }

  output = trimEnd(output)
  const firstNonEmptyNewline = findFirstNonEmptyNewline(output)
  if (firstNonEmptyNewline !== null) {
    output = output.slice(0, firstNonEmptyNewline)
  }

  return finishCompletion(output, dedent, params)
}

function finishCompletion(output: string, dedent: string, params: CompletionParams): TextCompletion | null {
  if (!canDelete(params)) {
    return null
  }

  const hasTrailingCharacters = trim(params.lineAfterCursor).length > 0
  const outputTrimmed = trim(output)
  if (outputTrimmed === '') {
    return null
  }

  if (hasLeadingNewline(output)) {
    const firstNonEmptyLine = findFirstNonEmptyNewline(output)
    const lastNewline = findLastNewline(output)
    if (firstNonEmptyLine !== null && lastNewline !== null) {
      return {
        kind: 'text',
        text: output.slice(0, lastNewline + 1),
        dedent,
        isIncomplete: false,
      }
    }

    return null
  }

  const firstNonEmptyNewline = findFirstNonEmptyNewline(output)
  if (firstNonEmptyNewline !== null) {
    return {
      kind: 'text',
      text: output.slice(0, firstNonEmptyNewline + 1),
      dedent,
      isIncomplete: false,
    }
  }

  if (params.canRetry) {
    return {
      kind: 'text',
      text: output,
      dedent,
      isIncomplete: true,
    }
  }

  if (hasTrailingCharacters) {
    return null
  }

  if (trim(params.lineBeforeCursor) === '') {
    return null
  }

  if (!params.canShowPartialLine) {
    return null
  }

  return {
    kind: 'text',
    text: output,
    dedent,
    isIncomplete: true,
  }
}

function forceComplete(output: string, dedent: string, params: CompletionParams): TextCompletion {
  return finishCompletion(`${output}\n`, dedent, params) ?? { kind: 'text', text: '', dedent: '', isIncomplete: false }
}

function getSuggestionContext(content: string, cursorOffset: number) {
  const safeOffset = Math.max(0, Math.min(cursorOffset, content.length))
  const lineStart = content.lastIndexOf('\n', Math.max(0, safeOffset - 1)) + 1
  const lineEndIndex = content.indexOf('\n', safeOffset)
  const lineEnd = lineEndIndex === -1 ? content.length : lineEndIndex
  const lineBeforeCursor = content.slice(lineStart, safeOffset)
  const lineAfterCursor = content.slice(safeOffset, lineEnd)
  const lines = content.split('\n')
  const lineIndex = content.slice(0, safeOffset).split('\n').length - 1

  return {
    lineBeforeCursor,
    lineAfterCursor,
    lines,
    lineIndex,
  }
}

function hasSupermavenAuth() {
  const configPath = path.join(os.homedir(), '.supermaven', 'config.json')
  try {
    const raw = fs.readFileSync(configPath, 'utf8')
    const parsed = JSON.parse(raw) as SupermavenConfig
    return typeof parsed.api_key === 'string' && parsed.api_key.trim() !== ''
  } catch {
    return false
  }
}

function getBinaryPath() {
  const platform = getPlatformSegment()
  const arch = getArchSegment()
  if (!platform || !arch) {
    return null
  }

  const binaryName = process.platform === 'win32' ? 'sm-agent.exe' : 'sm-agent'
  const binaryPath = path.join(os.homedir(), '.supermaven', 'binary', 'v20', `${platform}-${arch}`, binaryName)
  return fs.existsSync(binaryPath) ? binaryPath : null
}

function getBootstrapDocumentPath() {
  return path.join(os.tmpdir(), 'kova-supermaven-bootstrap.ts')
}

function materializeSupermavenDocument(input: SupermavenInlineSuggestionRequest): MaterializedSupermavenDocument {
  const resolvedPath = resolveSupermavenDocumentPath(input.documentPath)
  const runtimeContext = getRequestRuntimeContext(input)
  const referencePrefix = runtimeContext ? materializeRuntimeReferencePrefix(resolvedPath, runtimeContext) : ''
  const content = `${referencePrefix}${input.content}`

  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true })
  writeIfChanged(resolvedPath, content)

  return {
    path: resolvedPath,
    content,
    cursorOffset: referencePrefix.length + input.cursorOffset,
  }
}

function resolveSupermavenDocumentPath(documentPath: string) {
  if (!documentPath.startsWith('kova://')) {
    return documentPath
  }

  const relativePath = documentPath.slice('kova://'.length)
  const sanitizedPath = relativePath
    .split('/')
    .filter(Boolean)
    .map(segment => sanitizePathSegment(segment))
    .join(path.sep)

  return path.join(os.tmpdir(), 'kova-supermaven', sanitizedPath)
}

function materializeRuntimeReferencePrefix(documentPath: string, runtimeContext: ScriptRuntimeContext) {
  const runtimeDir = path.join(os.tmpdir(), 'kova-supermaven', 'runtime')
  const runtimeFilePath = path.join(runtimeDir, `${getRuntimeContextKey(runtimeContext)}.d.ts`)
  fs.mkdirSync(path.dirname(runtimeFilePath), { recursive: true })
  writeIfChanged(runtimeFilePath, getScriptRuntimeDeclarations(runtimeContext))

  const relativeReferencePath = path.relative(path.dirname(documentPath), runtimeFilePath).split(path.sep).join('/')
  return `/// <reference path="${relativeReferencePath}" />\n`
}

function getRequestRuntimeContext(input: SupermavenInlineSuggestionRequest): ScriptRuntimeContext | null {
  if (input.targets && input.targets.length > 0) {
    return { targets: normalizeTargets(input.targets) }
  }

  if (input.phase) {
    return { phase: input.phase }
  }

  return null
}

function getRuntimeContextKey(context: ScriptRuntimeContext) {
  if ('phase' in context) {
    return context.phase
  }

  if ('templatePhase' in context) {
    return `template-${context.templatePhase}`
  }

  return `targets-${normalizeTargets(context.targets).join('__')}`
}

function normalizeTargets(targets: SharedScriptTarget[]) {
  return Array.from(new Set(targets)).sort((left, right) => left.localeCompare(right))
}

function writeIfChanged(filePath: string, content: string) {
  try {
    const existingContent = fs.readFileSync(filePath, 'utf8')
    if (existingContent === content) {
      return
    }
  } catch {
    // Ignore missing files and rewrite below.
  }

  fs.writeFileSync(filePath, content)
}

function sanitizePathSegment(segment: string) {
  return segment.replace(/[^A-Za-z0-9._-]/g, '_')
}

function getPlatformSegment() {
  if (process.platform === 'darwin') {
    return 'macosx'
  }

  if (process.platform === 'linux') {
    return 'linux'
  }

  if (process.platform === 'win32') {
    return 'windows'
  }

  return null
}

function getArchSegment() {
  if (process.arch === 'arm64') {
    return 'aarch64'
  }

  if (process.arch === 'x64') {
    return 'x86_64'
  }

  return null
}

function canDelete(params: CompletionParams) {
  if (trim(params.lineBeforeCursor) === '' && !isAllDust(params.lineAfterCursor, params.dustStrings)) {
    return false
  }

  return true
}

function isAllDust(line: string, dustStrings: string[]) {
  let lineHolding = line
  while (lineHolding.length > 0) {
    const originalLength = lineHolding.length
    lineHolding = trimStart(lineHolding)
    for (const dustString of dustStrings) {
      if (lineHolding.startsWith(dustString)) {
        lineHolding = lineHolding.slice(dustString.length)
      }
    }

    if (lineHolding.length === originalLength) {
      return false
    }
  }

  return true
}

function hasLeadingNewline(value: string) {
  for (const character of value) {
    if (character === '\n') {
      return true
    }

    if (!isWhitespace(character)) {
      return false
    }
  }

  return false
}

function findFirstNonEmptyNewline(value: string) {
  let seenNonWhitespace = false
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '\n' && seenNonWhitespace) {
      return index
    }

    if (!isWhitespace(character)) {
      seenNonWhitespace = true
    }
  }

  return null
}

function findLastNewline(value: string) {
  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] === '\n') {
      return index
    }
  }

  return null
}

function trim(value: string) {
  return value.trim()
}

function trimStart(value: string) {
  return value.replace(/^\s+/, '')
}

function trimEnd(value: string) {
  return value.replace(/\s+$/, '')
}

function isWhitespace(value: string) {
  return /\s/.test(value)
}

function delay(ms: number) {
  return new Promise(resolve => {
    setTimeout(resolve, ms)
  })
}

export const supermavenService = new SupermavenService()
