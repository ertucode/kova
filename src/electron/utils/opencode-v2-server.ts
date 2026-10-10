import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import type { OpenCodeClient } from '@opencode/client'
import { OpenCode } from '@opencode/client'
import { resolveOpenCodeSpawnConfig } from './opencode-command.js'

export type OpenCodeServer = {
  url: string
  client: OpenCodeClient
  close(): void
}

type RunningServer = {
  url: string
  client: OpenCodeClient
  child: ChildProcess
  refs: number
}

const runningServers = new Map<number, Promise<RunningServer>>()

export async function startOpenCodeServer(port: number, signal: AbortSignal): Promise<OpenCodeServer> {
  const existing = runningServers.get(port)
  if (existing) {
    const server = await existing
    server.refs += 1
    return createLease(port, server)
  }

  const startup = startServerProcess(port, signal)
  runningServers.set(port, startup)
  try {
    return createLease(port, await startup)
  } catch (error) {
    runningServers.delete(port)
    throw error
  }
}

async function startServerProcess(port: number, signal: AbortSignal): Promise<RunningServer> {
  const spawnConfig = await resolveOpenCodeSpawnConfig()
  const url = `http://127.0.0.1:${String(port)}`
  const password = randomBytes(32).toString('base64url')
  const headers = {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
  }

  const child = spawn(spawnConfig.command, ['serve', '--hostname', '127.0.0.1', '--port', String(port)], {
    env: {
      ...spawnConfig.env,
      OPENCODE_DISABLE_CLAUDE_CODE: 'true',
      OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: 'true',
      OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true',
      OPENCODE_SERVER_PASSWORD: password,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  const abort = () => child.kill('SIGTERM')
  signal.addEventListener('abort', abort, { once: true })

  try {
    await waitUntilReady(child, url, headers, signal)
  } catch (error) {
    child.kill('SIGTERM')
    throw error
  } finally {
    signal.removeEventListener('abort', abort)
  }

  return {
    url,
    client: OpenCode.make({ baseUrl: url, headers }),
    child,
    refs: 1,
  }
}

function createLease(port: number, server: RunningServer): OpenCodeServer {
  let closed = false
  return {
    url: server.url,
    client: server.client,
    close() {
      if (closed) {
        return
      }
      closed = true
      server.refs -= 1
      if (server.refs === 0) {
        runningServers.delete(port)
        server.child.kill('SIGTERM')
      }
    },
  }
}

async function waitUntilReady(
  child: ChildProcess,
  url: string,
  headers: Record<string, string>,
  signal: AbortSignal
) {
  let stderr = ''
  let spawnError: Error | null = null
  const onStderr = (chunk: Buffer) => {
    stderr += String(chunk)
  }
  const onError = (error: Error) => {
    spawnError = error
  }
  child.stderr?.on('data', onStderr)
  child.on('error', onError)

  try {
    const timeoutAt = Date.now() + 10_000
    while (Date.now() < timeoutAt) {
      if (signal.aborted) {
        throw new DOMException('OpenCode server startup was aborted.', 'AbortError')
      }
      if (spawnError) {
        throw spawnError
      }
      if (child.exitCode !== null) {
        throw new Error(stderr.trim() || `OpenCode V2 server exited with code ${String(child.exitCode)}.`)
      }
      if (await isOpenCodeV2Server(url, headers)) {
        return
      }
      await new Promise(resolve => setTimeout(resolve, 100))
    }

    throw new Error(`OpenCode V2 server did not become ready at ${url}.`)
  } finally {
    child.stderr?.off('data', onStderr)
    child.off('error', onError)
  }
}

async function isOpenCodeV2Server(url: string, headers: Record<string, string>) {
  try {
    const response = await fetch(new URL('/api/info', url), { headers, signal: AbortSignal.timeout(1_000) })
    if (!response.ok) {
      return false
    }
    const info = (await response.json()) as { version?: unknown }
    return typeof info.version === 'string' && info.version.startsWith('2.')
  } catch {
    return false
  }
}
