import crypto from 'crypto'
import path from 'path'
import { promises as fs } from 'fs'

const cacheDirName = 'node_modules/.tmp/kova-build-cache'

export async function computeInputHash(rootDir, relativePaths) {
  const hash = crypto.createHash('sha256')
  const files = []

  for (const relativePath of relativePaths) {
    const absolutePath = path.join(rootDir, relativePath)
    const stats = await fs.stat(absolutePath)
    if (stats.isDirectory()) {
      files.push(...(await collectFiles(rootDir, absolutePath)))
      continue
    }

    files.push(path.relative(rootDir, absolutePath))
  }

  files.sort((left, right) => left.localeCompare(right))
  for (const relativePath of files) {
    hash.update(relativePath)
    hash.update(await fs.readFile(path.join(rootDir, relativePath)))
  }

  return hash.digest('hex')
}

export async function hasAllOutputs(rootDir, relativePaths) {
  for (const relativePath of relativePaths) {
    try {
      await fs.access(path.join(rootDir, relativePath))
    } catch {
      return false
    }
  }

  return true
}

export async function readCache(rootDir, cacheName) {
  const cachePath = path.join(rootDir, cacheDirName, `${cacheName}.json`)
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8'))
  } catch {
    return null
  }
}

export async function writeCache(rootDir, cacheName, value) {
  const cacheDir = path.join(rootDir, cacheDirName)
  await fs.mkdir(cacheDir, { recursive: true })
  await fs.writeFile(path.join(cacheDir, `${cacheName}.json`), JSON.stringify(value, null, 2))
}

async function collectFiles(rootDir, directoryPath) {
  const files = []
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(rootDir, fullPath)))
      continue
    }

    files.push(path.relative(rootDir, fullPath))
  }

  return files
}
