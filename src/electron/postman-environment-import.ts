import fs from 'node:fs'
import path from 'node:path'
import { normalizeEnvironmentColor } from '../common/Environments.js'
import { collectDuplicateEnvironmentKeys } from '../common/EnvironmentVariables.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { stringifyEnvironmentVariables } from '../common/EnvironmentVariables.js'
import type { KeyValueRow } from '../common/KeyValueRows.js'
import {
  type AnalyzePostmanEnvironmentInput,
  type AnalyzePostmanEnvironmentResponse,
  type ImportPostmanEnvironmentInput,
  type ImportPostmanEnvironmentResponse,
  type PickPostmanEnvironmentFileResponse,
  type PostmanEnvironmentImportWarning,
  type PostmanEnvironmentImportWarningCode,
} from '../common/PostmanEnvironmentImport.js'
import { Result } from '../common/Result.js'
import { createEnvironment, updateEnvironment } from './db/environments.js'

type PostmanEnvironment = {
  name?: string
  values?: Array<{ key?: string; value?: string; enabled?: boolean; type?: string; _kova?: { description?: unknown } }>
  color?: unknown
  id?: unknown
  _postman_variable_scope?: unknown
  _postman_exported_at?: unknown
  _postman_exported_using?: unknown
}

type Analysis = {
  environmentName: string
  color: string | null
  variableCount: number
  warnings: PostmanEnvironmentImportWarning[]
  variables: string
}

export async function pickPostmanEnvironmentFile(): Promise<GenericResult<PickPostmanEnvironmentFileResponse>> {
  return GenericError.Message('File picker is handled in main process')
}

export async function analyzePostmanEnvironment(input: AnalyzePostmanEnvironmentInput): Promise<GenericResult<AnalyzePostmanEnvironmentResponse>> {
  try {
    const analysis = analyzeEnvironmentDocument(readPostmanEnvironment(input.filePath))
    return Result.Success({
      filePath: input.filePath,
      environmentName: analysis.environmentName,
      suggestedEnvironmentName: analysis.environmentName,
      variableCount: analysis.variableCount,
      warningCount: analysis.warnings.reduce((sum, warning) => sum + warning.count, 0),
      warnings: analysis.warnings,
    })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function importPostmanEnvironment(input: ImportPostmanEnvironmentInput): Promise<GenericResult<ImportPostmanEnvironmentResponse>> {
  const environmentName = input.environmentName.trim()
  if (!environmentName) {
    return GenericError.Message('Environment name is required')
  }

  try {
    const analysis = analyzeEnvironmentDocument(readPostmanEnvironment(input.filePath))
    const created = await createEnvironment({ name: environmentName })
    if (!created.success) {
      return created
    }

    const updated = await updateEnvironment({
      id: created.data.id,
      name: environmentName,
      variables: analysis.variables,
      color: analysis.color,
      priority: created.data.priority,
    })
    if (!updated.success) {
      return updated
    }

    return Result.Success({
      environmentId: updated.data.id,
      environmentName,
      variableCount: analysis.variableCount,
      warningCount: analysis.warnings.reduce((sum, warning) => sum + warning.count, 0),
      warnings: analysis.warnings,
    })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export function analyzeEnvironmentDocument(document: PostmanEnvironment): Analysis {
  const environmentName = sanitizeName(document.name, 'Imported Environment')
  const color = typeof document.color === 'string' ? normalizeEnvironmentColor(document.color) : null
  const rows: KeyValueRow[] = []
  const warnings = new Map<PostmanEnvironmentImportWarningCode, { count: number; examples: string[] }>()

  for (const [index, value] of (document.values ?? []).entries()) {
    const key = value.key?.trim() ?? ''
    if (!key) {
      addWarning(warnings, 'empty-keys-skipped', 1, [`row ${index + 1}`])
      continue
    }

    rows.push({
      id: `environment-${index}`,
      enabled: value.enabled !== false,
      key,
      value: value.value ?? '',
      description: typeof value._kova?.description === 'string' ? value._kova.description : '',
    })
  }

  const variables = stringifyEnvironmentVariables(rows)
  const duplicateKeys = collectDuplicateEnvironmentKeys({ variables })
  if (duplicateKeys.length > 0) {
    addWarning(warnings, 'duplicate-keys-overridden', duplicateKeys.reduce((sum, entry) => sum + entry.count - 1, 0), duplicateKeys.map(entry => entry.key))
  }

  const disabledRows = rows.filter(row => !row.enabled)
  if (disabledRows.length > 0) {
    addWarning(warnings, 'disabled-variables-commented', disabledRows.length, disabledRows.slice(0, 5).map(row => row.key))
  }

  const metadataCount = Number(Boolean(document.id)) + Number(Boolean(document._postman_variable_scope)) + Number(Boolean(document._postman_exported_at)) + Number(Boolean(document._postman_exported_using))
  if (metadataCount > 0) {
    addWarning(warnings, 'metadata-ignored', metadataCount, [environmentName])
  }

  return {
    environmentName,
    color,
    variableCount: rows.length,
    warnings: buildWarnings(warnings),
    variables,
  }
}

function readPostmanEnvironment(filePath: string) {
  const absolutePath = path.resolve(filePath)
  const raw = fs.readFileSync(absolutePath, 'utf8')
  return JSON.parse(raw) as PostmanEnvironment
}

function sanitizeName(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  return trimmed || fallback
}

function addWarning(
  warnings: Map<PostmanEnvironmentImportWarningCode, { count: number; examples: string[] }>,
  code: PostmanEnvironmentImportWarningCode,
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

function buildWarnings(warnings: Map<PostmanEnvironmentImportWarningCode, { count: number; examples: string[] }>): PostmanEnvironmentImportWarning[] {
  return Array.from(warnings.entries()).map(([code, value]) => ({
    code,
    severity: code === 'duplicate-keys-overridden' ? 'warning' : 'info',
    message: warningMessages[code],
    count: value.count,
    examples: value.examples,
  }))
}

const warningMessages: Record<PostmanEnvironmentImportWarningCode, string> = {
  'duplicate-keys-overridden': 'Some variables are defined more than once. The last enabled value wins.',
  'disabled-variables-commented': 'Disabled Postman variables are imported as commented rows.',
  'metadata-ignored': 'Postman environment metadata is ignored.',
  'empty-keys-skipped': 'Variables with empty keys are skipped.',
}
