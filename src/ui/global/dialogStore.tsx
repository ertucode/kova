import { createStore } from '@xstate/store'
import { ComponentType, ComponentProps } from 'react'
import { useSelector } from '@xstate/store/react'

type DialogState<T extends ComponentType<any>> = {
  component: T
  props: NoInfer<ComponentProps<T>>
}

// Store context - only one dialog can be open at a time
type DialogStoreContext = {
  state: DialogState<any> | null
}

// Create the initial context
const initialContext: DialogStoreContext = { state: null }

// Create the store
export const dialogStore = createStore({
  context: initialContext,
  on: {
    // Dont use. is not typesafe
    ___openDialog: (_context: DialogStoreContext, event: DialogState<any>) => ({
      state: event,
    }),

    closeDialog: () => initialContext,
  },
})

// Static helper functions for opening dialogs
export const dialogActions = {
  open: function <T extends ComponentType<any>>(state: DialogState<T>) {
    dialogStore.send({
      type: '___openDialog',
      ...state,
    })
  },
  close: () => {
    dialogStore.send({ type: 'closeDialog' })
  },
}

export function DialogStoreRenderer() {
  const state = useSelector(dialogStore, s => s.context.state)
  if (!state) return null

  return <state.component {...state.props} />
}

export function useIsDialogOpen() {
  return !!useSelector(dialogStore, s => s.context.state)
}
