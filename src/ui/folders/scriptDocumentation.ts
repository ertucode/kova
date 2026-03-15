export type ScriptDocumentationPhase = 'pre-request' | 'post-request'

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
    ],
  },
  'post-request': {
    title: 'Post-request Script Docs',
    description: 'Post-request scripts run after the response is received, so they are useful for inspecting results, saving values, and logging request outcomes.',
    notes: [
      'Scripts run in an async sandbox, so you can use await.',
      'Each script has a 500ms execution timeout.',
      'Environment changes made here are rolled back if the script throws.',
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
    ],
  },
}
