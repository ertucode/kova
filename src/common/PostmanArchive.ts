export type PostmanArchiveEntry = { name: string } & (
  | { kind: 'collection'; scope: 'folder'; folderId: string }
  | { kind: 'collection'; scope: 'request'; requestId: string }
  | { kind: 'environment'; environmentId: string }
)

export type ExportPostmanArchiveInput = { entries: PostmanArchiveEntry[] }
export type ExportPostmanArchiveResponse = { filePath: string; fileCount: number }
