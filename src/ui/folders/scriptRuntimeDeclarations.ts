import type { SharedScriptTarget } from '../../common/SharedScripts.js'
import type { ScriptAiRuntimeContext } from '../../common/ScriptAi.js'

export type ScriptAutocompletePhase = 'pre-request' | 'post-request' | 'response-visualizer' | 'view-runtime'
export type ScriptRuntimeContext = ScriptAiRuntimeContext & ({ phase: ScriptAutocompletePhase } | { templatePhase: 'pre-request' } | { targets: SharedScriptTarget[] })

const sharedDeclarations = String.raw`
type SafeParseSuccess<T> = {
  success: true
  data: T
}

type SafeParseFailure = {
  success: false
  error: {
    message: string
    format(): unknown
  }
}

type ScriptResponseBody =
  | {
      type: 'json'
      data: unknown
    }
  | {
      type: 'text'
      data: string
    }

interface ScriptConsoleApi {
  /** Write a standard log message to the request console. */
  log(...values: unknown[]): void
  /** Write an informational message to the request console. */
  info(...values: unknown[]): void
  /** Write a warning to the request console. */
  warn(...values: unknown[]): void
  /** Write an error to the request console. */
  error(...values: unknown[]): void
  /** Write a debug message to the request console. */
  debug(...values: unknown[]): void
}

interface ScriptEnvironmentApi {
  /** Read the effective value of an environment variable. */
  get(name: string, environmentName?: string): string | null
  /** Check whether an environment variable exists. */
  has(name: string, environmentName?: string): boolean
  /** Update or create an environment variable. */
  set(name: string, value: string, environmentName?: string): void
}

interface ScriptRequestScopeApi {
  /** Read a request-scoped value shared during this execution. */
  get(name: string): string | null
  /** Check whether a request-scoped value exists. */
  has(name: string): boolean
  /** Store a request-scoped value for later scripts in the same execution. */
  set(name: string, value: string): void
}

interface ViewRuntimeCacheApi {
  /** Read a persisted string value for the current view. */
  getItem(key: string): Promise<string | null>
  /** Read persisted data, try JSON first, then validate the raw string, and return null when missing or invalid. */
  getItemWithSchema<T>(key: string, schema: import('./vendor/zod/index.cjs').ZodType<T>): Promise<T | null>
  /** Persist a string value for the current view. */
  setItem(key: string, value: string): Promise<void>
  /** Return a copied object containing all persisted cache entries for the current view. */
  getAll(): Promise<Record<string, string>>
  /** Delete a persisted cache value for the current view. */
  removeItem(key: string): Promise<void>
}

interface ScriptHeaderApi {
  /** Read a request header value. */
  get(name: string): string | null
  /** Add or replace a request header. */
  set(name: string, value: string): void
  /** Remove a request header. */
  delete(name: string): void
  /** Check whether a request header exists. */
  has(name: string): boolean
  /** Return enabled request headers as key/value pairs. */
  entries(): Array<[string, string]>
  /** Return enabled request headers as an object. */
  toObject(): Record<string, string>
}

type ScriptCookieSameSite = 'strict' | 'lax' | 'none'

interface ScriptCookie {
  name: string
  value: string
  domain: string | null
  path: string | null
  secure: boolean
  httpOnly: boolean
  sameSite: ScriptCookieSameSite | null
  expires: string | null
  maxAge: number | null
}

interface ScriptCookieApi {
  /** Parse one or more Set-Cookie header values into cookie objects. */
  parse(value: string): ScriptCookie[]
  /** Serialize cookie objects into a Set-Cookie header value. */
  stringify(cookies: ScriptCookie[]): string
}

interface ScriptPathParam {
  /** Path param name. */
  key: string
  /** Path param value. */
  value: string
  /** Whether this path param is enabled. */
  enabled: boolean
  /** Optional path param description. */
  description: string
}

interface ScriptRequestApi {
  /** Current request method. */
  method: string
  /** Draft request URL exactly as typed or mutated in the script. */
  url: string
  /** Current path params as mutable JSON rows. */
  pathParams: ScriptPathParam[]
  /** Resolve the current request URL with variables, path params, search params, and auth query params applied. */
  resolveUrl(): string
  /** Current request body string. */
  body: string
  /** Current request body mode. */
  bodyType: string
  /** Current raw request body format. */
  rawType: string
  /** Request header helper API. */
  headers: ScriptHeaderApi
}

type ScriptRequestRuntimePhase = 'pre-request' | 'post-request' | 'template-expression'

type ScriptRequestRuntimeSource =
  | 'request-editor'
  | 'call-request'
  | 'navigate-and-call-request'
  | 'generate-request-code'
  | 'websocket'

interface ScriptRequestMetadataApi {
  /** Whether this execution was triggered as a retry of a previous UI request send. */
  isRetry: boolean
  /** How many times this request has been retried by the UI. */
  retryCount: number
  /** The current runtime phase executing this code. */
  currentRuntime: ScriptRequestRuntimePhase
  /** The source that started this request execution. */
  sourceRuntime: ScriptRequestRuntimeSource
}

interface ScriptCallRequestOptions {
  /** Override the outbound request method. Omit to keep the prepared method. */
  method?: string
  /** Override the outbound request URL. Omit to keep the prepared URL. */
  url?: string
  /** Replace the outbound header set. Omit to keep the prepared headers. */
  headers?: Record<string, string | undefined>
  /** Override the outbound request body. Pass undefined to send no body. */
  body?: string | undefined
}

interface ScriptResponseApi {
  /** Numeric HTTP status code. */
  status: number
  /** HTTP status text. */
  statusText: string
  /** Response header helper API. */
  headers: ScriptHeaderApi
  /** Check whether the response currently has any Set-Cookie headers. */
  hasCookies(): boolean
  /** Parse all current Set-Cookie response headers. */
  parseCookies(): ScriptCookie[]
  /** Parsed response body. */
  body: ScriptResponseBody
}

interface ScriptCryptoApi {
  /** Generate a UUID string inside the script runtime. */
  randomUUID(): string
}

type ScriptToastSeverity = 'success' | 'error' | 'warning' | 'info'

type ScriptToastLocation =
  | 'top-left'
  | 'top-right'
  | 'top-center'
  | 'bottom-left'
  | 'bottom-right'
  | 'bottom-center'

interface ScriptToastOptions {
  id?: string
  title?: string
  message?: string
  severity: ScriptToastSeverity
  timeout?: number
  location?: ScriptToastLocation
}

interface ScriptToastApi {
  /** Show a toast in the current app window and return its id. */
  show(options: ScriptToastOptions): string
  /** Hide a previously shown toast by id. */
  hide(id: string): void
}

interface ScriptPromptTextOptions {
  title?: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
  required?: boolean
}

interface ScriptPromptApi {
  /** Ask the user for a text value and return it, or null if they cancel. */
  text(options: ScriptPromptTextOptions): Promise<string | null>
}

interface ScriptClipboardApi {
  /** Write a string to the system clipboard. */
  write(value: string): void
}

declare const console: ScriptConsoleApi
declare const env: ScriptEnvironmentApi
declare const scope: ScriptRequestScopeApi
declare const crypto: ScriptCryptoApi
declare const clipboard: ScriptClipboardApi
declare const cookies: ScriptCookieApi
declare const z: typeof import('./vendor/zod/index.cjs').z

declare namespace z {
  export type infer<T extends import('./vendor/zod/index.cjs').ZodType<unknown>> = import('./vendor/zod/index.cjs').infer<T>
  export type input<T extends import('./vendor/zod/index.cjs').ZodType<unknown>> = import('./vendor/zod/index.cjs').input<T>
  export type output<T extends import('./vendor/zod/index.cjs').ZodType<unknown>> = import('./vendor/zod/index.cjs').output<T>
}

interface ScriptRuntimeInstalledPackageMap {}

declare function loadPackage<TName extends keyof ScriptRuntimeInstalledPackageMap>(
  name: TName
): ScriptRuntimeInstalledPackageMap[TName]
declare function loadPackage<TName extends string>(name: string extends TName ? TName : never): unknown
declare function formatXml(xml: string): string
declare function formatJson(json: string, indentation?: number): string
`

const scriptToastDeclarations = String.raw`
declare const toast: ScriptToastApi
`

const scriptPromptDeclarations = String.raw`
declare const prompt: ScriptPromptApi
`

const postRequestDeclarations = String.raw`
declare const response: ScriptResponseApi
`

const postRequestOnlyDeclarations = String.raw`
declare function retryRequest(): never
`

const requestDeclarations = String.raw`
declare const request: ScriptRequestApi
declare const requestMetadata: ScriptRequestMetadataApi
`

const responseVisualizerDeclarations = String.raw`
type SetStateAction<T> = T | ((previousState: T) => T)
type Dispatch<T> = (value: T) => void
type DependencyList = readonly unknown[]
type CodeEditorLanguage = 'plain' | 'json' | 'json5' | 'javascript' | 'jsx' | 'html' | 'css' | 'xml'
type ReactElementLike = {
  readonly type: unknown
  readonly props: unknown
  readonly key: string | number | null
}

interface RefObject<T> {
  current: T
}

interface MutableRefObject<T> {
  current: T
}

interface ReactApi {
  Fragment: unique symbol
  useState<T>(initialState: T | (() => T)): [T, Dispatch<SetStateAction<T>>]
  useEffect(effect: () => void | (() => void), deps?: DependencyList): void
  useEffectEvent<T extends (...args: never[]) => unknown>(callback: T): T
  useLayoutEffect(effect: () => void | (() => void), deps?: DependencyList): void
  useMemo<T>(factory: () => T, deps: DependencyList): T
  useRef<T>(initialValue: T): MutableRefObject<T>
  useRef<T>(initialValue: T | null): RefObject<T | null>
  useId(): string
  useReducer<TState, TAction>(
    reducer: (state: TState, action: TAction) => TState,
    initialState: TState
  ): [TState, Dispatch<TAction>]
  useDeferredValue<T>(value: T): T
  startTransition(action: () => void): void
}

interface TableProps {
  list: unknown[]
  columns?: string[]
  emptyMessage?: string
}

type CodeEditorPasteParams = {
  text: string
  value: string
  selectionFrom: number
  selectionTo: number
  selectedText: string
}

type CodeEditorSelection = {
  anchor: number
  head: number
}

type CodeEditorChangeParams = {
  caretPos: number
  previousValue: string
  previousCaretPos: number
}

interface CodeEditorHandle {
  focusLine(line: number, column?: number | null): void
}

interface CodeEditorProps {
  ref?: RefObject<CodeEditorHandle | null>
  testId?: string
  value: string
  language: CodeEditorLanguage
  placeholder?: string
  minHeightClassName?: string
  className?: string
  singleLine?: boolean
  compact?: boolean
  size?: 'normal' | 'small'
  scale?: number
  hideFocusOutline?: boolean
  readOnly?: boolean
  showFoldGutter?: boolean
  showLineNumbers?: boolean
  onPasteText?: (params: CodeEditorPasteParams) => boolean
  onChange?: (value: string, params: CodeEditorChangeParams) => void
  onSelectionChange?: (selection: CodeEditorSelection) => void
  onBlur?: () => void
  initialSelection?: CodeEditorSelection | null
  linePaddingOverride?: string
  vimMode?: boolean
  refreshKey?: string
}

declare const React: ReactApi
declare const Fragment: ReactApi['Fragment']
declare const useState: ReactApi['useState']
declare const useEffect: ReactApi['useEffect']
declare const useEffectEvent: ReactApi['useEffectEvent']
declare const useLayoutEffect: ReactApi['useLayoutEffect']
declare const useMemo: ReactApi['useMemo']
declare const useRef: ReactApi['useRef']
declare const useId: ReactApi['useId']
declare const useReducer: ReactApi['useReducer']
declare const useDeferredValue: ReactApi['useDeferredValue']
declare const startTransition: ReactApi['startTransition']
declare function Table(props: TableProps): ReactElementLike | null
declare function CodeEditor(props: CodeEditorProps): ReactElementLike | null
`

const viewRuntimeDeclarations = String.raw`
declare const cache: ViewRuntimeCacheApi
`

export function getScriptRuntimeDeclarations(context: ScriptRuntimeContext) {
  const targets = getContextTargets(context)
  let declarations = sharedDeclarations

  if (targets.every(target => target === 'pre-request' || target === 'post-request' || target === 'response-visualizer')) {
    declarations = `${declarations}\n${requestDeclarations}`
  }

  if (targets.every(target => target === 'pre-request' || target === 'post-request')) {
    declarations = `${declarations}\n${scriptToastDeclarations}\n${scriptPromptDeclarations}`
  }

  if (targets.every(target => target === 'post-request' || target === 'response-visualizer')) {
    declarations = `${declarations}\n${postRequestDeclarations}`
  }

  if (targets.every(target => target === 'post-request')) {
    declarations = `${declarations}\n${postRequestOnlyDeclarations}`
  }

  if (supportsVisualRuntimeDeclarations(targets)) {
    declarations = `${declarations}\n${responseVisualizerDeclarations}`
  }

  if (targets.length === 1 && targets[0] === 'view-runtime') {
    declarations = `${declarations}\n${viewRuntimeDeclarations}`
  }

  return declarations
}

export function getScriptRuntimeTargets(context: ScriptRuntimeContext): SharedScriptTarget[] {
  return getContextTargets(context)
}

export function isScriptRuntimeVisualizerOnly(context: ScriptRuntimeContext) {
  const targets = getContextTargets(context)
  return supportsVisualRuntimeDeclarations(targets)
}

function getContextTargets(context: ScriptRuntimeContext): SharedScriptTarget[] {
  if ('phase' in context) {
    return [context.phase]
  }

  if ('templatePhase' in context) {
    return [context.templatePhase]
  }

  return normalizeTargets(context.targets)
}

function normalizeTargets(targets: SharedScriptTarget[]) {
  return Array.from(new Set(targets))
}

function supportsVisualRuntimeDeclarations(targets: SharedScriptTarget[]) {
  return targets.length > 0 && targets.every(target => target === 'response-visualizer' || target === 'view-runtime')
}
