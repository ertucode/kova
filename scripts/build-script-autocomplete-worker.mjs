import path from 'path'
import { fileURLToPath } from 'url'
import { promises as fs } from 'fs'
import * as esbuild from 'esbuild'
import { computeInputHash, hasAllOutputs, readCache, writeCache } from './build-cache.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const rootDir = path.resolve(__dirname, '..')
const publicOutputDir = path.join(rootDir, 'public/generated/script-autocomplete')
const declarationOutputPath = path.join(publicOutputDir, 'declarations.json')
const workerOutputPath = path.join(publicOutputDir, 'scriptAutocomplete.worker.js')
const cacheName = 'script-autocomplete-worker'
const rootLibFile = 'lib.es2023.d.ts'
const reactJsxTypesFile = 'react-jsx-runtime.d.ts'
const reactJsxTypes = String.raw`
declare namespace JSX {
  interface Element {}
  interface ElementClass {}
  interface IntrinsicAttributes {
    key?: unknown
  }
  interface ElementAttributesProperty {
    props: {}
  }
  interface ElementChildrenAttribute {
    children: {}
  }
  interface IntrinsicElements {
    [elementName: string]: Record<string, unknown>
  }
}

declare module 'react/jsx-runtime' {
  export const Fragment: unique symbol
  export function jsx(type: unknown, props: unknown, key?: unknown): JSX.Element
  export function jsxs(type: unknown, props: unknown, key?: unknown): JSX.Element
}
`
const typeScriptLibFiles = [
  'lib.decorators.d.ts',
  'lib.decorators.legacy.d.ts',
  'lib.es5.d.ts',
  'lib.es2015.d.ts',
  'lib.es2015.collection.d.ts',
  'lib.es2015.core.d.ts',
  'lib.es2015.generator.d.ts',
  'lib.es2015.iterable.d.ts',
  'lib.es2015.promise.d.ts',
  'lib.es2015.proxy.d.ts',
  'lib.es2015.reflect.d.ts',
  'lib.es2015.symbol.d.ts',
  'lib.es2015.symbol.wellknown.d.ts',
  'lib.es2016.d.ts',
  'lib.es2016.array.include.d.ts',
  'lib.es2016.intl.d.ts',
  'lib.es2017.d.ts',
  'lib.es2017.arraybuffer.d.ts',
  'lib.es2017.date.d.ts',
  'lib.es2017.intl.d.ts',
  'lib.es2017.object.d.ts',
  'lib.es2017.sharedmemory.d.ts',
  'lib.es2017.string.d.ts',
  'lib.es2017.typedarrays.d.ts',
  'lib.es2018.d.ts',
  'lib.es2018.asyncgenerator.d.ts',
  'lib.es2018.asynciterable.d.ts',
  'lib.es2018.intl.d.ts',
  'lib.es2018.promise.d.ts',
  'lib.es2018.regexp.d.ts',
  'lib.es2019.d.ts',
  'lib.es2019.array.d.ts',
  'lib.es2019.intl.d.ts',
  'lib.es2019.object.d.ts',
  'lib.es2019.string.d.ts',
  'lib.es2019.symbol.d.ts',
  'lib.es2020.d.ts',
  'lib.es2020.bigint.d.ts',
  'lib.es2020.date.d.ts',
  'lib.es2020.intl.d.ts',
  'lib.es2020.number.d.ts',
  'lib.es2020.promise.d.ts',
  'lib.es2020.sharedmemory.d.ts',
  'lib.es2020.string.d.ts',
  'lib.es2020.symbol.wellknown.d.ts',
  'lib.es2021.d.ts',
  'lib.es2021.intl.d.ts',
  'lib.es2021.promise.d.ts',
  'lib.es2021.string.d.ts',
  'lib.es2021.weakref.d.ts',
  'lib.es2022.d.ts',
  'lib.es2022.array.d.ts',
  'lib.es2022.error.d.ts',
  'lib.es2022.intl.d.ts',
  'lib.es2022.object.d.ts',
  'lib.es2022.regexp.d.ts',
  'lib.es2022.string.d.ts',
  'lib.es2023.d.ts',
  'lib.es2023.array.d.ts',
  'lib.es2023.collection.d.ts',
  'lib.es2023.intl.d.ts',
  'lib.esnext.iterator.d.ts',
]
const zodDeclarationRoots = ['index.d.cts', 'v4/index.d.cts', 'v4/classic', 'v4/core', 'v4/locales']

const inputHash = await computeInputHash(rootDir, [
  'package.json',
  'package-lock.json',
  'tsconfig.app.json',
  'scripts/build-cache.mjs',
  'scripts/build-script-autocomplete-worker.mjs',
  'src/common/SharedScripts.ts',
  'src/common/ScriptPackages.ts',
  'src/ui/folders/scriptAutocomplete.worker.ts',
  'src/ui/folders/scriptAutocompleteTypes.ts',
  'src/ui/folders/scriptRuntimeDeclarations.ts',
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

const declarationFiles = await buildDeclarationFiles()

await fs.writeFile(
  declarationOutputPath,
  JSON.stringify(
    {
      rootLibFile,
      files: declarationFiles,
    },
    null,
    2
  )
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

async function readTypeScriptLibFile(fileName) {
  return fs.readFile(path.join(rootDir, 'node_modules/typescript/lib', fileName), 'utf8')
}

async function buildDeclarationFiles() {
  const files = {}

  for (const fileName of typeScriptLibFiles) {
    files[fileName] = await readTypeScriptLibFile(fileName)
  }

  for (const entry of zodDeclarationRoots) {
    Object.assign(files, await collectZodDeclarations(entry))
  }

  files[reactJsxTypesFile] = reactJsxTypes

  return files
}

async function collectZodDeclarations(entry) {
  const fullPath = path.join(rootDir, 'node_modules/zod', entry)
  if (entry.endsWith('.d.cts')) {
    return {
      [`vendor/zod/${entry.replace(/\.d\.cts$/, '.cjs')}`]: await fs.readFile(fullPath, 'utf8'),
    }
  }

  const declarations = {}
  for await (const filePath of walkFiles(fullPath)) {
    if (!filePath.endsWith('.d.cts')) {
      continue
    }

    const nestedPath = path.relative(path.join(rootDir, 'node_modules/zod'), filePath)
    declarations[`vendor/zod/${nestedPath.replace(/\.d\.cts$/, '.cjs')}`] = await fs.readFile(filePath, 'utf8')
  }

  return declarations
}

async function* walkFiles(directoryPath) {
  const entries = await fs.readdir(directoryPath, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      yield* walkFiles(fullPath)
      continue
    }

    yield fullPath
  }
}

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
