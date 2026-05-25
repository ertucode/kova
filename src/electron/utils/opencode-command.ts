import { spawn } from 'node:child_process'
import { constants } from 'node:fs'
import { access } from 'node:fs/promises'
import path from 'node:path'

const DEFAULT_PATH_SEGMENTS = ['/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin']
const SHELL_PATH_MARKER_START = '__KOVA_PATH_START__'
const SHELL_PATH_MARKER_END = '__KOVA_PATH_END__'
const SHELL_TIMEOUT_MS = 5_000

export async function resolveOpenCodeSpawnConfig(): Promise<{
  command: string
  env: NodeJS.ProcessEnv
}> {
  const processPath = process.env.PATH ?? ''
  const processCommand = await findExecutableInPath('opencode', processPath)
  if (processCommand) {
    return {
      command: processCommand,
      env: process.env,
    }
  }

  const fallbackPath = joinUniquePathSegments([processPath, ...DEFAULT_PATH_SEGMENTS])
  const fallbackCommand = await findExecutableInPath('opencode', fallbackPath)
  if (fallbackCommand) {
    return {
      command: fallbackCommand,
      env: {
        ...process.env,
        PATH: fallbackPath,
      },
    }
  }

  const zshPath = await readZshPath()
  if (zshPath) {
    const zshCommand = await findExecutableInPath('opencode', zshPath)
    if (zshCommand) {
      return {
        command: zshCommand,
        env: {
          ...process.env,
          PATH: joinUniquePathSegments([processPath, zshPath]),
        },
      }
    }
  }

  throw createCommandNotFoundError('opencode')
}

async function findExecutableInPath(command: string, rawPath: string) {
  for (const directory of splitPathSegments(rawPath)) {
    const candidate = path.join(directory, command)
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      continue
    }
  }

  return null
}

function splitPathSegments(rawPath: string) {
  return rawPath
    .split(path.delimiter)
    .map(segment => segment.trim())
    .filter(Boolean)
}

function joinUniquePathSegments(segments: string[]) {
  return [...new Set(segments.flatMap(splitPathSegments))].join(path.delimiter)
}

async function readZshPath() {
  const shellCandidates = [...new Set(['/bin/zsh', process.env.SHELL].filter(isZshShellPath))]

  for (const shellPath of shellCandidates) {
    const shellOutput = await runShellForPath(shellPath)
    if (shellOutput) {
      return shellOutput
    }
  }

  return null
}

function isZshShellPath(shellPath: string | undefined): shellPath is string {
  return typeof shellPath === 'string' && path.basename(shellPath) === 'zsh'
}

async function runShellForPath(shellPath: string) {
  return await new Promise<string | null>(resolve => {
    const child = spawn(shellPath, ['-lic', `printf '${SHELL_PATH_MARKER_START}%s${SHELL_PATH_MARKER_END}' "$PATH"`], {
      stdio: 'pipe',
      env: process.env,
    })

    let stdout = ''
    let settled = false

    const timeout = setTimeout(() => {
      if (settled) {
        return
      }

      settled = true
      child.kill('SIGTERM')
      resolve(null)
    }, SHELL_TIMEOUT_MS)

    child.stdout.on('data', chunk => {
      stdout += chunk.toString()
    })

    child.on('error', () => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)
      resolve(null)
    })

    child.on('close', code => {
      if (settled) {
        return
      }

      settled = true
      clearTimeout(timeout)

      if (code !== 0) {
        resolve(null)
        return
      }

      resolve(extractMarkedValue(stdout))
    })
  })
}

function extractMarkedValue(output: string) {
  const startIndex = output.indexOf(SHELL_PATH_MARKER_START)
  const endIndex = output.indexOf(SHELL_PATH_MARKER_END)

  if (startIndex === -1 || endIndex === -1 || endIndex <= startIndex) {
    return null
  }

  return output.slice(startIndex + SHELL_PATH_MARKER_START.length, endIndex).trim() || null
}

function createCommandNotFoundError(command: string) {
  const error = new Error(`Could not find the ${command} binary in PATH.`) as NodeJS.ErrnoException
  error.code = 'ENOENT'
  return error
}
