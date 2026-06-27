import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { errorResponseToMessage, type GenericResult } from '../common/GenericError.js'
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
        const explorer = await listExplorerItems()
        writeJson(response, 200, {
          success: true,
          scope: { scopeType: session.scopeType, targetFolderId: session.targetFolderId },
          items: addExplorerPaths(explorer),
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

function addExplorerPaths(items: Awaited<ReturnType<typeof listExplorerItems>>) {
  const itemMap = new Map(items.map(item => [item.id, item] as const))
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
