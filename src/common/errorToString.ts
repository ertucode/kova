export function errorToString(err: unknown) {
  if (err instanceof Error) {
    return `${err.stack}`
  }
  return String(err) // for non-Error values
}
