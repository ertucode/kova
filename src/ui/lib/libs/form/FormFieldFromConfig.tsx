import { Control, UseFormRegister } from 'react-hook-form'
import { ComponentType, createContext, useContext } from 'react'
import { LabeledFormField, LabeledFormFieldNoChildrenProps, LabeledFormFieldNonInputProps } from './LabeledFormField'
import { clsx } from '@/lib/functions/clsx'

export type FormFieldConfig<TKey extends string = string> = {
  label: React.ReactNode
} & FormFieldFromConfigProps.All<TKey>

export function FormFieldFromConfig({ config }: { config: FormFieldConfig }) {
  const contextValue = useContext(FormFieldFromConfigContext)
  const error = contextValue?.formState.errors?.[config.field]?.message
  const labelName = 'field' in config ? config.field : ''
  return (
    <LabeledFormField name={labelName} label={config.label} error={error}>
      <Inside config={config} contextValue={contextValue} />
      {config.AdditionalRender ? <config.AdditionalRender /> : undefined}
    </LabeledFormField>
  )
}

function Inside({
  config,
  contextValue,
}: {
  config: FormFieldConfig
  contextValue: FormFieldFromConfigContextValue | undefined
}) {
  if (config.type === 'input') {
    const className = clsx('input w-full', config.props?.className)
    return (
      <input
        id={config.field}
        name={config.field}
        {...contextValue?.register?.(config.field)}
        {...config.props}
        className={className}
      />
    )
  }

  if (config.type === 'textarea') {
    const className = clsx('textarea w-full', config.props?.className)
    return (
      <textarea
        id={config.field}
        name={config.field}
        {...contextValue?.register?.(config.field)}
        {...config.props}
        className={className}
      />
    )
  }

  if (config.type === 'select') {
    const className = clsx('select w-full', config.props?.className)
    return (
      <select
        id={config.field}
        name={config.field}
        {...contextValue?.register?.(config.field)}
        {...config.props}
        className={className}
      >
        {config.options.map(option => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )
  }

  if (config.type === 'checkbox') {
    const className = clsx('checkbox', config.props?.className)
    return (
      <input
        type="checkbox"
        id={config.field}
        name={config.field}
        {...contextValue?.register?.(config.field)}
        {...config.props}
        className={className}
      />
    )
  }

  return `Unknown type: ${(config as { type: string }).type}`
}

// function getControl(value: FormFieldFromConfigContextValue | undefined) {
//   if (value == undefined) throw new Error('FormFieldFromConfigContext not found in getControl')
//   if (value.control == undefined) throw new Error('FormFieldFromConfigContext.control not found in getControl')
//   return value.control
// }
//
export type FormFieldErrors = Partial<Record<string, { message?: $Maybe<string> }>>
export type FormFieldFromConfigContextValue = {
  control: Control<any, any>
  register: UseFormRegister<any>
  formState: { errors: FormFieldErrors }
}
export const FormFieldFromConfigContext = createContext<FormFieldFromConfigContextValue | undefined>(undefined)

export type FormFieldFromConfigContextProviderProps = (
  | {
      children: React.ReactNode
    }
  | {
      configs: $Maybe<FormFieldConfig>[]
    }
) & {
  hookForm?: FormFieldFromConfigContextValue
}
export function FormFieldFromConfigWrapper({ hookForm, ...props }: FormFieldFromConfigContextProviderProps) {
  let children: React.ReactNode
  if ('configs' in props) {
    children = props.configs.map(config => config && <FormFieldFromConfig key={getKey(config)} config={config} />)
  } else {
    children = props.children
  }
  return <FormFieldFromConfigContext.Provider value={hookForm}>{children}</FormFieldFromConfigContext.Provider>
}

function getKey(config: FormFieldConfig) {
  if ('field' in config) return config.field
}

namespace FormFieldFromConfigProps {
  export type SingleFieldAll = Input | TextArea | Select | Checkbox
  export type All<TKey extends string> = ({
    field: TKey
  } & SingleFieldAll) & {
    AdditionalRender?: ComponentType<{}>
  }

  export type Input = {
    type: 'input'
    props?: Omit<LabeledFormFieldNonInputProps & LabeledFormFieldNoChildrenProps, 'name' | 'label'>
  }
  export type TextArea = {
    type: 'textarea'
    props?: React.ComponentProps<'textarea'>
  }
  export type Select = {
    type: 'select'
    options: { value: string; label: string }[]
    props?: Omit<React.ComponentProps<'select'>, 'children'>
  }

  export type Checkbox = {
    type: 'checkbox'
    props?: Omit<React.ComponentProps<'input'>, 'type'>
  }
}
