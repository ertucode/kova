export type SaveTextToFileInput = {
  suggestedFileName: string
  content: string
  filters?: Array<{
    name: string
    extensions: string[]
  }>
}

export type SaveTextToFileResponse = {
  filePath: string
}
