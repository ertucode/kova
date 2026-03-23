import fs from 'node:fs'
import path from 'node:path'
import { parseKeyValueRows } from '../common/KeyValueRows.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import {
  type AnalyzePostmanEnvironmentExportInput,
  type AnalyzePostmanEnvironmentExportResponse,
  type ExportPostmanEnvironmentInput,
  type ExportPostmanEnvironmentResponse,
  type PickPostmanEnvironmentExportFileResponse,
  type PostmanEnvironmentExportWarning,
  type PostmanEnvironmentExportWarningCode,
} from '../common/PostmanEnvironmentExport.js'
import type { EnvironmentRecord } from '../common/Environments.js'
import { Result } from '../common/Result.js'
import { listEnvironments } from './db/environments.js'

type PostmanEnvironmentDocument = {
  name: string
  values: PostmanEnvironmentValue[]
  color?: string
  _kova: {
    warnOnRequest: boolean
  }
  _postman_variable_scope: 'environment'
}

type PostmanEnvironmentValue = {
  key: string
  value: string
  enabled: boolean
  type: 'text'
  _kova?: {
    description?: string
  }
}

type ExportAnalysis = {
  environmentId: string
  environmentName: string
  variableCount: number
  warnings: PostmanEnvironmentExportWarning[]
}

export async function pickPostmanEnvironmentExportFile(): Promise<GenericResult<PickPostmanEnvironmentExportFileResponse>> {
  return GenericError.Message('Save dialog is handled in main process')
}

export async function analyzePostmanEnvironmentExport(
  input: AnalyzePostmanEnvironmentExportInput
): Promise<GenericResult<AnalyzePostmanEnvironmentExportResponse>> {
  try {
    const environment = await loadEnvironment(input.environmentId)
    const analysis = analyzeEnvironmentExport(environment)
    return Result.Success({
      environmentId: environment.id,
      environmentName: environment.name,
      suggestedEnvironmentName: environment.name,
      variableCount: analysis.variableCount,
      warningCount: analysis.warnings.reduce((sum, warning) => sum + warning.count, 0),
      warnings: analysis.warnings,
    })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function exportPostmanEnvironment(input: ExportPostmanEnvironmentInput): Promise<GenericResult<ExportPostmanEnvironmentResponse>> {
  const environmentName = input.environmentName.trim()
  if (!environmentName) {
    return GenericError.Message('Environment name is required')
  }

  try {
    const environment = await loadEnvironment(input.environmentId)
    const analysis = analyzeEnvironmentExport(environment)
    const document = buildEnvironmentExportDocument(environment, environmentName)
    const filePath = path.resolve(input.filePath)
    fs.writeFileSync(filePath, `${JSON.stringify(document, null, 2)}\n`, 'utf8')

    return Result.Success({
      environmentId: environment.id,
      environmentName,
      filePath,
      variableCount: analysis.variableCount,
      warningCount: analysis.warnings.reduce((sum, warning) => sum + warning.count, 0),
      warnings: analysis.warnings,
    })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export function analyzeEnvironmentExport(environment: EnvironmentRecord): ExportAnalysis {
  const warnings = new Map<PostmanEnvironmentExportWarningCode, { count: number; examples: string[] }>()
  const rowsWithDescriptions = parseKeyValueRows(environment.variables).filter(row => row.description.trim())

  if (rowsWithDescriptions.length > 0) {
    addWarning(
      warnings,
      'variable-descriptions-stored-in-metadata',
      rowsWithDescriptions.length,
      rowsWithDescriptions.slice(0, 5).map(row => row.key || '(empty key)')
    )
  }

  return {
    environmentId: environment.id,
    environmentName: environment.name,
    variableCount: parseKeyValueRows(environment.variables).length,
    warnings: buildWarnings(warnings),
  }
}

export function buildEnvironmentExportDocument(environment: EnvironmentRecord, environmentName: string): PostmanEnvironmentDocument {
  return {
    name: environmentName,
    color: environment.color ?? undefined,
    _kova: {
      warnOnRequest: environment.warnOnRequest,
    },
    _postman_variable_scope: 'environment',
    values: parseKeyValueRows(environment.variables).map(row => ({
      key: row.key,
      value: row.value,
      enabled: row.enabled,
      type: 'text',
      _kova: row.description.trim() ? { description: row.description } : undefined,
    })),
  }
}

async function loadEnvironment(environmentId: string) {
  const environments = await listEnvironments()
  const environment = environments.find(entry => entry.id === environmentId)
  if (!environment) {
    throw new Error('Environment not found')
  }

  return environment
}

function addWarning(
  warnings: Map<PostmanEnvironmentExportWarningCode, { count: number; examples: string[] }>,
  code: PostmanEnvironmentExportWarningCode,
  count: number,
  examples: string[]
) {
  const current = warnings.get(code) ?? { count: 0, examples: [] }
  current.count += count

  for (const example of examples) {
    if (example && !current.examples.includes(example) && current.examples.length < 5) {
      current.examples.push(example)
    }
  }

  warnings.set(code, current)
}

function buildWarnings(
  warnings: Map<PostmanEnvironmentExportWarningCode, { count: number; examples: string[] }>
): PostmanEnvironmentExportWarning[] {
  return Array.from(warnings.entries()).map(([code, value]) => ({
    code,
    severity: 'info',
    message: warningMessages[code],
    count: value.count,
    examples: value.examples,
  }))
}

const warningMessages: Record<PostmanEnvironmentExportWarningCode, string> = {
  'variable-descriptions-stored-in-metadata': 'Variable descriptions are stored in Kova metadata. Postman will ignore them unless you import the file back into Kova.',
}
