import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { createManagementAgentMcpContext } from './management-agent-mcp/context.js'
import { registerDraftTools } from './management-agent-mcp/draft-tools.js'
import { registerExplorerTools } from './management-agent-mcp/explorer-tools.js'
import { registerHistoryTools } from './management-agent-mcp/history-tools.js'
import { registerSharedScriptTools } from './management-agent-mcp/shared-script-tools.js'
import { registerTagTools } from './management-agent-mcp/tag-tools.js'

export const MANAGEMENT_AGENT_MCP_SERVER_NAME = 'kova_management_agent'

type ManagementAgentMcpServer = {
  url: string
  token: string
  close(): Promise<void>
}

const MCP_PATHNAME = '/mcp'

export async function startManagementAgentMcpServer(): Promise<ManagementAgentMcpServer> {
  const token = randomBytes(24).toString('hex')
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${token}`) {
        writeJson(response, 401, { error: 'Unauthorized' })
        return
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (url.pathname !== MCP_PATHNAME) {
        writeJson(response, 404, { error: 'Not found' })
        return
      }

      if (request.method !== 'POST') {
        writeJsonRpcError(response, 405, 'Method not allowed.')
        return
      }

      const boundSessionId = url.searchParams.get('sessionId')?.trim() || null
      const mcpServer = createManagementAgentMcpServer(boundSessionId)
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
      const dispose = () => {
        void transport.close().catch(() => undefined)
        void mcpServer.close().catch(() => undefined)
      }

      response.once('close', dispose)
      await mcpServer.connect(transport)
      await transport.handleRequest(request, response)
    } catch (error) {
      writeJsonRpcError(response, 500, error instanceof Error ? error.message : String(error))
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Management agent MCP server did not expose a TCP port.')
  }

  if (process.env.NODE_ENV === 'development') {
    console.info('[management-agent-mcp] listening', {
      url: `http://127.0.0.1:${String(address.port)}${MCP_PATHNAME}`,
      token,
    })
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}${MCP_PATHNAME}`,
    token,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    },
  }
}

function createManagementAgentMcpServer(boundSessionId: string | null) {
  const server = new McpServer({
    name: MANAGEMENT_AGENT_MCP_SERVER_NAME,
    version: '1.0.0',
  })

  const context = createManagementAgentMcpContext(boundSessionId)
  registerExplorerTools(server, context)
  registerSharedScriptTools(server, context)
  registerTagTools(server, context)
  registerDraftTools(server, context)
  registerHistoryTools(server, context)

  return server
}

function writeJson(response: ServerResponse<IncomingMessage>, statusCode: number, payload: Record<string, unknown>) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(payload)}\n`)
}

function writeJsonRpcError(response: ServerResponse<IncomingMessage>, statusCode: number, message: string) {
  writeJson(response, statusCode, {
    jsonrpc: '2.0',
    error: {
      code: -32000,
      message,
    },
    id: null,
  })
}
