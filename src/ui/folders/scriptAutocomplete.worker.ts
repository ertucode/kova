import ts from 'typescript'
import decoratorsLib from 'typescript/lib/lib.decorators.d.ts?raw'
import decoratorsLegacyLib from 'typescript/lib/lib.decorators.legacy.d.ts?raw'
import es5Lib from 'typescript/lib/lib.es5.d.ts?raw'
import es2015Lib from 'typescript/lib/lib.es2015.d.ts?raw'
import es2015CollectionLib from 'typescript/lib/lib.es2015.collection.d.ts?raw'
import es2015CoreLib from 'typescript/lib/lib.es2015.core.d.ts?raw'
import es2015GeneratorLib from 'typescript/lib/lib.es2015.generator.d.ts?raw'
import es2015IterableLib from 'typescript/lib/lib.es2015.iterable.d.ts?raw'
import es2015PromiseLib from 'typescript/lib/lib.es2015.promise.d.ts?raw'
import es2015ProxyLib from 'typescript/lib/lib.es2015.proxy.d.ts?raw'
import es2015ReflectLib from 'typescript/lib/lib.es2015.reflect.d.ts?raw'
import es2015SymbolLib from 'typescript/lib/lib.es2015.symbol.d.ts?raw'
import es2015SymbolWellKnownLib from 'typescript/lib/lib.es2015.symbol.wellknown.d.ts?raw'
import es2016Lib from 'typescript/lib/lib.es2016.d.ts?raw'
import es2016ArrayIncludeLib from 'typescript/lib/lib.es2016.array.include.d.ts?raw'
import es2016IntlLib from 'typescript/lib/lib.es2016.intl.d.ts?raw'
import es2017Lib from 'typescript/lib/lib.es2017.d.ts?raw'
import es2017ArrayBufferLib from 'typescript/lib/lib.es2017.arraybuffer.d.ts?raw'
import es2017DateLib from 'typescript/lib/lib.es2017.date.d.ts?raw'
import es2017IntlLib from 'typescript/lib/lib.es2017.intl.d.ts?raw'
import es2017ObjectLib from 'typescript/lib/lib.es2017.object.d.ts?raw'
import es2017SharedMemoryLib from 'typescript/lib/lib.es2017.sharedmemory.d.ts?raw'
import es2017StringLib from 'typescript/lib/lib.es2017.string.d.ts?raw'
import es2017TypedArraysLib from 'typescript/lib/lib.es2017.typedarrays.d.ts?raw'
import es2018Lib from 'typescript/lib/lib.es2018.d.ts?raw'
import es2018AsyncGeneratorLib from 'typescript/lib/lib.es2018.asyncgenerator.d.ts?raw'
import es2018AsyncIterableLib from 'typescript/lib/lib.es2018.asynciterable.d.ts?raw'
import es2018IntlLib from 'typescript/lib/lib.es2018.intl.d.ts?raw'
import es2018PromiseLib from 'typescript/lib/lib.es2018.promise.d.ts?raw'
import es2018RegexpLib from 'typescript/lib/lib.es2018.regexp.d.ts?raw'
import es2019Lib from 'typescript/lib/lib.es2019.d.ts?raw'
import es2019ArrayLib from 'typescript/lib/lib.es2019.array.d.ts?raw'
import es2019IntlLib from 'typescript/lib/lib.es2019.intl.d.ts?raw'
import es2019ObjectLib from 'typescript/lib/lib.es2019.object.d.ts?raw'
import es2019StringLib from 'typescript/lib/lib.es2019.string.d.ts?raw'
import es2019SymbolLib from 'typescript/lib/lib.es2019.symbol.d.ts?raw'
import es2020Lib from 'typescript/lib/lib.es2020.d.ts?raw'
import es2020BigIntLib from 'typescript/lib/lib.es2020.bigint.d.ts?raw'
import es2020DateLib from 'typescript/lib/lib.es2020.date.d.ts?raw'
import es2020IntlLib from 'typescript/lib/lib.es2020.intl.d.ts?raw'
import es2020NumberLib from 'typescript/lib/lib.es2020.number.d.ts?raw'
import es2020PromiseLib from 'typescript/lib/lib.es2020.promise.d.ts?raw'
import es2020SharedMemoryLib from 'typescript/lib/lib.es2020.sharedmemory.d.ts?raw'
import es2020StringLib from 'typescript/lib/lib.es2020.string.d.ts?raw'
import es2020SymbolWellKnownLib from 'typescript/lib/lib.es2020.symbol.wellknown.d.ts?raw'
import es2021Lib from 'typescript/lib/lib.es2021.d.ts?raw'
import es2021IntlLib from 'typescript/lib/lib.es2021.intl.d.ts?raw'
import es2021PromiseLib from 'typescript/lib/lib.es2021.promise.d.ts?raw'
import es2021StringLib from 'typescript/lib/lib.es2021.string.d.ts?raw'
import es2021WeakRefLib from 'typescript/lib/lib.es2021.weakref.d.ts?raw'
import es2022Lib from 'typescript/lib/lib.es2022.d.ts?raw'
import es2022ArrayLib from 'typescript/lib/lib.es2022.array.d.ts?raw'
import es2022ErrorLib from 'typescript/lib/lib.es2022.error.d.ts?raw'
import es2022IntlLib from 'typescript/lib/lib.es2022.intl.d.ts?raw'
import es2022ObjectLib from 'typescript/lib/lib.es2022.object.d.ts?raw'
import es2022RegexpLib from 'typescript/lib/lib.es2022.regexp.d.ts?raw'
import es2022StringLib from 'typescript/lib/lib.es2022.string.d.ts?raw'
import es2023Lib from 'typescript/lib/lib.es2023.d.ts?raw'
import es2023ArrayLib from 'typescript/lib/lib.es2023.array.d.ts?raw'
import es2023CollectionLib from 'typescript/lib/lib.es2023.collection.d.ts?raw'
import es2023IntlLib from 'typescript/lib/lib.es2023.intl.d.ts?raw'
import esnextIteratorLib from 'typescript/lib/lib.esnext.iterator.d.ts?raw'
import { getScriptRuntimeDeclarations, type ScriptAutocompletePhase } from './scriptRuntimeDeclarations'
import type { ScriptAutocompleteOption, ScriptAutocompleteRequest, ScriptAutocompleteResponse } from './scriptAutocompleteTypes'

const rootLibFile = 'lib.es2023.d.ts'
const sharedFiles = new Map<string, string>([
  ['lib.decorators.d.ts', decoratorsLib],
  ['lib.decorators.legacy.d.ts', decoratorsLegacyLib],
  ['lib.es5.d.ts', es5Lib],
  ['lib.es2015.d.ts', es2015Lib],
  ['lib.es2015.collection.d.ts', es2015CollectionLib],
  ['lib.es2015.core.d.ts', es2015CoreLib],
  ['lib.es2015.generator.d.ts', es2015GeneratorLib],
  ['lib.es2015.iterable.d.ts', es2015IterableLib],
  ['lib.es2015.promise.d.ts', es2015PromiseLib],
  ['lib.es2015.proxy.d.ts', es2015ProxyLib],
  ['lib.es2015.reflect.d.ts', es2015ReflectLib],
  ['lib.es2015.symbol.d.ts', es2015SymbolLib],
  ['lib.es2015.symbol.wellknown.d.ts', es2015SymbolWellKnownLib],
  ['lib.es2016.d.ts', es2016Lib],
  ['lib.es2016.array.include.d.ts', es2016ArrayIncludeLib],
  ['lib.es2016.intl.d.ts', es2016IntlLib],
  ['lib.es2017.d.ts', es2017Lib],
  ['lib.es2017.arraybuffer.d.ts', es2017ArrayBufferLib],
  ['lib.es2017.date.d.ts', es2017DateLib],
  ['lib.es2017.intl.d.ts', es2017IntlLib],
  ['lib.es2017.object.d.ts', es2017ObjectLib],
  ['lib.es2017.sharedmemory.d.ts', es2017SharedMemoryLib],
  ['lib.es2017.string.d.ts', es2017StringLib],
  ['lib.es2017.typedarrays.d.ts', es2017TypedArraysLib],
  ['lib.es2018.d.ts', es2018Lib],
  ['lib.es2018.asyncgenerator.d.ts', es2018AsyncGeneratorLib],
  ['lib.es2018.asynciterable.d.ts', es2018AsyncIterableLib],
  ['lib.es2018.intl.d.ts', es2018IntlLib],
  ['lib.es2018.promise.d.ts', es2018PromiseLib],
  ['lib.es2018.regexp.d.ts', es2018RegexpLib],
  ['lib.es2019.d.ts', es2019Lib],
  ['lib.es2019.array.d.ts', es2019ArrayLib],
  ['lib.es2019.intl.d.ts', es2019IntlLib],
  ['lib.es2019.object.d.ts', es2019ObjectLib],
  ['lib.es2019.string.d.ts', es2019StringLib],
  ['lib.es2019.symbol.d.ts', es2019SymbolLib],
  ['lib.es2020.d.ts', es2020Lib],
  ['lib.es2020.bigint.d.ts', es2020BigIntLib],
  ['lib.es2020.date.d.ts', es2020DateLib],
  ['lib.es2020.intl.d.ts', es2020IntlLib],
  ['lib.es2020.number.d.ts', es2020NumberLib],
  ['lib.es2020.promise.d.ts', es2020PromiseLib],
  ['lib.es2020.sharedmemory.d.ts', es2020SharedMemoryLib],
  ['lib.es2020.string.d.ts', es2020StringLib],
  ['lib.es2020.symbol.wellknown.d.ts', es2020SymbolWellKnownLib],
  ['lib.es2021.d.ts', es2021Lib],
  ['lib.es2021.intl.d.ts', es2021IntlLib],
  ['lib.es2021.promise.d.ts', es2021PromiseLib],
  ['lib.es2021.string.d.ts', es2021StringLib],
  ['lib.es2021.weakref.d.ts', es2021WeakRefLib],
  ['lib.es2022.d.ts', es2022Lib],
  ['lib.es2022.array.d.ts', es2022ArrayLib],
  ['lib.es2022.error.d.ts', es2022ErrorLib],
  ['lib.es2022.intl.d.ts', es2022IntlLib],
  ['lib.es2022.object.d.ts', es2022ObjectLib],
  ['lib.es2022.regexp.d.ts', es2022RegexpLib],
  ['lib.es2022.string.d.ts', es2022StringLib],
  ['lib.es2023.d.ts', es2023Lib],
  ['lib.es2023.array.d.ts', es2023ArrayLib],
  ['lib.es2023.collection.d.ts', es2023CollectionLib],
  ['lib.es2023.intl.d.ts', es2023IntlLib],
  ['lib.esnext.iterator.d.ts', esnextIteratorLib],
])

type PhaseState = {
  service: ts.LanguageService
  files: Map<string, string>
  versions: Map<string, number>
  userFileName: string
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

const preferredSandboxGlobals = new Set(['env', 'scope', 'request', 'response', 'console', 'crypto', 'z'])
const preferredBuiltinGlobals = new Set(['Date', 'Math', 'JSON', 'Promise', 'Object', 'Array', 'Map', 'Set', 'String', 'Number'])

const phaseStates = new Map<ScriptAutocompletePhase, PhaseState>([
  ['pre-request', createPhaseState('pre-request')],
  ['post-request', createPhaseState('post-request')],
  ['response-visualizer', createPhaseState('response-visualizer')],
])

self.addEventListener('message', (event: MessageEvent<ScriptAutocompleteRequest>) => {
  const response = complete(event.data)
  self.postMessage(response)
})

function complete(request: ScriptAutocompleteRequest): ScriptAutocompleteResponse {
  try {
    const phaseState = phaseStates.get(request.phase)
    if (!phaseState) {
      throw new Error(`Unknown script autocomplete phase: ${request.phase}`)
    }

    phaseState.files.set(phaseState.userFileName, request.code)
    phaseState.versions.set(phaseState.userFileName, (phaseState.versions.get(phaseState.userFileName) ?? 0) + 1)

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

function createPhaseState(phase: ScriptAutocompletePhase): PhaseState {
  const userFileName = phase === 'response-visualizer' ? `${phase}.script.tsx` : `${phase}.script.js`
  const declarationFileName = `${phase}.runtime.d.ts`
  const files = new Map(sharedFiles)
  files.set(declarationFileName, `${getScriptRuntimeDeclarations(phase)}\n/// <reference lib=\"esnext.iterator\" />\n`)
  files.set(userFileName, '')

  const versions = new Map<string, number>()
  for (const fileName of files.keys()) {
    versions.set(fileName, 0)
  }

  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.ESNext,
      lib: [rootLibFile],
      strict: true,
      allowJs: true,
      checkJs: true,
      noEmit: true,
      noLib: false,
      types: [],
    }),
    getScriptFileNames: () => [userFileName, declarationFileName, rootLibFile],
    getScriptVersion: fileName => String(versions.get(fileName) ?? 0),
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
  }

  return {
    service: ts.createLanguageService(host, ts.createDocumentRegistry()),
    files,
    versions,
    userFileName,
  }
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
