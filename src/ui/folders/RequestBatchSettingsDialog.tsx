import { useSelector } from '@xstate/store/react'
import { SettingsDropdownFieldRow, SettingsList } from '@/components/settings'
import { dialogActions } from '@/global/dialogStore'
import { Dialog } from '@/lib/components/dialog'
import { RequestBatchCoordinator, requestBatchStore, type RequestBatchRowDetailView } from './requestBatchStore'

export function RequestBatchSettingsDialog() {
  const rowDetailView = useSelector(requestBatchStore, state => state.context.rowDetailView)

  return (
    <Dialog
      title="Batch settings"
      onClose={dialogActions.close}
      className="max-w-[560px]"
      footer={<button type="button" className="btn" onClick={dialogActions.close}>Close</button>}
    >
      <SettingsList className="min-h-[50vh]">
        <SettingsDropdownFieldRow<RequestBatchRowDetailView>
          title="Row detail view"
          description="Choose how expanded rows display their saved execution details. Applies to all batches."
          value={rowDetailView}
          options={[
            { value: 'response-panel', label: 'Response Panel' },
            { value: 'history-view', label: 'History View' },
          ]}
          onChange={RequestBatchCoordinator.setRowDetailView}
        />
      </SettingsList>
    </Dialog>
  )
}
