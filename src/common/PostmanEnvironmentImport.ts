export type PostmanEnvironmentImportWarningCode =
  | 'duplicate-keys-overridden'
  | 'disabled-variables-commented'
  | 'metadata-ignored'
  | 'empty-keys-skipped'

export type PostmanEnvironmentImportWarning = {
  code: PostmanEnvironmentImportWarningCode
  severity: 'info' | 'warning'
  message: string
  count: number
  examples: string[]
}

export type PickPostmanEnvironmentFileResponse = {
  filePath: string
}

export type AnalyzePostmanEnvironmentInput = {
  filePath: string
}

export type AnalyzePostmanEnvironmentResponse = {
  filePath: string
  environmentName: string
  suggestedEnvironmentName: string
  variableCount: number
  warningCount: number
  warnings: PostmanEnvironmentImportWarning[]
}

export type ImportPostmanEnvironmentInput = {
  filePath: string
  environmentName: string
}

export type ImportPostmanEnvironmentResponse = {
  environmentId: string
  environmentName: string
  variableCount: number
  warningCount: number
  warnings: PostmanEnvironmentImportWarning[]
}
