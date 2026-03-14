import { asc } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type { FolderExplorerTabRecord, SaveFolderExplorerTabsInput } from '../../common/FolderExplorerTabs.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { folderExplorerTabs } from './schema.js'

type FolderExplorerTabRow = typeof folderExplorerTabs.$inferSelect

export async function listFolderExplorerTabs(): Promise<FolderExplorerTabRecord[]> {
  const db = getDb()

  return db
    .select()
    .from(folderExplorerTabs)
    .orderBy(asc(folderExplorerTabs.position), asc(folderExplorerTabs.createdAt))
    .all()
    .map(toFolderExplorerTabRecord)
}

export async function saveFolderExplorerTabs(input: SaveFolderExplorerTabsInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    db.transaction(tx => {
      tx.delete(folderExplorerTabs).run()

      if (input.tabs.length === 0) {
        return
      }

      const rows: FolderExplorerTabRow[] = input.tabs.map(tab => ({
        id: tab.id,
        itemType: tab.itemType,
        itemId: tab.itemId,
        position: tab.position,
        isPinned: tab.isPinned,
        isActive: tab.isActive,
        createdAt: tab.createdAt,
        updatedAt: tab.updatedAt,
      }))

      tx.insert(folderExplorerTabs).values(rows).run()
    })

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function toFolderExplorerTabRecord(row: FolderExplorerTabRow): FolderExplorerTabRecord {
  return {
    id: row.id,
    itemType: row.itemType as FolderExplorerTabRecord['itemType'],
    itemId: row.itemId,
    position: row.position,
    isPinned: row.isPinned,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
