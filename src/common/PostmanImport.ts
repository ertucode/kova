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
  warnings: PostmanImportWarning[]
}

export type ImportPostmanCollectionInput = {
  filePath: string
  rootFolderName: string
}

export type ImportPostmanCollectionResponse = {
  rootFolderId: string
  rootFolderName: string
  folderCount: number
  requestCount: number
  warningCount: number
  warnings: PostmanImportWarning[]
}
