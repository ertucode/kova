export type EnvironmentRecord = {
  id: string
  name: string
  variables: string
  priority: number
  createdAt: number
  deletedAt: number | null
}

export type CreateEnvironmentInput = {
  name: string
}

export type UpdateEnvironmentInput = {
  id: string
  name: string
  variables: string
  priority: number
}

export type DeleteEnvironmentInput = {
  id: string
}
