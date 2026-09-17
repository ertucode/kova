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
import type { ScriptRuntimeContext } from './scriptRuntimeDeclarations'
import type { ScriptAutocompleteSharedScript } from './scriptAutocompleteTypes'

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

  it('accepts intrinsic JSX elements in view-runtime diagnostics', async () => {
    const diagnostics = await getDiagnostics(
      { phase: 'view-runtime' },
      ['export default function View() {', '  return <div>Hello</div>', '}'].join('\n')
    )

    expect(diagnostics).toEqual([])
  })

  it('accepts intrinsic JSX props in view-runtime diagnostics', async () => {
    const diagnostics = await getDiagnostics(
      { phase: 'view-runtime' },
      ['export default function View() {', '  return <div className="hello">Hello</div>', '}'].join('\n')
    )

    expect(diagnostics).toEqual([])
  })

  it('accepts CodeEditor as a JSX component in response-visualizer diagnostics', async () => {
    const diagnostics = await getDiagnostics(
      { phase: 'response-visualizer' },
      ['export default function View() {', '  return <CodeEditor value="{}" language="json" />', '}'].join('\n')
    )

    expect(diagnostics).toEqual([])
  })

  it('accepts CodeEditor as a JSX component in view-runtime diagnostics', async () => {
    const diagnostics = await getDiagnostics(
      { phase: 'view-runtime' },
      ['export default function View() {', '  return <CodeEditor value="{}" language="json" />', '}'].join('\n')
    )

    expect(diagnostics).toEqual([])
  })

  it('offers CodeEditor while typing a JSX tag in response-visualizer completions', async () => {
    const code = ['export default function View() {', '  return <CodeEd', '}'].join('\n')
    const completionLabels = await getShapedCompletionLabels({ phase: 'response-visualizer' }, code, code.indexOf('CodeEd') + 'CodeEd'.length)

    expect(completionLabels).toContain('CodeEditor')
  })

  it('offers CodeEditor while typing a JSX tag in view-runtime completions', async () => {
    const code = ['export default function View() {', '  return <CodeEd', '}'].join('\n')
    const completionLabels = await getShapedCompletionLabels({ phase: 'view-runtime' }, code, code.indexOf('CodeEd') + 'CodeEd'.length)

    expect(completionLabels).toContain('CodeEditor')
  })

  it('shows concrete hover info for intrinsic JSX elements', async () => {
    const code = ['export default function View() {', '  return <div>Hello</div>', '}'].join('\n')
    const hoverText = await getQuickInfoDisplayText({ phase: 'view-runtime' }, code, code.indexOf('div') + 1)

    expect(hoverText).not.toContain('IntrinsicElements[string]')
    expect(hoverText).toContain('HTMLDivElement')
  })

  it('offers intrinsic JSX props in view-runtime completions', async () => {
    const code = ['export default function View() {', '  return <div cl', '}'].join('\n')
    const completionLabels = await getCompletionLabelsAt({ phase: 'view-runtime' }, code, code.length - 1)

    expect(completionLabels).toContain('className')
  })

  it('offers intrinsic event props in view-runtime completions', async () => {
    const code = ['export default function View() {', '  return <button on', '}'].join('\n')
    const completionLabels = await getCompletionLabelsAt({ phase: 'view-runtime' }, code, code.length - 1)

    expect(completionLabels).toContain('onClick')
  })

  it('does not offer HTMLInputElement in pre-request completions', async () => {
    const completionLabels = await getCompletionLabels({ phase: 'pre-request' }, 'type Value = HTMLInputElement')

    expect(completionLabels).not.toContain('HTMLInputElement')
  })

  it('accepts useMemo for shared scripts checked against both visual runtimes', async () => {
    const diagnostics = await getDiagnostics(
      { targets: ['response-visualizer', 'view-runtime'] },
      ['export function readValue(value: string) {', '  return useMemo(() => value.length, [value])', '}'].join('\n')
    )

    expect(diagnostics).toEqual([])
  })

  it('accepts navigateAndCallRequest declarations in the test runtime', async () => {
    const diagnostics = await getDiagnostics(
      { phase: 'test' },
      "export {}\n\nasync function run() {\n  await navigateAndCallRequest(['Auth', 'Refresh Token'])\n}"
    )

    expect(diagnostics).toEqual([])
  })

  it('keeps shared-script request helpers as target intersections', async () => {
    const diagnostics = await getDiagnostics(
      { targets: ['pre-request', 'test'] },
      "await navigateAndCallRequest(['Auth', 'Refresh Token'])"
    )

    expect(diagnostics.some(message => message.includes("Cannot find name 'navigateAndCallRequest'"))).toBe(true)
  })

  it('types expression script exports only in template expressions', async () => {
    const sharedScripts: ScriptAutocompleteSharedScript[] = [{
      id: 'phone-expression',
      scopeType: 'workspace',
      scopeId: null,
      name: 'Phone expressions',
      kind: 'expression',
      code: "export const phonePrefix = '+1'\nexport function randomPhone(input: { country: string }) { return input.country }",
      targets: [],
      isActive: true,
    }]
    const templateState = await createPhaseState({ templatePhase: 'pre-request' }, 'randomPh', sharedScripts)
    const completions = templateState.service.getCompletionsAtPosition(templateState.userFileName, 'randomPh'.length, {})
    const diagnosticsState = await createPhaseState(
      { templatePhase: 'pre-request' },
      "randomPhone({ country: 1 })",
      sharedScripts
    )
    const diagnostics = diagnosticsState.service.getSemanticDiagnostics(diagnosticsState.userFileName)
    const normalScriptState = await createPhaseState({ phase: 'pre-request' }, 'randomPhone', sharedScripts)

    expect(completions?.entries.map(entry => entry.name)).toContain('randomPhone')
    expect(diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')))
      .toContain("Type 'number' is not assignable to type 'string'.")
    expect(normalScriptState.service.getSemanticDiagnostics(normalScriptState.userFileName)
      .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')))
      .toContain("Cannot find name 'randomPhone'.")

    expect(templateState.expressionExportSources.get('randomPhone')).toEqual({
      id: 'phone-expression',
      scopeType: 'workspace',
      scopeId: null,
      name: 'Phone expressions',
      code: 'export function randomPhone(input: { country: string }) { return input.country }',
    })
    expect(templateState.expressionExportSources.get('phonePrefix')).toEqual({
      id: 'phone-expression',
      scopeType: 'workspace',
      scopeId: null,
      name: 'Phone expressions',
      code: "export const phonePrefix = '+1'",
    })
  })
})

async function getCompletionLabels(
  runtimeContext: ScriptRuntimeContext,
  code: string
) {
  return await getCompletionLabelsAt(runtimeContext, code, code.length)
}

async function getCompletionLabelsAt(
  runtimeContext: ScriptRuntimeContext,
  code: string,
  position: number
) {
  const phaseState = await createPhaseState(runtimeContext, code)
  const completions = phaseState.service.getCompletionsAtPosition(phaseState.userFileName, position, {
    includeCompletionsForModuleExports: false,
    includeCompletionsWithInsertText: true,
    includeCompletionsWithSnippetText: true,
  })

  return completions?.entries.map(entry => entry.name) ?? []
}

async function getShapedCompletionLabels(
  runtimeContext: ScriptRuntimeContext,
  code: string,
  position = code.length
) {
  const phaseState = await createPhaseState(runtimeContext, code)
  const completions = phaseState.service.getCompletionsAtPosition(phaseState.userFileName, position, {
    includeCompletionsForModuleExports: false,
    includeCompletionsWithInsertText: true,
    includeCompletionsWithSnippetText: true,
  })

  if (!completions) {
    return []
  }

  return toScriptAutocompleteResult(phaseState.service, phaseState.userFileName, position, code, completions).options.map(
    option => option.label
  )
}

async function getQuickInfoDisplayText(
  runtimeContext: ScriptRuntimeContext,
  code: string,
  position: number
) {
  const phaseState = await createPhaseState(runtimeContext, code)
  const quickInfo = phaseState.service.getQuickInfoAtPosition(phaseState.userFileName, position)

  return ts.displayPartsToString(quickInfo?.displayParts ?? [])
}

async function getDiagnostics(
  runtimeContext: ScriptRuntimeContext,
  code: string,
  sharedScripts: ScriptAutocompleteSharedScript[] = []
) {
  const phaseState = await createPhaseState(runtimeContext, code, sharedScripts)
  return phaseState.service
    .getSemanticDiagnostics(phaseState.userFileName)
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

async function createPhaseState(
  runtimeContext: ScriptRuntimeContext,
  code: string,
  sharedScripts: ScriptAutocompleteSharedScript[] = []
) {
  const declarationFiles = await declarationFilesPromise
  const phaseStateManager = createScriptRuntimePhaseStateManager(async () => declarationFiles)
  const phaseState = await phaseStateManager.getOrCreatePhaseState(runtimeContext)

  updateScriptRuntimePhaseSource(phaseState, {
    code,
    requestPaths: [],
    sharedScripts,
    packages: [],
  })

  return phaseState
}
