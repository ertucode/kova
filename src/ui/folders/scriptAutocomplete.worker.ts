import ts from 'typescript'
import { type ScriptRuntimeContext } from './scriptRuntimeDeclarations'
import type {
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
import { toScriptAutocompleteResult } from './scriptAutocompleteCompletions'

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

    const result = toScriptAutocompleteResult(
      phaseState.service,
      phaseState.userFileName,
      request.position,
      request.code,
      completions
    )

    return {
      requestId: request.requestId,
      success: true,
      from: result.from,
      to: result.to,
      options: result.options,
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
