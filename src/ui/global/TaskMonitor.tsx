import { useSelector } from '@xstate/store/react'
import { taskStore } from './taskStore'
import { TaskDefinition } from '@common/Tasks'
import {
  ChevronDown,
  Loader2Icon,
  CheckCircle2,
  XCircle,
  Archive,
  FolderArchive,
  FileIcon,
  FolderIcon,
  XOctagon,
  Copy,
  Move,
  DeleteIcon,
  FileXCornerIcon,
  Info,
  TerminalIcon,
  Edit3Icon,
} from 'lucide-react'
import { useState, useEffect } from 'react'
import { clsx } from '@/lib/functions/clsx'
import { errorResponseToMessage } from '@common/GenericError'
import { PathHelpers } from '@common/PathHelpers'
import { getWindowElectron } from '@/getWindowElectron'
import { Dialog } from '@/lib/components/dialog'
import { Typescript } from '@common/Typescript'

function getTaskTypeLabel(task: TaskDefinition): string {
  switch (task.type) {
    case 'archive':
      return `Creating ${task.metadata.type} archive`
    case 'unarchive':
      return `Extracting ${task.metadata.type} archive`
    case 'paste':
      return task.metadata.isCut ? 'Moving files' : 'Copying files'
    case 'delete':
      return 'File Deletion'
    case 'run-command':
      return 'Run Command'
    case 'vim-changes':
      return 'Applying VIM Changes'
    default:
      return Typescript.assertUnreachable(task)
  }
}

function formatTimeRemaining(ms: number): string {
  const seconds = Math.ceil(ms / 1000)

  if (seconds < 60) {
    return `${seconds}s`
  }

  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60

  if (minutes < 60) {
    return remainingSeconds > 0 ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`
  }

  const hours = Math.floor(minutes / 60)
  const remainingMinutes = minutes % 60

  return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`
}

function getTaskIcon(task: TaskDefinition) {
  switch (task.type) {
    case 'archive':
      return Archive
    case 'unarchive':
      return FolderArchive
    case 'paste':
      return task.metadata.isCut ? Move : Copy
    case 'delete':
      return DeleteIcon
    case 'run-command':
      return TerminalIcon
    case 'vim-changes':
      return Edit3Icon
    default:
      return Typescript.assertUnreachable(task)
  }
}

function getTaskStatus(task: TaskDefinition): 'running' | 'success' | 'error' {
  if (task.result) {
    return task.result.success ? 'success' : 'error'
  }
  return 'running'
}

function formatPath(filePath: string, maxLength = 35): string {
  if (filePath.length <= maxLength) return filePath

  const filename = PathHelpers.name(filePath)
  const parentInfo = PathHelpers.parent(filePath)

  if (filename.length > maxLength - 3) {
    return '...' + filename.slice(-(maxLength - 3))
  }

  const remainingLength = maxLength - filename.length - 4 // 4 for "/..."
  if (remainingLength <= 0) {
    return '.../' + filename
  }

  if (parentInfo.path.length <= remainingLength) {
    return parentInfo.path + '/' + filename
  }

  return '.../' + filename
}

function TaskMetadata({ task }: { task: TaskDefinition }) {
  if (task.type === 'archive') {
    const sourceCount = task.metadata.source.length
    const destination = task.metadata.destination

    return (
      <div className="mt-2 space-y-1.5 text-xs overflow-hidden">
        <div className="flex items-center gap-1.5 text-base-content/70">
          <FileIcon className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium flex-shrink-0">Source:</span>
          <div className="dropdown dropdown-hover overflow-hidden">
            <div
              tabIndex={0}
              className="truncate cursor-pointer hover:text-primary transition-colors"
              title={sourceCount === 1 ? task.metadata.source[0] : undefined}
            >
              {sourceCount === 1 ? formatPath(task.metadata.source[0]) : `${sourceCount} items`}
            </div>
            <div
              tabIndex={0}
              className="dropdown-content z-[1] p-2 shadow bg-base-100 rounded-box border border-base-300 max-w-md"
            >
              <div className="space-y-1">
                {task.metadata.source.map((sourcePath, index) => (
                  <div
                    key={index}
                    className="text-xs cursor-pointer hover:text-primary transition-colors p-1 hover:bg-base-200 rounded break-all"
                  >
                    {sourcePath}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-base-content/70">
          <Archive className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium flex-shrink-0">Output:</span>
          <span className="truncate" title={destination}>
            {formatPath(destination)}
          </span>
        </div>
      </div>
    )
  }

  if (task.type === 'unarchive') {
    const source = task.metadata.source
    const destination = task.metadata.destination

    return (
      <div className="mt-2 space-y-1.5 text-xs overflow-hidden">
        <div className="flex items-center gap-1.5 text-base-content/70">
          <Archive className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium flex-shrink-0">Archive:</span>
          <div className="dropdown dropdown-hover overflow-hidden">
            <div tabIndex={0} className="truncate cursor-pointer hover:text-primary transition-colors" title={source}>
              {formatPath(source)}
            </div>
            <div
              tabIndex={0}
              className="dropdown-content z-[1] p-2 shadow bg-base-100 rounded-box border border-base-300 max-w-md"
            >
              <div className="text-xs cursor-pointer hover:text-primary transition-colors p-1 hover:bg-base-200 rounded break-all">
                {source}
              </div>
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-base-content/70">
          <FolderIcon className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium flex-shrink-0">Extract to:</span>
          <span className="truncate" title={destination}>
            {formatPath(destination)}
          </span>
        </div>
      </div>
    )
  }

  if (task.type === 'paste') {
    const { fileCount, destinationDir, isEstimated } = task.metadata
    const itemLabel =
      (isEstimated ? 'More than ' : '') + (fileCount === 0 ? '...' : fileCount === 1 ? '1 file' : `${fileCount} files`)

    return (
      <div className="mt-2 space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-base-content/70">
          <FileIcon className="h-3 w-3 flex-shrink-0" />
          {itemLabel && <span>{itemLabel}</span>}
        </div>
        <div className="flex items-center gap-1.5 text-base-content/70">
          <FolderIcon className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium">Destination:</span>
          <span className="truncate" title={destinationDir}>
            {formatPath(destinationDir)}
          </span>
        </div>
      </div>
    )
  }

  if (task.type === 'delete') {
    const { files } = task.metadata
    const label = files.length === 1 ? `${PathHelpers.getLastCountParts(files[0], 2)}` : `${files.length} files`

    return (
      <div className="mt-2 space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-base-content/70">
          <FileXCornerIcon className="size-4 flex-shrink-0 text-error" />
          <span className="font-medium overflow-hidden whitespace-nowrap text-ellipsis rtl text-left">{label}</span>
        </div>
      </div>
    )
  }

  if (task.type === 'run-command') {
    const { command, fullPath, parameters } = task.metadata
    const hasParameters = Object.keys(parameters).length > 0

    return (
      <div className="mt-2 space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-base-content/70">
          <TerminalIcon className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium">Command:</span>
          <code className="text-xs bg-base-300 px-1.5 py-0.5 rounded font-mono break-all">{command}</code>
        </div>
        {hasParameters && (
          <div className="flex items-start gap-1.5 text-base-content/70">
            <span className="font-medium">Parameters:</span>
            <div className="flex-1 space-y-0.5">
              {Object.entries(parameters).map(([key, value]) => (
                <div key={key} className="flex gap-1">
                  <code className="text-xs bg-base-300 px-1.5 py-0.5 rounded font-mono">{key}:</code>
                  <code className="text-xs bg-base-300 px-1.5 py-0.5 rounded font-mono break-all flex-1">{value}</code>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="flex items-center gap-1.5 text-base-content/70">
          <FolderIcon className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium">Path:</span>
          <span className="truncate" title={fullPath}>
            {formatPath(fullPath)}
          </span>
        </div>
      </div>
    )
  }

  if (task.type === 'vim-changes') {
    const { changeCount } = task.metadata
    const label = changeCount === 1 ? '1 change' : `${changeCount} changes`

    return (
      <div className="mt-2 space-y-1.5 text-xs">
        <div className="flex items-center gap-1.5 text-base-content/70">
          <Edit3Icon className="h-3 w-3 flex-shrink-0" />
          <span className="font-medium">{label}</span>
        </div>
      </div>
    )
  }

  Typescript.assertUnreachable(task)
}

function TaskItem({ task, onDismiss }: { task: TaskDefinition; onDismiss: () => void }) {
  const status = getTaskStatus(task)
  const Icon = getTaskIcon(task)
  const label = getTaskTypeLabel(task)
  const [showInfoDialog, setShowInfoDialog] = useState(false)
  const [isHovered, setIsHovered] = useState(false)
  const hasInfo = task.info && task.info.length > 0

  // Calculate estimated time remaining based on createdIso and progress
  const estimatedTimeRemaining = (() => {
    if (status !== 'running' || task.progress <= 0 || task.progress >= 100) {
      return undefined
    }

    const startTime = new Date(task.createdIso).getTime()
    const now = Date.now()
    const elapsed = now - startTime

    // Need at least 1 second of progress to make a reasonable estimate
    if (elapsed < 1000) {
      return undefined
    }

    const estimatedTotal = (elapsed / task.progress) * 100
    const remaining = Math.max(0, estimatedTotal - elapsed)

    // Only show if more than 1 second remaining
    return remaining > 1000 ? remaining : undefined
  })()

  // Auto-dismiss successful tasks after 5 seconds (unless info dialog is open or item is hovered)
  useEffect(() => {
    if (status === 'success' && !showInfoDialog && !isHovered) {
      const timer = setTimeout(() => {
        onDismiss()
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [status, onDismiss, showInfoDialog, isHovered])

  const handleCancel = async () => {
    const electron = getWindowElectron()
    await electron.abortTask(task.id)
  }

  return (
    <>
      <div
        className="p-3 bg-base-200 rounded-lg border border-base-300 hover:border-primary/30 transition-colors group"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="flex items-start gap-2.5">
          <div className="flex-shrink-0 mt-0.5">
            <div
              className={clsx(
                'p-1.5 rounded-md',
                status === 'running' && 'bg-primary/10',
                status === 'success' && 'bg-success/10',
                status === 'error' && 'bg-error/10'
              )}
            >
              <Icon
                className={clsx(
                  'h-4 w-4',
                  status === 'running' && 'text-primary',
                  status === 'success' && 'text-success',
                  status === 'error' && 'text-error'
                )}
              />
            </div>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 justify-between">
              <div className="font-medium text-sm text-base-content">{label}</div>
              <div className="flex items-center gap-1.5 relative">
                {hasInfo && (
                  <button
                    onClick={() => setShowInfoDialog(true)}
                    className="btn btn-ghost btn-xs btn-circle opacity-60 hover:opacity-100 transition-opacity"
                    title="View task info"
                  >
                    <Info className="h-3.5 w-3.5" />
                  </button>
                )}
                <div className="flex-shrink-0">
                  {status === 'running' && (
                    <div className="flex items-center gap-1.5">
                      <div className="flex flex-col items-end">
                        <span className="text-xs font-semibold text-primary">{Math.round(task.progress)}%</span>
                        {estimatedTimeRemaining && (
                          <span className="text-[10px] text-base-content/60">
                            {formatTimeRemaining(estimatedTimeRemaining)} left
                          </span>
                        )}
                      </div>
                      <div className="flex items-center">
                        <Loader2Icon className="h-4 w-4 text-primary animate-spin" />
                        <div className="absolute right-0 flex items-center size-4">
                          <button
                            onClick={handleCancel}
                            className="btn btn-xs size-4 btn-circle opacity-0 group-hover:opacity-100 transition-opacity"
                            title="Cancel task"
                          >
                            <XOctagon className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  <div className="flex items-center">
                    {status === 'success' && <CheckCircle2 className="h-4 w-4 text-success" />}
                    {status === 'error' && <XCircle className="h-4 w-4 text-error" />}
                    <div className="absolute right-0 flex items-center size-4">
                      <button
                        onClick={onDismiss}
                        className="btn btn-xs size-4 btn-circle opacity-0 group-hover:opacity-100 transition-opacity"
                        title="Dismiss"
                      >
                        <XOctagon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <TaskMetadata task={task} />

            {status === 'running' && (
              <div className="w-full bg-base-300 rounded-full h-1.5 mt-2.5 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-primary to-primary/70 h-1.5 rounded-full transition-all duration-300 ease-out"
                  style={{ width: `${task.progress}%` }}
                />
              </div>
            )}

            {status === 'error' && task.result && !task.result.success && (
              <div className="mt-2 p-2 bg-error/10 border border-error/20 rounded text-xs text-error relative group/error">
                <div className="break-words whitespace-pre-wrap overflow-wrap-anywhere pr-6">
                  {errorResponseToMessage(task.result.error)}
                </div>
                <button
                  onClick={() => {
                    if (task.result && !task.result.success) {
                      navigator.clipboard.writeText(errorResponseToMessage(task.result.error))
                    }
                  }}
                  className="btn btn-ghost btn-xs absolute top-1 right-1 opacity-0 group-hover/error:opacity-100 transition-opacity"
                  title="Copy error"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
            )}

            {status === 'success' && (
              <div className="mt-2 text-xs text-success font-medium">Completed successfully</div>
            )}
          </div>
        </div>
      </div>

      {showInfoDialog && hasInfo && (
        <Dialog
          title="Task Information"
          onClose={() => setShowInfoDialog(false)}
          footer={
            <button className="btn btn-primary" onClick={() => setShowInfoDialog(false)}>
              Close
            </button>
          }
        >
          <pre className="text-xs bg-base-200 p-4 rounded overflow-auto max-h-96">{task.info!.join('\n')}</pre>
        </Dialog>
      )}
    </>
  )
}

export function TaskMonitor() {
  const tasks = useSelector(taskStore, state => state.context.tasks)
  const [isMinimized, setIsMinimized] = useState(false)

  const taskArray = Object.values(tasks)
  const hasTasks = taskArray.length > 0

  const handleDismiss = (taskId: string) => {
    taskStore.send({ type: 'removeTask', id: taskId })
  }

  if (!hasTasks) {
    return null
  }

  const runningTasks = taskArray.filter(t => getTaskStatus(t) === 'running')
  const completedTasks = taskArray.filter(t => getTaskStatus(t) !== 'running')

  return (
    <div className={clsx('fixed bottom-4 right-4 z-50', !isMinimized && 'w-80')}>
      {isMinimized ? (
        <button
          onClick={() => setIsMinimized(false)}
          className="btn btn-primary btn-circle shadow-lg"
          title="Show tasks"
        >
          <div className="relative">
            <Loader2Icon className={clsx('h-5 w-5', runningTasks.length > 0 && 'animate-spin')} />
            {taskArray.length > 0 && (
              <div className="absolute -top-2 -right-2 bg-error text-error-content text-xs rounded-full h-5 w-5 flex items-center justify-center font-bold">
                {taskArray.length}
              </div>
            )}
          </div>
        </button>
      ) : (
        <div className="bg-base-100 border border-base-300 rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center justify-between p-3 bg-base-200 border-b border-base-300">
            <div className="flex items-center gap-2">
              <Loader2Icon className={clsx('h-4 w-4', runningTasks.length > 0 && 'animate-spin text-primary')} />
              <h3 className="text-sm font-semibold text-base-content">Tasks ({taskArray.length})</h3>
            </div>
            <button onClick={() => setIsMinimized(true)} className="btn btn-ghost btn-xs btn-circle" title="Minimize">
              <ChevronDown className="h-4 w-4" />
            </button>
          </div>

          <div className="p-3 max-h-96 overflow-y-auto space-y-2">
            {runningTasks.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-base-content/70 uppercase">
                  Running ({runningTasks.length})
                </div>
                {runningTasks.map(task => (
                  <TaskItem key={task.id} task={task} onDismiss={() => handleDismiss(task.id)} />
                ))}
              </div>
            )}

            {completedTasks.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-base-content/70 uppercase">
                  Completed ({completedTasks.length})
                </div>
                {completedTasks.map(task => (
                  <TaskItem key={task.id} task={task} onDismiss={() => handleDismiss(task.id)} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
