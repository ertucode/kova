import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { z } from 'zod'
import type { EnvironmentRecord } from '../../common/Environments.js'
import { Typescript } from '../../common/Typescript.js'
import { errorResponseToMessage, GenericError, type GenericResult } from '../../common/GenericError.js'
import type { ExplorerItem } from '../../common/Explorer.js'
import { parseKeyValueRows } from '../../common/KeyValueRows.js'
import { listEnvironments } from '../db/environments.js'
import { listExplorerItems } from '../db/explorer.js'
import { getFolder } from '../db/folders.js'
import { getRequest } from '../db/requests.js'
import type { ManagementAgentMcpContext } from './context.js'

const folderIdSchema = z.string().trim().min(1)
const nullableFolderIdSchema = folderIdSchema.nullable()
const parentScopeSchema = z.enum(['session-root', 'workspace-root']).optional()
const folderPathSchema = z.array(z.string().trim().min(1))
const explorerQuerySchema = z.string().trim().min(1)
const environmentQuerySchema = z.string().trim().min(1)
const environmentVariableNameSchema = z.string().trim().min(1)

export function registerExplorerTools(server: McpServer, context: ManagementAgentMcpContext) {
  async function listExplorerItemsHelper({
    folderId,
    folderPath,
  }: {
    folderId?: string | null
    folderPath?: string[]
  }) {
    const session = context.requireSession()
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

    return context.toToolResult({
      scope: {
        scopeType: session.scopeType,
        targetFolderId: session.targetFolderId,
        targetRequestId: session.targetRequestId,
      },
      items: addExplorerPaths(filteredExplorer.data, explorer),
    })
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
        folderPath: folderPathSchema.describe(
          'Path relative to workspace root. Use [] for the root folder, e.g. ["test"] or ["mainfolder", "nestedfolder"]'
        ),
      }),
    },
    ({ folderPath }) => listExplorerItemsHelper({ folderPath })
  )

  server.registerTool(
    'get_folder',
    {
      description: 'Get a folder by ID for a management-agent session.',
      inputSchema: {
        folderId: folderIdSchema.describe('Folder ID to load'),
      },
    },
    async ({ folderId }) => {
      context.requireSession()
      const result = await getFolder({ id: folderId })
      if (!result.success) {
        throw new Error(errorResponseToMessage(result.error))
      }

      return context.toToolResult({ folder: result.data })
    }
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
      context.requireSession()
      const result = await getRequest({ id: requestId })
      if (!result.success) {
        throw new Error(errorResponseToMessage(result.error))
      }

      return context.toToolResult({ request: result.data })
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
      context.requireSession()
      const normalizedQuery = query.toLocaleLowerCase()
      const explorerItems = await listExplorerItems()
      const matchedItems = explorerItems.filter(
        (item): item is Extract<ExplorerItem, { itemType: 'folder' | 'request' }> =>
          (item.itemType === 'folder' || item.itemType === 'request') &&
          item.name.toLocaleLowerCase() === normalizedQuery
      )

      return context.toToolResult({
        query,
        items: addExplorerPathSegments(matchedItems, explorerItems),
      })
    }
  )

  server.registerTool(
    'list_environments',
    {
      description: 'List all environments available to the management agent without returning variable values. Use get_environment_value to read one variable value when needed.',
      inputSchema: {},
    },
    async () => {
      context.requireSession()
      return context.toToolResult({ environments: summarizeEnvironmentsForAgent(await listEnvironments()) })
    }
  )

  server.registerTool(
    'get_environment_value',
    {
      description: 'Get one environment variable value by exact environment ID or exact environment name. Use this only for the specific variable you need.',
      inputSchema: {
        environment: environmentQuerySchema.describe('Exact environment ID or exact environment name.'),
        name: environmentVariableNameSchema.describe('Exact variable name to read.'),
      },
    },
    async ({ environment, name }) => {
      context.requireSession()
      return context.toToolResult(getEnvironmentValueFromRecords(await listEnvironments(), environment, name))
    }
  )
}

export function summarizeEnvironmentsForAgent(environments: EnvironmentRecord[]) {
  return environments.map(environment => ({
    id: environment.id,
    name: environment.name,
    variableNames: parseKeyValueRows(environment.variables)
      .filter(row => row.key.trim())
      .map(row => row.key.trim()),
  }))
}

export function getEnvironmentValueFromRecords(environments: EnvironmentRecord[], environmentQuery: string, variableName: string) {
  const environment = environments.find(item => item.id === environmentQuery || item.name === environmentQuery)
  if (!environment) {
    throw new Error('Environment not found.')
  }

  const variable = parseKeyValueRows(environment.variables).find(
    row => row.key.trim() === variableName
  )
  if (!variable) {
    throw new Error('Environment variable not found.')
  }

  return {
    environmentId: environment.id,
    environmentName: environment.name,
    name: variable.key.trim(),
    value: variable.value,
  }
}

export function resolveExplorerFolderSelection(input: {
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
          item.itemType === 'request' &&
          ((item.parentFolderId === null && folderId === null) ||
            (item.parentFolderId !== null && visibleFolderIds.has(item.parentFolderId)))
      )
      .map(item => item.id)
  )

  return items.filter(item => {
    switch (item.itemType) {
      case 'folder':
        return visibleFolderIds.has(item.id)
      case 'request':
        return (
          (item.parentFolderId === null && folderId === null) ||
          (item.parentFolderId !== null && visibleFolderIds.has(item.parentFolderId))
        )
      case 'example':
        return requestIds.has(item.requestId)
      default:
        return Typescript.assertUnreachable(item)
    }
  })
}

export function addExplorerPaths(items: Awaited<ReturnType<typeof listExplorerItems>>, allItems = items) {
  const itemMap = new Map(allItems.map(item => [item.id, item] as const))
  return items.map(item => ({
    ...item,
    path:
      item.itemType === 'example'
        ? [itemMap.get(item.requestId)?.name ?? item.requestId, item.name].join(' / ')
        : [...getFolderPath(itemMap, item.parentFolderId), item.name].join(' / '),
  }))
}

function addExplorerPathSegments(items: Awaited<ReturnType<typeof listExplorerItems>>, allItems = items) {
  const itemMap = new Map(allItems.map(item => [item.id, item] as const))
  return items.map(item => ({
    ...item,
    path:
      item.itemType === 'example'
        ? [itemMap.get(item.requestId)?.name ?? item.requestId, item.name]
        : [...getFolderPath(itemMap, item.parentFolderId), item.name],
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

export { nullableFolderIdSchema, parentScopeSchema }
