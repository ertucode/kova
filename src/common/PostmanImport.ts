export type PostmanImportWarningSeverity = 'info' | 'warning'

export type PostmanImportWarningCode =
  | 'scripts-commented'
  | 'unsupported-script-api'
  | 'collection-variables-ignored'
  | 'protocol-profile-ignored'
  | 'unsupported-auth'
  | 'unsupported-body-mode'
  | 'file-form-data-ignored'

export type PostmanImportWarning = {
  code: PostmanImportWarningCode
  severity: PostmanImportWarningSeverity
  message: string
  count: number
  examples: string[]
}

export type AnalyzePostmanCollectionInput = {
  filePath: string
}

export type PickPostmanCollectionFileResponse = {
  filePath: string
}

export type AnalyzePostmanCollectionResponse = {
  filePath: string
  collectionName: string
  suggestedRootFolderName: string
  folderCount: number
  requestCount: number
  warningCount: number
  exportedByKova: boolean
  hasCollectionAuth: boolean
  hasCollectionScripts: boolean
  hasCollectionHeaders: boolean
  hasCollectionVariables: boolean
  hasCollectionProtocolProfileBehavior: boolean
  warnings: PostmanImportWarning[]
}

export type ImportPostmanCollectionInput = {
  filePath: string
  target: 'new-folder' | 'existing-folder' | 'global'
  targetFolderId?: string
  rootFolderName?: string
  skipRootFolder?: boolean
}

export type ImportPostmanCollectionResponse = {
  createdRootFolderId?: string
  createdRootFolderName?: string
  targetFolderId: string | null
  primaryImportedItem?: {
    itemType: 'folder' | 'request'
    id: string
  }
  folderCount: number
  requestCount: number
  warningCount: number
  warnings: PostmanImportWarning[]
}
