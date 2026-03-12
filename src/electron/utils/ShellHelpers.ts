export namespace ShellHelpers {
  /**
   * Escape a string for safe use in shell commands.
   * Wraps the string in single quotes and escapes any single quotes within.
   * This is the safest way to pass arbitrary strings to shell commands.
   *
   * @example
   * ShellHelpers.escape("file with spaces.txt") // "'file with spaces.txt'"
   * ShellHelpers.escape("file'with'quotes.txt") // "'file'\\''with'\\''quotes.txt'"
   * ShellHelpers.escape("file(1).txt") // "'file(1).txt'"
   */
  export function escape(str: string): string {
    // Wrap in single quotes and escape any single quotes within the string
    // by ending the single-quoted string, adding an escaped single quote, and starting a new single-quoted string
    return `'${str.replace(/'/g, "'\\''")}'`;
  }
}
