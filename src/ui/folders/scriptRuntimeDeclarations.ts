export type ScriptAutocompletePhase = 'pre-request' | 'post-request' | 'response-visualizer'

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

interface ZodSchema<T = unknown> {
  parse(value: unknown): T
  safeParse(value: unknown): SafeParseSuccess<T> | SafeParseFailure
  optional(): ZodSchema<T | undefined>
  nullable(): ZodSchema<T | null>
  array(): ZodSchema<T[]>
}

interface ZodStringSchema extends ZodSchema<string> {
  min(length: number): ZodStringSchema
  max(length: number): ZodStringSchema
}

interface ZodNumberSchema extends ZodSchema<number> {
  min(value: number): ZodNumberSchema
  max(value: number): ZodNumberSchema
  int(): ZodNumberSchema
}

interface ZodBooleanSchema extends ZodSchema<boolean> {}

interface ZodObjectSchema<T extends Record<string, unknown>> extends ZodSchema<T> {
  extend<U extends Record<string, unknown>>(shape: { [K in keyof U]: ZodSchema<U[K]> }): ZodObjectSchema<T & U>
}

interface ZodApi {
  object<T extends Record<string, unknown>>(shape: { [K in keyof T]: ZodSchema<T[K]> }): ZodObjectSchema<T>
  array<T>(schema: ZodSchema<T>): ZodSchema<T[]>
  string(): ZodStringSchema
  number(): ZodNumberSchema
  boolean(): ZodBooleanSchema
  unknown(): ZodSchema<unknown>
  literal<T extends string | number | boolean | null>(value: T): ZodSchema<T>
  enum<T extends readonly [string, ...string[]]>(values: T): ZodSchema<T[number]>
  union<T extends readonly [ZodSchema<unknown>, ...ZodSchema<unknown>[]]>(schemas: T): ZodSchema<unknown>
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
  title: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
}

interface ScriptPromptApi {
  /** Ask the user for a text value and return it, or null if they cancel. */
  text(options: ScriptPromptTextOptions): Promise<string | null>
}

declare const console: ScriptConsoleApi
declare const env: ScriptEnvironmentApi
declare const scope: ScriptRequestScopeApi
declare const request: ScriptRequestApi
declare const crypto: ScriptCryptoApi
declare const z: ZodApi
`

const scriptToastDeclarations = String.raw`
declare const toast: ScriptToastApi
`

const scriptPromptDeclarations = String.raw`
declare const prompt: ScriptPromptApi
`

const postRequestDeclarations = String.raw`
interface ScriptResponseApi {
  /** Numeric HTTP status code. */
  status: number
  /** HTTP status text. */
  statusText: string
  /** Parsed response headers. */
  headers: Record<string, string>
  /** Parsed response body. */
  body: ScriptResponseBody
}

declare const response: ScriptResponseApi
`

const responseVisualizerDeclarations = String.raw`
type SetStateAction<T> = T | ((previousState: T) => T)
type Dispatch<T> = (value: T) => void
type DependencyList = readonly unknown[]

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
declare function Table(props: TableProps): unknown
`

export function getScriptRuntimeDeclarations(phase: ScriptAutocompletePhase) {
  if (phase === 'pre-request') {
    return `${sharedDeclarations}
${scriptToastDeclarations}
${scriptPromptDeclarations}`
  }

  if (phase === 'response-visualizer') {
    return `${sharedDeclarations}\n${postRequestDeclarations}\n${responseVisualizerDeclarations}`
  }

  return `${sharedDeclarations}\n${scriptToastDeclarations}\n${scriptPromptDeclarations}\n${postRequestDeclarations}`
}
