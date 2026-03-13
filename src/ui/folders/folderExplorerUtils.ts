import type { ExplorerItem } from '@common/Explorer'
import type { FolderRecord } from '@common/Folders'
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
  return value
    .split('\n')
    .map((line, index) => parseHeaderRow(line, index))
    .filter((row): row is HeaderRow => row !== null)
}

export function stringifyHeaderRows(rows: HeaderRow[]) {
  const populatedRows = rows.filter(hasHeaderContent)
  if (populatedRows.length === 0) {
    return ''
  }

  return populatedRows
    .map(row => {
      const prefix = row.enabled ? '' : '//'
      const description = row.description.trim() ? ` // ${row.description.trim()}` : ''
      return `${prefix}${row.key.trim()}:${row.value.trim()}${description}`
    })
    .join('\n')
}

export function createEmptyHeaderRow(): HeaderRow {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    key: '',
    value: '',
    description: '',
  }
}

function parseHeaderRow(line: string, index: number): HeaderRow | null {
  const trimmedLine = line.trim()
  if (!trimmedLine) {
    return null
  }

  const enabled = !trimmedLine.startsWith('//')
  const content = enabled ? trimmedLine : trimmedLine.slice(2)
  const descriptionIndex = content.indexOf(' // ')
  const entry = descriptionIndex >= 0 ? content.slice(0, descriptionIndex) : content
  const description = descriptionIndex >= 0 ? content.slice(descriptionIndex + 4) : ''
  const separatorIndex = entry.indexOf(':')

  if (separatorIndex < 0) {
    return {
      id: `header-${index}`,
      enabled,
      key: entry.trim(),
      value: '',
      description,
    }
  }

  return {
    id: `header-${index}`,
    enabled,
    key: entry.slice(0, separatorIndex).trim(),
    value: entry.slice(separatorIndex + 1).trim(),
    description,
  }
}

function hasHeaderContent(row: HeaderRow) {
  return row.key.trim() !== '' || row.value.trim() !== '' || row.description.trim() !== ''
}
