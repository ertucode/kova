import z from 'zod'
import { fromBase64, toBase64 } from './base64.js'
import { CommandMetadata } from './Command.js'

export const WindowArguments = z.object({
  initialPath: z.string().optional(),
  mode: z.enum(['select-app']).optional(),
  homeDir: z.string(),
  commands: CommandMetadata.array().optional(),
  isDev: z.boolean(),
})
export type WindowArguments = z.infer<typeof WindowArguments>

export function serializeWindowArguments(args: WindowArguments) {
  return toBase64(JSON.stringify(args))
}

export function deserializeWindowArguments(base64: string): WindowArguments {
  try {
    return WindowArguments.parse(JSON.parse(fromBase64(base64)))
  } catch (e) {
    console.error(e)
    // Unrecoverable
    throw e
  }
}
