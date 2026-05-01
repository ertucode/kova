import { useMemo, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import type { TaggableItemType } from '@common/Tags'
import { dialogActions } from '@/global/dialogStore'
import { Dialog } from '@/lib/components/dialog'
import { TagsCoordinator } from './tagsCoordinator'
import { tagsStore } from './tagsStore'

export function AssignTagsDialog({ itemType, itemId, itemName }: { itemType: TaggableItemType; itemId: string; itemName: string }) {
  const items = useSelector(tagsStore, state => state.context.items)
  const assignments = useSelector(tagsStore, state => state.context.assignments)
  const [isSaving, setIsSaving] = useState(false)

  const [selectedIds, setSelectedIds] = useState(() =>
    assignments
      .filter(assignment => assignment.itemType === itemType && assignment.itemId === itemId)
      .map(assignment => assignment.tagId)
  )

  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds])

  const save = async () => {
    setIsSaving(true)
    const success = await TagsCoordinator.replaceItemTags(itemType, itemId, selectedIds)
    setIsSaving(false)
    if (success) {
      dialogActions.close()
    }
  }

  return (
    <Dialog
      title={`Assign Tags`}
      onClose={() => dialogActions.close()}
      className="max-w-[560px]"
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={() => dialogActions.close()} disabled={isSaving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={isSaving}>
            {isSaving ? 'Saving...' : 'Save'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-base-content/60">Choose tags for {itemName}.</p>
        {items.length === 0 ? <p className="text-sm text-base-content/45">No tags yet.</p> : null}
        <div className="space-y-1.5">
          {items.map(tag => {
            const checked = selectedIdSet.has(tag.id)

            return (
              <label
                key={tag.id}
                className={[
                  'flex cursor-pointer items-center gap-3 rounded-2xl px-3 py-2.5 transition',
                  checked ? 'bg-primary/10 text-base-content' : 'bg-base-200/40 text-base-content/78 hover:bg-base-200/65',
                ].join(' ')}
              >
                <input
                  type="checkbox"
                  className="checkbox checkbox-sm"
                  checked={checked}
                  onChange={event =>
                    setSelectedIds(current =>
                      event.target.checked ? [...current, tag.id] : current.filter(currentId => currentId !== tag.id)
                    )
                  }
                />
                <span
                  className="size-3 rounded-full"
                  style={{ backgroundColor: tag.color ?? 'color-mix(in oklch, var(--color-base-content) 28%, transparent)' }}
                />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{tag.name}</span>
              </label>
            )
          })}
        </div>
      </div>
    </Dialog>
  )
}
