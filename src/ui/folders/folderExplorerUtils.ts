import type { ExplorerItem } from '@common/Explorer'
import type { FolderRecord } from '@common/Folders'
import { createEmptyKeyValueRow, parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'
import type { HttpRequestRecord } from '@common/Requests'
import type {
  DetailsDraft,
  DetailEntity,
  FolderDetailsDraft,
  HeaderRow,
  RequestDetailsDraft,
  Selection,
  TreeNode,
} from './folderExplorerTypes'

export function buildTree(items: ExplorerItem[]) {
  const nodes = items
    .slice()
    .sort((a, b) => a.position - b.position || a.createdAt - b.createdAt)
    .map(item => ({ ...item, children: [] as TreeNode[] }))

  const treeMap = new Map(nodes.map(node => [toSelectionKey(node), node]))
  const roots: TreeNode[] = []

  nodes.forEach(node => {
    if (!node.parentFolderId) {
      roots.push(node)
      return
    }

    const parent = treeMap.get(`folder:${node.parentFolderId}`)
    if (parent) {
      parent.children.push(node)
      return
    }

    roots.push(node)
  })

  return {
    roots,
    itemMap: treeMap,
  }
}

export function filterTree(nodes: TreeNode[], query: string): TreeNode[] {
  if (!query) return nodes

  return nodes.flatMap(node => {
    const filteredChildren = filterTree(node.children, query)
    const requestMatch = node.itemType === 'request' ? `${node.method} ${node.url}`.toLowerCase().includes(query) : false
    const isMatch = node.name.toLowerCase().includes(query) || requestMatch

    if (!isMatch && filteredChildren.length === 0) {
      return []
    }

    return [{ ...node, children: filteredChildren }]
  })
}

export function toFolderDetailsDraft(folder: FolderRecord): FolderDetailsDraft {
  return {
    itemType: 'folder',
    name: folder.name,
    description: folder.description,
    preRequestScript: folder.preRequestScript,
    postRequestScript: folder.postRequestScript,
  }
}

export function toRequestDetailsDraft(request: HttpRequestRecord): RequestDetailsDraft {
  return {
    itemType: 'request',
    name: request.name,
    method: request.method,
    url: request.url,
    pathParams: request.pathParams,
    searchParams: request.searchParams,
    preRequestScript: request.preRequestScript,
    postRequestScript: request.postRequestScript,
    headers: request.headers,
    body: request.body,
    bodyType: request.bodyType,
    rawType: request.rawType,
  }
}

export function toDetailsDraft(value: DetailEntity): DetailsDraft {
  if ('method' in value) {
    return toRequestDetailsDraft(value)
  }

  return toFolderDetailsDraft(value)
}

export function serializeDetails(value: DetailsDraft | null) {
  if (!value) return ''
  return JSON.stringify(value)
}

export function toSelectionKey(value: Selection | ExplorerItem) {
  return `${value.itemType}:${value.id}`
}

export function parseHeaderRows(value: string): HeaderRow[] {
  return parseKeyValueRows(value)
}

export function stringifyHeaderRows(rows: HeaderRow[]) {
  return stringifyKeyValueRows(rows)
}

export function createEmptyHeaderRow(): HeaderRow {
  return createEmptyKeyValueRow()
}
