import type { ExplorerItem } from '@common/Explorer'
import type { FolderRecord } from '@common/Folders'
import { createEmptyKeyValueRow, parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'
import type { RequestExampleRecord } from '@common/RequestExamples'
import type { HttpRequestRecord } from '@common/Requests'
import type { WebSocketExampleRecord } from '@common/WebSocketExamples'
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
    if (node.itemType === 'example') {
      const parent = treeMap.get(`request:${node.requestId}`)
      if (parent) {
        parent.children.push(node)
        return
      }

      roots.push(node)
      return
    }

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
    const exampleMatch = node.itemType === 'example'
      ? `${node.name} ${node.responseStatus ?? ''} ${node.messageCount ?? ''}`.toLowerCase().includes(query)
      : false
    const isMatch = node.name.toLowerCase().includes(query) || requestMatch || exampleMatch

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
    headers: folder.headers,
    auth: folder.auth,
    preRequestScript: folder.preRequestScript,
    postRequestScript: folder.postRequestScript,
  }
}

export function toRequestDetailsDraft(request: HttpRequestRecord): RequestDetailsDraft {
  return {
    itemType: 'request',
    name: request.name,
    requestType: request.requestType,
    method: request.method,
    url: request.url,
    pathParams: request.pathParams,
    searchParams: request.searchParams,
    auth: request.auth,
    preRequestScript: request.preRequestScript,
    postRequestScript: request.postRequestScript,
    responseVisualizer: request.responseVisualizer,
    prefersResponseVisualizer: request.prefersResponseVisualizer,
    headers: request.headers,
    body: request.body,
    bodyType: request.bodyType,
    rawType: request.rawType,
    websocketSubprotocols: request.websocketSubprotocols,
    saveToHistory: request.saveToHistory,
  }
}

export function toRequestExampleDetailsDraft(example: RequestExampleRecord) {
  return {
    itemType: 'example' as const,
    exampleType: 'http' as const,
    name: example.name,
    requestHeaders: example.requestHeaders,
    requestBody: example.requestBody,
    requestBodyType: example.requestBodyType,
    requestRawType: example.requestRawType,
    responseStatus: example.responseStatus,
    responseStatusText: example.responseStatusText,
    responseHeaders: example.responseHeaders,
    responseBody: example.responseBody,
  }
}

export function toWebSocketExampleDetailsDraft(example: WebSocketExampleRecord) {
  return {
    itemType: 'example' as const,
    exampleType: 'websocket' as const,
    name: example.name,
    requestHeaders: example.requestHeaders,
    requestBody: example.requestBody,
    messages: example.messages,
  }
}

export function toDetailsDraft(value: DetailEntity): DetailsDraft {
  if ('method' in value) {
    return toRequestDetailsDraft(value)
  }

  if ('messages' in value) {
    return toWebSocketExampleDetailsDraft(value)
  }

  if ('requestId' in value) {
    return toRequestExampleDetailsDraft(value)
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
