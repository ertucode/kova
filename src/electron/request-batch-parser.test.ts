import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import XLSX from 'xlsx'
import { listRequestBatchSheetNames, parseRequestBatchFile } from './request-batch-parser.js'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true })
  }
})

describe('parseRequestBatchFile', () => {
  it('parses CSV values and blank cells as strings', () => {
    const filePath = writeFile('rows.csv', '\uFEFFid,enabled,note\n42,true,\n')
    expect(parseRequestBatchFile({ filePath })).toMatchObject({
      sourceType: 'csv',
      columns: ['id', 'enabled', 'note'],
      rows: [{ id: '42', enabled: 'true', note: '' }],
    })
  })

  it('requires a JSON root array of flat objects', () => {
    const validPath = writeFile('rows.json', JSON.stringify([{ id: 42, active: false, note: null }]))
    expect(parseRequestBatchFile({ filePath: validPath }).rows).toEqual([{ id: '42', active: 'false', note: '' }])

    const rootObjectPath = writeFile('root-object.json', JSON.stringify({ id: 1 }))
    expect(() => parseRequestBatchFile({ filePath: rootObjectPath })).toThrow('array at the root')

    const nestedPath = writeFile('nested.json', JSON.stringify([{ id: 1, nested: { value: 2 } }]))
    expect(() => parseRequestBatchFile({ filePath: nestedPath })).toThrow('contains a nested value')
  })

  it('rejects empty and duplicate normalized variable names', () => {
    const emptyHeaderPath = writeFile('empty-header.csv', 'id,  \n1,2\n')
    expect(() => parseRequestBatchFile({ filePath: emptyHeaderPath })).toThrow('empty name')

    const duplicateHeaderPath = writeFile('duplicate-header.csv', 'id, id \n1,2\n')
    expect(() => parseRequestBatchFile({ filePath: duplicateHeaderPath })).toThrow('duplicate variable "id"')
  })

  it('lists and selects XLSX worksheets', () => {
    const directory = createTemporaryDirectory()
    const filePath = path.join(directory, 'rows.xlsx')
    const workbook = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ id: 1 }]), 'First')
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet([{ id: 2, active: true }]), 'Second')
    XLSX.writeFile(workbook, filePath)

    expect(listRequestBatchSheetNames(filePath)).toEqual(['First', 'Second'])
    expect(parseRequestBatchFile({ filePath, sheetName: 'Second' })).toMatchObject({
      sheetName: 'Second',
      availableSheetNames: ['First', 'Second'],
      rows: [{ id: '2', active: 'true' }],
    })
    expect(() => parseRequestBatchFile({ filePath, sheetName: 'Missing' })).toThrow('Worksheet not found')
  })
})

function writeFile(name: string, contents: string) {
  const filePath = path.join(createTemporaryDirectory(), name)
  fs.writeFileSync(filePath, contents)
  return filePath
}

function createTemporaryDirectory() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'kova-request-batch-'))
  temporaryDirectories.push(directory)
  return directory
}
