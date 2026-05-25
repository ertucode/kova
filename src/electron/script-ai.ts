import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { tmpdir } from 'node:os'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import type { GenerateScriptWithAiInput, GenerateScriptWithAiResponse, ScriptAiPhase } from '../common/ScriptAi.js'
import { Typescript } from '../common/Typescript.js'
import { resolveOpenCodeSpawnConfig } from './utils/opencode-command.js'

const OPENCODE_TIMEOUT_MS = 120_000
const OPENCODE_WORKDIR = path.join(tmpdir(), 'kova-opencode-script-ai')

export async function generateScriptWithAi(input: GenerateScriptWithAiInput): Promise<GenericResult<GenerateScriptWithAiResponse>> {
  const prompt = buildScriptAiPrompt(input)

  try {
    const rawText = await runOpenCodePrompt(prompt, input.model)
    const code = normalizeGeneratedCode(rawText)
    if (!code.trim()) {
      return GenericError.Message('OpenCode returned an empty script.')
    }

    return Result.Success({ code, rawText })
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return GenericError.Message('Could not find the opencode binary in PATH.')
    }

    return GenericError.Message(error instanceof Error ? error.message : String(error))
  }
}

function buildScriptAiPrompt(input: GenerateScriptWithAiInput) {
  const phaseLabel = getPhaseLabel(input.phase)
  const modeLabel = input.currentCode.trim() ? 'Update the existing script' : 'Create a new script from scratch'

  return [
    'You are generating code for Kova script editors.',
    'Return only the final script source code.',
    'Do not include markdown fences.',
    'Do not include explanations, summaries, or notes.',
    '',
    `Target runtime: ${phaseLabel}`,
    `Task: ${modeLabel}`,
    '',
    'User request:',
    input.userPrompt.trim(),
    ...(input.model ? ['', `Preferred model: ${input.model}`] : []),
    '',
    'Runtime documentation:',
    input.documentation.trim(),
    '',
    'Current script:',
    input.currentCode.trim() ? input.currentCode : '// Empty script',
    '',
    'Output requirement:',
    'Respond with only the full final script source code.',
  ].join('\n')
}

async function runOpenCodePrompt(prompt: string, model: string | null) {
  await mkdir(OPENCODE_WORKDIR, { recursive: true })
  const spawnConfig = await resolveOpenCodeSpawnConfig()

  return await new Promise<string>((resolve, reject) => {
    const args = ['run', '--dir', OPENCODE_WORKDIR, '--format', 'json']
    if (model) {
      args.push('--model', model)
    }
    args.push(prompt)

    const child = spawn(spawnConfig.command, args, {
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
      reject(
        new Error(
          `OpenCode did not finish within ${Math.round(OPENCODE_TIMEOUT_MS / 1000)} seconds. Check that opencode is installed and authenticated.`
        )
      )
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
        reject(new Error(stderr.trim() || `opencode exited with code ${code ?? 'unknown'}`))
        return
      }

      const parsed = parseOpenCodeJsonOutput(stdout)
      if (!parsed.trim()) {
        reject(new Error(stderr.trim() || 'OpenCode returned no script content.'))
        return
      }

      resolve(parsed)
    })
  })
}

function parseOpenCodeJsonOutput(output: string) {
  const textParts: string[] = []

  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }

    try {
      const event = JSON.parse(trimmed) as {
        type?: string
        part?: {
          type?: string
          text?: string
        }
      }

      if (event.type === 'text' && event.part?.type === 'text' && typeof event.part.text === 'string') {
        textParts.push(event.part.text)
      }
    } catch {
      continue
    }
  }

  return textParts.join('\n').trim()
}

function normalizeGeneratedCode(value: string) {
  const trimmed = value.trim()
  const fencedMatch = trimmed.match(/^```[A-Za-z0-9_-]*\n([\s\S]*?)\n```$/)
  if (fencedMatch) {
    return fencedMatch[1].trim()
  }

  return trimmed
}

function getPhaseLabel(phase: ScriptAiPhase) {
  switch (phase) {
    case 'pre-request':
      return 'Pre-request script'
    case 'post-request':
      return 'Post-request script'
    case 'response-visualizer':
      return 'Response visualizer'
    case 'view-runtime':
      return 'View runtime'
  }

  return Typescript.assertUnreachable(phase)
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}
