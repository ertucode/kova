export function buildSharedScriptDocumentPath(scriptId: string, isVisualizerOnly: boolean) {
  return `kova://shared-scripts/${scriptId}/${isVisualizerOnly ? 'script.tsx' : 'script.ts'}`
}
