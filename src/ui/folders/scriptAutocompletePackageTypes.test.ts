import { describe, expect, it } from 'vitest'
import ts from 'typescript'
import { sanitizePackageTypeFileContent } from './scriptAutocompletePackageTypes'

describe('sanitizePackageTypeFileContent', () => {
  it('prevents package namespaces from leaking globals into scripts', () => {
    const lodashTypes = [
      'export = _;',
      'export as namespace _;',
      'declare const _: _.LoDashStatic;',
      'declare namespace _ {',
      '  interface LoDashStatic {}',
      '}',
      '',
    ].join('\n')

    expect(getDiagnostics(lodashTypes)).toContain("Cannot redeclare block-scoped variable '_'.")
    expect(getDiagnostics(sanitizePackageTypeFileContent(lodashTypes))).not.toContain("Cannot redeclare block-scoped variable '_'.")
  })
})

function getDiagnostics(packageDeclaration: string) {
  const files = new Map<string, string>([
    [
      '/runtime.d.ts',
      [
        'interface ScriptRuntimeInstalledPackageMap {',
        '  "lodash": typeof import("lodash")',
        '}',
        'declare function loadPackage<TName extends keyof ScriptRuntimeInstalledPackageMap>(name: TName): ScriptRuntimeInstalledPackageMap[TName]',
        'declare function loadPackage<TName extends string>(name: string extends TName ? TName : never): unknown',
        '',
      ].join('\n'),
    ],
    ['/script.ts', "const _ = loadPackage('lodash')\n"],
    ['/node_modules/lodash/index.d.ts', packageDeclaration],
  ])

  const rootFiles = ['/runtime.d.ts', '/script.ts']
  const versions = new Map(Array.from(files.keys(), fileName => [fileName, '0']))
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2020,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    noEmit: true,
    noLib: true,
    strict: true,
    types: [],
  }

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => rootFiles,
    getScriptVersion: fileName => versions.get(fileName) ?? '0',
    getScriptSnapshot: fileName => {
      const content = files.get(fileName)
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
    },
    getCurrentDirectory: () => '/',
    getDefaultLibFileName: () => '/lib.d.ts',
    fileExists: fileName => files.has(fileName),
    readFile: fileName => files.get(fileName),
    directoryExists: directoryPath => {
      const normalized = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`
      return Array.from(files.keys()).some(fileName => fileName.startsWith(normalized))
    },
    getDirectories: directoryPath => {
      const normalized = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`
      const directories = new Set<string>()
      for (const fileName of files.keys()) {
        if (!fileName.startsWith(normalized)) {
          continue
        }

        const remainder = fileName.slice(normalized.length)
        const slashIndex = remainder.indexOf('/')
        if (slashIndex > 0) {
          directories.add(remainder.slice(0, slashIndex))
        }
      }

      return Array.from(directories)
    },
    readDirectory: () => [],
    useCaseSensitiveFileNames: () => true,
  }

  const service = ts.createLanguageService(host, ts.createDocumentRegistry())
  return service
    .getSemanticDiagnostics('/script.ts')
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}
