import path from 'path'
import { spawn } from 'child_process'
import { fileURLToPath } from 'url'
import { computeInputHash, hasAllOutputs, readCache, writeCache } from './build-cache.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const cacheName = 'view-runtime'

const inputHash = await computeInputHash(rootDir, [
  'package.json',
  'package-lock.json',
  'tsconfig.app.json',
  'view-runtime.html',
  'vite.view-runtime.config.ts',
  'vite.shared.ts',
  'scripts/build-cache.mjs',
  'scripts/build-view-runtime.mjs',
  'src/common/Auth.ts',
  'src/common/formatXml.ts',
  'src/common/Json5.ts',
  'src/common/KeyValueRows.ts',
  'src/common/PathParams.ts',
  'src/common/RequestVariables.ts',
  'src/ui/App.css',
  'src/ui/folders/CodeEditor.tsx',
  'src/ui/getWindowElectron.ts',
  'src/ui/global/appSettingsStore.ts',
  'src/ui/viewRuntime',
  'src/ui/styles',
])
const cachedBuild = await readCache(rootDir, cacheName)
if (
  cachedBuild?.inputHash === inputHash &&
  (await hasAllOutputs(rootDir, ['public/generated/view-runtime/view-runtime.html']))
) {
  console.log('view runtime is up to date')
  process.exit(0)
}

await runViteBuild()
await writeCache(rootDir, cacheName, { inputHash })

function runViteBuild() {
  return new Promise((resolve, reject) => {
    const viteCliPath = path.join(rootDir, 'node_modules/vite/bin/vite.js')
    const child = spawn(process.execPath, [viteCliPath, 'build', '--config', 'vite.view-runtime.config.ts'], {
      cwd: rootDir,
      stdio: 'inherit',
    })

    child.on('exit', code => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`view runtime build failed with code ${code ?? 'unknown'}`))
    })
    child.on('error', reject)
  })
}
