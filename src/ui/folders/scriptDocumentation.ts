import type { ScriptAiPhase } from '@common/ScriptAi'

export type ScriptDocumentationPhase = ScriptAiPhase

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
  description:
    'The script VM includes standard JavaScript globals, so common language APIs are available without extra setup.',
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
      {
        label: 'env.set(name, value, environmentName?)',
        detail: 'Updates an existing variable or creates it in the active environment.',
      },
    ],
  },
  {
    title: 'Request Scope',
    description: 'Share values between scripts during a single request execution.',
    entries: [
      { label: 'scope.get(name)', detail: 'Returns a request-scoped value or null.' },
      { label: 'scope.has(name)', detail: 'Checks whether a request-scoped value exists.' },
      {
        label: 'scope.set(name, value)',
        detail: 'Stores a request-scoped value for later scripts in the same execution.',
      },
    ],
  },
  {
    title: 'Request Object',
    description: 'Inspect and change the outgoing request before or after execution.',
    entries: [
      { label: 'request.method', detail: 'HTTP method.' },
      { label: 'request.url', detail: 'Draft request URL exactly as typed or mutated in the script.' },
      {
        label: 'request.resolveUrl()',
        detail:
          'Returns the resolved URL after variables, path params, search params, and auth query params are applied.',
      },
      {
        label: 'request.pathParams',
        detail:
          'Path params as mutable JSON rows: [{ key, value, enabled, description }]. You can edit rows in place or assign a new array.',
      },
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
    title: 'Request Metadata',
    description: 'Inspect how the current request runtime was started.',
    entries: [
      { label: 'requestMetadata.isRetry', detail: 'True when the current execution was triggered by retryRequest from a previous UI send.' },
      { label: 'requestMetadata.retryCount', detail: 'The number of retry hops that led to this execution.' },
      { label: 'requestMetadata.currentRuntime', detail: 'The current runtime phase: pre-request, post-request, or template-expression.' },
      { label: 'requestMetadata.sourceRuntime', detail: 'The source that started this execution, such as request-editor or call-request.' },
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
    title: 'Toast Notifications',
    description: 'Show or hide app toasts from pre-request and post-request scripts.',
    entries: [
      {
        label: 'toast.show({ severity, title?, message?, timeout?, location?, id? })',
        detail: 'Shows a toast in the current window and returns its id.',
      },
      { label: 'toast.hide(id)', detail: 'Hides a previously shown toast by id.' },
    ],
  },
  {
    title: 'User Prompt',
    description: 'Ask the current user for a text value during script execution.',
    entries: [
      {
        label:
          'await prompt.text({ title, message?, defaultValue?, placeholder?, confirmText?, cancelText?, required? })',
        detail:
          'Shows a prompt dialog and resolves to the entered text or null when cancelled. When required is true, cancelling or submitting a blank value throws an error.',
      },
    ],
  },
  {
    title: 'Clipboard',
    description: 'Write values to the system clipboard from pre-request and post-request scripts.',
    entries: [{ label: 'clipboard.write(value)', detail: 'Writes a string value to the system clipboard.' }],
  },
  {
    title: 'Cookies',
    description: 'Parse and rewrite Set-Cookie header values.',
    entries: [
      { label: 'cookies.parse(value)', detail: 'Parses one or more Set-Cookie header values into cookie objects.' },
      { label: 'cookies.stringify(cookies)', detail: 'Serializes cookie objects into a Set-Cookie header value.' },
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
    { label: 'response.headers.get(name)', detail: 'Read a response header value.' },
    { label: 'response.headers.set(name, value)', detail: 'Add or replace a response header.' },
    { label: 'response.headers.delete(name)', detail: 'Remove a response header.' },
    { label: 'response.headers.has(name)', detail: 'Check whether a response header exists.' },
    { label: 'response.headers.entries()', detail: 'Return response headers as key/value pairs.' },
    { label: 'response.headers.toObject()', detail: 'Return response headers as an object.' },
    { label: 'response.hasCookies()', detail: 'Check whether the response currently has any Set-Cookie headers.' },
    { label: 'response.parseCookies()', detail: 'Parse all current Set-Cookie response headers.' },
    { label: 'response.body.type', detail: 'Either json or text.' },
    { label: 'response.body.data', detail: 'Parsed JSON value or raw text body.' },
  ],
}

const callRequestSection: ScriptDocumentationSection = {
  title: 'callRequest',
  description: 'Available in pre-request and post-request scripts.',
  entries: [
    {
      label: "const authResponse = await callRequest(['Auth', 'Refresh Token'])",
      detail:
        'Sends the target HTTP request in place and returns its response without navigating away from the current request.',
    },
    {
      label: "await callRequest(['Auth', 'Refresh Token'], { url: 'https://api.example.com/refresh', headers: {}, body: undefined })",
      detail:
        'Omitted fields keep the prepared request. Present fields replace the outbound method, URL, header set, or body just before send.',
    },
  ],
}

const navigateAndCallRequestSection: ScriptDocumentationSection = {
  title: 'navigateAndCallRequest',
  description: 'Available only in post-request scripts.',
  entries: [
    {
      label: "await navigateAndCallRequest(['Folder', 'Request Name'])",
      detail:
        'Switches the UI to the target HTTP request and sends it. The path starts at the workspace root and ends with the request name.',
    },
  ],
}

const retryRequestSection: ScriptDocumentationSection = {
  title: 'retryRequest',
  description: 'Available only in post-request scripts.',
  entries: [
    {
      label: 'retryRequest()',
      detail:
        'Stops the current post-request script immediately, completes the current request normally, then asks the frontend to send the same request again with a fresh runtime scope. Only request-editor executions are retried; script-triggered executions such as callRequest do not retry.',
    },
  ],
}

export const scriptDocumentationByPhase: Record<ScriptDocumentationPhase, ScriptDocumentation> = {
  'pre-request': {
    title: 'Pre-request Script Docs',
    description:
      'Pre-request scripts run before the request is sent, so they are ideal for preparing headers, URLs, variables, and body content.',
    notes: [
      'Scripts run in an async sandbox, so you can use await.',
      'Each script has a 500ms execution timeout.',
      'Response data is not available in pre-request scripts.',
      'Zod is available globally as z.',
    ],
    sections: [...sharedSections, callRequestSection],
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
        title: 'Fill a path param from the environment',
        code: "const userId = env.get('userId')\nif (userId) {\n  const userRow = request.pathParams.find(row => row.key === 'userId')\n  if (userRow) {\n    userRow.value = userId\n  }\n  console.info(request.resolveUrl())\n}",
      },
      {
        title: 'Validate required config',
        code: "const ConfigSchema = z.object({\n  apiHost: z.string(),\n  token: z.string(),\n})\n\nconst parsed = ConfigSchema.safeParse({\n  apiHost: env.get('apiHost'),\n  token: env.get('token'),\n})\n\nif (!parsed.success) {\n  throw new Error(parsed.error.message)\n}",
      },
      {
        title: 'Show a setup warning',
        code: "if (!env.get('token')) {\n  toast.show({\n    severity: 'warning',\n    title: 'Missing token',\n    message: 'Set the token environment variable before sending this request.',\n    timeout: 4000,\n  })\n}",
      },
      {
        title: 'Ask before using an ad-hoc value',
        code: "if (!env.get('userId')) {\n  const userId = await prompt.text({\n    title: 'User id required',\n    message: 'Enter the user id to send with this request.',\n    placeholder: '42',\n    confirmText: 'Use value',\n    required: true,\n  })\n\n  if (userId) {\n    scope.set('userId', userId)\n  }\n}",
      },
      {
        title: 'Copy the resolved URL',
        code: 'clipboard.write(request.resolveUrl())',
      },
      {
        title: 'Refresh a token before sending',
        code:
          "const refreshResponse = await callRequest(['Auth', 'Refresh Token'], { headers: {} })\nif (refreshResponse.status !== 200) {\n  throw new Error('Could not refresh token')\n}",
      },
    ],
  },
  'post-request': {
    title: 'Post-request Script Docs',
    description:
      'Post-request scripts run after the response is received, so they are useful for inspecting results, saving values, and logging request outcomes.',
    notes: [
      'Scripts run in an async sandbox, so you can use await.',
      'Each script has a 500ms execution timeout.',
      'Environment changes made here are rolled back if the script throws.',
      'Zod is available globally as z.',
    ],
    sections: [...sharedSections, responseSection, callRequestSection, navigateAndCallRequestSection, retryRequestSection],
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
        title: 'Remove a cookie before persistence',
        code: "if (response.hasCookies()) {\n  const filtered = response.parseCookies().filter(cookie => cookie.name !== 'cookiesession1')\n  response.headers.set('set-cookie', cookies.stringify(filtered))\n}",
      },
      {
        title: 'Measure roundtrip flow',
        code: "const startedAt = scope.get('startedAt')\nif (startedAt) {\n  console.info('Elapsed', Date.now() - Number(startedAt), 'ms')\n}",
      },
      {
        title: 'Validate response shape',
        code: "const TokenResponse = z.object({\n  token: z.string(),\n})\n\nif (response.body.type === 'json') {\n  const parsed = TokenResponse.safeParse(response.body.data)\n  if (parsed.success) {\n    env.set('token', parsed.data.token)\n  }\n}",
      },
      {
        title: 'Show and dismiss a progress toast',
        code: "const toastId = scope.get('requestToastId')\n\nif (response.status >= 400) {\n  if (toastId) {\n    toast.hide(toastId)\n  }\n\n  toast.show({\n    severity: 'error',\n    title: 'Request failed',\n    message: response.status + ' ' + response.statusText,\n  })\n} else if (toastId) {\n  toast.hide(toastId)\n}",
      },
      {
        title: 'Ask whether to persist a value',
        code: "if (response.body.type === 'json') {\n  const token = typeof response.body.data === 'object' && response.body.data !== null ? Reflect.get(response.body.data, 'token') : null\n\n  if (typeof token === 'string') {\n    const environmentName = await prompt.text({\n      title: 'Save token',\n      message: 'Enter an environment name to store the token, or cancel to skip.',\n      placeholder: 'Default',\n      confirmText: 'Save',\n      cancelText: 'Skip',\n    })\n\n    if (environmentName) {\n      env.set('token', token, environmentName)\n    }\n  }\n}",
      },
      {
        title: 'Trigger a follow-up request',
        code: "if (response.status === 401) {\n  await navigateAndCallRequest(['Auth', 'Refresh Token'])\n}",
      },
      {
        title: 'Call a request and inspect its response',
        code: "if (response.status === 401) {\n  const refreshResponse = await callRequest(['Auth', 'Refresh Token'])\n  if (refreshResponse.status === 200) {\n    console.info('Token refreshed')\n  }\n}",
      },
      {
        title: 'Retry the same request after refresh',
        code:
          "if (!requestMetadata.isRetry && response.status === 401) {\n  const refreshResponse = await callRequest(['Auth', 'Refresh Token'])\n  if (refreshResponse.status === 200) {\n    retryRequest()\n  }\n}",
      },
      {
        title: 'Copy a token from the response',
        code: "if (response.body.type === 'json') {\n  const token = typeof response.body.data === 'object' && response.body.data !== null ? Reflect.get(response.body.data, 'token') : null\n  if (typeof token === 'string') {\n    clipboard.write(token)\n  }\n}",
      },
    ],
  },
  'response-visualizer': {
    title: 'Response Visualizer Docs',
    description:
      'Response visualizers run in a sandboxed iframe as TSX modules and render custom JSX in the response pane.',
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
          { label: 'response?.headers.get(name)', detail: 'Read a response header value.' },
          { label: 'response?.headers.set(name, value)', detail: 'Add or replace a response header.' },
          { label: 'response?.headers.delete(name)', detail: 'Remove a response header.' },
          { label: 'response?.hasCookies()', detail: 'Check whether the response currently has any Set-Cookie headers.' },
          { label: 'response?.parseCookies()', detail: 'Parse all current Set-Cookie response headers.' },
          { label: 'cookies.parse(value)', detail: 'Parse one or more Set-Cookie header values.' },
          { label: 'cookies.stringify(cookies)', detail: 'Serialize cookie objects into a Set-Cookie header value.' },
          { label: 'response?.body.type', detail: 'Either json or text.' },
          { label: 'response?.body.data', detail: 'Parsed JSON value or raw text body.' },
          { label: 'env.get(name, environmentName?)', detail: 'Read an environment value.' },
          { label: 'scope.get(name)', detail: 'Read a request-scoped value.' },
          { label: 'request.headers.get(name)', detail: 'Read a request header value.' },
          { label: 'request.resolveUrl()', detail: 'Read the fully resolved request URL.' },
          { label: 'request.pathParams', detail: 'Read or mutate request path params as JSON rows.' },
          { label: 'z.object(shape)', detail: 'Validate complex response payloads.' },
          { label: 'formatXml(xml)', detail: 'Pretty-print XML strings before rendering or viewing them.' },
          {
            label: 'formatJson(json, indentation?)',
            detail: 'Pretty-print JSON strings before rendering or viewing them.',
          },
          { label: '<Table list={rows} />', detail: 'Render an inferred table from an array of objects.' },
          { label: '<CodeEditor ... />', detail: 'Render the shared editor component inside the visualizer.' },
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
      {
        title: 'CodeEditor Props',
        description:
          'The visualizer runtime exposes the same CodeEditor component used elsewhere in the app, except custom extensions are not supported here.',
        entries: [
          { label: 'value', detail: 'Editor content string.' },
          {
            label: "language: 'plain' | 'json' | 'json5' | 'javascript' | 'jsx' | 'html' | 'css' | 'xml'",
            detail: 'Syntax highlighting mode.',
          },
          { label: 'onChange(value, params)', detail: 'Receive content updates and caret metadata.' },
          { label: 'readOnly', detail: 'Disable editing for inspector-style viewers.' },
          { label: 'showLineNumbers', detail: 'Show the line number gutter.' },
          { label: 'showFoldGutter', detail: 'Show fold controls for foldable languages.' },
          { label: 'placeholder', detail: 'Placeholder text shown when the editor is empty.' },
          { label: 'singleLine', detail: 'Restrict the editor to a single line.' },
          { label: 'compact', detail: 'Use compact vertical spacing.' },
          { label: "size: 'normal' | 'small'", detail: 'Switch between regular and compact font sizing.' },
          { label: 'scale', detail: 'Multiply the editor font size and line height by this value.' },
          { label: 'hideFocusOutline', detail: 'Suppress the focus outline.' },
          { label: 'minHeightClassName', detail: 'Apply a Tailwind min-height class to the outer wrapper.' },
          { label: 'className', detail: 'Apply custom classes to the outer wrapper.' },
          { label: 'linePaddingOverride', detail: 'Override per-line padding.' },
          { label: 'vimMode', detail: 'Enable or disable Vim mode for this editor instance.' },
          { label: 'refreshKey', detail: 'Force a lightweight editor refresh when the key changes.' },
          { label: 'initialSelection', detail: 'Set the initial selection using anchor/head offsets.' },
          { label: 'onSelectionChange(selection)', detail: 'Observe selection updates.' },
          { label: 'onPasteText(params)', detail: 'Intercept plain-text paste handling.' },
          { label: 'onBlur()', detail: 'Run logic when the editor loses focus.' },
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
      {
        title: 'Render response body in CodeEditor',
        code: "export default function ResponseBodyEditor() {\n  const value = response?.body.type === 'json'\n    ? JSON.stringify(response.body.data, null, 2)\n    : response?.body.data ?? ''\n\n  return (\n    <CodeEditor\n      value={value}\n      language={response?.body.type === 'json' ? 'json' : 'plain'}\n      readOnly\n      showLineNumbers\n      minHeightClassName=\"min-h-[320px]\"\n    />\n  )\n}",
      },
      {
        title: 'Format XML response body',
        code: 'export default function XmlViewer() {\n  if (response?.body.type !== \'text\') {\n    return <div>No XML body</div>\n  }\n\n  try {\n    return (\n      <CodeEditor\n        value={formatXml(response.body.data)}\n        language="xml"\n        readOnly\n        showLineNumbers\n        minHeightClassName="min-h-[320px]"\n      />\n    )\n  } catch {\n    return <pre>{response.body.data}</pre>\n  }\n}',
      },
      {
        title: 'Editable scratchpad with CodeEditor',
        code: "export default function Scratchpad() {\n  const initialValue = response?.body.type === 'json'\n    ? JSON.stringify(response.body.data, null, 2)\n    : response?.body.data ?? ''\n  const [value, setValue] = useState(initialValue)\n\n  return (\n    <div style={{ display: 'grid', gap: 12 }}>\n      <CodeEditor\n        value={value}\n        language=\"json\"\n        minHeightClassName=\"min-h-[240px]\"\n        onChange={nextValue => setValue(nextValue)}\n      />\n      <div style={{ fontSize: 12, opacity: 0.7 }}>Chars: {value.length}</div>\n    </div>\n  )\n}",
      },
    ],
  },
  'view-runtime': {
    title: 'View Runtime Docs',
    description:
      'Views run in a sandboxed iframe as TSX modules and are designed for building multi-request flows with reusable React UI.',
    notes: [
      'Write normal module code and export default a component function.',
      'The runtime includes React hooks, env, scope, console, crypto, clipboard, cookies, z, Table, and CodeEditor.',
      'Use callRequest to execute saved HTTP requests from the workspace without navigating away from the view pane.',
      'The runtime does not expose request or response globals. Build your own state around callRequest results.',
      'Tailwind utility classes can be used in view runtime components, in addition to inline styles.',
    ],
    sections: [
      {
        title: 'Input',
        description: 'Your view module reads and updates runtime globals directly.',
        entries: [
          { label: "await callRequest(['Auth', 'Refresh Token'])", detail: 'Run another saved HTTP request and receive a script response object.' },
          { label: 'env.get(name, environmentName?)', detail: 'Read an environment value.' },
          { label: 'env.set(name, value, environmentName?)', detail: 'Update an environment value from the running view.' },
          { label: 'scope.get(name)', detail: 'Read a view-scoped value from the current run.' },
          { label: 'scope.set(name, value)', detail: 'Persist a string value within the current run.' },
          { label: 'cookies.parse(value)', detail: 'Parse Set-Cookie header values returned from callRequest.' },
          { label: 'cookies.stringify(cookies)', detail: 'Serialize cookie objects back into a Set-Cookie string.' },
          { label: 'formatXml(xml)', detail: 'Pretty-print XML strings before rendering them.' },
          { label: 'formatJson(json, indentation?)', detail: 'Pretty-print JSON strings before rendering them.' },
          { label: '<Table list={rows} />', detail: 'Render an inferred table from an array of objects.' },
          { label: '<CodeEditor ... />', detail: 'Render the shared editor component inside the running view.' },
        ],
      },
      {
        title: 'Module Format',
        description: 'Views are plain TSX modules with a default export component.',
        entries: [
          { label: 'export default function View() { ... }', detail: 'Preferred view shape.' },
          { label: 'const Helper = (...) => ...', detail: 'Create local helpers and child components freely.' },
          { label: 'useState / useEffect / useReducer', detail: 'Build richer stateful flows using normal React hooks.' },
          { label: 'style={{ ... }}', detail: 'Apply inline styles because the sandbox does not inherit app CSS.' },
        ],
      },
    ],
    examples: [
      {
        title: 'Run a request from a button',
        code: "export default function View() {\n  const [status, setStatus] = useState('idle')\n\n  async function load() {\n    setStatus('loading')\n    const response = await callRequest(['Folder', 'Request Name'])\n    setStatus(response.status + ' ' + response.statusText)\n  }\n\n  return <button onClick={load}>{status}</button>\n}",
      },
      {
        title: 'Display JSON in a table',
        code: "export default function UsersView() {\n  const [rows, setRows] = useState<unknown[]>([])\n\n  async function load() {\n    const response = await callRequest(['Users', 'List'])\n    if (response.body.type === 'json' && Array.isArray(response.body.data)) {\n      setRows(response.body.data)\n    }\n  }\n\n  useEffect(() => {\n    void load()\n  }, [])\n\n  return <Table list={rows} />\n}",
      },
      {
        title: 'Use remembered flow state',
        code: "export default function FlowView() {\n  const [token, setToken] = useState(scope.get('token') ?? '')\n\n  async function authenticate() {\n    const response = await callRequest(['Auth', 'Refresh Token'])\n    if (response.body.type === 'json') {\n      const nextToken = typeof response.body.data === 'object' && response.body.data !== null ? Reflect.get(response.body.data, 'token') : null\n      if (typeof nextToken === 'string') {\n        scope.set('token', nextToken)\n        setToken(nextToken)\n      }\n    }\n  }\n\n  return <div>{token || 'No token yet'}</div>\n}",
      },
    ],
  },
}

export function buildScriptDocumentationPrompt(phase: ScriptDocumentationPhase) {
  const documentation = scriptDocumentationByPhase[phase]

  return [
    `${documentation.title}`,
    documentation.description,
    '',
    'Notes:',
    ...documentation.notes.map(note => `- ${note}`),
    '',
    ...documentation.sections.flatMap(section => [
      `${section.title}:`,
      ...(section.description ? [section.description] : []),
      ...section.entries.map(entry => `- ${entry.label}: ${entry.detail}`),
      '',
    ]),
    'Examples:',
    ...documentation.examples.flatMap(example => [example.title, example.code, '']),
  ]
    .join('\n')
    .trim()
}
