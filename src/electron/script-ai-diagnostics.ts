import path from 'node:path'
import { readFile } from 'node:fs/promises'
import { app } from 'electron'
import type { ExplorerItem } from '../common/Explorer.js'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import { Result } from '../common/Result.js'
import type {
  GetScriptAiDiagnosticsInput,
  GetScriptAiDiagnosticsResponse,
  ScriptAiTarget,
} from '../common/ScriptAi.js'
import { Typescript } from '../common/Typescript.js'
import { getRequestParentFolderId, listExplorerItems } from './db/explorer.js'
import { getFolder } from './db/folders.js'
import { getRequest } from './db/requests.js'
import { listScriptPackages } from './db/script-packages.js'
import { getSharedScript, listVisibleSharedScripts } from './db/shared-scripts.js'
import { getView } from './db/views.js'
import { isDev } from './util.js'
import { getScriptPackageArtifact } from './script-package-registry.js'
import { getScriptAiWorkspaceSnapshot } from './script-ai-sdk.js'
import {
  collectScriptRuntimeDiagnostics,
  createScriptRuntimeDeclarationFiles,
  createScriptRuntimePhaseStateManager,
  type ScriptRuntimeDeclarationFiles,
  type ScriptRuntimeDeclarationPayload,
  type ScriptRuntimePackage,
  updateScriptRuntimePhaseSource,
} from '../ui/folders/scriptRuntimeDiagnostics.js'

type ScriptAiDiagnosticsBridgeInfo = {
  url: string
  token: string
}

type ResolvedScriptAiDiagnosticsTarget = {
  workspaceCode: string
  requestPaths: string[][]
  sharedScripts: Awaited<ReturnType<typeof listVisibleSharedScripts>>
  packages: ScriptRuntimePackage[]
}

let declarationFilesPromise: Promise<ScriptRuntimeDeclarationFiles> | null = null
let scriptAiDiagnosticsBridgeInfo: ScriptAiDiagnosticsBridgeInfo | null = null

const phaseStateManager = createScriptRuntimePhaseStateManager(loadDeclarationFiles)

export async function getScriptAiDiagnostics(
  input: GetScriptAiDiagnosticsInput
): Promise<GenericResult<GetScriptAiDiagnosticsResponse>> {
  try {
    const resolvedTarget = await resolveScriptAiDiagnosticsTarget(input.target)
    const phaseState = await phaseStateManager.getOrCreatePhaseState(input.target.runtimeContext)

    updateScriptRuntimePhaseSource(phaseState, {
      code: resolvedTarget.workspaceCode,
      requestPaths: resolvedTarget.requestPaths,
      sharedScripts: resolvedTarget.sharedScripts,
      packages: resolvedTarget.packages,
    })

    return Result.Success({
      diagnostics: collectScriptRuntimeDiagnostics(phaseState, resolvedTarget.workspaceCode),
    })
  } catch (error) {
    return GenericError.Message(error instanceof Error ? error.message : String(error))
  }
}

export function configureScriptAiDiagnosticsBridge(info: ScriptAiDiagnosticsBridgeInfo) {
  scriptAiDiagnosticsBridgeInfo = info
}

export function requireScriptAiDiagnosticsBridge() {
  if (!scriptAiDiagnosticsBridgeInfo) {
    throw new Error('Script AI diagnostics bridge is not configured.')
  }

  return scriptAiDiagnosticsBridgeInfo
}

async function resolveScriptAiDiagnosticsTarget(target: ScriptAiTarget): Promise<ResolvedScriptAiDiagnosticsTarget> {
  const [{ workspaceCode }, folderId, requestPaths, packages] = await Promise.all([
    getScriptAiWorkspaceSnapshot(target),
    resolveTargetFolderId(target),
    loadRequestPaths(),
    loadScriptPackages(),
  ])

  const sharedScripts = await listVisibleSharedScripts({ folderId, onlyActive: true })

  return {
    workspaceCode,
    requestPaths,
    sharedScripts,
    packages,
  }
}

async function resolveTargetFolderId(target: ScriptAiTarget) {
  switch (target.ownerType) {
    case 'request': {
      const requestResult = await getRequest({ id: target.ownerId })
      if (!requestResult.success) {
        throw new Error('Request target was not found.')
      }

      return await getRequestParentFolderId(target.ownerId)
    }
    case 'folder': {
      const folderResult = await getFolder({ id: target.ownerId })
      if (!folderResult.success) {
        throw new Error('Folder target was not found.')
      }

      return target.ownerId
    }
    case 'view': {
      const view = await getView(target.ownerId)
      if (!view) {
        throw new Error('View target was not found.')
      }

      return null
    }
    case 'shared-script': {
      const script = await getSharedScript(target.ownerId)
      if (!script) {
        throw new Error('Shared script target was not found.')
      }

      return script.scopeType === 'folder' ? script.scopeId : null
    }
    default:
      return Typescript.assertUnreachable(target.ownerType)
  }
}

async function loadRequestPaths() {
  const items = await listExplorerItems()
  return buildHttpRequestPaths(items)
}

async function loadScriptPackages() {
  const records = await listScriptPackages()
  const artifacts = await Promise.all(records.map(record => getScriptPackageArtifact(record)))
  return artifacts.filter((artifact): artifact is NonNullable<typeof artifact> => artifact !== null)
}

function buildHttpRequestPaths(items: ExplorerItem[]) {
  const itemMap = new Map(items.map(item => [item.id, item] as const))
  type HttpExplorerRequestItem = Extract<ExplorerItem, { itemType: 'request' }> & { requestType: 'http' }

  return items
    .filter((item): item is HttpExplorerRequestItem => item.itemType === 'request' && item.requestType === 'http')
    .map(item => [...getFolderPathSegments(itemMap, item.parentFolderId), item.name])
}

function getFolderPathSegments(itemMap: Map<string, ExplorerItem>, parentFolderId: string | null) {
  const segments: string[] = []
  let currentFolderId = parentFolderId

  while (currentFolderId) {
    const folder = itemMap.get(currentFolderId)
    if (!folder || folder.itemType !== 'folder') {
      break
    }

    segments.unshift(folder.name)
    currentFolderId = folder.parentFolderId
  }

  return segments
}

function loadDeclarationFiles() {
  if (!declarationFilesPromise) {
    declarationFilesPromise = loadDeclarationPayload().then(createScriptRuntimeDeclarationFiles)
  }

  return declarationFilesPromise
}

async function loadDeclarationPayload(): Promise<ScriptRuntimeDeclarationPayload> {
  const declarationPath = getScriptAutocompleteDeclarationsPath()
  return JSON.parse(await readFile(declarationPath, 'utf8')) as ScriptRuntimeDeclarationPayload
}

function getScriptAutocompleteDeclarationsPath() {
  return isDev()
    ? path.join(app.getAppPath(), 'public', 'generated', 'script-autocomplete', 'declarations.json')
    : path.join(app.getAppPath(), 'dist-react', 'generated', 'script-autocomplete', 'declarations.json')
}
