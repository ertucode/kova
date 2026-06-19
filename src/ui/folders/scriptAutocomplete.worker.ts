import ts from 'typescript'
import { type ScriptRuntimeContext } from './scriptRuntimeDeclarations'
import type {
  ScriptAutocompleteOption,
  ScriptAutocompleteRequest,
  ScriptAutocompleteResponse,
  ScriptHoverPart,
  ScriptHoverRequest,
  ScriptHoverResponse,
  ScriptDiagnosticsRequest,
  ScriptDiagnosticsResponse,
} from './scriptAutocompleteTypes'
import {
  collectScriptRuntimeDiagnostics,
  createScriptRuntimeDeclarationFiles,
  createScriptRuntimePhaseStateManager,
  type ScriptRuntimeDeclarationFiles as DeclarationFiles,
  type ScriptRuntimeDeclarationPayload as DeclarationPayload,
  type ScriptRuntimePhaseState as PhaseState,
  updateScriptRuntimePhaseSource,
} from './scriptRuntimeDiagnostics'

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

const preferredSandboxGlobals = new Set([
  'env',
  'scope',
  'cache',
  'request',
  'response',
  'callRequest',
  'console',
  'crypto',
  'prompt',
  'toast',
  'z',
])
const preferredBuiltinGlobals = new Set(['Date', 'Math', 'JSON', 'Promise', 'Object', 'Array', 'Map', 'Set', 'String', 'Number'])

let declarationFilesPromise: Promise<DeclarationFiles> | null = null
const phaseStateManager = createScriptRuntimePhaseStateManager(loadDeclarationFiles)

self.addEventListener('message', event => {
  void handleMessage(event.data)
})

async function handleMessage(request: ScriptAutocompleteRequest | ScriptDiagnosticsRequest | ScriptHoverRequest) {
  const response = await ((): Promise<ScriptAutocompleteResponse | ScriptDiagnosticsResponse | ScriptHoverResponse> => {
    switch (request.type) {
      case 'autocomplete':
        return complete(request)
      case 'diagnostics':
        return getDiagnostics(request)
      case 'hover':
        return getHover(request)
    }
  })()

  self.postMessage(response)
}

async function complete(request: ScriptAutocompleteRequest): Promise<ScriptAutocompleteResponse> {
  try {
    const phaseState = await getOrCreatePhaseState(request.runtimeContext)
    updatePhaseState(phaseState, request)

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
    updatePhaseState(phaseState, request)

    return {
      requestId: request.requestId,
      success: true,
      diagnostics: collectScriptRuntimeDiagnostics(phaseState, request.code),
    }
  } catch (error) {
    return {
      requestId: request.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

async function getHover(request: ScriptHoverRequest): Promise<ScriptHoverResponse> {
  try {
    const phaseState = await getOrCreatePhaseState(request.runtimeContext)
    updatePhaseState(phaseState, request)

    const quickInfo = phaseState.service.getQuickInfoAtPosition(phaseState.userFileName, request.position)
    if (!quickInfo || !quickInfo.textSpan) {
      return {
        requestId: request.requestId,
        success: true,
        hover: null,
      }
    }

    return {
      requestId: request.requestId,
      success: true,
      hover: {
        from: quickInfo.textSpan.start,
        to: quickInfo.textSpan.start + quickInfo.textSpan.length,
        detailParts: toHoverParts(quickInfo.displayParts),
        documentationParts: toHoverParts(quickInfo.documentation),
        tags: (quickInfo.tags ?? []).map(tag => ({
          name: tag.name,
          textParts: toHoverParts(tag.text),
        })),
      },
    }
  } catch (error) {
    return {
      requestId: request.requestId,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

function updatePhaseState(
  phaseState: PhaseState,
  request: ScriptAutocompleteRequest | ScriptDiagnosticsRequest | ScriptHoverRequest
) {
  updateScriptRuntimePhaseSource(phaseState, {
    code: request.code,
    requestPaths: request.requestPaths ?? [],
    sharedScripts: request.sharedScripts ?? [],
    packages: request.packages ?? [],
  })
}

function toHoverParts(parts: readonly ts.SymbolDisplayPart[] | string | undefined): ScriptHoverPart[] {
  if (!parts) {
    return []
  }

  if (typeof parts === 'string') {
    return [{ text: parts, kind: 'text' }]
  }

  return parts.map(part => ({ text: part.text, kind: part.kind }))
}

async function getOrCreatePhaseState(runtimeContext: ScriptRuntimeContext) {
  return await phaseStateManager.getOrCreatePhaseState(runtimeContext)
}

function loadDeclarationFiles() {
  if (!declarationFilesPromise) {
    declarationFilesPromise = loadDeclarationPayload().then(createScriptRuntimeDeclarationFiles)
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
