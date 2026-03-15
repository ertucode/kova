export type PostmanEnvironmentExportWarningCode = 'variable-descriptions-stored-in-metadata'

export type PostmanEnvironmentExportWarning = {
  code: PostmanEnvironmentExportWarningCode
  severity: 'info' | 'warning'
  message: string
  count: number
  examples: string[]
}

export type PickPostmanEnvironmentExportFileInput = {
  suggestedFileName: string
}

export type PickPostmanEnvironmentExportFileResponse = {
  filePath: string
}

export type AnalyzePostmanEnvironmentExportInput = {
  environmentId: string
}

export type AnalyzePostmanEnvironmentExportResponse = {
  environmentId: string
  environmentName: string
  suggestedEnvironmentName: string
  variableCount: number
  warningCount: number
  warnings: PostmanEnvironmentExportWarning[]
}

export type ExportPostmanEnvironmentInput = {
  environmentId: string
  environmentName: string
  filePath: string
}

export type ExportPostmanEnvironmentResponse = {
  environmentId: string
  environmentName: string
  filePath: string
  variableCount: number
  warningCount: number
  warnings: PostmanEnvironmentExportWarning[]
}
