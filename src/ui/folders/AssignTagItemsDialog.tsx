import { useState } from 'react'
import { useSelector } from '@xstate/store/react'
import type { TaggableItemType } from '@common/Tags'
import { dialogActions } from '@/global/dialogStore'
import { Dialog } from '@/lib/components/dialog'
import { folderExplorerTreeStore } from './folderExplorerTreeStore'
import { ExplorerItemPicker } from './ExplorerItemPicker'
import { TagsCoordinator } from './tagsCoordinator'
import { tagsStore } from './tagsStore'

export function AssignTagItemsDialog({ tagId, tagName }: { tagId: string; tagName: string }) {
  const explorerItems = useSelector(folderExplorerTreeStore, state => state.context.items)
  const assignments = useSelector(tagsStore, state => state.context.assignments)
  const [isSaving, setIsSaving] = useState(false)

  const [selectedKeys, setSelectedKeys] = useState(() =>
    assignments.filter(assignment => assignment.tagId === tagId).map(assignment => `${assignment.itemType}:${assignment.itemId}`)
  )

  const save = async () => {
    setIsSaving(true)
    const nextItems = selectedKeys.map(key => {
      const [itemType, itemId] = key.split(':')
      return { itemType: itemType as TaggableItemType, itemId }
    })
    const success = await TagsCoordinator.replaceTagItems(tagId, nextItems)
    setIsSaving(false)
    if (success) {
      dialogActions.close()
    }
  }

  return (
    <Dialog
      title="Assign Items"
      onClose={() => dialogActions.close()}
      className="max-w-[720px]"
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
        <p className="text-sm text-base-content/60">Choose folders and requests for {tagName}.</p>
        <ExplorerItemPicker items={explorerItems} selectedKeys={selectedKeys} onChange={setSelectedKeys} isMultiple />
      </div>
    </Dialog>
  )
}
