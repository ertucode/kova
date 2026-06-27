import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import type { ExplorerItem } from '../common/Explorer.js'
import { GenericError, errorResponseToMessage, type GenericResult } from '../common/GenericError.js'
import { normalizeImportAgentPlan } from '../common/ImportAgent.js'
import { getRequest } from './db/requests.js'
import { listEnvironments } from './db/environments.js'
import { listExplorerItems } from './db/explorer.js'
import {
  clearCurrentImportAgentDraftPlan,
  getCurrentImportAgentDraftPlan,
  getImportAgentSession,
  listAppliedImportAgentPlans,
  setCurrentImportAgentDraftPlan,
} from './db/import-agent.js'

type ImportAgentToolBridge = {
  url: string
  token: string
  close(): Promise<void>
}

export async function startImportAgentToolBridge(): Promise<ImportAgentToolBridge> {
  const token = randomBytes(24).toString('hex')
  const server = createServer(async (request, response) => {
    try {
      if (request.headers.authorization !== `Bearer ${token}`) {
        writeJson(response, 401, { success: false, error: 'Unauthorized' })
        return
      }

      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const sessionId = url.searchParams.get('sessionId')?.trim() ?? ''
      const session = sessionId ? getImportAgentSession(sessionId) : null
      if (!session) {
        writeJson(response, 404, { success: false, error: 'Import session not found.' })
        return
      }

      if (request.method === 'GET' && url.pathname === '/import-agent/explorer') {
        const folderIdParam = url.searchParams.get('folderId')
        const folderId = folderIdParam === null ? null : folderIdParam.trim()
        if (folderIdParam !== null && !folderId) {
          writeJson(response, 400, { success: false, error: 'folderId cannot be empty.' })
          return
        }

        const explorer = await listExplorerItems()
        const filteredExplorer = filterExplorerItemsForSession(explorer, session.scopeType, session.targetFolderId, folderId)
        if (!filteredExplorer.success) {
          writeJson(response, filteredExplorer.statusCode, { success: false, error: errorResponseToMessage(filteredExplorer.error) })
          return
        }

        writeJson(response, 200, {
          success: true,
          scope: { scopeType: session.scopeType, targetFolderId: session.targetFolderId },
          items: addExplorerPaths(filteredExplorer.data, explorer),
        })
        return
      }

      if (request.method === 'GET' && url.pathname === '/import-agent/request') {
        const requestId = url.searchParams.get('requestId')?.trim() ?? ''
        if (!requestId) {
          writeJson(response, 400, { success: false, error: 'requestId is required.' })
          return
        }

        const result = await getRequest({ id: requestId })
        if (!result.success) {
          writeJson(response, 404, { success: false, error: errorResponseToMessage(result.error) })
          return
        }

        writeJson(response, 200, { success: true, request: result.data })
        return
      }

      if (request.method === 'GET' && url.pathname === '/import-agent/environments') {
        writeJson(response, 200, { success: true, environments: await listEnvironments() })
        return
      }

      if (request.method === 'GET' && url.pathname === '/import-agent/draft') {
        writeJson(response, 200, { success: true, draft: getCurrentImportAgentDraftPlan(session.id) })
        return
      }

      if (request.method === 'PUT' && url.pathname === '/import-agent/draft') {
        const payload = await readJsonBody(request)
        const plan = normalizeImportAgentPlan(
          payload && typeof payload === 'object' && payload !== null && 'plan' in payload
            ? (payload as { plan?: unknown }).plan
            : payload
        )
        writeJson(response, 200, {
          success: true,
          draft: setCurrentImportAgentDraftPlan(session.id, plan),
        })
        return
      }

      if (request.method === 'DELETE' && url.pathname === '/import-agent/draft') {
        clearCurrentImportAgentDraftPlan(session.id)
        writeJson(response, 200, { success: true })
        return
      }

      if (request.method === 'GET' && url.pathname === '/import-agent/plans/applied') {
        writeJson(response, 200, { success: true, plans: listAppliedImportAgentPlans(session.id) })
        return
      }

      writeJson(response, 404, { success: false, error: 'Not found' })
    } catch (error) {
      writeJson(response, 500, { success: false, error: error instanceof Error ? error.message : String(error) })
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
    throw new Error('Import agent tool bridge did not expose a TCP port.')
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}`,
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

function filterExplorerItemsForSession(
  items: Awaited<ReturnType<typeof listExplorerItems>>,
  scopeType: string,
  targetFolderId: string | null,
  folderId: string | null
):
  | ({ statusCode: number } & Exclude<GenericResult<Awaited<ReturnType<typeof listExplorerItems>>>, { success: true }>)
  | Extract<GenericResult<Awaited<ReturnType<typeof listExplorerItems>>>, { success: true }> {
  const scopedFolderId = scopeType === 'folder' ? targetFolderId : null
  const effectiveFolderId = folderId ?? scopedFolderId

  if (!effectiveFolderId) {
    return { success: true, data: items }
  }

  const folderItems = items.filter((item): item is Extract<ExplorerItem, { itemType: 'folder' }> => item.itemType === 'folder')
  const folderMap = new Map(folderItems.map(item => [item.id, item] as const))
  if (!folderMap.has(effectiveFolderId)) {
    return { ...GenericError.Message('Folder not found.'), statusCode: 404 }
  }

  if (scopedFolderId !== null) {
    const allowedFolderIds = collectDescendantFolderIds(folderItems, scopedFolderId)
    if (!allowedFolderIds.has(effectiveFolderId)) {
      return { ...GenericError.Message('Folder not found.'), statusCode: 404 }
    }
  }

  return { success: true, data: filterExplorerItemsByFolderId(items, effectiveFolderId) }
}

function filterExplorerItemsByFolderId(items: Awaited<ReturnType<typeof listExplorerItems>>, folderId: string) {
  const folderItems = items.filter((item): item is Extract<ExplorerItem, { itemType: 'folder' }> => item.itemType === 'folder')
  const descendantFolderIds = collectDescendantFolderIds(folderItems, folderId)
  const requestIds = new Set(
    items
      .filter(
        (item): item is Extract<ExplorerItem, { itemType: 'request' }> =>
          item.itemType === 'request' && item.parentFolderId !== null && descendantFolderIds.has(item.parentFolderId)
      )
      .map(item => item.id)
  )

  return items.filter(item => {
    switch (item.itemType) {
      case 'folder':
        return descendantFolderIds.has(item.id)
      case 'request':
        return item.parentFolderId !== null && descendantFolderIds.has(item.parentFolderId)
      case 'example':
        return requestIds.has(item.requestId)
    }
  })
}

function collectDescendantFolderIds(folderItems: Array<Extract<ExplorerItem, { itemType: 'folder' }>>, rootFolderId: string) {
  const descendantFolderIds = new Set<string>([rootFolderId])
  let changed = true

  while (changed) {
    changed = false
    for (const item of folderItems) {
      if (item.parentFolderId && descendantFolderIds.has(item.parentFolderId) && !descendantFolderIds.has(item.id)) {
        descendantFolderIds.add(item.id)
        changed = true
      }
    }
  }

  return descendantFolderIds
}

function addExplorerPaths(items: Awaited<ReturnType<typeof listExplorerItems>>, allItems = items) {
  const itemMap = new Map(allItems.map(item => [item.id, item] as const))
  return items.map(item => ({
    ...item,
    path: item.itemType === 'example'
      ? [itemMap.get(item.requestId)?.name ?? item.requestId, item.name].join(' / ')
      : [...getFolderPath(itemMap, item.itemType === 'folder' ? item.parentFolderId : item.parentFolderId), item.name].join(' / '),
  }))
}

function getFolderPath(itemMap: Map<string, Awaited<ReturnType<typeof listExplorerItems>>[number]>, parentFolderId: string | null) {
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

async function readJsonBody(request: IncomingMessage) {
  let body = ''

  for await (const chunk of request) {
    body += chunk.toString()
  }

  return body.trim() ? (JSON.parse(body) as unknown) : null
}
