import ts from 'typescript'
import type { SharedScriptTarget } from '@common/SharedScripts'
import { formatScriptPackageSpecifier, parseScriptPackageSpecifier } from '@common/ScriptPackages'
import {
  getScriptRuntimeDeclarations,
  getScriptRuntimeTargets,
  isScriptRuntimeVisualizerOnly,
  type ScriptRuntimeContext,
} from './scriptRuntimeDeclarations'
import type {
  ScriptAutocompleteOption,
  ScriptAutocompletePackage,
  ScriptAutocompleteRequest,
  ScriptAutocompleteResponse,
  ScriptAutocompleteSharedScript,
  ScriptDiagnosticsRequest,
  ScriptDiagnosticsResponse,
  ScriptEditorDiagnostic,
} from './scriptAutocompleteTypes'
import { sanitizePackageTypeFileContent } from './scriptAutocompletePackageTypes'

type PhaseState = {
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
  packages: ScriptAutocompletePackage[]
}

type DeclarationPayload = {
  rootLibFile: string
  files: Record<string, string>
}

type DeclarationFiles = {
  rootLibFile: string
  files: Map<string, string>
}

const blockedKeywordCompletions = new Set([
  'abstract',
  'any',
  'as',
  'asserts',
  'declare',
  'enum',
  'implements',
  'infer',
  'interface',
  'is',
  'keyof',
  'module',
  'namespace',
  'override',
  'private',
  'protected',
  'public',
  'readonly',
  'satisfies',
  'type',
])

const preferredSandboxGlobals = new Set(['env', 'scope', 'request', 'response', 'console', 'crypto', 'prompt', 'toast', 'z'])
const preferredBuiltinGlobals = new Set(['Date', 'Math', 'JSON', 'Promise', 'Object', 'Array', 'Map', 'Set', 'String', 'Number'])
const allowedTopLevelScriptDiagnosticCodes = new Set([
  1108,
  1375,
])

const phaseStates = new Map<string, PhaseState>()
const phaseStatePromises = new Map<string, Promise<PhaseState>>()
let declarationFilesPromise: Promise<DeclarationFiles> | null = null

self.addEventListener('message', event => {
  void handleMessage(event.data)
})

async function handleMessage(request: ScriptAutocompleteRequest | ScriptDiagnosticsRequest) {
  const response = request.type === 'autocomplete' ? await complete(request) : await getDiagnostics(request)
  self.postMessage(response)
}

async function complete(request: ScriptAutocompleteRequest): Promise<ScriptAutocompleteResponse> {
  try {
    const phaseState = await getOrCreatePhaseState(request.runtimeContext)

    updatePhaseSource(phaseState, request.code, request.sharedScripts ?? [], request.packages ?? [])

    const completions = phaseState.service.getCompletionsAtPosition(phaseState.userFileName, request.position, {
      includeCompletionsForModuleExports: false,
      includeCompletionsWithInsertText: true,
      includeCompletionsWithSnippetText: true,
    })

    if (!completions) {
      return {
        requestId: request.requestId,
        success: true,
        from: request.position,
        to: request.position,
        options: [],
      }
    }

    const entries = completions.entries.filter(isAllowedEntry)
    const replacementFrom = completions.optionalReplacementSpan ? completions.optionalReplacementSpan.start : request.position
    const query = request.code.slice(replacementFrom, request.position)

    return {
      requestId: request.requestId,
      success: true,
      from: replacementFrom,
      to: completions.optionalReplacementSpan ? completions.optionalReplacementSpan.start + completions.optionalReplacementSpan.length : request.position,
      options: entries.slice(0, 200).map((entry, index) =>
        toOption(phaseState.service, phaseState.userFileName, request.position, entry, index, query)
      ),
    }
  } catch (error) {
    return {
      requestId: request.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function getDiagnostics(request: ScriptDiagnosticsRequest): Promise<ScriptDiagnosticsResponse> {
  try {
    const phaseState = await getOrCreatePhaseState(request.runtimeContext)

    updatePhaseSource(phaseState, request.code, request.sharedScripts ?? [], request.packages ?? [])

    return {
      requestId: request.requestId,
      success: true,
      diagnostics: dedupeDiagnostics([
        ...phaseState.service.getSyntacticDiagnostics(phaseState.userFileName),
        ...phaseState.service.getSemanticDiagnostics(phaseState.userFileName),
      ])
        .filter(diagnostic => !diagnostic.file || diagnostic.file.fileName === phaseState.userFileName)
        .filter(diagnostic => !shouldIgnoreDiagnostic(phaseState.runtimeContext, diagnostic))
        .map(diagnostic => toEditorDiagnostic(diagnostic, request.code, phaseState.service, phaseState.userFileName)),
    }
  } catch (error) {
    return {
      requestId: request.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function shouldIgnoreDiagnostic(runtimeContext: ScriptRuntimeContext, diagnostic: ts.Diagnostic) {
  if (isScriptRuntimeVisualizerOnly(runtimeContext)) {
    return false
  }

  return allowedTopLevelScriptDiagnosticCodes.has(diagnostic.code)
}

function updatePhaseSource(
  phaseState: PhaseState,
  code: string,
  sharedScripts: ScriptAutocompleteSharedScript[],
  packages: ScriptAutocompletePackage[]
) {
  phaseState.projectVersion += 1
  phaseState.files.set(phaseState.userFileName, code)
  phaseState.versions.set(phaseState.userFileName, (phaseState.versions.get(phaseState.userFileName) ?? 0) + 1)
  phaseState.packages = packages

  for (const fileName of phaseState.dynamicFileNames) {
    phaseState.files.delete(fileName)
    phaseState.versions.delete(fileName)
  }
  phaseState.dynamicFileNames.clear()
  for (const fileName of phaseState.dynamicRootFileNames) {
    phaseState.rootFileNames.delete(fileName)
  }
  phaseState.dynamicRootFileNames.clear()

  const sharedScriptFiles = createSharedScriptFiles(phaseState.runtimeContext, sharedScripts)
  for (const file of sharedScriptFiles.files) {
    phaseState.dynamicFileNames.add(file.fileName)
    phaseState.dynamicRootFileNames.add(file.fileName)
    phaseState.rootFileNames.add(file.fileName)
    phaseState.files.set(file.fileName, file.content)
    phaseState.versions.set(file.fileName, (phaseState.versions.get(file.fileName) ?? 0) + 1)
  }

  for (const pkg of packages) {
    for (const [relativePath, content] of Object.entries(pkg.typeFiles)) {
      const fileName = toVirtualPackageFileName(pkg.cacheKey, relativePath)
      phaseState.dynamicFileNames.add(fileName)
      phaseState.files.set(fileName, sanitizePackageTypeFileContent(content))
      phaseState.versions.set(fileName, (phaseState.versions.get(fileName) ?? 0) + 1)
    }
  }

  phaseState.files.set(
    phaseState.declarationFileName,
    [
      getScriptRuntimeDeclarations(phaseState.runtimeContext),
      buildRequireScriptDeclarations(sharedScriptFiles.modules),
      buildLoadPackageDeclarations(packages),
      '/// <reference lib="esnext.iterator" />',
      '',
    ].join('\n')
  )
  phaseState.versions.set(phaseState.declarationFileName, (phaseState.versions.get(phaseState.declarationFileName) ?? 0) + 1)
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

function toEditorDiagnostic(
  diagnostic: ts.Diagnostic,
  source: string,
  service: ts.LanguageService,
  fileName: string
): ScriptEditorDiagnostic {
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

function createPhaseState(runtimeContext: ScriptRuntimeContext, declarationFiles: DeclarationFiles): PhaseState {
  const key = getRuntimeContextKey(runtimeContext)
  const userFileName = isScriptRuntimeVisualizerOnly(runtimeContext) ? `${key}.script.tsx` : `${key}.script.ts`
  const declarationFileName = `${key}.runtime.d.ts`
  const files = new Map(declarationFiles.files)
  files.set(declarationFileName, `${getScriptRuntimeDeclarations(runtimeContext)}\n/// <reference lib=\"esnext.iterator\" />\n`)
  files.set(userFileName, '')
  const rootFileNames = new Set(files.keys())

  const versions = new Map<string, number>()
  for (const fileName of files.keys()) {
    versions.set(fileName, 0)
  }

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      lib: [declarationFiles.rootLibFile],
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
    getDefaultLibFileName: () => declarationFiles.rootLibFile,
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

  const phaseState: PhaseState = {
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

function createSharedScriptFiles(runtimeContext: ScriptRuntimeContext, sharedScripts: ScriptAutocompleteSharedScript[]) {
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

async function getOrCreatePhaseState(runtimeContext: ScriptRuntimeContext) {
  const key = getRuntimeContextKey(runtimeContext)
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
}

function loadDeclarationFiles() {
  if (!declarationFilesPromise) {
    declarationFilesPromise = loadDeclarationPayload().then(payload => ({
      rootLibFile: payload.rootLibFile,
      files: new Map(Object.entries(payload.files)),
    }))
  }

  return declarationFilesPromise
}

async function loadDeclarationPayload(): Promise<DeclarationPayload> {
  const response = await fetch(new URL('./declarations.json', self.location.href))
  if (!response.ok) {
    throw new Error(`Failed to load script autocomplete declarations: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as DeclarationPayload
}

function getRuntimeContextKey(runtimeContext: ScriptRuntimeContext) {
  if ('phase' in runtimeContext) {
    return runtimeContext.phase
  }

  if ('templatePhase' in runtimeContext) {
    return `template-${runtimeContext.templatePhase}`
  }

  return `targets-${normalizeTargets(runtimeContext.targets).join('__')}`
}

function normalizeTargets(targets: SharedScriptTarget[]) {
  return Array.from(new Set(targets)).sort((left, right) => left.localeCompare(right))
}

function buildRequireScriptDeclarations(modules: Map<string, string>) {
  const lines = Array.from(modules.entries()).map(
    ([name, fileName]) => `declare function requireScript(name: ${JSON.stringify(name)}): typeof import('./${fileName.replace(/\.tsx?$/, '')}')`
  )

  lines.push('declare function requireScript(name: string): unknown')

  return lines.join('\n')
}

function buildLoadPackageDeclarations(packages: ScriptAutocompletePackage[]) {
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
  packages: ScriptAutocompletePackage[]
) {
  const parsedSpecifier = parseScriptPackageSpecifier(moduleName)
  const matchingPackages = parsedSpecifier ? packages.filter(pkg => pkg.packageName === parsedSpecifier.packageName) : []

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

function isAllowedEntry(entry: ts.CompletionEntry) {
  if (entry.kind === ts.ScriptElementKind.keyword && blockedKeywordCompletions.has(entry.name)) {
    return false
  }

  return true
}

function toOption(
  service: ts.LanguageService,
  fileName: string,
  position: number,
  entry: ts.CompletionEntry,
  index: number,
  query: string
): ScriptAutocompleteOption {
  const details = service.getCompletionEntryDetails(fileName, position, entry.name, {}, entry.source, {}, entry.data)
  const display = ts.displayPartsToString(details?.displayParts ?? [])
  const documentation = ts.displayPartsToString(details?.documentation ?? [])
  const baseBoost = Math.max(-40, 40 - index)

  return {
    label: entry.name,
    type: mapCompletionKind(entry.kind),
    detail: display || entry.kind,
    info: documentation || undefined,
    applyText: entry.insertText && !entry.isSnippet ? entry.insertText : undefined,
    boost: clampBoost(baseBoost + scoreEntry(entry, query)),
  }
}

function scoreEntry(entry: ts.CompletionEntry, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  const normalizedName = entry.name.toLowerCase()
  let score = 0

  if (isLocalValueEntry(entry)) {
    score += 35
  }

  if (preferredSandboxGlobals.has(entry.name)) {
    score += normalizedQuery === '' ? 70 : 40
  } else if (preferredBuiltinGlobals.has(entry.name)) {
    score += normalizedQuery === '' ? 20 : 10
  } else if (normalizedQuery === '' && isGenericGlobalEntry(entry)) {
    score -= 15
  }

  if (normalizedQuery !== '') {
    if (normalizedName === normalizedQuery) {
      score += 80
    } else if (normalizedName.startsWith(normalizedQuery)) {
      score += 45
    } else if (normalizedName.includes(normalizedQuery)) {
      score += 10
    } else {
      score -= 25
    }
  }

  return score
}

function isLocalValueEntry(entry: ts.CompletionEntry) {
  return (
    entry.kind === ts.ScriptElementKind.localVariableElement ||
    entry.kind === ts.ScriptElementKind.variableElement ||
    entry.kind === ts.ScriptElementKind.parameterElement ||
    entry.kind === ts.ScriptElementKind.localFunctionElement
  )
}

function isGenericGlobalEntry(entry: ts.CompletionEntry) {
  return entry.source === undefined && !isLocalValueEntry(entry)
}

function clampBoost(value: number) {
  return Math.max(-99, Math.min(99, value))
}

function mapCompletionKind(kind: ts.ScriptElementKind): ScriptAutocompleteOption['type'] {
  switch (kind) {
    case ts.ScriptElementKind.keyword:
      return 'keyword'
    case ts.ScriptElementKind.primitiveType:
    case ts.ScriptElementKind.localClassElement:
    case ts.ScriptElementKind.typeElement:
    case ts.ScriptElementKind.classElement:
      return 'type'
    case ts.ScriptElementKind.memberFunctionElement:
    case ts.ScriptElementKind.functionElement:
    case ts.ScriptElementKind.constructSignatureElement:
      return 'function'
    case ts.ScriptElementKind.variableElement:
    case ts.ScriptElementKind.localVariableElement:
    case ts.ScriptElementKind.parameterElement:
      return 'variable'
    case ts.ScriptElementKind.memberGetAccessorElement:
    case ts.ScriptElementKind.memberSetAccessorElement:
    case ts.ScriptElementKind.memberVariableElement:
    case ts.ScriptElementKind.memberAccessorVariableElement:
      return 'property'
    case ts.ScriptElementKind.enumElement:
      return 'constant'
    case ts.ScriptElementKind.interfaceElement:
      return 'interface'
    default:
      return 'text'
  }
}
