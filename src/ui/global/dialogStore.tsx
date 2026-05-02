import { createStore } from '@xstate/store'
import { type FormEvent, type ComponentType, type ComponentProps, useState } from 'react'
import { useSelector } from '@xstate/store/react'
import { Dialog } from '@/lib/components/dialog'

type PromptDialogOptions = {
  title?: string
  message?: string
  defaultValue?: string
  placeholder?: string
  confirmText?: string
  cancelText?: string
}

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
let pendingPromptResolver: ((value: string | null) => void) | null = null

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
    settlePendingPrompt(null)
    dialogStore.send({
      type: '___openDialog',
      ...state,
    })
  },
  close: () => {
    settlePendingPrompt(null)
    dialogStore.send({ type: 'closeDialog' })
  },
  resolvePrompt: (value: string | null) => {
    settlePendingPrompt(value)
    dialogStore.send({ type: 'closeDialog' })
  },
  promptText: (options: PromptDialogOptions) => {
    settlePendingPrompt(null)
    return new Promise<string | null>(resolve => {
      pendingPromptResolver = resolve
      dialogStore.send({
        type: '___openDialog',
        component: ScriptPromptDialog,
        props: options,
      })
    })
  },
}

function settlePendingPrompt(value: string | null) {
  const resolver = pendingPromptResolver
  pendingPromptResolver = null
  resolver?.(value)
}

export function DialogStoreRenderer() {
  const state = useSelector(dialogStore, s => s.context.state)
  if (!state) return null

  return <state.component {...state.props} />
}

export function useIsDialogOpen() {
  return !!useSelector(dialogStore, s => s.context.state)
}

function ScriptPromptDialog({
  title,
  message,
  defaultValue,
  placeholder,
  confirmText,
  cancelText,
}: PromptDialogOptions) {
  const [value, setValue] = useState(defaultValue ?? '')

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    dialogActions.resolvePrompt(value)
  }

  return (
    <Dialog
      title={title}
      onClose={() => dialogActions.resolvePrompt(null)}
      className="max-w-[560px]"
      footer={
        <>
          <button className="btn" type="button" onClick={() => dialogActions.resolvePrompt(null)}>
            {cancelText ?? 'Cancel'}
          </button>
          <button className="btn btn-primary" form="script-prompt-dialog-form" type="submit">
            {confirmText ?? 'Continue'}
          </button>
        </>
      }
    >
      <form id="script-prompt-dialog-form" onSubmit={handleSubmit} className="flex flex-col gap-3 px-1">
        {message ? <p className="text-sm leading-6 text-base-content/72">{message}</p> : null}
        <input
          autoFocus
          type="text"
          className="input h-11 w-full rounded-xl border-base-content/10 bg-base-100"
          value={value}
          placeholder={placeholder}
          onChange={event => setValue(event.target.value)}
        />
      </form>
    </Dialog>
  )
}
