import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import type { ListOpenCodeModelsResponse } from '../common/ScriptAi.js'

const OPENCODE_TIMEOUT_MS = 120_000
const OPENCODE_WORKDIR = path.join(tmpdir(), 'kova-opencode-script-ai')

export async function listOpenCodeModels(): Promise<GenericResult<ListOpenCodeModelsResponse>> {
  try {
    await mkdir(OPENCODE_WORKDIR, { recursive: true })
    const output = await runOpenCodeModelsCommand()
    const models = output
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)

    return Result.Success({ models })
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return GenericError.Message('Could not find the opencode binary in PATH.')
    }

    return GenericError.Message(error instanceof Error ? error.message : String(error))
  }
}

async function runOpenCodeModelsCommand() {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('opencode', ['models'], {
      cwd: OPENCODE_WORKDIR,
      stdio: 'pipe',
      env: process.env,
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

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
