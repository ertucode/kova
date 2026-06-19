import ts from 'typescript'
import {
  formatScriptPackageSpecifier,
  parseScriptPackageSpecifier,
  type ScriptPackageArtifact,
  type ScriptPackageDownloadStatus,
} from '../../common/ScriptPackages.js'
import type { ScriptRuntimeDiagnostic } from '../../common/ScriptAi.js'
import type { SharedScriptRecord, SharedScriptTarget } from '../../common/SharedScripts.js'
import {
  getScriptRuntimeDeclarations,
  getScriptRuntimeTargets,
  isScriptRuntimeVisualizerOnly,
  type ScriptRuntimeContext,
} from './scriptRuntimeDeclarations.js'
import { sanitizePackageTypeFileContent } from './scriptAutocompletePackageTypes.js'

export type ScriptRuntimeSharedScript = Pick<SharedScriptRecord, 'id' | 'name' | 'kind' | 'code' | 'targets' | 'isActive'>

export type ScriptRuntimePackage = Pick<
  ScriptPackageArtifact,
  'cacheKey' | 'packageName' | 'packageVersion' | 'typesPackageName' | 'typesPackageVersion' | 'typeFiles'
> & {
  downloadStatus: ScriptPackageDownloadStatus
}

export type ScriptRuntimeDeclarationPayload = {
  rootLibFile: string
  visualizerRootLibFile: string
  files: Record<string, string>
}

export type ScriptRuntimeDeclarationFiles = {
  rootLibFile: string
  visualizerRootLibFile: string
  files: Map<string, string>
}

export type ScriptRuntimePhaseState = {
  runtimeContext: ScriptRuntimeContext
  service: ts.LanguageService
  files: Map<string, string>
  versions: Map<string, number>
  projectVersion: number
  userFileName: string
  declarationFileName: string
  rootFileNames: Set<string>
  dynamicFileNames: Set<string>
  dynamicRootFileNames: Set<string>
  packages: ScriptRuntimePackage[]
}

const allowedTopLevelScriptDiagnosticCodes = new Set([1108, 1375])
const reactTypeModuleFileNames = {
  react: 'vendor/react/index.d.ts',
  reactJsxRuntime: 'vendor/react/jsx-runtime.d.ts',
  reactJsxDevRuntime: 'vendor/react/jsx-dev-runtime.d.ts',
  csstype: 'vendor/csstype/index.d.ts',
} as const
const builtInReactTypeFileNames = new Set<string>([
  reactTypeModuleFileNames.react,
  reactTypeModuleFileNames.reactJsxRuntime,
  reactTypeModuleFileNames.reactJsxDevRuntime,
  reactTypeModuleFileNames.csstype,
  'vendor/react/global.d.ts',
])

export function createScriptRuntimePhaseStateManager(loadDeclarationFiles: () => Promise<ScriptRuntimeDeclarationFiles>) {
  const phaseStates = new Map<string, ScriptRuntimePhaseState>()
  const phaseStatePromises = new Map<string, Promise<ScriptRuntimePhaseState>>()

  return {
    async getOrCreatePhaseState(runtimeContext: ScriptRuntimeContext) {
      const key = getScriptRuntimeContextKey(runtimeContext)
      const existing = phaseStates.get(key)
      if (existing) {
        return existing
      }

      const pending = phaseStatePromises.get(key)
      if (pending) {
        return pending
      }

      const created = (async () => {
        try {
          const declarationFiles = await loadDeclarationFiles()
          const phaseState = createPhaseState(runtimeContext, declarationFiles)
          phaseStates.set(key, phaseState)
          return phaseState
        } finally {
          phaseStatePromises.delete(key)
        }
      })()

      phaseStatePromises.set(key, created)
      return created
    },
  }
}

export function createScriptRuntimeDeclarationFiles(payload: ScriptRuntimeDeclarationPayload): ScriptRuntimeDeclarationFiles {
  return {
    rootLibFile: payload.rootLibFile,
    visualizerRootLibFile: payload.visualizerRootLibFile,
    files: new Map(Object.entries(payload.files)),
  }
}

export function updateScriptRuntimePhaseSource(
  phaseState: ScriptRuntimePhaseState,
  input: {
    code: string
    requestPaths: string[][]
    sharedScripts: ScriptRuntimeSharedScript[]
    packages: ScriptRuntimePackage[]
  }
) {
  phaseState.projectVersion += 1
  phaseState.files.set(phaseState.userFileName, input.code)
  phaseState.versions.set(phaseState.userFileName, (phaseState.versions.get(phaseState.userFileName) ?? 0) + 1)
  phaseState.packages = input.packages

  for (const fileName of phaseState.dynamicFileNames) {
    phaseState.files.delete(fileName)
    phaseState.versions.delete(fileName)
  }
  phaseState.dynamicFileNames.clear()

  for (const fileName of phaseState.dynamicRootFileNames) {
    phaseState.rootFileNames.delete(fileName)
  }
  phaseState.dynamicRootFileNames.clear()

  const sharedScriptFiles = createSharedScriptFiles(phaseState.runtimeContext, input.sharedScripts)
  for (const file of sharedScriptFiles.files) {
    phaseState.dynamicFileNames.add(file.fileName)
    phaseState.dynamicRootFileNames.add(file.fileName)
    phaseState.rootFileNames.add(file.fileName)
    phaseState.files.set(file.fileName, file.content)
    phaseState.versions.set(file.fileName, (phaseState.versions.get(file.fileName) ?? 0) + 1)
  }

  for (const pkg of input.packages) {
    for (const [relativePath, content] of Object.entries(pkg.typeFiles)) {
      const fileName = toVirtualPackageFileName(pkg.cacheKey, relativePath)
      phaseState.dynamicFileNames.add(fileName)
      phaseState.files.set(fileName, sanitizePackageTypeFileContent(content))
      phaseState.versions.set(fileName, (phaseState.versions.get(fileName) ?? 0) + 1)
    }
  }

  phaseState.files.set(
    phaseState.declarationFileName,
    buildPhaseDeclarations(phaseState.runtimeContext, [
      getScriptRuntimeDeclarations(phaseState.runtimeContext),
      buildRequestPathDeclarations(phaseState.runtimeContext, input.requestPaths),
      buildRequireScriptDeclarations(sharedScriptFiles.modules),
      buildLoadPackageDeclarations(input.packages),
    ])
  )
  phaseState.versions.set(
    phaseState.declarationFileName,
    (phaseState.versions.get(phaseState.declarationFileName) ?? 0) + 1
  )
}

export function collectScriptRuntimeDiagnostics(phaseState: ScriptRuntimePhaseState, source: string): ScriptRuntimeDiagnostic[] {
  return dedupeDiagnostics([
    ...phaseState.service.getSyntacticDiagnostics(phaseState.userFileName),
    ...phaseState.service.getSemanticDiagnostics(phaseState.userFileName),
  ])
    .filter(diagnostic => !diagnostic.file || diagnostic.file.fileName === phaseState.userFileName)
    .filter(diagnostic => !shouldIgnoreDiagnostic(phaseState.runtimeContext, diagnostic))
    .map(diagnostic => toRuntimeDiagnostic(diagnostic, source, phaseState.service, phaseState.userFileName))
}

export function getScriptRuntimeContextKey(runtimeContext: ScriptRuntimeContext) {
  if ('phase' in runtimeContext) {
    return runtimeContext.phase
  }

  if ('templatePhase' in runtimeContext) {
    return `template-${runtimeContext.templatePhase}`
  }

  return `targets-${normalizeTargets(runtimeContext.targets).join('__')}`
}

function shouldIgnoreDiagnostic(runtimeContext: ScriptRuntimeContext, diagnostic: ts.Diagnostic) {
  if (isScriptRuntimeVisualizerOnly(runtimeContext)) {
    return false
  }

  return allowedTopLevelScriptDiagnosticCodes.has(diagnostic.code)
}

function buildRequestPathDeclarations(runtimeContext: ScriptRuntimeContext, requestPaths: string[][]) {
  if (!supportsRequestPathDeclarations(runtimeContext)) {
    return ''
  }

  const pathEntries = Array.from(new Set(requestPaths.filter(path => path.length > 0).map(path => JSON.stringify(path)))).sort((left, right) =>
    left.localeCompare(right)
  )

  const requestPathType = pathEntries.length > 0 ? pathEntries.map(path => `  | ${path}`).join('\n') : '  | readonly string[]'

  return [
    'type ScriptRequestPath =',
    requestPathType,
    '',
    supportsNavigateAndCallRequestDeclarations(runtimeContext)
      ? 'declare function navigateAndCallRequest(path: ScriptRequestPath): Promise<void>'
      : '',
    'declare function callRequest(path: ScriptRequestPath, overrides?: ScriptCallRequestOptions): Promise<ScriptResponseApi>',
  ]
    .filter(Boolean)
    .join('\n')
}

function supportsRequestPathDeclarations(runtimeContext: ScriptRuntimeContext) {
  if ('phase' in runtimeContext) {
    return runtimeContext.phase === 'pre-request' || runtimeContext.phase === 'post-request' || runtimeContext.phase === 'view-runtime'
  }

  if ('templatePhase' in runtimeContext) {
    return false
  }

  return runtimeContext.targets.some(target => target === 'pre-request' || target === 'post-request' || target === 'view-runtime')
}

function supportsNavigateAndCallRequestDeclarations(runtimeContext: ScriptRuntimeContext) {
  if ('phase' in runtimeContext) {
    return runtimeContext.phase === 'post-request'
  }

  if ('templatePhase' in runtimeContext) {
    return false
  }

  return runtimeContext.targets.includes('post-request')
}

function dedupeDiagnostics(diagnostics: readonly ts.Diagnostic[]) {
  const seen = new Set<string>()
  const result: ts.Diagnostic[] = []

  for (const diagnostic of diagnostics) {
    if (diagnostic.category !== ts.DiagnosticCategory.Error) {
      continue
    }

    const key = [
      diagnostic.code,
      diagnostic.start ?? -1,
      diagnostic.length ?? -1,
      ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    ].join(':')

    if (seen.has(key)) {
      continue
    }

    seen.add(key)
    result.push(diagnostic)
  }

  return result
}

function toRuntimeDiagnostic(
  diagnostic: ts.Diagnostic,
  source: string,
  service: ts.LanguageService,
  fileName: string
): ScriptRuntimeDiagnostic {
  const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
  const file = diagnostic.file ?? service.getProgram()?.getSourceFile(fileName)
  const from = Math.max(0, typeof diagnostic.start === 'number' ? diagnostic.start : 0)
  const to = Math.max(from + 1, from + (typeof diagnostic.length === 'number' && diagnostic.length > 0 ? diagnostic.length : 0))
  const location = file ? file.getLineAndCharacterOfPosition(from) : null
  const line = location ? location.line + 1 : null
  const column = location ? location.character + 1 : null
  const sourceLine = line ? source.split('\n')[line - 1]?.trimEnd() ?? null : null

  return {
    from,
    to,
    message,
    line,
    column,
    sourceLine,
  }
}

function createPhaseState(runtimeContext: ScriptRuntimeContext, declarationFiles: ScriptRuntimeDeclarationFiles): ScriptRuntimePhaseState {
  const key = getScriptRuntimeContextKey(runtimeContext)
  const isVisualizerOnly = isScriptRuntimeVisualizerOnly(runtimeContext)
  const userFileName = isVisualizerOnly ? `${key}.script.tsx` : `${key}.script.ts`
  const declarationFileName = `${key}.runtime.d.ts`
  const rootLibFile = isVisualizerOnly ? declarationFiles.visualizerRootLibFile : declarationFiles.rootLibFile
  const files = new Map(declarationFiles.files)
  if (!isVisualizerOnly) {
    for (const fileName of builtInReactTypeFileNames) {
      files.delete(fileName)
    }
  }
  files.set(declarationFileName, buildPhaseDeclarations(runtimeContext, [getScriptRuntimeDeclarations(runtimeContext)]))
  files.set(userFileName, '')
  const rootFileNames = new Set([declarationFileName, userFileName])

  const versions = new Map<string, number>()
  for (const fileName of files.keys()) {
    versions.set(fileName, 0)
  }

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: [rootLibFile],
      strict: true,
      noImplicitAny: false,
      allowJs: true,
      checkJs: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      jsx: ts.JsxEmit.ReactJSX,
      noEmit: true,
      noLib: false,
      types: [],
    }),
    getScriptFileNames: () => Array.from(rootFileNames),
    getScriptVersion: fileName => String(versions.get(fileName) ?? 0),
    getProjectVersion: () => String(phaseState.projectVersion),
    getScriptSnapshot: fileName => {
      const content = files.get(fileName)
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content)
    },
    getScriptKind: fileName => {
      if (fileName.endsWith('.tsx')) {
        return ts.ScriptKind.TSX
      }

      if (fileName.endsWith('.js')) {
        return ts.ScriptKind.JS
      }

      return ts.ScriptKind.TS
    },
    getCurrentDirectory: () => '',
    getDefaultLibFileName: () => rootLibFile,
    fileExists: fileName => files.has(fileName),
    readFile: fileName => files.get(fileName),
    readDirectory: () => [],
    directoryExists: () => true,
    getDirectories: () => [],
    useCaseSensitiveFileNames: () => true,
    resolveModuleNames: (moduleNames, containingFile) => {
      const compilerOptions = host.getCompilationSettings()
      return moduleNames.map(moduleName =>
        resolvePackageAwareModuleName(moduleName, containingFile, compilerOptions, files, phaseState.packages)
      )
    },
  }

  const phaseState: ScriptRuntimePhaseState = {
    runtimeContext,
    service: ts.createLanguageService(host, ts.createDocumentRegistry()),
    files,
    versions,
    projectVersion: 0,
    userFileName,
    declarationFileName,
    rootFileNames,
    dynamicFileNames: new Set<string>(),
    dynamicRootFileNames: new Set<string>(),
    packages: [],
  }

  return phaseState
}

function buildPhaseDeclarations(runtimeContext: ScriptRuntimeContext, sections: string[]) {
  return [
    isScriptRuntimeVisualizerOnly(runtimeContext) ? '/// <reference path="./vendor/react/jsx-runtime.d.ts" />' : '',
    ...sections,
    '/// <reference lib="esnext.iterator" />',
    '',
  ]
    .filter(Boolean)
    .join('\n')
}

function createSharedScriptFiles(runtimeContext: ScriptRuntimeContext, sharedScripts: ScriptRuntimeSharedScript[]) {
  const extension = isScriptRuntimeVisualizerOnly(runtimeContext) ? 'tsx' : 'ts'
  const files: Array<{ fileName: string; content: string }> = []
  const modules = new Map<string, string>()
  const requiredTargets = getScriptRuntimeTargets(runtimeContext)

  for (const script of sharedScripts) {
    if (!script.isActive || !script.code.trim() || !requiredTargets.every(target => script.targets.includes(target))) {
      continue
    }

    const fileName = `shared-script-${script.id}.${extension}`
    files.push({ fileName, content: script.code })

    if (script.kind === 'module' && script.name.trim()) {
      modules.set(script.name, fileName)
    }
  }

  return { files, modules }
}

function buildRequireScriptDeclarations(modules: Map<string, string>) {
  const lines = Array.from(modules.entries()).map(
    ([name, fileName]) => `declare function requireScript(name: ${JSON.stringify(name)}): typeof import('./${fileName.replace(/\.tsx?$/, '')}')`
  )

  lines.push('declare function requireScript(name: string): unknown')
  return lines.join('\n')
}

function buildLoadPackageDeclarations(packages: ScriptRuntimePackage[]) {
  const packageCounts = new Map<string, number>()
  for (const pkg of packages) {
    packageCounts.set(pkg.packageName, (packageCounts.get(pkg.packageName) ?? 0) + 1)
  }

  const packageEntries = new Map<string, string>()
  for (const pkg of packages) {
    if (pkg.downloadStatus !== 'ready') {
      continue
    }

    const exactSpecifier = formatScriptPackageSpecifier(pkg.packageName, pkg.packageVersion)
    packageEntries.set(exactSpecifier, exactSpecifier)

    if (packageCounts.get(pkg.packageName) === 1) {
      packageEntries.set(pkg.packageName, exactSpecifier)
    }
  }

  if (packageEntries.size === 0) {
    return ''
  }

  const lines = ['interface ScriptRuntimeInstalledPackageMap {']
  for (const [specifier, importSpecifier] of packageEntries) {
    lines.push(`  ${JSON.stringify(specifier)}: typeof import(${JSON.stringify(importSpecifier)})`)
  }
  lines.push('}')

  return lines.join('\n')
}

function resolvePackageAwareModuleName(
  moduleName: string,
  containingFile: string,
  compilerOptions: ts.CompilerOptions,
  files: Map<string, string>,
  packages: ScriptRuntimePackage[]
) {
  const parsedSpecifier = parseScriptPackageSpecifier(moduleName)
  const matchingPackages = parsedSpecifier ? packages.filter(pkg => pkg.packageName === parsedSpecifier.packageName) : []

  const builtInReactTypeFileName = getBuiltInReactTypeFileName(moduleName)
  if (builtInReactTypeFileName) {
    return {
      resolvedFileName: builtInReactTypeFileName,
      extension: ts.Extension.Dts,
      isExternalLibraryImport: true,
    }
  }

  const resolvedPackage =
    parsedSpecifier && parsedSpecifier.version
      ? matchingPackages.find(pkg => pkg.packageVersion === parsedSpecifier.version)
      : matchingPackages.length === 1
        ? matchingPackages[0]
        : null

  const moduleResolutionHost: ts.ModuleResolutionHost = {
    fileExists: fileName => files.has(fileName),
    readFile: fileName => files.get(fileName),
    directoryExists: directoryPath => hasDirectory(files, directoryPath),
    getDirectories: directoryPath => listDirectories(files, directoryPath),
    realpath: fileName => fileName,
    useCaseSensitiveFileNames: () => true,
    getCurrentDirectory: () => '/',
  }

  if (!parsedSpecifier || matchingPackages.length === 0) {
    return ts.resolveModuleName(moduleName, containingFile, compilerOptions, moduleResolutionHost).resolvedModule
  }

  if (!resolvedPackage || resolvedPackage.downloadStatus !== 'ready') {
    return undefined
  }

  const internalModuleName = `${parsedSpecifier.packageName}${parsedSpecifier.subpath}`
  const syntheticContainingFile = `/__script_packages__/${resolvedPackage.cacheKey}/index.ts`
  return ts.resolveModuleName(internalModuleName, syntheticContainingFile, compilerOptions, moduleResolutionHost).resolvedModule
}

function getBuiltInReactTypeFileName(moduleName: string) {
  switch (moduleName) {
    case 'react':
      return reactTypeModuleFileNames.react
    case 'react/jsx-runtime':
      return reactTypeModuleFileNames.reactJsxRuntime
    case 'react/jsx-dev-runtime':
      return reactTypeModuleFileNames.reactJsxDevRuntime
    case 'csstype':
      return reactTypeModuleFileNames.csstype
    default:
      return null
  }
}

function toVirtualPackageFileName(cacheKey: string, relativePath: string) {
  return `/__script_packages__/${cacheKey}/node_modules/${relativePath.replace(/\\/g, '/')}`
}

function hasDirectory(files: Map<string, string>, directoryPath: string) {
  const normalizedDirectoryPath = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`
  for (const fileName of files.keys()) {
    if (fileName.startsWith(normalizedDirectoryPath)) {
      return true
    }
  }

  return false
}

function listDirectories(files: Map<string, string>, directoryPath: string) {
  const normalizedDirectoryPath = directoryPath.endsWith('/') ? directoryPath : `${directoryPath}/`
  const directories = new Set<string>()

  for (const fileName of files.keys()) {
    if (!fileName.startsWith(normalizedDirectoryPath)) {
      continue
    }

    const remainder = fileName.slice(normalizedDirectoryPath.length)
    const slashIndex = remainder.indexOf('/')
    if (slashIndex <= 0) {
      continue
    }

    directories.add(remainder.slice(0, slashIndex))
  }

  return Array.from(directories)
}

function normalizeTargets(targets: SharedScriptTarget[]) {
  return Array.from(new Set(targets)).sort((left, right) => left.localeCompare(right))
}
