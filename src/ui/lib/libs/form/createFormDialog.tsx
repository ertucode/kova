import { useForm, UseFormProps, UseFormReturn } from 'react-hook-form'
import { arktypeResolver } from '@hookform/resolvers/arktype'
import { ComponentType, ReactNode, useEffect, useMemo } from 'react'
import { FormFieldConfig, FormFieldFromConfigWrapper } from '../form/FormFieldFromConfig'
import { ResultHandlerResult, useDefaultResultHandler } from '@/lib/hooks/useDefaultResultHandler'
import { ZodType } from 'zod'
import { Dialog } from '@/lib/components/dialog'
import { Button } from '@/lib/components/button'
import { clsx } from '@/lib/functions/clsx'
import { useTrigger } from '@/lib/hooks/useTrigger'
import { dialogActions } from '@/global/dialogStore'

export type CreateFormDialogOpts<TItem, TRequest extends Record<string, any>> = {
  schema: ZodType<TRequest>
  getFormParams: (item: TItem | undefined) => UseFormProps<TRequest, any>
  translationNamespace?: string[]
  action: (body: TRequest, item: TItem) => Promise<ResultHandlerResult>
  onSuccessBehavior?: {
    resetForm?: boolean
    closeDialog?: boolean
    noToastOnSuccess?: boolean
  }
  onNonErrorBehavior?: {
    closeDialog?: boolean
  }
  getConfigs: (hookForm: UseFormReturn<TRequest>, item: TItem | undefined) => FormFieldConfig<keyof TRequest & string>[]
  getTexts: (item: TItem | undefined) => {
    title: ReactNode
    buttonLabel: ReactNode
    buttonIcon?: React.ComponentType<{ className?: string }>
  }
  extraButtons?: (formId: string) => ReactNode
  dialogButtonOpts?: () => {
    icon: React.ComponentType<{ className?: string }>
    label: string
  }
  formId?: string
  Wrapper?: ComponentType<{
    children: ReactNode
    hookForm: UseFormReturn<TRequest>
    item: TItem | undefined
  }>
  dialogContentStyle?: React.CSSProperties
  dialogClassName?: string
  asyncInitialData?: (item: TItem | undefined) => Promise<TRequest | undefined>
  itemEffect?: (item: TItem | undefined) => void
}

export type FormDialogFormProps<TItem, TForm extends Record<string, any>> = CreateFormDialogOpts<TItem, TForm> & {
  item: TItem | undefined
}

export type FormDialogProps<TItem> = TItem | undefined

const defaultOnSuccessBehavior = {
  resetForm: true,
  closeDialog: true,
}

export function createFormDialog<TItem, TForm extends Record<string, any>>(opts: CreateFormDialogOpts<TItem, TForm>) {
  return function (props: FormDialogProps<TItem>) {
    return <FormDialogForm<TItem, TForm> {...opts} item={props} />
  }
}

export function FormDialogForm<TItem, TForm extends Record<string, any>>(opts: FormDialogFormProps<TItem, TForm>) {
  const formId = opts.formId ?? 'dialog-form'
  const onClose = dialogActions.close
  const [trigger, triggerValue] = useTrigger()
  const { item } = opts

  const formParams = useMemo(() => opts.getFormParams(item), [item, triggerValue])
  const hookForm = useForm<TForm>({
    ...formParams,
    resolver: arktypeResolver(opts.schema),
  })

  const {
    register,
    handleSubmit,
    control,
    formState: { isSubmitting, errors },
  } = hookForm

  const { onResult } = useDefaultResultHandler()
  async function onSubmit(data: TForm) {
    const result = await opts.action(data, item!)

    onResult(result, {
      success: () => {
        const onSuccessBehavior = {
          ...defaultOnSuccessBehavior,
          ...opts.onSuccessBehavior,
        }

        if (onSuccessBehavior.resetForm) {
          hookForm.reset()
        }
        if (onSuccessBehavior.closeDialog) {
          onClose()
        }
      },
      nonError: () => {
        if (opts.onNonErrorBehavior?.closeDialog) {
          onClose()
        }
      },
      noToastOnSuccess: opts.onSuccessBehavior?.noToastOnSuccess,
    })
  }

  useEffect(() => {
    if (opts.asyncInitialData) {
      opts.asyncInitialData(item).then(data => {
        if (data) {
          hookForm.reset(data)
          trigger()
        }
      })
    }
    if (opts.itemEffect) {
      opts.itemEffect(item)
    }
  }, [item])

  const configs = useMemo(() => opts.getConfigs(hookForm, item), [hookForm, item, triggerValue])

  const text = opts.getTexts(item)

  const dialogButtonOpts = opts.dialogButtonOpts?.()

  const renderedForm = (
    <form onSubmit={handleSubmit(onSubmit)} id={formId} className="flex flex-col gap-3">
      <FormFieldFromConfigWrapper
        hookForm={{
          register,
          control,
          formState: { errors: errors as any },
        }}
        configs={configs}
      ></FormFieldFromConfigWrapper>
    </form>
  )

  const content = opts.Wrapper ? (
    <opts.Wrapper hookForm={hookForm} item={item}>
      {renderedForm}
    </opts.Wrapper>
  ) : (
    renderedForm
  )

  return (
    <>
      {dialogButtonOpts && (
        <button type="button" className="button">
          <dialogButtonOpts.icon className="h-5 w-5" /> {dialogButtonOpts.label}
        </button>
      )}
      <Dialog
        onClose={onClose}
        style={opts.dialogContentStyle}
        title={text.title}
        className={clsx('max-w-100 w-100', opts.dialogClassName)}
        footer={
          <>
            {opts.extraButtons?.(formId)}
            <Button pending={isSubmitting} form={formId} type="submit" icon={text.buttonIcon}>
              {text.buttonLabel}
            </Button>
          </>
        }
      >
        {content}
      </Dialog>
    </>
  )
}
