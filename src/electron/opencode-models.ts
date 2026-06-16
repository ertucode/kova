import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import type { ListOpenCodeModelsResponse, OpenCodeModelSummary } from '../common/ScriptAi.js'
import { resolveOpenCodeSpawnConfig } from './utils/opencode-command.js'

const OPENCODE_TIMEOUT_MS = 120_000
const OPENCODE_WORKDIR = path.join(tmpdir(), 'kova-opencode-script-ai')

export async function listOpenCodeModels(): Promise<GenericResult<ListOpenCodeModelsResponse>> {
  try {
    await mkdir(OPENCODE_WORKDIR, { recursive: true })
    const output = await runOpenCodeModelsCommand()
    const models = parseVerboseModelsOutput(output)

    if (!models.length) {
      throw new Error('OpenCode returned no models.')
    }

    return Result.Success({ models })
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return GenericError.Message('Could not find the opencode binary in PATH.')
    }

    return GenericError.Message(error instanceof Error ? error.message : String(error))
  }
}

async function runOpenCodeModelsCommand() {
  const spawnConfig = await resolveOpenCodeSpawnConfig()

  return await new Promise<string>((resolve, reject) => {
    const child = spawn(spawnConfig.command, ['models', '--verbose'], {
      cwd: OPENCODE_WORKDIR,
      stdio: 'pipe',
      env: spawnConfig.env,
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      child.kill('SIGTERM')
      reject(new Error('OpenCode model listing timed out after 120 seconds.'))
    }, OPENCODE_TIMEOUT_MS)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })

    child.on('error', error => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      reject(error)
    })

    child.on('close', code => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)

      if (code !== 0) {
        reject(new Error(stderr.trim() || `opencode models exited with code ${code ?? 'unknown'}`))
        return
      }

      if (!stdout.trim()) {
        reject(new Error(stderr.trim() || 'OpenCode returned no models.'))
        return
      }

      resolve(stdout.trim())
    })
  })
}

function parseVerboseModelsOutput(output: string): OpenCodeModelSummary[] {
  const lines = output.split(/\r?\n/)
  const models: OpenCodeModelSummary[] = []
  let currentModelId: string | null = null
  let jsonLines: string[] = []
  let braceDepth = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) {
      continue
    }

    if (braceDepth === 0 && !line.startsWith('{')) {
      currentModelId = line
      continue
    }

    if (!currentModelId) {
      continue
    }

    jsonLines.push(rawLine)
    braceDepth += countCharacter(rawLine, '{')
    braceDepth -= countCharacter(rawLine, '}')

    if (braceDepth > 0) {
      continue
    }

    try {
      const parsed = JSON.parse(jsonLines.join('\n')) as { limit?: { context?: unknown } }
      models.push({
        id: currentModelId,
        contextWindow: typeof parsed.limit?.context === 'number' ? parsed.limit.context : null,
      })
    } catch {
      // Ignore malformed entries and continue parsing the rest of the output.
    }

    currentModelId = null
    jsonLines = []
  }

  return models
}

function countCharacter(value: string, character: string) {
  return [...value].filter(item => item === character).length
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
