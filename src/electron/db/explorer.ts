import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { ExplorerItem } from '../../common/Explorer.js'
import { getDb } from './index.js'
import { requestExamples } from './schema.js'
import { folders, requests, treeItems } from './schema.js'

export async function listExplorerItems(): Promise<ExplorerItem[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(treeItems)
    .where(isNull(treeItems.deletedAt))
    .orderBy(treeItems.parentFolderId, treeItems.position, treeItems.createdAt)

  const folderIds = rows.filter(row => row.itemType === 'folder').map(row => row.itemId)
  const requestIds = rows.filter(row => row.itemType === 'request').map(row => row.itemId)

  const folderRows = folderIds.length
    ? await db.select().from(folders).where(and(inArray(folders.id, folderIds), isNull(folders.deletedAt)))
    : []
  const requestRows = requestIds.length
    ? await db.select().from(requests).where(and(inArray(requests.id, requestIds), isNull(requests.deletedAt)))
    : []
  const exampleRows = requestIds.length
    ? await db.select().from(requestExamples).where(and(inArray(requestExamples.requestId, requestIds), isNull(requestExamples.deletedAt)))
    : []

  const folderMap = new Map(folderRows.map(folder => [folder.id, folder]))
  const requestMap = new Map(requestRows.map(request => [request.id, request]))

  const items: ExplorerItem[] = []

  rows.forEach(row => {
    if (row.itemType === 'folder') {
      const folder = folderMap.get(row.itemId)

      if (!folder) {
        return
      }

      items.push({
        itemType: 'folder' as const,
        id: folder.id,
        parentFolderId: row.parentFolderId,
        name: folder.name,
        position: row.position,
        createdAt: row.createdAt,
        deletedAt: folder.deletedAt,
      })
      return
    }

    const request = requestMap.get(row.itemId)
    if (!request) {
      return
    }

    items.push({
      itemType: 'request' as const,
      id: request.id,
      parentFolderId: row.parentFolderId,
      name: request.name,
      method: request.method,
      url: request.url,
      position: row.position,
      createdAt: row.createdAt,
      deletedAt: request.deletedAt,
    })
  })

  exampleRows.forEach(example => {
    items.push({
      itemType: 'example' as const,
      id: example.id,
      requestId: example.requestId,
      name: example.name,
      responseStatus: example.responseStatus,
      position: example.position,
      createdAt: example.createdAt,
      deletedAt: example.deletedAt,
    })
  })

  return items
}

export async function getRequestParentFolderId(requestId: string) {
  const db = getDb()
  const row = await db
    .select({ parentFolderId: treeItems.parentFolderId })
    .from(treeItems)
    .where(and(eq(treeItems.itemType, 'request'), eq(treeItems.itemId, requestId), isNull(treeItems.deletedAt)))
    .get()

  return row?.parentFolderId ?? null
}
