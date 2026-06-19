declare module '../../../scripts/utils/scriptRuntimeDeclarationBuilder.mjs' {
  import type { ScriptRuntimeDeclarationPayload } from '../ui/folders/scriptRuntimeDiagnostics'

  export function buildScriptRuntimeDeclarationPayload(input: {
    rootDir: string
  }): Promise<ScriptRuntimeDeclarationPayload>
}
