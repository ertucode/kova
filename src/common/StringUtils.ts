export namespace StringUtils {
  export function joinNullable(char: string, values: $Maybe<string>[]) {
    return values.filter(v => v).join(char)
  }
}
