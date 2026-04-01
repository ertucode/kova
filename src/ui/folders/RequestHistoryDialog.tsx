import { useEffect, useState } from 'react'
import type { RequestExecutionRecord } from '@common/Requests'
import { getWindowElectron } from '@/getWindowElectron'
import { dialogActions } from '@/global/dialogStore'
import { Dialog } from '@/lib/components/dialog'
import { EmptyExecutionState, ExecutionCard } from './RequestExecutionPanels'

const REQUEST_HISTORY_PAGE_SIZE = 20

export function RequestHistoryDialog({
  requestId,
  requestName,
}: {
  requestId: string
  requestName: string
}) {
  const [items, setItems] = useState<RequestExecutionRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)
  const [nextOffset, setNextOffset] = useState<number | null>(0)
  const [totalCount, setTotalCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void loadPage({ requestId, offset: 0 }).then(result => {
      setItems(result.items)
      setNextOffset(result.nextOffset)
      setTotalCount(result.totalCount)
      setError(null)
      setIsLoading(false)
    }).catch(() => {
      setError('Could not load request history.')
      setIsLoading(false)
    })
  }, [requestId])

  return (
    <Dialog
      title={`History · ${requestName}`}
      onClose={dialogActions.close}
      className="max-w-[72rem]"
      footer={
        <button type="button" className="btn" onClick={dialogActions.close}>
          Close
        </button>
      }
    >
      <div className="flex min-h-0 flex-col gap-4">
        <div className="text-sm text-base-content/45">
          {totalCount === 0 ? 'No history saved for this request yet.' : `${totalCount} ${totalCount === 1 ? 'item' : 'items'}`}
        </div>

        {isLoading ? <EmptyExecutionState message="Loading history..." /> : null}
        {error ? <EmptyExecutionState message={error} /> : null}
        {!isLoading && !error && items.length === 0 ? <EmptyExecutionState message="No history saved for this request yet." /> : null}

        {!error ? (
          <div className="flex min-h-0 flex-col gap-3 overflow-auto pr-1">
            {items.map(item => (
              <ExecutionCard
                key={item.id}
                execution={item}
                onDelete={id => {
                  setItems(current => current.filter(item => item.id !== id))
                  setTotalCount(current => Math.max(0, current - 1))
                }}
              />
            ))}
            {nextOffset !== null ? (
              <button
                type="button"
                className="rounded-2xl border border-base-content/10 bg-base-100/60 px-4 py-3 text-sm font-medium text-base-content/70 transition hover:border-base-content/20 hover:bg-base-100 hover:text-base-content disabled:cursor-default disabled:opacity-50"
                onClick={() => {
                  setIsLoadingMore(true)
                  void loadPage({ requestId, offset: nextOffset })
                    .then(result => {
                      setItems(current => [...current, ...result.items])
                      setNextOffset(result.nextOffset)
                      setTotalCount(result.totalCount)
                    })
                    .finally(() => {
                      setIsLoadingMore(false)
                    })
                }}
                disabled={isLoadingMore}
              >
                {isLoadingMore ? 'Loading...' : 'Load next'}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </Dialog>
  )
}

async function loadPage({ requestId, offset }: { requestId: string; offset: number }) {
  const result = await getWindowElectron().listRequestHistory({
    requestId,
    searchQuery: '',
    offset,
    limit: REQUEST_HISTORY_PAGE_SIZE,
  })

  return {
    items: result.items.filter((item): item is RequestExecutionRecord => item.itemType === 'http'),
    nextOffset: result.nextOffset,
    totalCount: result.totalCount,
  }
}
