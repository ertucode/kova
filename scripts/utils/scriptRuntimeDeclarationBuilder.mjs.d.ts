import type { ScriptRuntimeDeclarationPayload } from '../../src/ui/folders/scriptRuntimeDiagnostics'

export function buildScriptRuntimeDeclarationPayload(input: {
  rootDir: string
}): Promise<ScriptRuntimeDeclarationPayload>
