import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import type { RequestBatchExportData } from './db/request-batches.js'
import { buildRequestBatchWorkbook, writeRequestBatchExport } from './request-batch-export.js'

describe('batch Excel export', () => {
  it('writes all rows, data columns, and raw execution fields to a readable XLSX file', async () => {
    const data = createData()
    const first = data.rows[0]
    data.rows = Array.from({ length: 150 }, (_, index) => ({
      ...first,
      row: { ...first.row, id: `row-${index}`, rowIndex: index },
    }))
    const directory = await mkdtemp(path.join(os.tmpdir(), 'kova-batch-export-'))
    try {
      const filePath = path.join(directory, 'results.xlsx')
      await writeRequestBatchExport(data, filePath)
      const workbook = XLSX.read(await readFile(filePath), { type: 'buffer' })
      const sheet = workbook.Sheets['Batch results']
      const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' })
      expect(rows).toHaveLength(151)
      expect(rows[0]).toEqual([
        '#', 'Status', 'customer', 'HTTP status', 'Request URL', 'HTTP status', 'Duration (ms)',
        'Request body', 'Response headers', 'Response body', 'Response error', 'Response body omitted',
        'Request error', 'Test status', 'Tests total', 'Tests passed', 'Tests failed', 'Tests skipped',
        'Test duration (ms)', 'Test results (JSON)', 'Script errors (JSON)',
      ])
      expect(rows[1]).toEqual([
        1, 'HTTP error', '00123', 'input status', 'https://example.test/customers/00123', 500, 123.5,
        '{ "customer": "00123" }\n', 'content-type: application/json\r\nx-test: raw',
        '{"error":"oops"}\n', '', 'No',
        '', '', '', '', '', '', '', '', '',
      ])
      expect(rows[150][0]).toBe(150)
      expect(sheet.F2.t).toBe('n')
      expect(sheet.C2.t).toBe('s')
      expect(sheet['!autofilter']?.ref).toBe('A1:U151')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('includes rows without saved responses and keeps formula-like input as literal text', () => {
    const data = createData()
    data.rows[0].history = null
    data.rows[0].row.status = 'pending'
    data.rows[0].row.variables.customer = '=SUM(1,2)'
    const sheet = roundTrip(data).Sheets['Batch results']
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' })
    expect(rows[1]).toEqual([1, 'pending', '=SUM(1,2)', 'input status', ...Array(17).fill('')])
    expect(sheet.C2.t).toBe('s')
    expect(sheet.C2.f).toBeUndefined()
  })

  it('preserves long response bodies across continuation columns without splitting Unicode characters', () => {
    const data = createData()
    const body = `${'x'.repeat(32766)}😀${'y'.repeat(40000)}\n`
    const history = data.rows[0].history!
    history.responseBody = body
    const sheet = roundTrip(data).Sheets['Batch results']
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(sheet, { header: 1, defval: '' })
    const bodyIndex = rows[0].indexOf('Response body')
    expect(rows[0].slice(bodyIndex, bodyIndex + 3)).toEqual([
      'Response body', 'Response body (continued 2)', 'Response body (continued 3)',
    ])
    const parts = rows[1].slice(bodyIndex, bodyIndex + 3)
    expect(parts.join('')).toBe(body)
    expect(parts.every(part => String(part).length <= 32767)).toBe(true)
    expect(String(parts[1]).startsWith('😀')).toBe(true)
  })

  it('distinguishes omitted response bodies from saved empty bodies', () => {
    const data = createData()
    data.rows[0].history!.responseBody = ''
    data.rows[0].history!.responseBodyOmitted = true
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(roundTrip(data).Sheets['Batch results'], { header: 1, defval: '' })
    expect(rows[1][rows[0].indexOf('Response body')]).toBe('')
    expect(rows[1][rows[0].indexOf('Response body omitted')]).toBe('Yes')
  })

  it('exports headers for an empty batch', () => {
    const data = createData()
    data.rows = []
    const rows = XLSX.utils.sheet_to_json(roundTrip(data).Sheets['Batch results'], { header: 1 })
    expect(rows).toHaveLength(1)
  })

  it('exports the failure reason even when no request history exists', () => {
    const data = createData()
    data.rows[0].history = null
    data.rows[0].row.status = 'failed'
    data.rows[0].row.errorMessage = 'Environment variable "API_URL" was not found'
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(roundTrip(data).Sheets['Batch results'], { header: 1, defval: '' })
    expect(rows[1][rows[0].indexOf('Request error')]).toBe(data.rows[0].row.errorMessage)
    expect(rows[1][rows[0].indexOf('Test status')]).toBe('')
  })

  it('exports test counts and complete nested test failures across continuation columns', () => {
    const data = createData()
    const history = data.rows[0].history!
    history.testRun = {
      status: 'failed', totalCount: 2, passedCount: 0, failedCount: 1, skippedCount: 1, durationMs: 12,
      suites: [{
        id: 'suite', path: ['Response'], name: 'Response', status: 'failed', durationMs: 12, suites: [],
        tests: [{
          id: 'test', path: ['Response', 'body'], name: 'body', status: 'failed', durationMs: 12,
          failures: [{
            message: 'Unexpected response body', matcherName: 'toEqual', expected: 'expected', actual: 'x'.repeat(40000),
            diff: '- expected\n+ actual', sourceName: 'Request tests', line: 2, column: 1, sourceLine: 'expect(body).toEqual(expected)',
          }],
        }, {
          id: 'skipped', path: ['Response', 'skipped'], name: 'skipped', status: 'skipped', durationMs: 0, failures: [],
        }],
      }],
    }
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(roundTrip(data).Sheets['Batch results'], { header: 1, defval: '' })
    expect(rows[1][rows[0].indexOf('Test status')]).toBe('failed')
    expect(rows[1][rows[0].indexOf('Tests failed')]).toBe(1)
    expect(rows[1][rows[0].indexOf('Tests skipped')]).toBe(1)
    expect(rows[1][rows[0].indexOf('Tests passed')]).toBe(0)
    const testParts = rows[0].flatMap((header, index) => String(header).startsWith('Test results (JSON)') ? [rows[1][index]] : [])
    expect(testParts.length).toBeGreaterThan(1)
    expect(JSON.parse(testParts.join(''))).toEqual(history.testRun)
  })
})

function roundTrip(data: RequestBatchExportData) {
  return XLSX.read(XLSX.write(buildRequestBatchWorkbook(data), { type: 'buffer', bookType: 'xlsx' }), { type: 'buffer' })
}

function createData(): RequestBatchExportData {
  return {
    batch: {
      id: 'batch-1', requestId: 'request-1', requestName: 'Customers', name: 'customers.csv',
      sourceFileName: 'customers.csv', sourceType: 'csv', sheetName: null,
      columns: ['customer', 'HTTP status'], rowCount: 1, status: 'failed', concurrency: 1,
      summary: { totalCount: 1, pendingCount: 0, runningCount: 0, completedCount: 0, httpErrorCount: 1, failedTestCount: 0, failedCount: 0, cancelledCount: 0 },
      startedAt: 1, completedAt: 2, createdAt: 0, updatedAt: 2,
    },
    rows: [{
      row: {
        id: 'row-1', batchId: 'batch-1', rowIndex: 0, variables: { customer: '00123', 'HTTP status': 'input status' },
        status: 'http-error', historyId: 'history-1', startedAt: 1, completedAt: 2, createdAt: 0, updatedAt: 2,
        errorMessage: null,
      },
      history: {
        requestUrl: 'https://example.test/customers/00123', requestBody: '{ "customer": "00123" }\n',
        responseStatus: 500, responseBody: '{"error":"oops"}\n',
        responseHeaders: 'content-type: application/json\r\nx-test: raw', durationMs: 123.5,
        responseError: null, responseBodyOmitted: false,
        testRun: null, scriptErrors: [],
      },
    }],
  }
}
