import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { errorResponseToMessage, type GenericResult } from '../common/GenericError.js'
import type { GetScriptAiDiagnosticsInput, GetScriptAiDiagnosticsResponse } from '../common/ScriptAi.js'

type ScriptAiDiagnosticsBridge = {
  url: string
  token: string
  close(): Promise<void>
}

export async function startScriptAiDiagnosticsBridge(options: {
  getDiagnostics(input: GetScriptAiDiagnosticsInput): Promise<GenericResult<GetScriptAiDiagnosticsResponse>>
}): Promise<ScriptAiDiagnosticsBridge> {
  const token = randomBytes(24).toString('hex')
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/script-ai/diagnostics') {
        writeJson(response, 404, { success: false, error: 'Not found' })
        return
      }

      if (request.headers.authorization !== `Bearer ${token}`) {
        writeJson(response, 401, { success: false, error: 'Unauthorized' })
        return
      }

      const body = await readJsonBody(request)
      if (!isGetScriptAiDiagnosticsInput(body)) {
        writeJson(response, 400, { success: false, error: 'Invalid diagnostics request payload.' })
        return
      }

      const result = await options.getDiagnostics(body)
      if (!result.success) {
        writeJson(response, 500, { success: false, error: errorResponseToMessage(result.error) })
        return
      }

      writeJson(response, 200, {
        success: true,
        diagnostics: result.data?.diagnostics ?? [],
      })
    } catch (error) {
      writeJson(response, 500, {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Script AI diagnostics bridge did not expose a TCP port.')
  }

  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    token,
    close() {
      return new Promise<void>((resolve, reject) => {
        server.close(error => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
    },
  }
}

function writeJson(
  response: ServerResponse<IncomingMessage>,
  statusCode: number,
  payload: Record<string, unknown>
) {
  response.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(`${JSON.stringify(payload)}\n`)
}

async function readJsonBody(request: IncomingMessage) {
  let body = ''

  for await (const chunk of request) {
    body += chunk.toString()
  }

  return JSON.parse(body) as unknown
}

function isGetScriptAiDiagnosticsInput(value: unknown): value is GetScriptAiDiagnosticsInput {
  if (typeof value !== 'object' || value === null || !('target' in value)) {
    return false
  }

  const target = value.target
  return typeof target === 'object' && target !== null && 'ownerType' in target && 'ownerId' in target && 'runtimeContext' in target
}
