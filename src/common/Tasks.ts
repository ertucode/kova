import { ArchiveTypes } from './ArchiveTypes.js'
import { GenericResult } from './GenericError.js'

export type TaskDefinition = Tasks.Base &
  (Tasks.Archive | Tasks.Unarchive | Tasks.Paste | Tasks.Delete | Tasks.RunCommand | Tasks.VimChanges)

export type TaskCreate<T extends TaskDefinition['type']> = $DistributiveOmit<
  Extract<TaskDefinition, { type: T }>,
  'id' | 'createdIso'
> & { clientMetadata?: Tasks.ClientMetadata }

export type TaskUpdate<T extends TaskDefinition['type']> = {
  type: T
  metadata: Partial<Extract<TaskDefinition, { type: T }>['metadata']>
}

export namespace Tasks {
  export type ClientMetadata = {
    directoryId: string
    selection: { indexes: Set<number>; last: number | undefined }
  }

  export type Base = {
    id: string
    progress: number
    createdIso: string
    info?: string[]
    clientMetadata?: ClientMetadata
  }

  export type Archive = {
    type: 'archive'
    metadata: {
      type: ArchiveTypes.ArchiveType
    } & ArchiveTypes.ArchiveOpts
    result?: ArchiveTypes.ArchiveResult
  }

  export type Unarchive = {
    type: 'unarchive'
    metadata: {
      type: ArchiveTypes.ArchiveType
    } & ArchiveTypes.UnarchiveOpts
    result?: ArchiveTypes.UnarchiveResult
  }

  export type Paste = {
    type: 'paste'
    metadata: {
      fileCount: number
      destinationDir: string
      sourceFiles: string[]
      isCut: boolean
      isEstimated: boolean
    }
    result?: GenericResult<{ pastedItems: string[] }>
  }

  export type Delete = {
    type: 'delete'
    metadata: {
      files: string[]
    }
    result?: GenericResult<undefined>
  }

  export type RunCommand = {
    type: 'run-command'
    metadata: {
      command: string
      parameters: Record<string, string>
      fullPath: string
    }
    result?: GenericResult<void>
  }

  export type VimChanges = {
    type: 'vim-changes'
    metadata: {
      changeCount: number
      affectedDirectories: string[]
    }
    result?: GenericResult<void>
  }
}

export type TaskEvents =
  | {
      type: 'create'
      task: TaskDefinition
    }
  | {
      type: 'update'
      id: string
      metadata: Partial<TaskDefinition['metadata']>
    }
  | {
      type: 'progress'
      id: string
      progress: number
    }
  | {
      type: 'result'
      id: string
      result: GenericResult<any>
    }
  | {
      type: 'abort'
      id: string
    }
  | {
      type: 'push-info'
      id: string
      info: string[]
    }
