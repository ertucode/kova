import { resolveExecutableSpawnConfig } from './executable-command.js'

export async function resolveOpenCodeSpawnConfig(): Promise<{
  command: string
  env: NodeJS.ProcessEnv
}> {
  return resolveExecutableSpawnConfig('opencode')
}
