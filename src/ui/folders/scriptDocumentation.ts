export type ScriptDocumentationPhase = 'pre-request' | 'post-request' | 'response-visualizer'

export type ScriptDocumentationEntry = {
  label: string
  detail: string
}

export type ScriptDocumentationSection = {
  title: string
  description?: string
  entries: ScriptDocumentationEntry[]
}

export type ScriptDocumentationExample = {
  title: string
  code: string
}

export type ScriptDocumentation = {
  title: string
  description: string
  notes: string[]
  sections: ScriptDocumentationSection[]
  examples: ScriptDocumentationExample[]
}

const builtInGlobalsSection: ScriptDocumentationSection = {
  title: 'Built-in Globals',
  description: 'The script VM includes standard JavaScript globals, so common language APIs are available without extra setup.',
  entries: [
    { label: 'Date.now()', detail: 'Returns the current timestamp in milliseconds.' },
    { label: 'new Date()', detail: 'Creates a standard JavaScript Date object.' },
    { label: 'Math.random()', detail: 'Returns a random number between 0 and 1.' },
    { label: 'JSON.parse(text)', detail: 'Parses JSON text.' },
    { label: 'crypto.randomUUID()', detail: 'Returns a UUID string.' },
  ],
}

const sharedSections: ScriptDocumentationSection[] = [
  builtInGlobalsSection,
  {
    title: 'Environment Variables',
    description: 'Read and update active environment values from scripts.',
    entries: [
      { label: 'env.get(name, environmentName?)', detail: 'Returns the effective value for a variable or null.' },
      { label: 'env.has(name, environmentName?)', detail: 'Checks whether a variable exists.' },
      { label: 'env.set(name, value, environmentName?)', detail: 'Updates an existing variable or creates it in the active environment.' },
    ],
  },
  {
    title: 'Request Scope',
    description: 'Share values between scripts during a single request execution.',
    entries: [
      { label: 'scope.get(name)', detail: 'Returns a request-scoped value or null.' },
      { label: 'scope.has(name)', detail: 'Checks whether a request-scoped value exists.' },
      { label: 'scope.set(name, value)', detail: 'Stores a request-scoped value for later scripts in the same execution.' },
    ],
  },
  {
    title: 'Request Object',
    description: 'Inspect and change the outgoing request before or after execution.',
    entries: [
      { label: 'request.method', detail: 'HTTP method.' },
      { label: 'request.url', detail: 'Full request URL.' },
      { label: 'request.body', detail: 'Request body string.' },
      { label: 'request.bodyType', detail: 'Current body mode.' },
      { label: 'request.rawType', detail: 'Current raw body format.' },
      { label: 'request.headers.get(name)', detail: 'Reads a header value.' },
      { label: 'request.headers.set(name, value)', detail: 'Adds or replaces a header.' },
      { label: 'request.headers.delete(name)', detail: 'Removes a header.' },
      { label: 'request.headers.has(name)', detail: 'Checks whether a header exists.' },
      { label: 'request.headers.entries()', detail: 'Returns enabled headers as key/value pairs.' },
      { label: 'request.headers.toObject()', detail: 'Returns enabled headers as an object.' },
    ],
  },
  {
    title: 'Console',
    description: 'Write logs to the request console output.',
    entries: [
      { label: 'console.log(...values)', detail: 'Logs a standard message.' },
      { label: 'console.info(...values)', detail: 'Logs an informational message.' },
      { label: 'console.warn(...values)', detail: 'Logs a warning.' },
      { label: 'console.error(...values)', detail: 'Logs an error.' },
      { label: 'console.debug(...values)', detail: 'Logs a debug message.' },
    ],
  },
  {
    title: 'Validation',
    description: 'Use Zod schemas to validate request and response data inside scripts.',
    entries: [
      { label: 'z.object(shape)', detail: 'Creates an object schema.' },
      { label: 'z.array(schema)', detail: 'Creates an array schema.' },
      { label: 'z.string()', detail: 'Creates a string schema.' },
      { label: 'z.number()', detail: 'Creates a number schema.' },
      { label: 'schema.safeParse(value)', detail: 'Validates without throwing and returns a success flag.' },
    ],
  },
]

const responseSection: ScriptDocumentationSection = {
  title: 'Response Object',
  description: 'Available only in post-request scripts.',
  entries: [
    { label: 'response.status', detail: 'Numeric status code.' },
    { label: 'response.statusText', detail: 'Response status text.' },
    { label: 'response.headers', detail: 'Response headers as an object.' },
    { label: 'response.body.type', detail: 'Either json or text.' },
    { label: 'response.body.data', detail: 'Parsed JSON value or raw text body.' },
  ],
}

export const scriptDocumentationByPhase: Record<ScriptDocumentationPhase, ScriptDocumentation> = {
  'pre-request': {
    title: 'Pre-request Script Docs',
    description: 'Pre-request scripts run before the request is sent, so they are ideal for preparing headers, URLs, variables, and body content.',
    notes: [
      'Scripts run in an async sandbox, so you can use await.',
      'Each script has a 500ms execution timeout.',
      'Response data is not available in pre-request scripts.',
      'Zod is available globally as z.',
    ],
    sections: sharedSections,
    examples: [
      {
        title: 'Set an auth header',
        code: "const token = env.get('token')\nif (token) {\n  request.headers.set('Authorization', `Bearer ${token}`)\n}",
      },
      {
        title: 'Pass data to later scripts',
        code: "scope.set('startedAt', String(Date.now()))\nrequest.headers.set('X-Trace-Id', crypto.randomUUID())",
      },
      {
        title: 'Switch base URL by environment',
        code: "const host = env.get('apiHost', 'Staging') ?? env.get('apiHost')\nif (host) {\n  request.url = `${host}/users`\n}",
      },
      {
        title: 'Validate required config',
        code: "const ConfigSchema = z.object({\n  apiHost: z.string(),\n  token: z.string(),\n})\n\nconst parsed = ConfigSchema.safeParse({\n  apiHost: env.get('apiHost'),\n  token: env.get('token'),\n})\n\nif (!parsed.success) {\n  throw new Error(parsed.error.message)\n}",
      },
    ],
  },
  'post-request': {
    title: 'Post-request Script Docs',
    description: 'Post-request scripts run after the response is received, so they are useful for inspecting results, saving values, and logging request outcomes.',
    notes: [
      'Scripts run in an async sandbox, so you can use await.',
      'Each script has a 500ms execution timeout.',
      'Environment changes made here are rolled back if the script throws.',
      'Zod is available globally as z.',
    ],
    sections: [...sharedSections, responseSection],
    examples: [
      {
        title: 'Persist a token from JSON',
        code: "if (response.body.type === 'json' && response.body.data && typeof response.body.data === 'object') {\n  const token = Reflect.get(response.body.data, 'token')\n  if (typeof token === 'string') {\n    env.set('token', token)\n  }\n}",
      },
      {
        title: 'Log failed requests',
        code: "if (response.status >= 400) {\n  console.error('Request failed', response.status, response.statusText)\n}",
      },
      {
        title: 'Measure roundtrip flow',
        code: "const startedAt = scope.get('startedAt')\nif (startedAt) {\n  console.info('Elapsed', Date.now() - Number(startedAt), 'ms')\n}",
      },
      {
        title: 'Validate response shape',
        code: "const TokenResponse = z.object({\n  token: z.string(),\n})\n\nif (response.body.type === 'json') {\n  const parsed = TokenResponse.safeParse(response.body.data)\n  if (parsed.success) {\n    env.set('token', parsed.data.token)\n  }\n}",
      },
    ],
  },
  'response-visualizer': {
    title: 'Response Visualizer Docs',
    description: 'Response visualizers run in a sandboxed iframe as TSX modules and render custom JSX in the response pane.',
    notes: [
      'Write normal module code and export default a component function.',
      'Use the same globals as post-request scripts: env, scope, request, response, console, crypto, and z.',
      'The response global is null until a response arrives.',
      'Use inline styles for custom presentation because the sandbox does not inherit app CSS.',
    ],
    sections: [
      {
        title: 'Input',
        description: 'Your visualizer module can read the runtime globals directly.',
        entries: [
          { label: 'response?.status', detail: 'Numeric status code.' },
          { label: 'response?.statusText', detail: 'Response status text.' },
          { label: 'response?.headers', detail: 'Parsed response headers as an object.' },
          { label: 'response?.body.type', detail: 'Either json or text.' },
          { label: 'response?.body.data', detail: 'Parsed JSON value or raw text body.' },
          { label: 'env.get(name, environmentName?)', detail: 'Read an environment value.' },
          { label: 'scope.get(name)', detail: 'Read a request-scoped value.' },
          { label: 'request.headers.get(name)', detail: 'Read a request header value.' },
          { label: 'z.object(shape)', detail: 'Validate complex response payloads.' },
          { label: '<Table list={rows} />', detail: 'Render an inferred table from an array of objects.' },
        ],
      },
      {
        title: 'Module Format',
        description: 'You can define helpers, local components, and constants before the default export.',
        entries: [
          { label: 'export default function View() { ... }', detail: 'Preferred visualizer shape.' },
          { label: 'const Helper = (...) => ...', detail: 'Create local helper functions and components freely.' },
          { label: '<div>...</div>', detail: 'Render regular HTML elements.' },
          { label: '<>...</>', detail: 'Group siblings with fragments.' },
          { label: 'style={{ ... }}', detail: 'Apply inline styles with a style object.' },
        ],
      },
    ],
    examples: [
      {
        title: 'Status card',
        code: "export default function StatusCard() {\n  return (\n    <div style={{ padding: 16, borderRadius: 16, background: '#fff', border: '1px solid #e2e8f0' }}>\n      <div style={{ fontSize: 12, opacity: 0.6 }}>Response</div>\n      <div style={{ fontSize: 28, fontWeight: 700 }}>{response?.status ?? '...'}</div>\n      <div>{response?.statusText ?? 'Waiting for response'}</div>\n    </div>\n  )\n}",
      },
      {
        title: 'Render JSON rows',
        code: "function Row({ label, value }) {\n  return (\n    <tr>\n      <td style={{ padding: '6px 12px 6px 0', fontWeight: 600 }}>{label}</td>\n      <td style={{ padding: '6px 0' }}>{value}</td>\n    </tr>\n  )\n}\n\nexport default function JsonRows() {\n  const data = response?.body.type === 'json' ? response.body.data : null\n  if (!data || typeof data !== 'object') {\n    return <div>No JSON body</div>\n  }\n\n  return (\n    <table>\n      <tbody>\n        {Object.entries(data).map(([key, value]) => (\n          <Row key={key} label={key} value={JSON.stringify(value)} />\n        ))}\n      </tbody>\n    </table>\n  )\n}",
      },
      {
        title: 'Validate before render',
        code: "const FundsSchema = z.object({\n  rawResponse: z.object({\n    fundBuyList: z.array(z.object({\n      fonAd: z.string(),\n      fonKodu: z.string(),\n    })),\n  }),\n})\n\nexport default function ValidatedVisualizer() {\n  const data = response?.body.type === 'json' ? response.body.data : null\n  const parsed = FundsSchema.safeParse(data)\n\n  if (!parsed.success) {\n    return <pre>{parsed.error.message}</pre>\n  }\n\n  return <div>{parsed.data.rawResponse.fundBuyList.length} fon</div>\n}",
      },
      {
        title: 'Use built-in Table helper',
        code: "export default function FundsTable() {\n  const data = response?.body.type === 'json' ? response.body.data : null\n  const list = Array.isArray((data as any)?.rawResponse?.fundBuyList) ? (data as any).rawResponse.fundBuyList : []\n\n  return <Table list={list} />\n}",
      },
    ],
  },
}
