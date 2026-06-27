export type ImportAgentToolBridgeInfo = {
  url: string
  token: string
}

let importAgentToolBridgeInfo: ImportAgentToolBridgeInfo | null = null

export function configureImportAgentToolBridge(info: ImportAgentToolBridgeInfo) {
  importAgentToolBridgeInfo = info
}

export function requireImportAgentToolBridge() {
  if (!importAgentToolBridgeInfo) {
    throw new Error('Import agent tool bridge is not configured.')
  }

  return importAgentToolBridgeInfo
}
