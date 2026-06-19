import { bench, describe } from 'vitest'
import {
  createDomPropertyScenario,
  createIdentifierScenario,
  createJsxScenario,
  measureEndToEndCompletionStep,
  measureHydratedCompletionStep,
  measureRankedCompletionStep,
  measureRawCompletionStep,
  prepareAutocompleteScenario,
  measureShapedCompletionStep,
} from './scriptAutocompletePerfHelpers'

describe('script autocomplete benchmarks', () => {
  bench('pre-request identifier raw completion', async () => {
    const scenario = await prepareAutocompleteScenario('pre-request', createIdentifierScenario('Promise'))
    measureRawCompletionStep(scenario, 5)
  })

  bench('pre-request identifier rank completion', async () => {
    const scenario = await prepareAutocompleteScenario('pre-request', createIdentifierScenario('Promise'))
    measureRankedCompletionStep(scenario, 5)
  })

  bench('pre-request identifier hydrate completion', async () => {
    const scenario = await prepareAutocompleteScenario('pre-request', createIdentifierScenario('Promise'))
    measureHydratedCompletionStep(scenario, 5)
  })

  bench('pre-request identifier shaped completion', async () => {
    const scenario = await prepareAutocompleteScenario('pre-request', createIdentifierScenario('Promise'))
    measureShapedCompletionStep(scenario, 5)
  })

  bench('pre-request identifier end-to-end completion', async () => {
    const scenario = await prepareAutocompleteScenario('pre-request', createIdentifierScenario('Promise'))
    measureEndToEndCompletionStep(scenario, 5)
  })

  bench('view-runtime identifier raw completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createIdentifierScenario('HTMLInputElement'))
    measureRawCompletionStep(scenario, 5)
  })

  bench('view-runtime identifier rank completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createIdentifierScenario('HTMLInputElement'))
    measureRankedCompletionStep(scenario, 5)
  })

  bench('view-runtime identifier hydrate completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createIdentifierScenario('HTMLInputElement'))
    measureHydratedCompletionStep(scenario, 5)
  })

  bench('view-runtime identifier shaped completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createIdentifierScenario('HTMLInputElement'))
    measureShapedCompletionStep(scenario, 5)
  })

  bench('view-runtime identifier end-to-end completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createIdentifierScenario('HTMLInputElement'))
    measureEndToEndCompletionStep(scenario, 5)
  })

  bench('response-visualizer identifier raw completion', async () => {
    const scenario = await prepareAutocompleteScenario('response-visualizer', createIdentifierScenario('HTMLInputElement'))
    measureRawCompletionStep(scenario, 5)
  })

  bench('response-visualizer identifier rank completion', async () => {
    const scenario = await prepareAutocompleteScenario('response-visualizer', createIdentifierScenario('HTMLInputElement'))
    measureRankedCompletionStep(scenario, 5)
  })

  bench('response-visualizer identifier hydrate completion', async () => {
    const scenario = await prepareAutocompleteScenario('response-visualizer', createIdentifierScenario('HTMLInputElement'))
    measureHydratedCompletionStep(scenario, 5)
  })

  bench('response-visualizer identifier shaped completion', async () => {
    const scenario = await prepareAutocompleteScenario('response-visualizer', createIdentifierScenario('HTMLInputElement'))
    measureShapedCompletionStep(scenario, 5)
  })

  bench('response-visualizer identifier end-to-end completion', async () => {
    const scenario = await prepareAutocompleteScenario('response-visualizer', createIdentifierScenario('HTMLInputElement'))
    measureEndToEndCompletionStep(scenario, 5)
  })

  bench('view-runtime JSX raw completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createJsxScenario('CodeEd'))
    measureRawCompletionStep(scenario, 5)
  })

  bench('view-runtime JSX rank completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createJsxScenario('CodeEd'))
    measureRankedCompletionStep(scenario, 5)
  })

  bench('view-runtime JSX hydrate completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createJsxScenario('CodeEd'))
    measureHydratedCompletionStep(scenario, 5)
  })

  bench('view-runtime JSX shaped completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createJsxScenario('CodeEd'))
    measureShapedCompletionStep(scenario, 5)
  })

  bench('view-runtime JSX end-to-end completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createJsxScenario('CodeEd'))
    measureEndToEndCompletionStep(scenario, 5)
  })

  bench('view-runtime document raw completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createDomPropertyScenario('document'))
    measureRawCompletionStep(scenario, 5)
  })

  bench('view-runtime document rank completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createDomPropertyScenario('document'))
    measureRankedCompletionStep(scenario, 5)
  })

  bench('view-runtime document hydrate completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createDomPropertyScenario('document'))
    measureHydratedCompletionStep(scenario, 5)
  })

  bench('view-runtime document shaped completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createDomPropertyScenario('document'))
    measureShapedCompletionStep(scenario, 5)
  })

  bench('view-runtime document end-to-end completion', async () => {
    const scenario = await prepareAutocompleteScenario('view-runtime', createDomPropertyScenario('document'))
    measureEndToEndCompletionStep(scenario, 5)
  })
})
