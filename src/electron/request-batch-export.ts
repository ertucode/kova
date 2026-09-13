import { writeFile } from 'node:fs/promises'
import * as XLSX from 'xlsx'
import type { RequestBatchExportData } from './db/request-batches.js'

const MAX_CELL_LENGTH = 32767
const MAX_SHEET_ROWS = 1048576
const MAX_SHEET_COLUMNS = 16384
type CellValue = string | number

export async function writeRequestBatchExport(data: RequestBatchExportData, filePath: string) {
  const workbook = buildRequestBatchWorkbook(data)
  await writeFile(filePath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx', compression: true }))
}

export function buildRequestBatchWorkbook({ batch, rows }: RequestBatchExportData) {
  const headers = [
    '#',
    'Status',
    ...batch.columns,
    'Request URL',
    'HTTP status',
    'Duration (ms)',
    'Request body',
    'Response headers',
    'Response body',
    'Response error',
    'Response body omitted',
  ]
  const values: CellValue[][] = rows.map(({ row, history }) => [
    row.rowIndex + 1,
    row.status === 'http-error' ? 'HTTP error' : row.status,
    ...batch.columns.map(column => row.variables[column] ?? ''),
    history?.requestUrl ?? '',
    history?.responseStatus ?? '',
    history?.durationMs ?? '',
    history?.requestBody ?? '',
    history?.responseHeaders ?? '',
    history?.responseBody ?? '',
    history?.responseError ?? '',
    history ? (history.responseBodyOmitted ? 'Yes' : 'No') : '',
  ])

  // Excel cannot store more than 32,767 characters in one cell. Keep all saved
  // text by placing the remaining chunks in adjacent, labeled columns.
  const columnParts = headers.map(() => 1)
  const splitRows = values.map(row => row.map((value, index) => {
    const parts = splitCell(value)
    columnParts[index] = Math.max(columnParts[index], parts.length)
    return parts
  }))
  const expandedHeaders = headers.flatMap((header, index) =>
    Array.from({ length: columnParts[index] }, (_, part) => part === 0 ? header : `${header} (continued ${part + 1})`)
  )
  if (expandedHeaders.length > MAX_SHEET_COLUMNS) {
    throw new Error('This batch exceeds the Excel worksheet column limit.')
  }

  const workbook = XLSX.utils.book_new()
  const rowsPerSheet = MAX_SHEET_ROWS - 1
  const sheetCount = Math.max(1, Math.ceil(splitRows.length / rowsPerSheet))
  for (let index = 0; index < sheetCount; index++) {
    const sheetRows = splitRows.slice(index * rowsPerSheet, (index + 1) * rowsPerSheet).map(row =>
      row.flatMap((parts, column) => Array.from({ length: columnParts[column] }, (_, part) => parts[part] ?? ''))
    )
    const sheet = XLSX.utils.aoa_to_sheet([expandedHeaders, ...sheetRows])
    sheet['!autofilter'] = { ref: XLSX.utils.encode_range({ r: 0, c: 0 }, { r: sheetRows.length, c: expandedHeaders.length - 1 }) }
    sheet['!cols'] = expandedHeaders.map((_, column) => ({ wch: column === 0 ? 8 : 28 }))
    XLSX.utils.book_append_sheet(workbook, sheet, index === 0 ? 'Batch results' : `Batch results ${index + 1}`)
  }
  return workbook
}

function splitCell(value: CellValue): CellValue[] {
  if (typeof value === 'number' || value.length <= MAX_CELL_LENGTH) return [value]
  const parts: string[] = []
  for (let offset = 0; offset < value.length;) {
    let end = Math.min(offset + MAX_CELL_LENGTH, value.length)
    const lastCode = value.charCodeAt(end - 1)
    if (end < value.length && lastCode >= 0xd800 && lastCode <= 0xdbff) end -= 1
    parts.push(value.slice(offset, end))
    offset = end
  }
  return parts
}
