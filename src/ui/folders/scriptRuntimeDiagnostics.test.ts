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
})

async function getCompletionLabels(
  runtimeContext:
    | { phase: 'view-runtime' | 'pre-request' | 'test' }
    | { targets: ['response-visualizer', 'view-runtime'] }
    | { targets: ['pre-request', 'test'] },
  code: string
) {
  return await getCompletionLabelsAt(runtimeContext, code, code.length)
}

async function getCompletionLabelsAt(
  runtimeContext:
    | { phase: 'view-runtime' | 'pre-request' | 'test' }
    | { targets: ['response-visualizer', 'view-runtime'] }
    | { targets: ['pre-request', 'test'] },
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

async function getQuickInfoDisplayText(
  runtimeContext:
    | { phase: 'view-runtime' | 'pre-request' | 'test' }
    | { targets: ['response-visualizer', 'view-runtime'] }
    | { targets: ['pre-request', 'test'] },
  code: string,
  position: number
) {
  const phaseState = await createPhaseState(runtimeContext, code)
  const quickInfo = phaseState.service.getQuickInfoAtPosition(phaseState.userFileName, position)

  return ts.displayPartsToString(quickInfo?.displayParts ?? [])
}

async function getDiagnostics(
  runtimeContext:
    | { phase: 'view-runtime' | 'pre-request' | 'test' }
    | { targets: ['response-visualizer', 'view-runtime'] }
    | { targets: ['pre-request', 'test'] },
  code: string
) {
  const phaseState = await createPhaseState(runtimeContext, code)
  return phaseState.service
    .getSemanticDiagnostics(phaseState.userFileName)
    .map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
}

async function createPhaseState(
  runtimeContext:
    | { phase: 'view-runtime' | 'pre-request' | 'test' }
    | { targets: ['response-visualizer', 'view-runtime'] }
    | { targets: ['pre-request', 'test'] },
  code: string
) {
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
