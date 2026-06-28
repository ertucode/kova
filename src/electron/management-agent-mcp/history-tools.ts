import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { listAppliedManagementAgentPlans } from '../db/management-agent.js'
import type { ManagementAgentMcpContext } from './context.js'

export function registerHistoryTools(server: McpServer, context: ManagementAgentMcpContext) {
  server.registerTool(
    'list_applied_plans',
    {
      description: 'List previously applied plans for a session.',
      inputSchema: {},
    },
    async () => {
      context.requireSession()
      return context.toToolResult({ plans: listAppliedManagementAgentPlans(context.requireSessionId()) })
    }
  )
}
