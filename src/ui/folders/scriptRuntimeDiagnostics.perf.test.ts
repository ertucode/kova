import { describe, expect, it } from 'vitest'
import {
  createDomPropertyScenario,
  createIdentifierScenario,
  createJsxScenario,
  measureAutocompleteScenario,
} from './scriptAutocompletePerfHelpers'

describe('script runtime autocomplete performance', () => {
  it('reports identifier completion timings across runtimes', async () => {
    const preRequest = await measureAutocompleteScenario('pre-request', createIdentifierScenario('Promise'), 6)
    const viewRuntime = await measureAutocompleteScenario('view-runtime', createIdentifierScenario('HTMLInputElement'), 6)
    const responseVisualizer = await measureAutocompleteScenario(
      'response-visualizer',
      createIdentifierScenario('HTMLInputElement'),
      6
    )

    console.table({
      'pre-request raw': preRequest.raw.averageMs.toFixed(2),
      'pre-request rank': preRequest.rank.averageMs.toFixed(2),
      'pre-request hydrate': preRequest.hydrate.averageMs.toFixed(2),
      'pre-request shaped': preRequest.shaped.averageMs.toFixed(2),
      'pre-request end-to-end': preRequest.endToEnd.averageMs.toFixed(2),
      'view-runtime raw': viewRuntime.raw.averageMs.toFixed(2),
      'view-runtime rank': viewRuntime.rank.averageMs.toFixed(2),
      'view-runtime hydrate': viewRuntime.hydrate.averageMs.toFixed(2),
      'view-runtime shaped': viewRuntime.shaped.averageMs.toFixed(2),
      'view-runtime end-to-end': viewRuntime.endToEnd.averageMs.toFixed(2),
      'response-visualizer raw': responseVisualizer.raw.averageMs.toFixed(2),
      'response-visualizer rank': responseVisualizer.rank.averageMs.toFixed(2),
      'response-visualizer hydrate': responseVisualizer.hydrate.averageMs.toFixed(2),
      'response-visualizer shaped': responseVisualizer.shaped.averageMs.toFixed(2),
      'response-visualizer end-to-end': responseVisualizer.endToEnd.averageMs.toFixed(2),
    })

    expect(preRequest.raw.labels).toContain('Promise')
    expect(viewRuntime.raw.labels).toContain('HTMLInputElement')
    expect(responseVisualizer.raw.labels).toContain('HTMLInputElement')
    expect(viewRuntime.endToEnd.labels).toContain('HTMLInputElement')
    expect(responseVisualizer.endToEnd.labels).toContain('HTMLInputElement')
  }, 15000)

  it('reports TSX and DOM global completion timings for DOM-heavy runtimes', async () => {
    const viewJsx = await measureAutocompleteScenario('view-runtime', createJsxScenario('CodeEd'), 4)
    const visualizerJsx = await measureAutocompleteScenario('response-visualizer', createJsxScenario('CodeEd'), 4)
    const viewDocument = await measureAutocompleteScenario('view-runtime', createDomPropertyScenario('document'), 4)

    console.table({
      'view-runtime JSX raw': viewJsx.raw.averageMs.toFixed(2),
      'view-runtime JSX rank': viewJsx.rank.averageMs.toFixed(2),
      'view-runtime JSX hydrate': viewJsx.hydrate.averageMs.toFixed(2),
      'view-runtime JSX shaped': viewJsx.shaped.averageMs.toFixed(2),
      'view-runtime JSX end-to-end': viewJsx.endToEnd.averageMs.toFixed(2),
      'response-visualizer JSX raw': visualizerJsx.raw.averageMs.toFixed(2),
      'response-visualizer JSX rank': visualizerJsx.rank.averageMs.toFixed(2),
      'response-visualizer JSX hydrate': visualizerJsx.hydrate.averageMs.toFixed(2),
      'response-visualizer JSX shaped': visualizerJsx.shaped.averageMs.toFixed(2),
      'response-visualizer JSX end-to-end': visualizerJsx.endToEnd.averageMs.toFixed(2),
      'view-runtime document raw': viewDocument.raw.averageMs.toFixed(2),
      'view-runtime document rank': viewDocument.rank.averageMs.toFixed(2),
      'view-runtime document hydrate': viewDocument.hydrate.averageMs.toFixed(2),
      'view-runtime document shaped': viewDocument.shaped.averageMs.toFixed(2),
      'view-runtime document end-to-end': viewDocument.endToEnd.averageMs.toFixed(2),
    })

    expect(viewJsx.raw.labels).toContain('CodeEditor')
    expect(visualizerJsx.raw.labels).toContain('CodeEditor')
    expect(viewDocument.raw.labels.length).toBeGreaterThan(0)
    expect(viewDocument.endToEnd.labels.length).toBeGreaterThan(0)
  }, 15000)
})
