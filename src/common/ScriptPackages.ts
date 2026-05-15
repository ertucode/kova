export const EXACT_SCRIPT_PACKAGE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/

export type ScriptPackageDownloadStatus = 'not-downloaded' | 'downloading' | 'ready' | 'error'

export type ScriptPackageRecord = {
  id: string
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
  createdAt: number
  deletedAt: number | null
}

export type ScriptPackageListItem = ScriptPackageRecord & {
  cacheKey: string
  downloadStatus: ScriptPackageDownloadStatus
  cacheDirectory: string | null
  errorMessage: string | null
  downloadedAt: number | null
}

export type CreateScriptPackageInput = {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
}

export type DeleteScriptPackageInput = {
  id: string
}

export type DeleteDownloadedScriptPackageInput = {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
}

export type SuggestScriptPackageVersionInput = {
  packageName: string
}

export type SuggestTypesScriptPackageInput = {
  packageName: string
  packageVersion: string
}

export type DownloadScriptPackageInput = {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
}

export type SuggestedScriptPackageVersion = {
  packageName: string
  packageVersion: string
}

export type SuggestedTypesScriptPackage = {
  status: 'built-in' | 'suggested' | 'none'
  packageName: string | null
  packageVersion: string | null
}

export type ScriptPackageTypeFiles = Record<string, string>

export type ScriptPackageArtifact = {
  cacheKey: string
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
  downloadStatus: ScriptPackageDownloadStatus
  browserBundleCode: string | null
  browserBundleSourceMap: string | null
  typeFiles: ScriptPackageTypeFiles
}

export type ParsedScriptPackageSpecifier = {
  packageName: string
  subpath: string
  version: string | null
}

export function isExactScriptPackageVersion(value: string) {
  return EXACT_SCRIPT_PACKAGE_VERSION_PATTERN.test(value.trim())
}

export function normalizeScriptPackageName(value: string) {
  return value.trim()
}

export function normalizeScriptPackageVersion(value: string) {
  return value.trim()
}

export function parseScriptPackageSpecifier(specifier: string): ParsedScriptPackageSpecifier | null {
  const trimmed = specifier.trim()
  if (!trimmed) {
    return null
  }

  const lastAtIndex = trimmed.lastIndexOf('@')
  const hasVersionSuffix = lastAtIndex > 0 && isExactScriptPackageVersion(trimmed.slice(lastAtIndex + 1))
  const packagePath = hasVersionSuffix ? trimmed.slice(0, lastAtIndex) : trimmed
  const version = hasVersionSuffix ? trimmed.slice(lastAtIndex + 1) : null

  const packageName = readScriptPackageNameFromPath(packagePath)
  if (!packageName) {
    return null
  }

  return {
    packageName,
    subpath: packagePath.slice(packageName.length),
    version,
  }
}

export function formatScriptPackageSpecifier(packageName: string, packageVersion: string, subpath = '') {
  return `${packageName}${subpath}@${packageVersion}`
}

export function buildScriptPackageCacheKey(input: {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
}) {
  return [
    `${input.packageName}@${input.packageVersion}`,
    input.typesPackageName && input.typesPackageVersion ? `${input.typesPackageName}@${input.typesPackageVersion}` : 'no-types',
  ].join('__')
}

export function getDefinitelyTypedPackageName(packageName: string) {
  const normalized = normalizeScriptPackageName(packageName)
  if (!normalized) {
    return null
  }

  if (normalized.startsWith('@')) {
    const [scope, name] = normalized.split('/')
    if (!scope || !name) {
      return null
    }

    return `@types/${scope.slice(1)}__${name}`
  }

  return `@types/${normalized}`
}

function readScriptPackageNameFromPath(packagePath: string) {
  if (!packagePath) {
    return null
  }

  if (packagePath.startsWith('@')) {
    const slashIndex = packagePath.indexOf('/')
    if (slashIndex < 0) {
      return null
    }

    const secondSlashIndex = packagePath.indexOf('/', slashIndex + 1)
    return secondSlashIndex < 0 ? packagePath : packagePath.slice(0, secondSlashIndex)
  }

  const slashIndex = packagePath.indexOf('/')
  return slashIndex < 0 ? packagePath : packagePath.slice(0, slashIndex)
}
