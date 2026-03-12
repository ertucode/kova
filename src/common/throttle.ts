export function throttle<T extends (...args: any[]) => any>(fn: T, delay: number) {
  if (delay === 0) return fn
  let timeout: ReturnType<typeof setTimeout> | undefined
  return function (...args: Parameters<T>) {
    if (timeout) {
      clearTimeout(timeout)
    }
    timeout = setTimeout(() => {
      fn(...args)
      timeout = undefined
    }, delay)
  }
}
