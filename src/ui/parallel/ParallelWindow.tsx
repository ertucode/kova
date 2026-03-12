import { useEffect } from 'react'

export function ParallelWindow() {
  // const [data, setData] = useState<ParallelHelpers.DerivedData | null>(null)
  // const [error, setError] = useState<string | null>(null)

  // Listen for messages from parent window
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'preview-file') {
        return
      }
    }

    window.addEventListener('message', handleMessage)
    return () => window.removeEventListener('message', handleMessage)
  }, [])

  return undefined
}
