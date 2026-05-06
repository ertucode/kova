import { describe, expect, it } from 'vitest'
import type { ExplorerItem } from '@common/Explorer'
import { buildTree, createFolderTreeSearchManager, filterTreeWithDrafts, toSelectionKey, type SearchDraftEntries, type SearchTagNames } from './folderExplorerUtils'

describe('folderExplorerUtils search', () => {
  it('matches request text fuzzily and keeps the parent folder visible', () => {
    const roots = createRoots([
      folderItem({ id: 'folder-1', name: 'Workspace' }),
      requestItem({ id: 'request-1', parentFolderId: 'folder-1', name: 'Customer Search', method: 'GET', url: '/customers/search' }),
    ])

    const visibleRoots = filterTreeWithDrafts(roots, 'custmer')

    expect(visibleRoots).toHaveLength(1)
    expect(visibleRoots[0]?.name).toBe('Workspace')
    expect(visibleRoots[0]?.children.map(child => child.name)).toEqual(['Customer Search'])
  })

  it('matches tags fuzzily with @ terms', () => {
    const roots = createRoots([
      requestItem({ id: 'request-1', name: 'Deploy API', method: 'POST', url: '/deploy' }),
      requestItem({ id: 'request-2', name: 'Local Health', method: 'GET', url: '/health' }),
    ])

    const tagNamesBySelection: SearchTagNames = {
      'request:request-1': ['production'],
      'request:request-2': ['development'],
    }

    const visibleRoots = filterTreeWithDrafts(roots, '@producion', undefined, tagNamesBySelection)

    expect(visibleRoots.map(node => node.name)).toEqual(['Deploy API'])
  })

  it('matches normalized hyphenated values with fuzzy typos', () => {
    const roots = createRoots([
      requestItem({ id: 'request-1', name: 'translation-values', method: 'GET', url: '/translations/values' }),
      requestItem({ id: 'request-2', name: 'health-check', method: 'GET', url: '/health' }),
    ])

    const visibleRoots = filterTreeWithDrafts(roots, 'travalu')

    expect(visibleRoots.map(node => node.name)).toEqual(['translation-values'])
  })

  it('orders sibling matches by relevance', () => {
    const roots = createRoots([
      requestItem({ id: 'request-1', name: 'translation-value-archive', method: 'GET', url: '/translations/archive' }),
      requestItem({ id: 'request-2', name: 'translation-values', method: 'GET', url: '/translations/values' }),
      requestItem({ id: 'request-3', name: 'translation-value-history', method: 'GET', url: '/translations/history' }),
    ])

    const visibleRoots = filterTreeWithDrafts(roots, 'translation-values')

    expect(visibleRoots.map(node => node.name)).toEqual([
      'translation-values',
      'translation-value-archive',
      'translation-value-history',
    ])
  })

  it('requires both text and tag terms to match', () => {
    const roots = createRoots([
      requestItem({ id: 'request-1', name: 'Deploy API', method: 'POST', url: '/deploy' }),
      requestItem({ id: 'request-2', name: 'Deploy Admin', method: 'POST', url: '/admin/deploy' }),
    ])

    const tagNamesBySelection: SearchTagNames = {
      'request:request-1': ['production'],
      'request:request-2': ['staging'],
    }

    const visibleRoots = filterTreeWithDrafts(roots, 'deply @producion', undefined, tagNamesBySelection)

    expect(visibleRoots.map(node => node.name)).toEqual(['Deploy API'])
  })

  it('includes request draft fields in fuzzy matches', () => {
    const roots = createRoots([
      requestItem({ id: 'request-1', name: 'Orders', method: 'GET', url: '/orders' }),
    ])

    const requestKey = toSelectionKey({ itemType: 'request', id: 'request-1' })
    const entries: SearchDraftEntries = {
      [requestKey]: {
        base: null,
        current: {
          itemType: 'request',
          name: 'Billing Overview',
          requestType: 'http',
          method: 'PATCH',
          url: '/billing/overview',
          pathParams: '',
          searchParams: '',
          auth: { type: 'noauth' },
          preRequestScript: '',
          postRequestScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw',
          headers: '',
          body: '',
          bodyType: 'none',
          rawType: 'json',
          websocketSubprotocols: '',
          websocketOnOpenMessage: '',
          websocketAutoSendEnabled: false,
          websocketAutoSendMessage: '',
          websocketAutoSendIntervalSeconds: 0,
          saveToHistory: true,
        },
      },
    }

    const visibleRoots = filterTreeWithDrafts(roots, 'billng', entries)

    expect(visibleRoots.map(node => node.name)).toEqual(['Orders'])
  })

  it('reuses cached query results for repeated searches on the same manager', () => {
    const roots = createRoots([
      requestItem({ id: 'request-1', name: 'Deploy API', method: 'POST', url: '/deploy' }),
    ])
    const manager = createFolderTreeSearchManager()

    const firstResult = manager.filter(roots, 'deploy')
    const secondResult = manager.filter(roots, 'deploy')

    expect(secondResult).toBe(firstResult)
  })
})

function createRoots(items: ExplorerItem[]) {
  return buildTree(items).roots
}

function folderItem({ id, name, parentFolderId = null, position = 0, createdAt = 0 }: FolderItemInput): ExplorerItem {
  return {
    itemType: 'folder',
    id,
    name,
    parentFolderId,
    position,
    createdAt,
    deletedAt: null,
  }
}

function requestItem({
  id,
  name,
  method,
  url,
  parentFolderId = null,
  position = 0,
  createdAt = 0,
}: RequestItemInput): ExplorerItem {
  return {
    itemType: 'request',
    id,
    name,
    method,
    url,
    requestType: 'http',
    parentFolderId,
    position,
    createdAt,
    deletedAt: null,
  }
}

type FolderItemInput = {
  id: string
  name: string
  parentFolderId?: string | null
  position?: number
  createdAt?: number
}

type RequestItemInput = {
  id: string
  name: string
  method: string
  url: string
  parentFolderId?: string | null
  position?: number
  createdAt?: number
}
