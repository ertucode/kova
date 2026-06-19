import path from 'path'
import { fileURLToPath } from 'url'
import { promises as fs } from 'fs'
import * as esbuild from 'esbuild'
import { computeInputHash, hasAllOutputs, readCache, writeCache } from './build-cache.mjs'
import { buildScriptRuntimeDeclarationPayload } from './utils/scriptRuntimeDeclarationBuilder.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const publicOutputDir = path.join(rootDir, 'public/generated/script-autocomplete')
const declarationOutputPath = path.join(publicOutputDir, 'declarations.json')
const workerOutputPath = path.join(publicOutputDir, 'scriptAutocomplete.worker.js')
const cacheName = 'script-autocomplete-worker'

const inputHash = await computeInputHash(rootDir, [
  'package.json',
  'package-lock.json',
  'tsconfig.app.json',
  'scripts/build-cache.mjs',
  'scripts/build-script-autocomplete-worker.mjs',
  'scripts/utils/scriptRuntimeDeclarationBuilder.mjs',
  'src/common/SharedScripts.ts',
  'src/common/ScriptPackages.ts',
  'src/ui/folders/scriptAutocompleteCompletions.ts',
  'src/ui/folders/scriptAutocomplete.worker.ts',
  'src/ui/folders/scriptAutocompleteTypes.ts',
  'src/ui/folders/scriptRuntimeDeclarations.ts',
  'src/ui/folders/scriptRuntimeDiagnostics.ts',
])
const cachedBuild = await readCache(rootDir, cacheName)
if (
  cachedBuild?.inputHash === inputHash &&
  (await hasAllOutputs(rootDir, [
    'public/generated/script-autocomplete/declarations.json',
    'public/generated/script-autocomplete/scriptAutocomplete.worker.js',
  ]))
) {
  console.log('script autocomplete worker is up to date')
  process.exit(0)
}

await fs.mkdir(publicOutputDir, { recursive: true })

const declarationPayload = await buildScriptRuntimeDeclarationPayload({ rootDir })

await fs.writeFile(
  declarationOutputPath,
  JSON.stringify(declarationPayload, null, 2)
)

await esbuild.build({
  absWorkingDir: rootDir,
  entryPoints: ['src/ui/folders/scriptAutocomplete.worker.ts'],
  outfile: workerOutputPath,
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  sourcemap: true,
  logLevel: 'info',
  tsconfig: 'tsconfig.app.json',
  plugins: [aliasPlugin()],
})

await writeCache(rootDir, cacheName, { inputHash })

function aliasPlugin() {
  return {
    name: 'kova-aliases',
    setup(build) {
      build.onResolve({ filter: /^@common\// }, async args => ({
        path: await resolveAliasedPath(path.join(rootDir, 'src/common', args.path.slice('@common/'.length))),
      }))
      build.onResolve({ filter: /^@\// }, async args => ({
        path: await resolveAliasedPath(path.join(rootDir, 'src/ui', args.path.slice(2))),
      }))
    },
  }
}

async function resolveAliasedPath(basePath) {
  const candidatePaths = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    path.join(basePath, 'index.ts'),
    path.join(basePath, 'index.tsx'),
    path.join(basePath, 'index.js'),
    path.join(basePath, 'index.jsx'),
  ]

  for (const candidatePath of candidatePaths) {
    if (await pathExists(candidatePath)) {
      return candidatePath
    }
  }

  return basePath
}

async function pathExists(filePath) {
  try {
    await fs.stat(filePath)
    return true
  } catch {
    return false
  }
}
