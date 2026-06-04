export type OpenApiImportWarningSeverity = 'info' | 'warning'

export type OpenApiImportWarningCode =
  | 'multiple-tags-first-used'
  | 'multiple-servers-first-used'
  | 'unsupported-http-method'
  | 'unsupported-security-scheme'
  | 'unsupported-content-type'
  | 'unsupported-parameter-location'
  | 'callbacks-ignored'
  | 'webhooks-ignored'

export type OpenApiImportWarning = {
  code: OpenApiImportWarningCode
  severity: OpenApiImportWarningSeverity
  message: string
  count: number
  examples: string[]
}

export type AnalyzeOpenApiSpecInput = {
  filePath: string
}

export type PickOpenApiSpecFileResponse = {
  filePath: string
}

export type AnalyzeOpenApiSpecResponse = {
  filePath: string
  specName: string
  suggestedRootFolderName: string
  folderCount: number
  requestCount: number
  warningCount: number
  hasServers: boolean
  hasSecuritySchemes: boolean
  usesTags: boolean
  warnings: OpenApiImportWarning[]
}

export type ImportOpenApiSpecInput = {
  filePath: string
  target: 'new-folder' | 'existing-folder' | 'global'
  targetFolderId?: string
  rootFolderName?: string
}

export type ImportOpenApiSpecResponse = {
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
  warnings: OpenApiImportWarning[]
}
