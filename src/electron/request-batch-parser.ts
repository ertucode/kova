import fs from 'node:fs'
import path from 'node:path'
import { parse as parseCsv } from 'csv-parse/sync'
import XLSX from 'xlsx'
import type {
  ParsedRequestBatch,
  ParseRequestBatchFileInput,
  RequestBatchSourceType,
  RequestBatchVariables,
} from '../common/RequestBatches.js'

type UntrustedRow = Record<string, unknown>

const MAX_BATCH_FILE_BYTES = 50 * 1024 * 1024
const MAX_BATCH_ROWS = 250_000
const MAX_BATCH_COLUMNS = 500
const MAX_BATCH_CELL_LENGTH = 1024 * 1024

export function parseRequestBatchFile(input: ParseRequestBatchFileInput): ParsedRequestBatch {
  const filePath = path.resolve(input.filePath)
  if (fs.statSync(filePath).size > MAX_BATCH_FILE_BYTES) {
    throw new Error('Batch files cannot exceed 50 MB')
  }
  const sourceType = getRequestBatchSourceType(filePath)
  const sourceFileName = path.basename(filePath)

  if (sourceType === 'csv') {
    const records = parseCsv(fs.readFileSync(filePath, 'utf8'), {
      bom: true,
      columns: headers => normalizeHeaders(headers.map(String)),
      relax_column_count: false,
      skip_empty_lines: true,
    }) as UntrustedRow[]
    return buildParsedBatch(records, sourceType, sourceFileName, null, [])
  }

  if (sourceType === 'json') {
    const value: unknown = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    if (!Array.isArray(value)) {
      throw new Error('Batch JSON must contain an array at the root')
    }
    return buildParsedBatch(value, sourceType, sourceFileName, null, [])
  }

  const workbook = XLSX.readFile(filePath)
  const sheetName = input.sheetName ?? workbook.SheetNames[0]
  if (!sheetName || !workbook.Sheets[sheetName]) {
    if (input.sheetName) {
      throw new Error(`Worksheet not found: ${input.sheetName}`)
    }
    throw new Error('Workbook does not contain any worksheets')
  }

  const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
    blankrows: false,
  })
  const [headerValues = [], ...valueRows] = sheetRows
  const headers = normalizeHeaders(
    headerValues.map(value => (value === null || value === undefined ? '' : String(value)))
  )
  const records = valueRows.map((values, rowIndex) => {
    if (
      values.length > headers.length &&
      values.slice(headers.length).some(value => value !== null && value !== undefined)
    ) {
      throw new Error(`Batch row ${rowIndex + 2} has more cells than the header row`)
    }
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? null]))
  })
  return buildParsedBatch(records, sourceType, sourceFileName, sheetName, workbook.SheetNames)
}

export function listRequestBatchSheetNames(filePath: string): string[] {
  if (getRequestBatchSourceType(filePath) !== 'xlsx') {
    return []
  }
  return XLSX.readFile(path.resolve(filePath), { bookSheets: true }).SheetNames
}

function buildParsedBatch(
  inputRows: unknown[],
  sourceType: RequestBatchSourceType,
  sourceFileName: string,
  sheetName: string | null,
  availableSheetNames: string[]
): ParsedRequestBatch {
  if (inputRows.length === 0) {
    throw new Error('Batch file does not contain any data rows')
  }
  if (inputRows.length > MAX_BATCH_ROWS) {
    throw new Error(`Batch files cannot contain more than ${MAX_BATCH_ROWS.toLocaleString()} rows`)
  }
  const columns: string[] = []
  const seenColumns = new Set<string>()
  const rows = inputRows.map((value, rowIndex) => {
    if (!isRecord(value)) {
      throw new Error(`Batch row ${rowIndex + 1} must be an object`)
    }

    const row: RequestBatchVariables = {}
    const rowColumns = new Set<string>()
    for (const [rawKey, cell] of Object.entries(value)) {
      const key = rawKey.trim()
      if (!key) {
        throw new Error(`Batch row ${rowIndex + 1} contains an empty variable name`)
      }
      if (rowColumns.has(key)) {
        throw new Error(`Batch row ${rowIndex + 1} contains duplicate variable "${key}"`)
      }
      rowColumns.add(key)
      if (!seenColumns.has(key)) {
        if (columns.length >= MAX_BATCH_COLUMNS) {
          throw new Error(`Batch files cannot contain more than ${MAX_BATCH_COLUMNS} variables`)
        }
        columns.push(key)
        seenColumns.add(key)
      }
      row[key] = scalarToString(cell, rowIndex, key)
    }
    return row
  })

  return { sourceType, sourceFileName, sheetName, availableSheetNames, columns, rows }
}

function scalarToString(value: unknown, rowIndex: number, key: string): string {
  if (value === null || value === undefined) {
    return ''
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    const normalized = String(value)
    if (normalized.length > MAX_BATCH_CELL_LENGTH) {
      throw new Error(`Batch row ${rowIndex + 1}, column "${key}" exceeds 1 MB`)
    }
    return normalized
  }
  throw new Error(`Batch row ${rowIndex + 1}, column "${key}" contains a nested value`)
}

function normalizeHeaders(headers: string[]) {
  const seen = new Set<string>()
  return headers.map((header, index) => {
    const normalized = header.trim()
    if (!normalized) {
      throw new Error(`Batch column ${index + 1} has an empty name`)
    }
    if (seen.has(normalized)) {
      throw new Error(`Batch contains duplicate variable "${normalized}"`)
    }
    seen.add(normalized)
    return normalized
  })
}

function isRecord(value: unknown): value is UntrustedRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function getRequestBatchSourceType(filePath: string): RequestBatchSourceType {
  const extension = path.extname(filePath).toLowerCase()
  if (extension === '.csv') {
    return 'csv'
  }
  if (extension === '.json') {
    return 'json'
  }
  if (extension === '.xlsx') {
    return 'xlsx'
  }
  throw new Error(`Unsupported batch file type: ${extension || '(none)'}`)
}
