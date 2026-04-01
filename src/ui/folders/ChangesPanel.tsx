import { useEffect, useMemo } from 'react'
import { useSelector } from '@xstate/store/react'
import { SearchIcon, Undo2Icon, XIcon } from 'lucide-react'
import type { OperationRecord } from '@common/Operations'
import { changesStore } from './changesStore'
import { ChangesCoordinator } from './changesCoordinator'

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Reversible' },
  { id: 'undone', label: 'Reversed' },
  { id: 'failed', label: 'Failed' },
] as const

function getStatusLabel(status: OperationRecord['status']) {
  switch (status) {
    case 'active':
      return 'Reversible'
    case 'undone':
      return 'Reversed'
    case 'failed':
      return 'Failed'
  }
}

function getStatusBadgeClassName(status: OperationRecord['status']) {
  switch (status) {
    case 'active':
      return 'bg-info/15 text-info'
    case 'undone':
      return 'bg-warning/15 text-warning'
    case 'failed':
      return 'bg-error/15 text-error'
  }
}

export function ChangesPanel() {
  const operations = useSelector(changesStore, state => state.context.operations)
  const loading = useSelector(changesStore, state => state.context.loading)
  const searchQuery = useSelector(changesStore, state => state.context.searchQuery)
  const statusFilter = useSelector(changesStore, state => state.context.statusFilter)
  const selectedIds = useSelector(changesStore, state => state.context.selectedIds)

  useEffect(() => {
    void ChangesCoordinator.loadOperations()
  }, [])

  const visibleOperations = useMemo(() => {
    const normalizedQuery = searchQuery.trim().toLowerCase()
    return operations.filter(operation => {
      if (statusFilter !== 'all' && operation.status !== statusFilter) {
        return false
      }

      if (!normalizedQuery) {
        return true
      }

      return `${operation.title} ${operation.summary}`.toLowerCase().includes(normalizedQuery)
    })
  }, [operations, searchQuery, statusFilter])

  const selectedOperations = visibleOperations.filter(operation => selectedIds.includes(operation.id))
  const visibleIds = visibleOperations.map(operation => operation.id)
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.includes(id))
  const undoableSelectedIds = selectedOperations.filter(operation => operation.status === 'active').map(operation => operation.id)

  return (
    <div className="flex h-full min-w-0 flex-col px-6 py-6">
      <div className="text-sm font-semibold text-base-content">Changes</div>
      <div className="mt-2 text-sm leading-6 text-base-content/45">Track completed and reversible actions like deletes and imports.</div>

      <div className="mt-5 grid gap-3 rounded-2xl border border-base-content/10 bg-base-100/50 p-4">
        <label className="flex items-center gap-3 rounded-xl border border-base-content/10 bg-base-100 px-3 py-2.5">
          <SearchIcon className="size-4 shrink-0 text-base-content/40" />
          <input
            value={searchQuery}
            onChange={event => ChangesCoordinator.setSearchQuery(event.target.value)}
            placeholder="Search changes"
            className="w-full border-0 bg-transparent text-sm text-base-content outline-none placeholder:text-base-content/35"
          />
        </label>

        <div className="flex flex-wrap items-center gap-2">
          {STATUS_FILTERS.map(filter => (
            <button
              key={filter.id}
              type="button"
              className={[
                'rounded-full px-3 py-1.5 text-xs font-medium transition',
                statusFilter === filter.id
                  ? 'bg-primary/15 text-primary'
                  : 'bg-base-content/8 text-base-content/60 hover:bg-base-content/12 hover:text-base-content',
              ].join(' ')}
              onClick={() => ChangesCoordinator.setStatusFilter(filter.id)}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-base-content/10 bg-base-100 px-3 py-2.5 text-sm">
          <label className="flex items-center gap-2 text-base-content/70">
            <input
              type="checkbox"
              className="checkbox checkbox-sm"
              checked={allVisibleSelected}
              onChange={() => ChangesCoordinator.toggleVisibleSelection(visibleIds)}
            />
            <span>Select visible</span>
          </label>

          <span className="text-base-content/45">{selectedIds.length} selected</span>

          <button
            type="button"
            className="rounded-xl border border-base-content/10 bg-base-100 px-3 py-2 text-sm font-medium text-base-content/75 transition hover:border-base-content/20 hover:bg-base-200/70 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={undoableSelectedIds.length === 0}
            onClick={() => void ChangesCoordinator.undoSelected(undoableSelectedIds)}
          >
            Undo Selected
          </button>

          <button
            type="button"
            className="rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-sm font-medium text-error transition hover:bg-error/10 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={selectedOperations.length === 0}
            onClick={() => ChangesCoordinator.requestBulkDelete(selectedOperations)}
          >
            Delete Selected
          </button>

          {selectedIds.length > 0 ? (
            <button
              type="button"
              className="rounded-xl border border-base-content/10 bg-base-100 px-3 py-2 text-sm font-medium text-base-content/70 transition hover:border-base-content/20 hover:bg-base-200/70"
              onClick={() => ChangesCoordinator.clearSelection()}
            >
              Clear
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-5 flex min-h-0 flex-1 flex-col gap-3 overflow-auto pr-1">
        {loading ? <div className="rounded-2xl border border-dashed border-base-content/12 px-4 py-4 text-sm text-base-content/45">Loading changes...</div> : null}
        {!loading && visibleOperations.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-base-content/12 px-4 py-4 text-sm text-base-content/45">No changes found.</div>
        ) : null}
        {visibleOperations.map(operation => (
          <ChangeRow key={operation.id} operation={operation} selected={selectedIds.includes(operation.id)} />
        ))}
      </div>
    </div>
  )
}

function ChangeRow({ operation, selected }: { operation: OperationRecord; selected: boolean }) {
  const badgeClassName = getStatusBadgeClassName(operation.status)

  return (
    <div className="rounded-2xl border border-base-content/10 bg-base-100/50 px-4 py-4">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          className="checkbox checkbox-sm mt-1"
          checked={selected}
          onChange={() => ChangesCoordinator.toggleSelection(operation.id)}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate text-sm font-medium text-base-content">{operation.title}</div>
            <span className={`rounded-full px-2 py-1 text-[11px] font-medium uppercase tracking-[0.08em] ${badgeClassName}`}>
              {getStatusLabel(operation.status)}
            </span>
          </div>

          <div className="mt-1 text-sm text-base-content/55">{operation.summary}</div>
          <div className="mt-2 text-xs text-base-content/40">{new Date(operation.createdAt).toLocaleString()}</div>
        </div>

        <div className="flex items-center gap-2">
          {operation.status === 'active' ? (
            <button
              type="button"
              className="rounded-xl border border-base-content/10 bg-base-100 px-3 py-2 text-sm font-medium text-base-content/75 transition hover:border-base-content/20 hover:bg-base-200/70"
              onClick={() => void ChangesCoordinator.undoOperation(operation.id)}
              title="Undo"
            >
              <Undo2Icon className="size-4" />
            </button>
          ) : null}

          <button
            type="button"
            className="rounded-xl border border-error/20 bg-error/5 px-3 py-2 text-sm font-medium text-error transition hover:bg-error/10"
            onClick={() => ChangesCoordinator.requestDeleteOperation(operation)}
            title={operation.status === 'active' ? 'Delete Permanently' : 'Remove Record'}
          >
            <XIcon className="size-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
