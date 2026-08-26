import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { DEFAULT_APP_SETTINGS_TLS_VERIFICATION_MODE } from '../common/AppSettings.js'
import type { AppSettingsTlsVerificationMode } from '../common/AppSettings.js'
import type {
  FetchMcpIntrospectionInput,
  FetchMcpIntrospectionResponse,
  InvokeMcpRequestInput,
  McpPromptSummary,
  McpResourceSummary,
  McpToolSummary,
  SendRequestResponse,
} from '../common/Requests.js'
import { Result } from '../common/Result.js'
import { getAppSettings } from './db/app-settings.js'
import { getFolderAncestorChain } from './db/folders.js'
import { getRequestParentFolderId } from './db/explorer.js'
import { getTlsDispatcher, resolveEffectiveTlsVerificationMode } from './tls-runtime.js'

export async function fetchMcpIntrospection(
  input: FetchMcpIntrospectionInput
): Promise<GenericResult<FetchMcpIntrospectionResponse>> {
  const connection = await createMcpConnection(input)
  if (!connection.success) {
    return connection
  }

  const client = new Client({ name: 'kova', version: '1.0.0' })
  const transport = connection.data.transport

  try {
    await client.connect(transport)

    const capabilities = client.getServerCapabilities()
    const [tools, resources, prompts] = await Promise.all([
      loadTools(client, Boolean(capabilities?.tools)),
      loadResources(client, Boolean(capabilities?.resources)),
      loadPrompts(client, Boolean(capabilities?.prompts)),
    ])

    const introspection = {
      server: {
        name: client.getServerVersion()?.name ?? null,
        version: client.getServerVersion()?.version ?? null,
      },
      capabilities: capabilities ?? null,
      tools,
      resources,
      prompts,
    }

    return Result.Success({
      serverName: introspection.server.name,
      serverVersion: introspection.server.version,
      tools,
      resources,
      prompts,
      introspection: JSON.stringify(introspection, null, 2),
    })
  } catch (error) {
    return GenericError.Message(error instanceof Error ? error.message : String(error))
  } finally {
    await transport.close().catch(() => undefined)
  }
}

export async function invokeMcpRequest(input: InvokeMcpRequestInput): Promise<GenericResult<SendRequestResponse>> {
  const connection = await createMcpConnection(input)
  if (!connection.success) {
    return connection
  }

  const trimmedToolName = input.toolName.trim()
  if (!trimmedToolName) {
    return GenericError.Message('Select an MCP tool to invoke')
  }

  let parsedArguments: Record<string, unknown>
  const trimmedArgumentsJson = input.argumentsJson.trim()
  if (!trimmedArgumentsJson) {
    parsedArguments = {}
  } else {
    try {
      const parsed = JSON.parse(trimmedArgumentsJson) as unknown
      if (!isRecord(parsed)) {
        return GenericError.Message('MCP tool arguments must be a JSON object')
      }
      parsedArguments = parsed
    } catch {
      return GenericError.Message('MCP tool arguments must be valid JSON')
    }
  }

  const client = new Client({ name: 'kova', version: '1.0.0' })
  const transport = connection.data.transport
  const startedAt = Date.now()

  try {
    await client.connect(transport)
    const result = await client.callTool({
      name: trimmedToolName,
      arguments: parsedArguments,
    })
    const durationMs = Date.now() - startedAt
    const responseBody = JSON.stringify(result, null, 2)
    const status = result.isError ? 400 : 200
    const statusText = result.isError ? 'MCP Tool Error' : 'MCP Tool Result'
    const headers = 'content-type: application/json\nx-kova-response-kind: mcp-tool'
    const receivedAt = startedAt + durationMs

    return Result.Success({
      status,
      statusText,
      headers,
      body: responseBody,
      durationMs,
      requestScope: {},
      scriptErrors: [],
      testRun: null,
      updatedEnvironments: [],
      consoleEntries: [],
      execution: {
        itemType: 'http',
        id: crypto.randomUUID(),
        requestId: input.requestId,
        requestName: trimmedToolName,
        request: {
          requestId: input.requestId,
          requestName: trimmedToolName,
          method: 'POST',
          url: connection.data.serverUrl.toString(),
          headers: connection.data.requestHeaders,
          body: trimmedArgumentsJson,
          variables: {},
          bodyType: 'raw',
          rawType: 'json',
          graphqlQuery: '',
          graphqlVariables: '',
          sentAt: startedAt,
        },
        response: {
          status,
          statusText,
          headers,
          body: responseBody,
          bodyOmitted: false,
          durationMs,
          receivedAt,
        },
        responseError: result.isError ? responseBody : null,
        scriptErrors: [],
        testRun: null,
        consoleEntries: [],
      },
    })
  } catch (error) {
    return GenericError.Message(error instanceof Error ? error.message : String(error))
  } finally {
    await transport.close().catch(() => undefined)
  }
}

async function createMcpConnection(input: {
  requestId: string
  transport: FetchMcpIntrospectionInput['transport']
  serverUrl: string
  accessToken: string | undefined
  tlsVerificationMode: FetchMcpIntrospectionInput['tlsVerificationMode']
}) {
  if (input.transport !== 'http') {
    return GenericError.Message('Only HTTP MCP transport is supported right now')
  }

  const trimmedServerUrl = input.serverUrl.trim()
  if (!trimmedServerUrl) {
    return GenericError.Message('MCP server URL is required')
  }

  let serverUrl: URL
  try {
    serverUrl = new URL(trimmedServerUrl)
  } catch {
    return GenericError.Message('MCP server URL is invalid')
  }

  const authToken = input.accessToken?.trim() ?? ''
  const requestHeaders = authToken ? `Authorization: Bearer ${authToken}` : ''
  const appSettingsMode: AppSettingsTlsVerificationMode = await getAppSettings()
    .then(settings => settings.tlsVerificationMode)
    .catch(() => DEFAULT_APP_SETTINGS_TLS_VERIFICATION_MODE)
  const folderModes = await getRequestParentFolderId(input.requestId)
    .then(folderId => getFolderAncestorChain(folderId))
    .then(folders => folders.map(folder => folder.tlsVerificationMode ?? 'inherit'))
    .catch(() => [])
  const dispatcher = getTlsDispatcher(
    serverUrl.toString(),
    resolveEffectiveTlsVerificationMode({
      requestMode: input.tlsVerificationMode,
      folderModes,
      appSettingsMode,
    })
  )
  const requestInit = {
    ...(authToken
      ? {
          headers: {
            Authorization: `Bearer ${authToken}`,
          },
        }
      : null),
    ...(dispatcher ? { dispatcher } : null),
  }

  return Result.Success({
    serverUrl,
    requestHeaders,
    transport: new StreamableHTTPClientTransport(serverUrl, {
      requestInit: Object.keys(requestInit).length > 0 ? requestInit : undefined,
    }),
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function loadTools(client: Client, supported: boolean): Promise<McpToolSummary[]> {
  if (!supported) {
    return []
  }

  try {
    const result = await client.listTools()
    return result.tools.map(tool => ({
      name: tool.name,
      description: tool.description ?? '',
      inputSchema: tool.inputSchema ?? null,
    }))
  } catch {
    return []
  }
}

async function loadResources(client: Client, supported: boolean): Promise<McpResourceSummary[]> {
  if (!supported) {
    return []
  }

  try {
    const result = await client.listResources()
    return result.resources.map(resource => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description ?? '',
      mimeType: resource.mimeType ?? null,
    }))
  } catch {
    return []
  }
}

async function loadPrompts(client: Client, supported: boolean): Promise<McpPromptSummary[]> {
  if (!supported) {
    return []
  }

  try {
    const result = await client.listPrompts()
    return result.prompts.map(prompt => ({
      name: prompt.name,
      description: prompt.description ?? '',
      arguments: (prompt.arguments ?? []).map(argument => ({
        name: argument.name,
        description: argument.description ?? '',
        required: argument.required ?? false,
      })),
    }))
  } catch {
    return []
  }
}
