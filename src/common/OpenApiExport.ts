export type OpenApiExportTarget =
  | { scope: 'workspace' }
  | { scope: 'folder'; folderId: string }
  | { scope: 'request'; requestId: string }

export type OpenApiExportWarningCode =
  | 'websocket-requests-skipped'
  | 'graphql-requests-merged-by-endpoint'
  | 'folder-headers-not-exported'
  | 'folder-scripts-not-exported'
  | 'request-scripts-not-exported'
  | 'response-visualizer-not-exported'
  | 'token-refresh-config-not-exported'
  | 'disabled-rows-skipped'
  | 'mixed-servers-exported-with-operation-servers'
  | 'duplicate-path-method-skipped'

export type OpenApiExportWarning = {
  code: OpenApiExportWarningCode
  severity: 'info' | 'warning'
  message: string
  count: number
  examples: string[]
}

export type PickOpenApiSpecExportFileInput = {
  suggestedFileName: string
}

export type PickOpenApiSpecExportFileResponse = {
  filePath: string
}

export type AnalyzeOpenApiSpecExportInput = OpenApiExportTarget

export type AnalyzeOpenApiSpecExportResponse = {
  scope: 'workspace' | 'folder' | 'request'
  folderId: string | null
  requestId: string | null
  suggestedSpecName: string
  folderCount: number
  requestCount: number
  exampleCount: number
  warningCount: number
  warnings: OpenApiExportWarning[]
}

export type ExportOpenApiSpecInput = {
  filePath: string
  specName: string
} & OpenApiExportTarget

export type ExportOpenApiSpecResponse = {
  filePath: string
  specName: string
  folderCount: number
  requestCount: number
  exampleCount: number
  warningCount: number
  warnings: OpenApiExportWarning[]
}
