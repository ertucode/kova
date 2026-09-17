import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import AdmZip from 'adm-zip'
import type { ExportPostmanArchiveInput, ExportPostmanArchiveResponse } from '../common/PostmanArchive.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import { listEnvironments } from './db/environments.js'
import { buildEnvironmentExportDocument } from './postman-environment-export.js'
import { buildCollectionExportDocument, loadCollectionExportSource } from './postman-export.js'

export async function exportPostmanArchive(input: ExportPostmanArchiveInput, destination: string): Promise<GenericResult<ExportPostmanArchiveResponse>> {
  if (!input.entries.length) return GenericError.Message('Select at least one item to export')
  const filePath = path.resolve(destination)
  const temporaryPath = `${filePath}.${randomUUID()}.tmp`
  try {
    const archive = new AdmZip()
    const usedNames = new Set<string>()
    const environments = input.entries.some(entry => entry.kind === 'environment') ? await listEnvironments() : []
    for (const entry of input.entries) {
      const name = entry.name.trim()
      if (!name) return GenericError.Message('Every export must have a name')
      let document: unknown
      if (entry.kind === 'environment') {
        const environment = environments.find(item => item.id === entry.environmentId)
        if (!environment) return GenericError.Message(`Environment not found: ${name}`)
        document = buildEnvironmentExportDocument(environment, name)
      } else {
        const source = await loadCollectionExportSource(entry)
        document = buildCollectionExportDocument(source, name)
      }
      const sanitized = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').slice(0, 100).replace(/[. ]+$/g, '') || 'export'
      const stem = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(sanitized) ? `_${sanitized}` : sanitized
      const suffix = entry.kind === 'environment' ? '.postman_environment.json' : '.postman_collection.json'
      let filename = `${stem}${suffix}`
      for (let index = 2; usedNames.has(filename.toLowerCase()); index++) filename = `${stem}-${index}${suffix}`
      usedNames.add(filename.toLowerCase())
      archive.addFile(filename, Buffer.from(`${JSON.stringify(document, null, 2)}\n`, 'utf8'))
    }
    await fs.writeFile(temporaryPath, archive.toBuffer(), { flag: 'wx' })
    await fs.rename(temporaryPath, filePath)
    return Result.Success({ filePath, fileCount: input.entries.length })
  } catch (error) {
    return GenericError.Unknown(error)
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
  }
}
