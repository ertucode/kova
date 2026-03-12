import { AsyncStorageKey, AsyncStorageKeys } from '../../common/AsyncStorageKeys.js'
import { getXdgDataHome } from './getXdgDataHome.js'
import { promises as fs } from 'fs'
import path from 'path'

const baseDir = path.join(getXdgDataHome(), 'kova', 'async-storage')

export async function loadAsyncStorageValues(): Promise<Partial<Record<AsyncStorageKey, string | null>>> {
  const start = performance.now()
  const entries = await Promise.all(
    Object.values(AsyncStorageKeys).map(async key => {
      const filePath = path.join(baseDir, key)

      try {
        const content = await fs.readFile(filePath, 'utf8')
        return [key, content] as const
      } catch (err: any) {
        if (err.code !== 'ENOENT') {
          console.error('loadAsyncStorageValues', key, err)
        }
        return null
      }
    })
  )
  console.log('loadAsyncStorageValues elapsed', performance.now() - start)

  return Object.fromEntries(entries.filter(v => !!v))
}

export async function setAsyncStorageValue(key: AsyncStorageKey, value: $Maybe<string>): Promise<void> {
  await fs.mkdir(baseDir, { recursive: true })

  const filePath = path.join(baseDir, key)
  await fs.writeFile(filePath, value ?? '')
}
