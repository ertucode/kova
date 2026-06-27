import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { z } from 'zod'
import { AUTH_LOCATIONS } from '../common/Auth.js'
import type { ExplorerItem } from '../common/Explorer.js'
import { errorResponseToMessage, GenericError, type GenericResult } from '../common/GenericError.js'
import {
  createEmptyManagementAgentPlan,
  type ManagementAgentPlan,
  normalizeManagementAgentPlan,
  REQUEST_BODY_TYPES,
  REQUEST_METHODS,
  REQUEST_RAW_TYPES,
  RESPONSE_BODY_VIEWS,
} from '../common/ManagementAgent.js'
import { getRequest } from './db/requests.js'
import { listEnvironments } from './db/environments.js'
import { listExplorerItems } from './db/explorer.js'
import {
  clearCurrentManagementAgentDraftPlan,
  getCurrentManagementAgentDraftPlan,
  getManagementAgentSession,
  listAppliedManagementAgentPlans,
  setCurrentManagementAgentDraftPlan,
} from './db/management-agent.js'
import { listTagAssignments, listTags } from './db/tags.js'

export const MANAGEMENT_AGENT_MCP_SERVER_NAME = 'kova_management_agent'

type ManagementAgentMcpServer = {
  url: string
  token: string
  close(): Promise<void>
}

const MCP_PATHNAME = '/mcp'

const folderIdSchema = z.string().trim().min(1)
const nullableFolderIdSchema = folderIdSchema.nullable()
const parentScopeSchema = z.enum(['session-root', 'workspace-root']).optional()
const folderPathSchema = z.array(z.string().trim().min(1))
const explorerQuerySchema = z.string().trim().min(1)
const tagIdSchema = z.string().trim().min(1)
const tagNameSchema = z.string()
const tagColorSchema = z.string().trim().min(1).nullable()
const taggableItemTypeSchema = z.enum(['folder', 'request'])
const tagItemRefSchema = z.object({
  itemType: taggableItemTypeSchema,
  itemId: z.string().trim().min(1),
})
const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('inherit') }),
  z.object({ type: z.literal('noauth') }),
  z.object({
    type: z.literal('bearer'),
    token: z.string(),
    tokenRefreshRequestId: z.string().trim().min(1).optional(),
  }),
  z.object({
    type: z.literal('apikey'),
    key: z.string(),
    value: z.string(),
    addTo: z.enum(AUTH_LOCATIONS),
    tokenRefreshRequestId: z.string().trim().min(1).optional(),
  }),
  z.object({
    type: z.literal('basic'),
    username: z.string(),
    password: z.string(),
    tokenRefreshRequestId: z.string().trim().min(1).optional(),
  }),
])
const questionSchema = z.object({
  id: z.string().trim().min(1),
  label: z.string(),
  details: z.string(),
})
const warningSchema = z.object({
  id: z.string().trim().min(1),
  message: z.string(),
})
const folderPlanItemSchema = z.object({
  id: z.string().trim().min(1),
  parentFolderId: nullableFolderIdSchema,
  parentScope: parentScopeSchema,
  name: z.string(),
})
const requestPlanFieldsSchema = z.object({
  name: z.string(),
  method: z.enum(REQUEST_METHODS),
  url: z.string(),
  pathParams: z.string(),
  searchParams: z.string(),
  auth: authSchema,
  headers: z.string(),
  body: z.string(),
  bodyType: z.enum(REQUEST_BODY_TYPES),
  rawType: z.enum(REQUEST_RAW_TYPES),
  graphqlQuery: z.string(),
  graphqlVariables: z.string(),
  preRequestScript: z.string(),
  postRequestScript: z.string(),
  testScript: z.string(),
  responseVisualizer: z.string(),
  responseTableAccessor: z.string(),
  preferredResponseBodyView: z.enum(RESPONSE_BODY_VIEWS),
  saveToHistory: z.boolean(),
})
const requestCreatePlanItemSchema = requestPlanFieldsSchema.extend({
  id: z.string().trim().min(1),
  parentFolderId: nullableFolderIdSchema,
  parentScope: parentScopeSchema,
})
const requestUpdatePlanItemSchema = requestPlanFieldsSchema.extend({
  requestId: z.string().trim().min(1),
})
const environmentVariableSchema = z.object({
  key: z.string(),
  value: z.string(),
})
const environmentUpdateSchema = z.object({
  environmentId: z.string().trim().min(1),
  environmentName: z.string(),
  variables: z.array(environmentVariableSchema),
})
const tagCreatePlanItemSchema = z.object({
  id: tagIdSchema,
  name: tagNameSchema,
  color: tagColorSchema,
})
const tagUpdatePlanItemSchema = z.object({
  tagId: tagIdSchema,
  name: tagNameSchema,
  color: tagColorSchema,
})
const itemTagUpdatePlanItemSchema = z.object({
  itemType: taggableItemTypeSchema,
  itemId: z.string().trim().min(1),
  tagIds: z.array(tagIdSchema),
})
const tagItemUpdatePlanItemSchema = z.object({
  tagId: tagIdSchema,
  items: z.array(tagItemRefSchema),
})
const managementAgentPlanSchema = z.object({
  summary: z.string(),
  questions: z.array(questionSchema),
  warnings: z.array(warningSchema),
  foldersToCreate: z.array(folderPlanItemSchema),
  requestsToCreate: z.array(requestCreatePlanItemSchema),
  requestsToUpdate: z.array(requestUpdatePlanItemSchema),
  environmentUpdates: z.array(environmentUpdateSchema),
  tagsToCreate: z.array(tagCreatePlanItemSchema).optional(),
  tagsToUpdate: z.array(tagUpdatePlanItemSchema).optional(),
  itemTagUpdates: z.array(itemTagUpdatePlanItemSchema).optional(),
  tagItemUpdates: z.array(tagItemUpdatePlanItemSchema).optional(),
})

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

  async function listExplorerItemsHelper({
    folderId,
    folderPath,
  }: {
    folderId?: string | null
    folderPath?: string[]
  }) {
    const resolvedSessionId = requireBoundManagementAgentSessionId(boundSessionId)
    const session = requireManagementAgentSession(resolvedSessionId)
    const explorer = await listExplorerItems()
    const resolvedFolderId = resolveExplorerFolderSelection({
      items: explorer,
      folderId: folderId ?? null,
      folderPath: folderPath ?? null,
    })
    if (!resolvedFolderId.success) {
      throw new Error(errorResponseToMessage(resolvedFolderId.error))
    }

    const filteredExplorer = filterExplorerItems(explorer, resolvedFolderId.data)
    if (!filteredExplorer.success) {
      throw new Error(errorResponseToMessage(filteredExplorer.error))
    }

    return toToolResult({
      scope: { scopeType: session.scopeType, targetFolderId: session.targetFolderId },
      items: addExplorerPaths(filteredExplorer.data, explorer),
    })
  }

  async function updateDraft(
    updater: (draft: ManagementAgentPlan) => { draft: ManagementAgentPlan; result: Record<string, unknown> }
  ) {
    const resolvedSessionId = requireBoundManagementAgentSessionId(boundSessionId)
    requireManagementAgentSession(resolvedSessionId)
    const currentDraft = getCurrentManagementAgentDraftPlan(resolvedSessionId)?.plan ?? createEmptyManagementAgentPlan()
    const updated = updater(currentDraft)
    setCurrentManagementAgentDraftPlan(resolvedSessionId, normalizeManagementAgentPlan(updated.draft))
    return toToolResult(updated.result)
  }

  server.registerTool(
    'list_explorer_items_by_folder_id',
    {
      description: 'List explorer items under a folder by folderId.',
      inputSchema: z.object({
        folderId: folderIdSchema.describe('Required folder ID.'),
      }),
    },
    ({ folderId }) => listExplorerItemsHelper({ folderId })
  )

  server.registerTool(
    'list_explorer_items_by_folder_path',
    {
      description: 'List explorer items under a folder by path relative to workspace root.',
      inputSchema: z.object({
        folderPath: folderPathSchema.describe('Path relative to workspace root. Use [] for the root folder, e.g. ["test"] or ["mainfolder", "nestedfolder"]'),
      }),
    },
    ({ folderPath }) => listExplorerItemsHelper({ folderPath })
  )

  server.registerTool(
    'get_request',
    {
      description: 'Get a request by ID for a management-agent session.',
      inputSchema: {
        requestId: z.string().trim().min(1).describe('Request ID to load'),
      },
    },
    async ({ requestId }) => {
      requireManagementAgentSession(requireBoundManagementAgentSessionId(boundSessionId))
      const result = await getRequest({ id: requestId })
      if (!result.success) {
        throw new Error(errorResponseToMessage(result.error))
      }

      return toToolResult({ request: result.data })
    }
  )

  server.registerTool(
    'find_explorer_items_by_exact_query',
    {
      description: 'Find folders and requests whose names exactly match the query after lowercasing both sides.',
      inputSchema: {
        query: explorerQuerySchema.describe('Exact query to match case-insensitively against folder and request names.'),
      },
    },
    async ({ query }) => {
      requireManagementAgentSession(requireBoundManagementAgentSessionId(boundSessionId))
      const normalizedQuery = query.toLocaleLowerCase()
      const explorerItems = await listExplorerItems()
      const matchedItems = explorerItems.filter(
        (item): item is Extract<ExplorerItem, { itemType: 'folder' | 'request' }> =>
          (item.itemType === 'folder' || item.itemType === 'request') && item.name.toLocaleLowerCase() === normalizedQuery
      )

      return toToolResult({
        query,
        items: addExplorerPathSegments(matchedItems, explorerItems),
      })
    }
  )

  server.registerTool(
    'list_environments',
    {
      description: 'List all environments available to the management agent.',
      inputSchema: {},
    },
    async () => {
      requireManagementAgentSession(requireBoundManagementAgentSessionId(boundSessionId))
      return toToolResult({ environments: await listEnvironments() })
    }
  )

  server.registerTool(
    'list_tags',
    {
      description: 'List all tags available to the management agent.',
      inputSchema: {},
    },
    async () => {
      requireManagementAgentSession(requireBoundManagementAgentSessionId(boundSessionId))
      return toToolResult({ tags: await listTags() })
    }
  )

  server.registerTool(
    'get_tag_details',
    {
      description: 'Get a tag, its direct assignments, and tagged explorer items by tag ID.',
      inputSchema: {
        tagId: tagIdSchema.describe('Tag ID to load'),
      },
    },
    async ({ tagId }) => {
      requireManagementAgentSession(requireBoundManagementAgentSessionId(boundSessionId))
      const [tags, assignments, explorerItems] = await Promise.all([listTags(), listTagAssignments(), listExplorerItems()])
      const tag = tags.find(currentTag => currentTag.id === tagId) ?? null
      if (!tag) {
        throw new Error('Tag not found.')
      }

      const tagAssignments = assignments.filter(assignment => assignment.tagId === tagId)
      return toToolResult({
        tag,
        assignments: tagAssignments,
        items: getTaggedExplorerItems(tagAssignments, explorerItems),
      })
    }
  )

  server.registerTool(
    'list_explorer_items_by_tag_id',
    {
      description: 'List directly tagged folders and requests by tag ID.',
      inputSchema: {
        tagId: tagIdSchema.describe('Tag ID to list explorer items for'),
      },
    },
    async ({ tagId }) => {
      requireManagementAgentSession(requireBoundManagementAgentSessionId(boundSessionId))
      const [tags, assignments, explorerItems] = await Promise.all([listTags(), listTagAssignments(), listExplorerItems()])
      const tag = tags.find(currentTag => currentTag.id === tagId) ?? null
      if (!tag) {
        throw new Error('Tag not found.')
      }

      const tagAssignments = assignments.filter(assignment => assignment.tagId === tagId)
      return toToolResult({ tag, items: getTaggedExplorerItems(tagAssignments, explorerItems) })
    }
  )

  server.registerTool(
    'get_current_draft',
    {
      description: 'Get the current draft plan for a session.',
      inputSchema: {},
    },
    async () => {
      const resolvedSessionId = requireBoundManagementAgentSessionId(boundSessionId)
      requireManagementAgentSession(resolvedSessionId)
      return toToolResult({ draft: getCurrentManagementAgentDraftPlan(resolvedSessionId) })
    }
  )

  server.registerTool(
    'set_current_draft',
    {
      description: 'Replace the entire current draft plan for a session.',
      inputSchema: {
        plan: managementAgentPlanSchema.describe('Complete draft plan object to set as the current draft'),
      },
    },
    async ({ plan }) => {
      const resolvedSessionId = requireBoundManagementAgentSessionId(boundSessionId)
      requireManagementAgentSession(resolvedSessionId)
      return toToolResult({
        draft: setCurrentManagementAgentDraftPlan(resolvedSessionId, normalizeManagementAgentPlan(plan)),
      })
    }
  )

  server.registerTool(
    'plan_add_tag',
    {
      description: 'Plan creation of a new tag in the current draft.',
      inputSchema: tagCreatePlanItemSchema,
    },
    input =>
      updateDraft(draft => ({
        draft: {
          ...draft,
          tagsToCreate: overwriteBy(draft.tagsToCreate, input, tag => tag.id),
        },
        result: { plannedTag: input },
      }))
  )

  server.registerTool(
    'plan_update_tag',
    {
      description: 'Plan an update to an existing tag in the current draft.',
      inputSchema: tagUpdatePlanItemSchema,
    },
    input =>
      updateDraft(draft => ({
        draft: {
          ...draft,
          tagsToUpdate: overwriteBy(draft.tagsToUpdate, input, tag => tag.tagId),
        },
        result: { plannedTagUpdate: input },
      }))
  )

  server.registerTool(
    'plan_replace_item_tags',
    {
      description: 'Plan replacement of all tags on a folder or request.',
      inputSchema: itemTagUpdatePlanItemSchema,
    },
    input =>
      updateDraft(draft => ({
        draft: {
          ...draft,
          itemTagUpdates: overwriteBy(draft.itemTagUpdates, input, item => `${item.itemType}:${item.itemId}`),
        },
        result: { plannedItemTagUpdate: input },
      }))
  )

  server.registerTool(
    'plan_replace_tag_items',
    {
      description: 'Plan replacement of all items assigned to a tag.',
      inputSchema: tagItemUpdatePlanItemSchema,
    },
    input =>
      updateDraft(draft => ({
        draft: {
          ...draft,
          tagItemUpdates: overwriteBy(draft.tagItemUpdates, input, item => item.tagId),
        },
        result: { plannedTagItemUpdate: input },
      }))
  )

  server.registerTool(
    'clear_current_draft',
    {
      description: 'Clear the current draft plan for a session.',
      inputSchema: {},
    },
    async () => {
      const resolvedSessionId = requireBoundManagementAgentSessionId(boundSessionId)
      requireManagementAgentSession(resolvedSessionId)
      clearCurrentManagementAgentDraftPlan(resolvedSessionId)
      return toToolResult({ success: true })
    }
  )

  server.registerTool(
    'list_applied_plans',
    {
      description: 'List previously applied plans for a session.',
      inputSchema: {},
    },
    async () => {
      const resolvedSessionId = requireBoundManagementAgentSessionId(boundSessionId)
      requireManagementAgentSession(resolvedSessionId)
      return toToolResult({ plans: listAppliedManagementAgentPlans(resolvedSessionId) })
    }
  )

  return server
}

function requireManagementAgentSession(sessionId: string) {
  const session = getManagementAgentSession(sessionId)
  if (!session) {
    throw new Error('Management session not found.')
  }

  return session
}

function requireBoundManagementAgentSessionId(boundSessionId: string | null) {
  if (boundSessionId) {
    return boundSessionId
  }

  throw new Error('Management session not found.')
}

function toToolResult<T extends Record<string, unknown>>(value: T) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  }
}

function overwriteBy<T>(items: T[], nextItem: T, getKey: (item: T) => string) {
  const nextKey = getKey(nextItem)
  return [...items.filter(item => getKey(item) !== nextKey), nextItem]
}

function getTaggedExplorerItems(
  assignments: Awaited<ReturnType<typeof listTagAssignments>>,
  explorerItems: Awaited<ReturnType<typeof listExplorerItems>>
) {
  const itemKeys = new Set(assignments.map(assignment => `${assignment.itemType}:${assignment.itemId}`))
  return addExplorerPaths(
    explorerItems.filter(
      (item): item is Extract<ExplorerItem, { itemType: 'folder' | 'request' }> =>
        (item.itemType === 'folder' || item.itemType === 'request') && itemKeys.has(`${item.itemType}:${item.id}`)
    ),
    explorerItems
  )
}

function resolveExplorerFolderSelection(input: {
  items: Awaited<ReturnType<typeof listExplorerItems>>
  folderId: string | null
  folderPath: string[] | null
}): GenericResult<string | null> {
  if (input.folderId !== null && input.folderPath !== null) {
    return GenericError.Message('Provide either folderId or folderPath, not both.')
  }

  if (input.folderPath === null) {
    return { success: true, data: input.folderId }
  }

  if (input.folderPath.length === 0) {
    return { success: true, data: null }
  }

  const folderItems = input.items.filter(
    (item): item is Extract<ExplorerItem, { itemType: 'folder' }> => item.itemType === 'folder'
  )
  const resolvedFolderId = resolveFolderIdByPath(folderItems, null, input.folderPath)
  if (resolvedFolderId === null) {
    return GenericError.Message('Folder not found.')
  }

  return { success: true, data: resolvedFolderId }
}

function filterExplorerItems(
  items: Awaited<ReturnType<typeof listExplorerItems>>,
  folderId: string | null
):
  | ({ statusCode: number } & Exclude<GenericResult<Awaited<ReturnType<typeof listExplorerItems>>>, { success: true }>)
  | Extract<GenericResult<Awaited<ReturnType<typeof listExplorerItems>>>, { success: true }> {
  if (!folderId) {
    return { success: true, data: filterExplorerItemsByFolderId(items, null) }
  }

  const folderItems = items.filter(
    (item): item is Extract<ExplorerItem, { itemType: 'folder' }> => item.itemType === 'folder'
  )
  const folderMap = new Map(folderItems.map(item => [item.id, item] as const))
  if (!folderMap.has(folderId)) {
    return { ...GenericError.Message('Folder not found.'), statusCode: 404 }
  }

  return { success: true, data: filterExplorerItemsByFolderId(items, folderId) }
}

function resolveFolderIdByPath(
  folderItems: Array<Extract<ExplorerItem, { itemType: 'folder' }>>,
  rootFolderId: string | null,
  pathSegments: string[]
) {
  let currentParentFolderId = rootFolderId
  let currentFolderId: string | null = null

  for (const segment of pathSegments) {
    const nextFolder = folderItems.find(item => item.parentFolderId === currentParentFolderId && item.name === segment)
    if (!nextFolder) {
      return null
    }

    currentFolderId = nextFolder.id
    currentParentFolderId = nextFolder.id
  }

  return currentFolderId
}

function filterExplorerItemsByFolderId(items: Awaited<ReturnType<typeof listExplorerItems>>, folderId: string | null) {
  const visibleFolderIds = new Set<string>()
  if (folderId) {
    visibleFolderIds.add(folderId)
  }

  for (const item of items) {
    if (item.itemType === 'folder' && item.parentFolderId === folderId) {
      visibleFolderIds.add(item.id)
    }
  }

  const requestIds = new Set(
    items
      .filter(
        (item): item is Extract<ExplorerItem, { itemType: 'request' }> =>
          item.itemType === 'request'
            && ((item.parentFolderId === null && folderId === null) || (item.parentFolderId !== null && visibleFolderIds.has(item.parentFolderId)))
      )
      .map(item => item.id)
  )

  return items.filter(item => {
    switch (item.itemType) {
      case 'folder':
        return visibleFolderIds.has(item.id)
      case 'request':
        return (item.parentFolderId === null && folderId === null) || (item.parentFolderId !== null && visibleFolderIds.has(item.parentFolderId))
      case 'example':
        return requestIds.has(item.requestId)
    }
  })
}

function addExplorerPaths(items: Awaited<ReturnType<typeof listExplorerItems>>, allItems = items) {
  const itemMap = new Map(allItems.map(item => [item.id, item] as const))
  return items.map(item => ({
    ...item,
    path:
      item.itemType === 'example'
        ? [itemMap.get(item.requestId)?.name ?? item.requestId, item.name].join(' / ')
        : [
            ...getFolderPath(itemMap, item.itemType === 'folder' ? item.parentFolderId : item.parentFolderId),
            item.name,
          ].join(' / '),
  }))
}

function addExplorerPathSegments(items: Awaited<ReturnType<typeof listExplorerItems>>, allItems = items) {
  const itemMap = new Map(allItems.map(item => [item.id, item] as const))
  return items.map(item => ({
    ...item,
    path:
      item.itemType === 'example'
        ? [itemMap.get(item.requestId)?.name ?? item.requestId, item.name]
        : [...getFolderPath(itemMap, item.itemType === 'folder' ? item.parentFolderId : item.parentFolderId), item.name],
  }))
}

function getFolderPath(
  itemMap: Map<string, Awaited<ReturnType<typeof listExplorerItems>>[number]>,
  parentFolderId: string | null
) {
  const segments: string[] = []
  let currentFolderId = parentFolderId

  while (currentFolderId) {
    const folder = itemMap.get(currentFolderId)
    if (!folder || folder.itemType !== 'folder') {
      break
    }

    segments.unshift(folder.name)
    currentFolderId = folder.parentFolderId
  }

  return segments
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
