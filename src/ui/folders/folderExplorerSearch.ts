import Fuse from 'fuse.js'
import type { FuseResult, IFuseOptions } from 'fuse.js'
import type { DetailsDraft, TreeNode } from './folderExplorerTypes'

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

function toSelectionKey(node: Pick<TreeNode, 'itemType' | 'id'>) {
  return `${node.itemType}:${node.id}`
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
