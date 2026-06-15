export type ViewCacheEntryRecord = {
  id: string
  viewId: string
  key: string
  value: string
  createdAt: number
  updatedAt: number
}

export type ListViewCacheEntriesInput = {
  viewId: string
}

export type GetViewCacheEntryInput = {
  viewId: string
  key: string
}

export type SetViewCacheEntryInput = {
  viewId: string
  key: string
  value: string
}

export type DeleteViewCacheEntryInput = {
  viewId: string
  key: string
}
