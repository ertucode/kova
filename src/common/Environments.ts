export type EnvironmentRecord = {
  id: string
  name: string
  variables: string
  position: number
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

export type DuplicateEnvironmentInput = {
  id: string
}

export type MoveEnvironmentInput = {
  id: string
  targetPosition: number
}
