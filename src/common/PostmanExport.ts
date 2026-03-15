export type PostmanCollectionExportTarget =
  | { scope: 'workspace' }
  | { scope: 'folder'; folderId: string }
  | { scope: 'request'; requestId: string }

export type PostmanExportWarningCode = 'folder-headers-stored-in-metadata'

export type PostmanExportWarning = {
  code: PostmanExportWarningCode
  severity: 'info' | 'warning'
  message: string
  count: number
  examples: string[]
}

export type PickPostmanCollectionExportFileInput = {
  suggestedFileName: string
}

export type PickPostmanCollectionExportFileResponse = {
  filePath: string
}

export type AnalyzePostmanCollectionExportInput = PostmanCollectionExportTarget

export type AnalyzePostmanCollectionExportResponse = {
  scope: 'workspace' | 'folder' | 'request'
  folderId: string | null
  requestId: string | null
  suggestedCollectionName: string
  folderCount: number
  requestCount: number
  exampleCount: number
  warningCount: number
  warnings: PostmanExportWarning[]
}

export type ExportPostmanCollectionInput = {
  filePath: string
  collectionName: string
} & PostmanCollectionExportTarget

export type ExportPostmanCollectionResponse = {
  filePath: string
  collectionName: string
  folderCount: number
  requestCount: number
  exampleCount: number
  warningCount: number
  warnings: PostmanExportWarning[]
}
