import path from 'node:path'
import { promises as fs } from 'node:fs'

const rootLibFile = 'lib.es2023.d.ts'
const visualizerRootLibFile = 'lib.visualizer-runtime.d.ts'
const reactTypeFiles = [
  ['vendor/react/global.d.ts', 'node_modules/@types/react/global.d.ts'],
  ['vendor/react/index.d.ts', 'node_modules/@types/react/index.d.ts'],
  ['vendor/react/jsx-runtime.d.ts', 'node_modules/@types/react/jsx-runtime.d.ts'],
  ['vendor/react/jsx-dev-runtime.d.ts', 'node_modules/@types/react/jsx-dev-runtime.d.ts'],
  ['vendor/csstype/index.d.ts', 'node_modules/csstype/index.d.ts'],
]
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
  'lib.dom.d.ts',
  'lib.dom.iterable.d.ts',
  'lib.esnext.iterator.d.ts',
]
const zodDeclarationRoots = ['index.d.cts', 'v4/index.d.cts', 'v4/classic', 'v4/core', 'v4/locales']

export async function buildScriptRuntimeDeclarationPayload({ rootDir }) {
  const files = await buildDeclarationFiles(rootDir)
  return {
    rootLibFile,
    visualizerRootLibFile,
    files,
  }
}

async function readTypeScriptLibFile(rootDir, fileName) {
  return fs.readFile(path.join(rootDir, 'node_modules/typescript/lib', fileName), 'utf8')
}

async function buildDeclarationFiles(rootDir) {
  const files = {}

  for (const fileName of typeScriptLibFiles) {
    files[fileName] = await readTypeScriptLibFile(rootDir, fileName)
  }

  for (const entry of zodDeclarationRoots) {
    Object.assign(files, await collectZodDeclarations(rootDir, entry))
  }

  Object.assign(files, await collectReactDeclarations(rootDir))
  files[visualizerRootLibFile] = String.raw`/// <reference no-default-lib="true" />
/// <reference lib="es2023" />
/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
`

  return files
}

async function collectReactDeclarations(rootDir) {
  const declarations = {}

  for (const [virtualPath, sourcePath] of reactTypeFiles) {
    const content = await fs.readFile(path.join(rootDir, sourcePath), 'utf8')
    declarations[virtualPath] = sanitizeReactDeclarationContent(content)
  }

  return declarations
}

function sanitizeReactDeclarationContent(content) {
  return content.replace(/^\s*export\s+as\s+namespace\s+[A-Za-z_$][\w$]*\s*;?\s*$/gm, '')
}

async function collectZodDeclarations(rootDir, entry) {
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
