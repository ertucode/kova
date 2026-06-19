/// <reference types="node" />

import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { buildScriptRuntimeDeclarationPayload } from '../../../scripts/utils/scriptRuntimeDeclarationBuilder.js'
import { toScriptAutocompleteResult } from './scriptAutocompleteCompletions'
import {
  createScriptRuntimeDeclarationFiles,
  createScriptRuntimePhaseStateManager,
  updateScriptRuntimePhaseSource,
} from './scriptRuntimeDiagnostics'

const declarationFilesPromise = buildScriptRuntimeDeclarationPayload({
  rootDir: process.cwd(),
}).then(createScriptRuntimeDeclarationFiles)

describe('script runtime DOM completions', () => {
  it('offers HTMLInputElement in view-runtime completions', async () => {
    const completionLabels = await getCompletionLabels({ phase: 'view-runtime' }, 'type Value = HTMLInputElement')

    expect(completionLabels).toContain('HTMLInputElement')
  })

  it('keeps HTMLInputElement in worker autocomplete options for view-runtime', async () => {
    const code = 'type Value = HTMLInputElement'
    const phaseState = await createPhaseState({ phase: 'view-runtime' }, code)
    const completions = phaseState.service.getCompletionsAtPosition(phaseState.userFileName, code.length, {
      includeCompletionsForModuleExports: false,
      includeCompletionsWithInsertText: true,
      includeCompletionsWithSnippetText: true,
    })

    expect(completions).not.toBeNull()

    const result = toScriptAutocompleteResult(phaseState.service, phaseState.userFileName, code.length, code, completions!)

    expect(result.options.map(option => option.label)).toContain('HTMLInputElement')
  })

  it('accepts HTMLInputElement in view-runtime diagnostics', async () => {
    const diagnostics = await getDiagnostics({ phase: 'view-runtime' }, 'type Value = HTMLInputElement')

    expect(diagnostics).toEqual([])
  })

  it('does not offer HTMLInputElement in pre-request completions', async () => {
    const completionLabels = await getCompletionLabels({ phase: 'pre-request' }, 'type Value = HTMLInputElement')

    expect(completionLabels).not.toContain('HTMLInputElement')
  })
})

async function getCompletionLabels(runtimeContext: { phase: 'view-runtime' | 'pre-request' }, code: string) {
  const phaseState = await createPhaseState(runtimeContext, code)
  const completions = phaseState.service.getCompletionsAtPosition(phaseState.userFileName, code.length, {
    includeCompletionsForModuleExports: false,
    includeCompletionsWithInsertText: true,
    includeCompletionsWithSnippetText: true,
  })

  return completions?.entries.map(entry => entry.name) ?? []
}

async function getDiagnostics(runtimeContext: { phase: 'view-runtime' | 'pre-request' }, code: string) {
  const phaseState = await createPhaseState(runtimeContext, code)
  return phaseState.service
    .getSemanticDiagnostics(phaseState.userFileName)
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

async function createPhaseState(runtimeContext: { phase: 'view-runtime' | 'pre-request' }, code: string) {
  const declarationFiles = await declarationFilesPromise
  const phaseStateManager = createScriptRuntimePhaseStateManager(async () => declarationFiles)
  const phaseState = await phaseStateManager.getOrCreatePhaseState(runtimeContext)

  updateScriptRuntimePhaseSource(phaseState, {
    code,
    requestPaths: [],
    sharedScripts: [],
    packages: [],
  })

  return phaseState
}
