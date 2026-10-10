import { OpenCode, type OpenCodeClient } from '@opencode/client'
import { Service } from '@opencode/client/service'
import { mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import type { ListOpenCodeModelsResponse } from '../common/ScriptAi.js'
import { resolveOpenCodeSpawnConfig } from './utils/opencode-command.js'

const OPENCODE_WORKDIR = path.join(tmpdir(), 'kova-opencode-script-ai')
const MODEL_LOAD_TIMEOUT_MS = 10_000
const MODEL_LOAD_RETRY_MS = 100

export async function listOpenCodeModels(): Promise<GenericResult<ListOpenCodeModelsResponse>> {
  try {
    await mkdir(OPENCODE_WORKDIR, { recursive: true })
    const spawnConfig = await resolveOpenCodeSpawnConfig()
    const endpoint = await Service.ensure({
      version: version => version.startsWith('2.'),
      command: [spawnConfig.command, 'serve', '--service'],
      env: Object.fromEntries(
        Object.entries(spawnConfig.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
      ),
    })
    const client = OpenCode.make({
      baseUrl: endpoint.url,
      headers: Service.headers(endpoint),
    })
    await client.location.get({ location: { directory: OPENCODE_WORKDIR } })
    const availableModels = await waitForOpenCodeModels(client)
    const models = availableModels
      .filter(model => model.enabled && model.status !== 'deprecated')
      .map(model => ({ id: `${model.providerID}/${model.id}`, contextWindow: model.limit.context }))

    if (!models.length) {
      throw new Error('OpenCode returned no models.')
    }

    return Result.Success({ models })
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return GenericError.Message('Could not find the OpenCode V2 binary in PATH.')
    }

    return GenericError.Message(error instanceof Error ? error.message : String(error))
  }
}

async function waitForOpenCodeModels(client: OpenCodeClient) {
  const timeoutAt = Date.now() + MODEL_LOAD_TIMEOUT_MS

  while (true) {
    const response = await client.model.list({ location: { directory: OPENCODE_WORKDIR } })
    if (response.data.length > 0) {
      return response.data
    }

    if (Date.now() >= timeoutAt) {
      return response.data
    }

    await new Promise(resolve => setTimeout(resolve, MODEL_LOAD_RETRY_MS))
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
