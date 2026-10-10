import { spawn } from 'node:child_process'
import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { resolveOpenCodeSpawnConfig } from './opencode-command.js'

export type OpenCodeModelRef = {
  providerID: string
  id: string
}

let stateDirectoryPromise: Promise<string> | null = null

export function getPreferredOpenCodeModel() {
  return loadPreferredOpenCodeModel()
}

async function loadPreferredOpenCodeModel() {
  try {
    stateDirectoryPromise ??= getOpenCodeStateDirectory()
    const stateDirectory = await stateDirectoryPromise
    const rawState = await readFile(path.join(stateDirectory, 'model.json'), 'utf8')
    const state = JSON.parse(rawState) as unknown
    if (!isModelState(state)) {
      return undefined
    }

    const preferred = state.recent[0]
    return preferred ? { providerID: preferred.providerID, id: preferred.modelID } : undefined
  } catch {
    return undefined
  }
}

async function getOpenCodeStateDirectory() {
  const spawnConfig = await resolveOpenCodeSpawnConfig()
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(spawnConfig.command, ['debug', 'paths', 'state'], {
      env: spawnConfig.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''

    child.stdout.on('data', chunk => {
      stdout += String(chunk)
    })
    child.stderr.on('data', chunk => {
      stderr += String(chunk)
    })
    child.on('error', reject)
    child.on('close', code => {
      const directory = stdout.trim()
      if (code === 0 && directory) {
        resolve(directory)
        return
      }
      reject(new Error(stderr.trim() || `OpenCode could not resolve its state directory (exit ${String(code)}).`))
    })
  })
}

function isModelState(value: unknown): value is {
  recent: Array<{ providerID: string; modelID: string }>
} {
  if (!value || typeof value !== 'object' || !('recent' in value) || !Array.isArray(value.recent)) {
    return false
  }

  return value.recent.every(
    item =>
      !!item &&
      typeof item === 'object' &&
      'providerID' in item &&
      typeof item.providerID === 'string' &&
      'modelID' in item &&
      typeof item.modelID === 'string'
  )
}
