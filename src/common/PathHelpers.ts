import { Brands } from './Brands.js'

export namespace PathHelpers {
  export function name(path: string) {
    const parts = path.split('/').filter(Boolean)
    return parts[parts.length - 1] ?? '/'
  }

  export function getLastCountParts(path: string, count: number) {
    const parts = path.split('/').filter(Boolean)
    return parts.slice(-count).join('/')
  }

  /**
   * Get the parent folder path and name from a full path
   * e.g., "/Users/john/Documents/file.txt" -> { path: "/Users/john/Documents", name: "Documents" }
   */
  export function parent<T extends string>(
    fullPath: T
  ): {
    path: T
    name: string
  } {
    if (fullPath === '/') return { path: '' as T, name: '' }
    const parts = fullPath.split('/')
    // Remove empty parts but keep track of leading slash
    const filteredParts = parts.filter(Boolean)

    if (filteredParts.length === 1) {
      if (filteredParts[0] === '~') {
        return { path: '/' as T, name: '' }
      }

      return { path: '/' as T, name: '/' }
    }

    if (filteredParts.length >= 2) {
      const parentParts = filteredParts.slice(0, -1)
      const parentPath = filteredParts[0][0] === '~' ? parentParts.join('/') : '/' + parentParts.join('/')
      const parentName = parentParts[parentParts.length - 1]
      return { path: parentPath as T, name: parentName }
    }

    return { path: '/' as T, name: '/' }
  }

  export function reconstructDirectoryUntilIndex(parts: string[], idx: number) {
    const d = parts.slice(0, idx + 1).join('/') + '/'
    if (d.startsWith('/') || d.startsWith('~')) return d
    return '/' + d
  }

  export function getFolderNameParts(dir: string) {
    return dir.split('/').filter(Boolean)
  }

  export function expandHome(home: string, filePath: string): Brands.ExpandedPath {
    if (filePath.startsWith('~/')) {
      return (home + filePath.slice(1)) as Brands.ExpandedPath
    }
    return filePath as Brands.ExpandedPath
  }

  export function revertExpandedHome(home: string, filePath: string): string {
    if (filePath.startsWith(home)) {
      const remainder = filePath.slice(home.length)
      return remainder ? '~' + remainder : '~/'
    }
    return filePath
  }

  export function resolveUpDirectory(homeDirectory: string, input: string) {
    let parts = getFolderNameParts(input)
    if (parts.length === 1) {
      if (parts[0] === '~') {
        parts = getFolderNameParts(homeDirectory)
      }
    }

    // Check if the first part is ~, meaning the input started with ~/
    const startsWithTilde = parts.length > 0 && parts[0] === '~'

    let fullPath = parts.slice(0, parts.length - 1).join('/')

    // If input started with ~/ and we have no parts left, return ~/
    if (startsWithTilde && fullPath === '~') {
      return '~/'
    }

    if (fullPath[0] !== '/' && fullPath[0] !== '~') {
      fullPath = '/' + fullPath
    }

    return fullPath
  }

  export function withExtension<TExtension extends `.${string}`>(filePath: string, extension: TExtension) {
    if (filePath.endsWith(extension)) return filePath
    return filePath + extension
  }

  export function suggestUnarchiveName(filePath: string) {
    const matchedExt = PathHelpers.getExtension(filePath).replace(/^\./, '')
    return filePath.slice(0, -matchedExt.length - 1)
  }

  export function getExtension(filePath: string) {
    const lastDot = filePath.lastIndexOf('.')
    if (lastDot === -1 || lastDot === filePath.length - 1) {
      return ''
    }
    return filePath.slice(lastDot + 1)
  }

  export type DottedExtension = `.${string}` | ''
  export function getDottedExtension(filePath: string): DottedExtension {
    const ext = getExtension(filePath)
    if (!ext) return '.'
    return ('.' + ext) as DottedExtension
  }

  export function ensureDot(ext: string) {
    if (ext.startsWith('.')) return ext
    return '.' + ext
  }
}
