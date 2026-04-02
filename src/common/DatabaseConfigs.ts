export type DatabaseConfigRecord = {
  name: string
  path: string
  isDefault: boolean
  sizeBytes: number | null
}

export type DatabaseConfigState = {
  activeName: string
  defaultDirectoryPath: string
  items: DatabaseConfigRecord[]
}

export type PickDatabaseFileInput = {
  suggestedPath?: string
}

export type UpsertDatabaseConfigInput = {
  previousName?: string
  name: string
  path: string
  basedOnName?: string
}

export type DeleteDatabaseConfigInput = {
  name: string
}

export type SetActiveDatabaseConfigInput = {
  name: string
}

export type PickDatabaseFileResponse = {
  filePath: string
}
