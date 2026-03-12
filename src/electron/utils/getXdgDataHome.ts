import os from 'node:os'
import path from 'node:path'

export function getXdgDataHome(): string {
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
}
