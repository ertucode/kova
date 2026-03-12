import fs from 'fs/promises'
import path from 'path'
import { clipboard, nativeImage } from 'electron'
import { expandHome } from './expand-home.js'
import { GenericError, GenericResult } from '../../common/GenericError.js'
import { Result } from '../../common/Result.js'

// Base64 data URL prefixes to strip
const DATA_URL_PREFIXES = [
  'data:application/pdf;base64,',
  'data:image/png;base64,',
  'data:image/jpeg;base64,',
  'data:image/gif;base64,',
  'data:image/webp;base64,',
  'data:audio/mpeg;base64,',
  'data:video/mp4;base64,',
  'data:application/zip;base64,',
  'data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,',
]

function stripDataUrlPrefix(text: string): string {
  for (const prefix of DATA_URL_PREFIXES) {
    if (text.startsWith(prefix)) {
      return text.slice(prefix.length)
    }
  }
  return text
}

export type CreateFromClipboardType = 'image' | 'base64' | 'text'

export async function createFromClipboard(
  filePath: string,
  type: CreateFromClipboardType
): Promise<GenericResult<{ path: string }>> {
  try {
    const expandedPath = expandHome(filePath)
    const dir = path.dirname(expandedPath)
    const fileName = path.basename(expandedPath)

    // Check if file already exists
    try {
      await fs.access(expandedPath)
      return GenericError.Message(`File ${fileName} already exists`)
    } catch {
      // File doesn't exist, which is what we want
    }

    // Ensure parent directory exists
    await fs.mkdir(dir, { recursive: true })

    if (type === 'image') {
      // Get image from clipboard
      const image = clipboard.readImage()

      if (image.isEmpty()) {
        return GenericError.Message('No image in clipboard')
      }

      // Determine format based on file extension
      const ext = path.extname(fileName).toLowerCase()
      let buffer: Buffer

      if (ext === '.jpg' || ext === '.jpeg') {
        buffer = image.toJPEG(90)
      } else {
        // Default to PNG for other formats
        buffer = image.toPNG()
      }

      await fs.writeFile(expandedPath, buffer)
    } else if (type === 'base64') {
      const clipboardText = clipboard.readText()

      if (!clipboardText) {
        return GenericError.Message('No data in clipboard')
      }

      // Strip data URL prefix if present and decode
      const base64Data = stripDataUrlPrefix(clipboardText.trim()).replace(/\s/g, '')
      const buffer = Buffer.from(base64Data, 'base64')

      await fs.writeFile(expandedPath, buffer)
    } else if (type === 'text') {
      const clipboardText = clipboard.readText()

      if (!clipboardText) {
        return GenericError.Message('No text in clipboard')
      }

      await fs.writeFile(expandedPath, clipboardText, 'utf-8')
    } else {
      return GenericError.Message(`Unknown clipboard type: ${type}`)
    }

    return Result.Success({ path: expandedPath })
  } catch (error) {
    if (error instanceof Error) {
      return GenericError.Message(error.message)
    }
    return GenericError.Unknown(error)
  }
}
