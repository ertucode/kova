import { asc, eq } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type { FolderExplorerTabRecord, SaveFolderExplorerTabsInput, UpdateFolderExplorerTabInput } from '../../common/FolderExplorerTabs.js'
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
        requestMetaTab: tab.requestMetaTab,
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

export async function updateFolderExplorerTab(input: UpdateFolderExplorerTabInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    const nextValues: Partial<FolderExplorerTabRow> = {}

    if ('requestMetaTab' in input) {
      nextValues.requestMetaTab = input.requestMetaTab ?? null
    }

    if (Object.keys(nextValues).length === 0) {
      return Result.Success(undefined)
    }

    db.update(folderExplorerTabs).set(nextValues).where(eq(folderExplorerTabs.id, input.id)).run()
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
    requestMetaTab: row.requestMetaTab as FolderExplorerTabRecord['requestMetaTab'],
    position: row.position,
    isPinned: row.isPinned,
    isActive: row.isActive,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}
