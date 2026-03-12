import { useState } from 'react'

export function useTrigger() {
  const [value, setValue] = useState<{}>({})
  return [() => setValue({}), value] as const
}
