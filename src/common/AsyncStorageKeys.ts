export const AsyncStorageKeys = {
  favorites: 'favorites',
  recents: 'recents',
  settings: 'settings',
  tags: 'tags',
  folderExplorerDrafts: 'folderExplorerDrafts',
  oneTimeLayoutModel: 'oneTimeLayoutModel',
  customLayouts: 'customLayouts',
  columnPrefs: 'columnPrefs',
  defaultPath: 'defaultPath',
  batchRenameTemplates: 'batchRenameTemplates',
  batchRenameUndoHistory: 'batchRenameUndoHistory',
  customShortcuts: 'customShortcuts',
} as const
export type AsyncStorageKey = (typeof AsyncStorageKeys)[keyof typeof AsyncStorageKeys]
