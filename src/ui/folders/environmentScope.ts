import { buildEnvironmentVariableMap, resolveEnvironmentVariables } from '@common/EnvironmentVariables'
import type { EnvironmentRecord } from '@common/Environments'
import type { ExplorerItem } from '@common/Explorer'
import type { Selection } from './folderExplorerTypes'
import type { EnvironmentEntry } from './environmentEditorStore'

export type ScopedEnvironmentRecord = EnvironmentRecord & {
  scopeType: 'workspace' | 'folder'
  isActive: boolean
  scopeFolderPath: string[]
  scopeLabel: string | null
}

export function getSelectionEnvironmentFolderId(items: ExplorerItem[], selection: Selection | null) {
  if (!selection) {
    return null
  }

  switch (selection.itemType) {
    case 'folder':
      return selection.id
    case 'request':
      return (
        items.find(
          (item): item is Extract<ExplorerItem, { itemType: 'request' }> =>
            item.itemType === 'request' && item.id === selection.id
        )?.parentFolderId ?? null
      )
    case 'example': {
      const example = items.find(
        (item): item is Extract<ExplorerItem, { itemType: 'example' }> =>
          item.itemType === 'example' && item.id === selection.id
      )
      if (!example) {
        return null
      }

      return (
        items.find(
          (item): item is Extract<ExplorerItem, { itemType: 'request' }> =>
            item.itemType === 'request' && item.id === example.requestId
        )?.parentFolderId ?? null
      )
    }
  }
}

export function buildEnvironmentScope(input: {
  environments: EnvironmentRecord[]
  environmentEntries: Record<string, EnvironmentEntry>
  activeEnvironmentIds: string[]
  inactiveFolderEnvironmentIds: string[]
  explorerItems: ExplorerItem[]
  folderId: string | null
}) {
  const ancestorFolderIds = getAncestorFolderIds(input.explorerItems, input.folderId)
  const folderPathById = new Map(
    ancestorFolderIds.map(folderId => [folderId, getFolderPathById(input.explorerItems, folderId)])
  )

  const workspaceEnvironments = input.environments
    .filter(environment => environment.folderId == null)
    .map(environment =>
      toScopedEnvironment(
        environment,
        input.environmentEntries,
        input.activeEnvironmentIds.includes(environment.id),
        [],
        null
      )
    )
    .sort((left, right) => left.position - right.position || right.createdAt - left.createdAt)

  const visibleFolderEnvironments = ancestorFolderIds
    .slice()
    .reverse()
    .flatMap(folderId => {
      const scopeFolderPath = folderPathById.get(folderId) ?? []
      return input.environments
        .filter(environment => environment.folderId === folderId)
        .map(environment =>
          toScopedEnvironment(
            environment,
            input.environmentEntries,
            true,
            scopeFolderPath,
            scopeFolderPath.join(' / ') || null
          )
        )
        .sort((left, right) => left.position - right.position || right.createdAt - left.createdAt)
    })

  const inactiveFolderEnvironmentIdSet = new Set(input.inactiveFolderEnvironmentIds)
  const activeFolderEnvironments = visibleFolderEnvironments.map(environment => ({
    ...environment,
    isActive: !inactiveFolderEnvironmentIdSet.has(environment.id),
  }))

  const effectiveEnvironmentsForDisplay = [
    ...activeFolderEnvironments.filter(environment => environment.isActive),
    ...workspaceEnvironments.filter(environment => environment.isActive),
  ]
  const effectiveEnvironmentsForResolution = [
    ...activeFolderEnvironments
      .filter(environment => environment.isActive)
      .slice()
      .sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt),
    ...workspaceEnvironments
      .filter(environment => environment.isActive)
      .slice()
      .sort((left, right) => right.priority - left.priority || right.createdAt - left.createdAt),
  ]
  const specificityById = new Map(
    effectiveEnvironmentsForResolution.map((environment, index) => [environment.id, effectiveEnvironmentsForResolution.length - index])
  )
  const activeEnvironmentNames = effectiveEnvironmentsForDisplay.map(environment => environment.name)
  const activeEnvironmentVariableNames = Object.keys(
    buildEnvironmentVariableMap(effectiveEnvironmentsForResolution, environment => specificityById.get(environment.id) ?? 0)
  )

  return {
    workspaceEnvironments,
    visibleFolderEnvironments: activeFolderEnvironments,
    effectiveEnvironments: effectiveEnvironmentsForDisplay,
    tooltipEnvironments: [...activeFolderEnvironments, ...workspaceEnvironments],
    activeEnvironmentNames,
    activeEnvironmentVariableNames,
    specificityById,
  }
}

export function createVariableValueMap(environment: Pick<EnvironmentRecord, 'variables'>) {
  return new Map(
    Array.from(resolveEnvironmentVariables(environment).entries()).map(([key, row]) => [key, row.value])
  )
}

function toScopedEnvironment(
  environment: EnvironmentRecord,
  environmentEntries: Record<string, EnvironmentEntry>,
  isActive: boolean,
  scopeFolderPath: string[],
  scopeLabel: string | null
): ScopedEnvironmentRecord {
  const draft = environmentEntries[environment.id]?.current
  return {
    ...environment,
    name: draft?.name ?? environment.name,
    variables: draft?.variables ?? environment.variables,
    color: draft?.color ?? environment.color,
    warnOnRequest: draft?.warnOnRequest ?? environment.warnOnRequest,
    priority: draft?.priority ?? environment.priority,
    scopeType: environment.folderId == null ? 'workspace' : 'folder',
    isActive,
    scopeFolderPath,
    scopeLabel,
  }
}

function getAncestorFolderIds(items: ExplorerItem[], folderId: string | null) {
  if (!folderId) {
    return []
  }

  const itemMap = new Map(items.map(item => [item.id, item] as const))
  const ancestorFolderIds: string[] = []
  let currentFolderId: string | null = folderId

  while (currentFolderId) {
    const currentFolder = itemMap.get(currentFolderId)
    if (!currentFolder || currentFolder.itemType !== 'folder') {
      break
    }

    ancestorFolderIds.unshift(currentFolder.id)
    currentFolderId = currentFolder.parentFolderId
  }

  return ancestorFolderIds
}

function getFolderPathById(items: ExplorerItem[], folderId: string) {
  const itemMap = new Map(items.map(item => [item.id, item] as const))
  const segments: string[] = []
  let currentFolderId: string | null = folderId

  while (currentFolderId) {
    const currentFolder = itemMap.get(currentFolderId)
    if (!currentFolder || currentFolder.itemType !== 'folder') {
      break
    }

    segments.unshift(currentFolder.name)
    currentFolderId = currentFolder.parentFolderId
  }

  return segments
}
