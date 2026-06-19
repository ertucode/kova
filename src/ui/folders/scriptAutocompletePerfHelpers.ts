import { buildScriptRuntimeDeclarationPayload } from '../../../scripts/utils/scriptRuntimeDeclarationBuilder.js'
import {
  hydrateScriptAutocompleteOptions,
  rankScriptAutocompleteEntries,
  toScriptAutocompleteResult,
} from './scriptAutocompleteCompletions'
import {
  createScriptRuntimeDeclarationFiles,
  createScriptRuntimePhaseStateManager,
  updateScriptRuntimePhaseSource,
  type ScriptRuntimePhaseState,
} from './scriptRuntimeDiagnostics'

type RuntimePhase = 'pre-request' | 'response-visualizer' | 'view-runtime'

type PreparedScenario = {
  phaseState: ScriptRuntimePhaseState
  code: string
  position: number
}

type CompletionTiming = {
  averageMs: number
  labels: string[]
}

type ScenarioTiming = {
  raw: CompletionTiming
  rank: CompletionTiming
  hydrate: CompletionTiming
  shaped: CompletionTiming
  endToEnd: CompletionTiming
}

const declarationFilesPromise = buildScriptRuntimeDeclarationPayload({
  rootDir: process.cwd(),
}).then(createScriptRuntimeDeclarationFiles)

export async function prepareAutocompleteScenario(phase: RuntimePhase, code: string): Promise<PreparedScenario> {
  const declarationFiles = await declarationFilesPromise
  const phaseStateManager = createScriptRuntimePhaseStateManager(async () => declarationFiles)
  const phaseState = await phaseStateManager.getOrCreatePhaseState({ phase })

  updateScriptRuntimePhaseSource(phaseState, {
    code,
    requestPaths: [],
    sharedScripts: [],
    packages: [],
  })

  return {
    phaseState,
    code,
    position: code.length,
  }
}

export async function measureAutocompleteScenario(
  phase: RuntimePhase,
  code: string,
  iterations = 8
): Promise<ScenarioTiming> {
  const scenario = await prepareAutocompleteScenario(phase, code)
  const raw = measureRawCompletions(scenario, iterations)
  const rank = measureRankedEntries(scenario, iterations)
  const hydrate = measureHydratedOptions(scenario, iterations)
  const shaped = measureShapedCompletions(scenario, iterations)
  const endToEnd = measureEndToEndCompletions(scenario, iterations)

  return {
    raw,
    rank,
    hydrate,
    shaped,
    endToEnd,
  }
}

export function measureRawCompletionStep(scenario: PreparedScenario, iterations = 8) {
  return measureRawCompletions(scenario, iterations)
}

export function measureRankedCompletionStep(scenario: PreparedScenario, iterations = 8) {
  return measureRankedEntries(scenario, iterations)
}

export function measureHydratedCompletionStep(scenario: PreparedScenario, iterations = 8) {
  return measureHydratedOptions(scenario, iterations)
}

export function measureShapedCompletionStep(scenario: PreparedScenario, iterations = 8) {
  return measureShapedCompletions(scenario, iterations)
}

export function measureEndToEndCompletionStep(scenario: PreparedScenario, iterations = 8) {
  return measureEndToEndCompletions(scenario, iterations)
}

export function createIdentifierScenario(identifier: string) {
  return `type Value = ${identifier}`
}

export function createJsxScenario(tagPrefix: string) {
  return [
    'export default function View() {',
    '  return (',
    `    <${tagPrefix}`,
    '  )',
    '}',
  ].join('\n')
}

export function createDomPropertyScenario(globalName: 'document' | 'window') {
  return `${globalName}.`
}

function measureRawCompletions(scenario: PreparedScenario, iterations: number): CompletionTiming {
  let lastLabels: string[] = []

  const averageMs = measureAverageMs(() => {
    const completions = getCompletions(scenario)
    lastLabels = completions?.entries.map(entry => entry.name) ?? []
  }, iterations)

  return {
    averageMs,
    labels: lastLabels,
  }
}

function measureShapedCompletions(scenario: PreparedScenario, iterations: number): CompletionTiming {
  const completions = getRequiredCompletions(scenario)
  let lastLabels: string[] = []

  const averageMs = measureAverageMs(() => {
    const result = toScriptAutocompleteResult(
      scenario.phaseState.service,
      scenario.phaseState.userFileName,
      scenario.position,
      scenario.code,
      completions
    )
    lastLabels = result.options.map(option => option.label)
  }, iterations)

  return {
    averageMs,
    labels: lastLabels,
  }
}

function measureRankedEntries(scenario: PreparedScenario, iterations: number): CompletionTiming {
  const completions = getRequiredCompletions(scenario)
  const query = getCompletionQuery(scenario, completions)
  let lastLabels: string[] = []

  const averageMs = measureAverageMs(() => {
    const rankedEntries = rankScriptAutocompleteEntries(completions.entries, query)
    lastLabels = rankedEntries.map(rankedEntry => rankedEntry.entry.name)
  }, iterations)

  return {
    averageMs,
    labels: lastLabels,
  }
}

function measureHydratedOptions(scenario: PreparedScenario, iterations: number): CompletionTiming {
  const completions = getRequiredCompletions(scenario)
  const query = getCompletionQuery(scenario, completions)
  const rankedEntries = rankScriptAutocompleteEntries(completions.entries, query)
  let lastLabels: string[] = []

  const averageMs = measureAverageMs(() => {
    const options = hydrateScriptAutocompleteOptions(
      scenario.phaseState.service,
      scenario.phaseState.userFileName,
      scenario.position,
      rankedEntries
    )
    lastLabels = options.map(option => option.label)
  }, iterations)

  return {
    averageMs,
    labels: lastLabels,
  }
}

function measureEndToEndCompletions(scenario: PreparedScenario, iterations: number): CompletionTiming {
  let lastLabels: string[] = []

  const averageMs = measureAverageMs(() => {
    const completions = getRequiredCompletions(scenario)
    const result = toScriptAutocompleteResult(
      scenario.phaseState.service,
      scenario.phaseState.userFileName,
      scenario.position,
      scenario.code,
      completions
    )
    lastLabels = result.options.map(option => option.label)
  }, iterations)

  return {
    averageMs,
    labels: lastLabels,
  }
}

function getRequiredCompletions(scenario: PreparedScenario) {
  const completions = getCompletions(scenario)
  if (!completions) {
    throw new Error(`Expected completions for scenario: ${scenario.code}`)
  }

  return completions
}

function getCompletionQuery(scenario: PreparedScenario, completions: NonNullable<ReturnType<typeof getCompletions>>) {
  const replacementFrom = completions.optionalReplacementSpan ? completions.optionalReplacementSpan.start : scenario.position
  return scenario.code.slice(replacementFrom, scenario.position)
}

function getCompletions(scenario: PreparedScenario) {
  return scenario.phaseState.service.getCompletionsAtPosition(scenario.phaseState.userFileName, scenario.position, {
    includeCompletionsForModuleExports: false,
    includeCompletionsWithInsertText: true,
    includeCompletionsWithSnippetText: true,
  })
}

function measureAverageMs(task: () => void, iterations: number) {
  task()

  const startedAt = performance.now()
  for (let index = 0; index < iterations; index += 1) {
    task()
  }

  return (performance.now() - startedAt) / iterations
}
