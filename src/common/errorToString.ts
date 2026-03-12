export function errorToString(err: unknown) {
  if (err instanceof Error) {
    return `${err.name}: ${err.message}\n${err.stack}`;
  }
  return String(err); // for non-Error values
}
