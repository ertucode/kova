import { afterEach, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import AdmZip from 'adm-zip'
import { exportPostmanArchive } from './postman-archive.js'
import { loadCollectionExportSource } from './postman-export.js'

vi.mock('./db/environments.js', () => ({
  listEnvironments: async () => [{ id: 'env', name: 'Test', variables: 'host:localhost', color: null, warnOnRequest: false, position: 0, priority: 0, createdAt: 1, deletedAt: null }],
}))
vi.mock('./postman-export.js', async importOriginal => {
  const original = await importOriginal<typeof import('./postman-export.js')>()
  return { ...original, loadCollectionExportSource: vi.fn(async () => ({
    scope: 'folder', folderId: 'folder', requestId: null, suggestedCollectionName: 'Test',
    folders: [], requests: [], examplesByRequestId: new Map(), folderEnvironmentsByFolderId: new Map(), orderedItems: [],
  })) }
})

const temporaryDirectories: string[] = []
async function destination() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'kova-postman-archive-'))
  temporaryDirectories.push(directory)
  return path.join(directory, 'export.zip')
}
afterEach(async () => {
  for (const directory of temporaryDirectories.splice(0)) await fs.rm(directory, { recursive: true, force: true })
  vi.clearAllMocks()
})

describe('Postman batch archive', () => {
  it('exports separate standard collection and environment documents without overwriting duplicate names', async () => {
    const filePath = await destination()
    const result = await exportPostmanArchive({ entries: [
      { kind: 'collection', scope: 'folder', folderId: 'folder', name: 'Collection' },
      { kind: 'environment', environmentId: 'env', name: 'Test' },
      { kind: 'environment', environmentId: 'env', name: 'test' },
    ] }, filePath)
    expect(result.success).toBe(true)
    const archive = new AdmZip(filePath)
    expect(archive.getEntries().map(entry => entry.entryName)).toEqual([
      'Collection.postman_collection.json', 'test-2.postman_environment.json', 'Test.postman_environment.json',
    ])
    expect(JSON.parse(archive.readAsText('Test.postman_environment.json'))).toMatchObject({ name: 'Test', _postman_variable_scope: 'environment', values: [{ key: 'host', value: 'localhost' }] })
    expect(JSON.parse(archive.readAsText('Collection.postman_collection.json')).info.name).toBe('Collection')
  })

  it('keeps names safe to extract on Windows', async () => {
    const filePath = await destination()
    await exportPostmanArchive({ entries: ['../Test', 'CON', 'test/a', 'test\\a'].map(name => ({ kind: 'environment', environmentId: 'env', name })) }, filePath)
    const names = new AdmZip(filePath).getEntries().map(entry => entry.entryName)
    expect(names).toContain('_CON.postman_environment.json')
    expect(names.every(name => !/[\\/]/.test(name))).toBe(true)
    expect(new Set(names.map(name => name.toLowerCase())).size).toBe(4)
  })

  it('does not replace an existing archive when building an entry fails', async () => {
    const filePath = await destination()
    await fs.writeFile(filePath, 'original archive')
    vi.mocked(loadCollectionExportSource).mockRejectedValueOnce(new Error('Missing collection'))
    const result = await exportPostmanArchive({ entries: [{ kind: 'collection', scope: 'folder', folderId: 'missing', name: 'Missing' }] }, filePath)
    expect(result.success).toBe(false)
    expect(await fs.readFile(filePath, 'utf8')).toBe('original archive')
    expect(await fs.readdir(path.dirname(filePath))).toEqual(['export.zip'])
  })

  it('rejects an empty selection without creating an archive', async () => {
    const filePath = await destination()
    expect((await exportPostmanArchive({ entries: [] }, filePath)).success).toBe(false)
    expect(await fs.readdir(path.dirname(filePath))).toEqual([])
  })
})
