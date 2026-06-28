import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import { SHARED_SCRIPT_KINDS, SHARED_SCRIPT_SCOPE_TYPES, SHARED_SCRIPT_TARGETS } from '../../common/SharedScripts.js'
import { listSharedScripts, listVisibleSharedScripts } from '../db/shared-scripts.js'
import type { ManagementAgentMcpContext } from './context.js'

const sharedScriptScopeTypeSchema = z.enum(SHARED_SCRIPT_SCOPE_TYPES)
const sharedScriptTargetSchema = z.enum(SHARED_SCRIPT_TARGETS)
const sharedScriptKindSchema = z.enum(SHARED_SCRIPT_KINDS)

export function registerSharedScriptTools(server: McpServer, context: ManagementAgentMcpContext) {
  server.registerTool(
    'list_shared_scripts',
    {
      description: 'List shared scripts for a specific workspace or folder scope.',
      inputSchema: {
        scopeType: sharedScriptScopeTypeSchema,
        scopeId: z.string().trim().min(1).nullable(),
      },
    },
    async ({ scopeType, scopeId }) => {
      context.requireSession()
      return context.toToolResult({ sharedScripts: await listSharedScripts({ scopeType, scopeId }) })
    }
  )

  server.registerTool(
    'list_visible_shared_scripts',
    {
      description: 'List workspace and ancestor-folder shared scripts visible from a folder context.',
      inputSchema: {
        folderId: z.string().trim().min(1).nullable().describe('Folder ID to evaluate visibility from, or null for workspace root.'),
        target: sharedScriptTargetSchema.optional(),
        onlyActive: z.boolean().optional(),
        kind: sharedScriptKindSchema.optional(),
      },
    },
    async ({ folderId, target, onlyActive, kind }) => {
      context.requireSession()
      return context.toToolResult({ sharedScripts: await listVisibleSharedScripts({ folderId, target, onlyActive, kind }) })
    }
  )
}
