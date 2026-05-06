import type { ExplorerItem } from '@common/Explorer'
import type { FolderRecord } from '@common/Folders'
import { createEmptyKeyValueRow, parseKeyValueRows, stringifyKeyValueRows } from '@common/KeyValueRows'
import type { RequestExampleRecord } from '@common/RequestExamples'
import type { HttpRequestRecord } from '@common/Requests'
import type { WebSocketExampleRecord } from '@common/WebSocketExamples'
import Fuse from 'fuse.js'
import type { FuseResult, IFuseOptions } from 'fuse.js'
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
  return filterTreeWithDrafts(nodes, query)
}

export type SearchDraftEntries = Record<string, { base: DetailsDraft | null; current: DetailsDraft | null } | undefined>
export type SearchTagNames = Record<string, string[] | undefined>

type SearchDocument = {
  selectionKey: string
  textParts: string[]
  tagNames: string[]
}

type SearchBundle = {
  textFuse: Fuse<SearchDocument>
  tagFuse: Fuse<SearchDocument>
  queryResultCache: Map<string, TreeNode[]>
}

type SearchTermGroups = {
  textTerms: string[]
  tagTerms: string[]
}

type EntriesBundleCache = WeakMap<object, WeakMap<object, SearchBundle>>

const FUSE_OPTIONS: IFuseOptions<SearchDocument> = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.35,
  keys: ['textParts'],
}

const TAG_FUSE_OPTIONS: IFuseOptions<SearchDocument> = {
  includeScore: true,
  ignoreLocation: true,
  threshold: 0.35,
  keys: ['tagNames'],
}

const EMPTY_ENTRIES_SENTINEL: SearchDraftEntries = {}
const EMPTY_TAG_NAMES_SENTINEL: SearchTagNames = {}

export type FolderTreeSearchManager = {
  filter: (
    nodes: TreeNode[],
    query: string,
    entries?: SearchDraftEntries,
    tagNamesBySelection?: SearchTagNames
  ) => TreeNode[]
}

export function createFolderTreeSearchManager(): FolderTreeSearchManager {
  const bundleCacheByNodes = new WeakMap<TreeNode[], EntriesBundleCache>()

  return {
    filter(nodes, query, entries, tagNamesBySelection) {
      const normalizedQuery = query.trim().toLowerCase()
      if (!normalizedQuery) {
        return nodes
      }

      const termGroups = parseSearchTerms(normalizedQuery)
      if (termGroups.textTerms.length === 0 && termGroups.tagTerms.length === 0) {
        return nodes
      }

      const searchBundle = getSearchBundle(nodes, entries, tagNamesBySelection)
      const cacheKey = buildQueryCacheKey(termGroups)
      const cachedResult = searchBundle.queryResultCache.get(cacheKey)
      if (cachedResult) {
        return cachedResult
      }

      const scoreByKey = searchMatchingScores(searchBundle, termGroups)
      const filteredTree = filterNodesByMatchingScore(nodes, scoreByKey)
      searchBundle.queryResultCache.set(cacheKey, filteredTree)
      return filteredTree
    },
  }

  function getSearchBundle(nodes: TreeNode[], entries?: SearchDraftEntries, tagNamesBySelection?: SearchTagNames): SearchBundle {
    let bundleCacheByEntries = bundleCacheByNodes.get(nodes)
    if (!bundleCacheByEntries) {
      bundleCacheByEntries = new WeakMap<object, WeakMap<object, SearchBundle>>()
      bundleCacheByNodes.set(nodes, bundleCacheByEntries)
    }

    const entriesKey = entries ?? EMPTY_ENTRIES_SENTINEL
    let bundleCacheByTags = bundleCacheByEntries.get(entriesKey)
    if (!bundleCacheByTags) {
      bundleCacheByTags = new WeakMap<object, SearchBundle>()
      bundleCacheByEntries.set(entriesKey, bundleCacheByTags)
    }

    const tagNamesKey = tagNamesBySelection ?? EMPTY_TAG_NAMES_SENTINEL
    const cachedBundle = bundleCacheByTags.get(tagNamesKey)
    if (cachedBundle) {
      return cachedBundle
    }

    const searchDocuments = flattenSearchDocuments(nodes, entries, tagNamesBySelection)
    const searchBundle = {
      textFuse: new Fuse(searchDocuments, FUSE_OPTIONS),
      tagFuse: new Fuse(searchDocuments, TAG_FUSE_OPTIONS),
      queryResultCache: new Map<string, TreeNode[]>(),
    }
    bundleCacheByTags.set(tagNamesKey, searchBundle)
    return searchBundle
  }
}

const defaultFolderTreeSearchManager = createFolderTreeSearchManager()

export function filterTreeWithDrafts(
  nodes: TreeNode[],
  query: string,
  entries?: SearchDraftEntries,
  tagNamesBySelection?: SearchTagNames
): TreeNode[] {
  return defaultFolderTreeSearchManager.filter(nodes, query, entries, tagNamesBySelection)
}

export function getSearchParts(node: TreeNode, entries?: SearchDraftEntries): string[] {
  if (node.itemType === 'request') {
    const entry = entries?.[toSelectionKey(node)]
    const baseDraft = entry?.base?.itemType === 'request' ? entry.base : null
    const currentDraft = entry?.current?.itemType === 'request' ? entry.current : null

    return [...new Set([
      node.name,
      node.method,
      node.url,
      baseDraft?.name ?? '',
      baseDraft?.method ?? '',
      baseDraft?.url ?? '',
      currentDraft?.name ?? '',
      currentDraft?.method ?? '',
      currentDraft?.url ?? '',
    ].filter(Boolean))]
  }

  if (node.itemType === 'example') {
    return [node.name, `${node.responseStatus ?? ''}`, `${node.messageCount ?? ''}`]
  }

  return [node.name]
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
    responseTableAccessor: request.responseTableAccessor,
    preferredResponseBodyView: request.preferredResponseBodyView,
    headers: request.headers,
    body: request.body,
    bodyType: request.bodyType,
    rawType: request.rawType,
    websocketSubprotocols: request.websocketSubprotocols,
    websocketOnOpenMessage: request.websocketOnOpenMessage,
    websocketAutoSendEnabled: request.websocketAutoSendEnabled,
    websocketAutoSendMessage: request.websocketAutoSendMessage,
    websocketAutoSendIntervalSeconds: request.websocketAutoSendIntervalSeconds,
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

function parseSearchTerms(query: string): SearchTermGroups {
  const textTerms = new Set<string>()
  const tagTerms = new Set<string>()

  query
    .split(/\s+/u)
    .map(value => value.trim())
    .filter(Boolean)
    .forEach(term => {
      if (term.startsWith('@')) {
        const normalizedTagTerm = term.slice(1)
        if (normalizedTagTerm) {
          tagTerms.add(normalizedTagTerm)
        }
        return
      }

      textTerms.add(term)
    })

  return {
    textTerms: [...textTerms].sort(),
    tagTerms: [...tagTerms].sort(),
  }
}

function buildQueryCacheKey({ textTerms, tagTerms }: SearchTermGroups): string {
  return `text:${textTerms.join('\u0001')}|tags:${tagTerms.join('\u0001')}`
}

function flattenSearchDocuments(
  nodes: TreeNode[],
  entries?: SearchDraftEntries,
  tagNamesBySelection?: SearchTagNames
): SearchDocument[] {
  const searchDocuments: SearchDocument[] = []

  const visit = (currentNodes: TreeNode[]) => {
    currentNodes.forEach(node => {
      const selectionKey = toSelectionKey(node)
      searchDocuments.push({
        selectionKey,
        textParts: buildSearchIndexValues(getSearchParts(node, entries)),
        tagNames: buildSearchIndexValues(tagNamesBySelection?.[selectionKey] ?? []),
      })

      if (node.children.length > 0) {
        visit(node.children)
      }
    })
  }

  visit(nodes)
  return searchDocuments
}

function buildSearchIndexValues(values: string[]): string[] {
  const normalizedValues = new Set<string>()

  values.forEach(value => {
    const normalizedValue = value.trim().toLowerCase()
    if (!normalizedValue) {
      return
    }

    normalizedValues.add(normalizedValue)

    const whitespaceNormalizedValue = normalizedValue.replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
    if (whitespaceNormalizedValue) {
      normalizedValues.add(whitespaceNormalizedValue)

      const tokens = whitespaceNormalizedValue.split(/\s+/u).filter(Boolean)
      tokens.forEach(token => {
        if (token) {
          normalizedValues.add(token)
        }
      })

      buildTokenPrefixBlendVariants(tokens).forEach(variant => {
        normalizedValues.add(variant)
      })
    }

    const collapsedValue = normalizedValue.replace(/[^\p{L}\p{N}]+/gu, '')
    if (collapsedValue) {
      normalizedValues.add(collapsedValue)
    }
  })

  return [...normalizedValues]
}

function buildTokenPrefixBlendVariants(tokens: string[]): string[] {
  if (tokens.length < 2) {
    return []
  }

  const variants = new Set<string>()
  const maxWindowSize = Math.min(tokens.length, 3)

  for (let windowSize = 2; windowSize <= maxWindowSize; windowSize += 1) {
    for (let startIndex = 0; startIndex <= tokens.length - windowSize; startIndex += 1) {
      const tokenWindow = tokens.slice(startIndex, startIndex + windowSize)
      collectTokenPrefixBlendVariants(tokenWindow, 0, '', variants)
    }
  }

  return [...variants]
}

function collectTokenPrefixBlendVariants(
  tokens: string[],
  tokenIndex: number,
  currentValue: string,
  variants: Set<string>
) {
  if (variants.size >= 64) {
    return
  }

  if (tokenIndex >= tokens.length) {
    if (currentValue) {
      variants.add(currentValue)
    }
    return
  }

  const token = tokens[tokenIndex]
  const maxPrefixLength = Math.min(token.length, 5)

  for (let prefixLength = 2; prefixLength <= maxPrefixLength; prefixLength += 1) {
    collectTokenPrefixBlendVariants(tokens, tokenIndex + 1, `${currentValue}${token.slice(0, prefixLength)}`, variants)
  }
}

function searchMatchingScores(searchBundle: SearchBundle, { textTerms, tagTerms }: SearchTermGroups): Map<string, number> {
  let scoreByKey: Map<string, number> | null = null

  textTerms.forEach(term => {
    scoreByKey = intersectMatchingScores(scoreByKey, searchBundle.textFuse.search(term))
  })

  tagTerms.forEach(term => {
    scoreByKey = intersectMatchingScores(scoreByKey, searchBundle.tagFuse.search(term))
  })

  return scoreByKey ?? new Map<string, number>()
}

function intersectMatchingScores(
  currentScores: Map<string, number> | null,
  results: ReadonlyArray<FuseResult<SearchDocument>>
): Map<string, number> {
  const nextScores = new Map(results.map(result => [result.item.selectionKey, result.score ?? 1]))
  if (!currentScores) {
    return nextScores
  }

  return new Map(
    [...currentScores.entries()]
      .filter(([selectionKey]) => nextScores.has(selectionKey))
      .map(([selectionKey, score]) => [selectionKey, score + (nextScores.get(selectionKey) ?? 1)])
  )
}

function filterNodesByMatchingScore(nodes: TreeNode[], scoreByKey: Map<string, number>): TreeNode[] {
  return nodes
    .map((node, index) => buildRankedNode(node, index, scoreByKey))
    .filter((entry): entry is RankedTreeNode => entry !== null)
    .sort((left, right) => left.sortScore - right.sortScore || left.originalIndex - right.originalIndex)
    .map(entry => entry.node)
}

type RankedTreeNode = {
  node: TreeNode
  sortScore: number
  originalIndex: number
}

function buildRankedNode(node: TreeNode, originalIndex: number, scoreByKey: Map<string, number>): RankedTreeNode | null {
  const rankedChildren = node.children
    .map((child, childIndex) => buildRankedNode(child, childIndex, scoreByKey))
    .filter((entry): entry is RankedTreeNode => entry !== null)
    .sort((left, right) => left.sortScore - right.sortScore || left.originalIndex - right.originalIndex)

  const ownScore = scoreByKey.get(toSelectionKey(node))
  const bestChildScore = rankedChildren[0]?.sortScore
  const sortScore = Math.min(ownScore ?? Number.POSITIVE_INFINITY, bestChildScore ?? Number.POSITIVE_INFINITY)

  if (!Number.isFinite(sortScore)) {
    return null
  }

  return {
    node: {
      ...node,
      children: rankedChildren.map(entry => entry.node),
    },
    sortScore,
    originalIndex,
  }
}
