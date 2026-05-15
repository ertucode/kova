import path from 'node:path'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, rename, stat, writeFile, readdir } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import * as esbuild from 'esbuild'
import z from 'zod'
import { GenericError, type GenericResult } from '../common/GenericError.js'
import {
  buildScriptPackageCacheKey,
  getDefinitelyTypedPackageName,
  isExactScriptPackageVersion,
  normalizeScriptPackageName,
  normalizeScriptPackageVersion,
  type DeleteDownloadedScriptPackageInput,
  type DownloadScriptPackageInput,
  type ScriptPackageArtifact,
  type ScriptPackageDownloadStatus,
  type SuggestedScriptPackageVersion,
  type SuggestedTypesScriptPackage,
  type SuggestScriptPackageVersionInput,
  type SuggestTypesScriptPackageInput,
} from '../common/ScriptPackages.js'
import { Result } from '../common/Result.js'

const DAYS_30_MS = 30 * 24 * 60 * 60 * 1000
const BROWSER_BUNDLE_FORMAT_VERSION = 3
const registryEntrySchema = z.object({
  cacheKey: z.string(),
  packageName: z.string(),
  packageVersion: z.string(),
  typesPackageName: z.string().nullable(),
  typesPackageVersion: z.string().nullable(),
  status: z.union([z.literal('downloading'), z.literal('ready'), z.literal('error')]),
  cacheDirectory: z.string().nullable(),
  browserBundlePath: z.string().nullable(),
  browserBundleSourceMapPath: z.string().nullable(),
  typeFilesPath: z.string().nullable(),
  downloadedAt: z.number().nullable(),
  errorMessage: z.string().nullable(),
  buildVersion: z.number().int().nullable().optional(),
  updatedAt: z.number(),
})
const registrySchema = z.object({
  entries: z.record(z.string(), registryEntrySchema),
})

type RegistryEntry = z.infer<typeof registryEntrySchema>
type RegistryDocument = z.infer<typeof registrySchema>
type RegistryConfig = {
  baseDirectory: string
  cacheDirectory: string
  tempDirectory: string
  registryPath: string
}

let config: RegistryConfig | null = null

export function configureScriptPackageRegistry(baseDirectory: string) {
  config = {
    baseDirectory,
    cacheDirectory: path.join(baseDirectory, 'script-package-cache'),
    tempDirectory: path.join(baseDirectory, 'script-package-temp'),
    registryPath: path.join(baseDirectory, 'script-package-cache.json'),
  }
}

export async function listScriptPackageRegistryEntries() {
  const registry = await loadRegistry()
  return Object.values(registry.entries)
}

export async function getScriptPackageRegistryEntry(input: {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
}) {
  const registry = await loadRegistry()
  return registry.entries[buildScriptPackageCacheKey(input)] ?? null
}

export async function suggestScriptPackageVersion(
  input: SuggestScriptPackageVersionInput
): Promise<GenericResult<SuggestedScriptPackageVersion>> {
  const packageName = normalizeScriptPackageName(input.packageName)
  if (!packageName) {
    return GenericError.Message('Package name is required')
  }

  try {
    const metadata = await fetchNpmPackageMetadata(packageName)
    const packageVersion = pickSuggestedVersion(metadata)
    if (!packageVersion) {
      return GenericError.Message(`Could not find a stable ${packageName} version older than 30 days`)
    }

    return Result.Success({ packageName, packageVersion })
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function suggestTypesScriptPackage(
  input: SuggestTypesScriptPackageInput
): Promise<GenericResult<SuggestedTypesScriptPackage>> {
  const packageName = normalizeScriptPackageName(input.packageName)
  const packageVersion = normalizeScriptPackageVersion(input.packageVersion)
  if (!packageName) {
    return GenericError.Message('Package name is required')
  }

  if (!isExactScriptPackageVersion(packageVersion)) {
    return GenericError.Message('Package version must be an exact version')
  }

  try {
    const metadata = await fetchNpmPackageMetadata(packageName)
    const manifest = metadata.versions[packageVersion]
    if (!manifest) {
      return GenericError.Message(`Package ${packageName}@${packageVersion} was not found`)
    }

    if (hasBuiltInTypeDeclarations(manifest)) {
      return Result.Success({ status: 'built-in', packageName: null, packageVersion: null })
    }

    const typesPackageName = getDefinitelyTypedPackageName(packageName)
    if (!typesPackageName) {
      return Result.Success({ status: 'none', packageName: null, packageVersion: null })
    }

    try {
      const typesMetadata = await fetchNpmPackageMetadata(typesPackageName)
      const suggestedVersion = pickSuggestedVersion(typesMetadata)
      if (!suggestedVersion) {
        return Result.Success({ status: 'none', packageName: null, packageVersion: null })
      }

      return Result.Success({ status: 'suggested', packageName: typesPackageName, packageVersion: suggestedVersion })
    } catch {
      return Result.Success({ status: 'none', packageName: null, packageVersion: null })
    }
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function downloadScriptPackage(input: DownloadScriptPackageInput): Promise<GenericResult<void>> {
  const normalized = normalizeDownloadInput(input)
  const validationError = validateDownloadInput(normalized)
  if (validationError) {
    return GenericError.Message(validationError)
  }

  const cacheKey = buildScriptPackageCacheKey(normalized)

  try {
    const existing = await getScriptPackageRegistryEntry(normalized)
    if (existing?.status === 'ready' && existing.cacheDirectory) {
      const cacheExists = await pathExists(existing.cacheDirectory)
      if (cacheExists) {
        return Result.Success(undefined)
      }
    }

    await updateRegistryEntry(cacheKey, {
      cacheKey,
      packageName: normalized.packageName,
      packageVersion: normalized.packageVersion,
      typesPackageName: normalized.typesPackageName,
      typesPackageVersion: normalized.typesPackageVersion,
      status: 'downloading',
      cacheDirectory: null,
      browserBundlePath: null,
      browserBundleSourceMapPath: null,
      typeFilesPath: null,
      downloadedAt: null,
      errorMessage: null,
      buildVersion: BROWSER_BUNDLE_FORMAT_VERSION,
      updatedAt: Date.now(),
    })

    const registryConfig = getConfig()
    await mkdir(registryConfig.tempDirectory, { recursive: true })
    await mkdir(registryConfig.cacheDirectory, { recursive: true })

    const tempDirectory = path.join(registryConfig.tempDirectory, `${sanitizeForFileName(cacheKey)}-${Date.now()}`)
    const cacheDirectory = path.join(registryConfig.cacheDirectory, sanitizeForFileName(cacheKey))
    await rm(tempDirectory, { recursive: true, force: true })
    await rm(cacheDirectory, { recursive: true, force: true })
    await mkdir(tempDirectory, { recursive: true })
    await writeFile(path.join(tempDirectory, 'package.json'), JSON.stringify({ private: true, name: 'kova-script-package-cache' }, null, 2))

    const specs = [`${normalized.packageName}@${normalized.packageVersion}`]
    if (normalized.typesPackageName && normalized.typesPackageVersion) {
      specs.push(`${normalized.typesPackageName}@${normalized.typesPackageVersion}`)
    }

    await runNpmInstall(tempDirectory, specs)
    await validateInstalledTree(path.join(tempDirectory, 'node_modules'))

    const typeFiles = await collectTypeFiles(path.join(tempDirectory, 'node_modules'))
    const browserBundle = await buildBrowserBundle(tempDirectory, normalized.packageName)
    await writeFile(path.join(tempDirectory, 'type-files.json'), JSON.stringify(typeFiles))
    await writeFile(path.join(tempDirectory, 'browser-bundle.cjs'), browserBundle.code)
    if (browserBundle.sourceMap) {
      await writeFile(path.join(tempDirectory, 'browser-bundle.cjs.map'), browserBundle.sourceMap)
    }

    await rename(tempDirectory, cacheDirectory)

    await updateRegistryEntry(cacheKey, {
      cacheKey,
      packageName: normalized.packageName,
      packageVersion: normalized.packageVersion,
      typesPackageName: normalized.typesPackageName,
      typesPackageVersion: normalized.typesPackageVersion,
      status: 'ready',
      cacheDirectory,
      browserBundlePath: path.join(cacheDirectory, 'browser-bundle.cjs'),
      browserBundleSourceMapPath: browserBundle.sourceMap ? path.join(cacheDirectory, 'browser-bundle.cjs.map') : null,
      typeFilesPath: path.join(cacheDirectory, 'type-files.json'),
      downloadedAt: Date.now(),
      errorMessage: null,
      buildVersion: BROWSER_BUNDLE_FORMAT_VERSION,
      updatedAt: Date.now(),
    })

    return Result.Success(undefined)
  } catch (error) {
    await updateRegistryEntry(cacheKey, {
      cacheKey,
      packageName: normalized.packageName,
      packageVersion: normalized.packageVersion,
      typesPackageName: normalized.typesPackageName,
      typesPackageVersion: normalized.typesPackageVersion,
      status: 'error',
      cacheDirectory: null,
      browserBundlePath: null,
      browserBundleSourceMapPath: null,
      typeFilesPath: null,
      downloadedAt: null,
      errorMessage: error instanceof Error ? error.message : String(error),
      buildVersion: BROWSER_BUNDLE_FORMAT_VERSION,
      updatedAt: Date.now(),
    })

    return GenericError.Unknown(error)
  }
}

export async function deleteDownloadedScriptPackage(input: DeleteDownloadedScriptPackageInput): Promise<GenericResult<void>> {
  const cacheKey = buildScriptPackageCacheKey(input)

  try {
    const entry = await getScriptPackageRegistryEntry(input)
    if (entry?.cacheDirectory) {
      await rm(entry.cacheDirectory, { recursive: true, force: true })
    }

    await deleteRegistryEntry(cacheKey)
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function getScriptPackageArtifact(input: {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
}): Promise<ScriptPackageArtifact | null> {
  const entry = await getScriptPackageRegistryEntry(input)
  if (!entry) {
    return {
      cacheKey: buildScriptPackageCacheKey(input),
      packageName: input.packageName,
      packageVersion: input.packageVersion,
      typesPackageName: input.typesPackageName,
      typesPackageVersion: input.typesPackageVersion,
      downloadStatus: 'not-downloaded',
      browserBundleCode: null,
      browserBundleSourceMap: null,
      typeFiles: {},
    }
  }

  if (entry.status !== 'ready' || !entry.typeFilesPath || !entry.cacheDirectory || !(await pathExists(entry.cacheDirectory))) {
    return {
      cacheKey: entry.cacheKey,
      packageName: entry.packageName,
      packageVersion: entry.packageVersion,
      typesPackageName: entry.typesPackageName,
      typesPackageVersion: entry.typesPackageVersion,
      downloadStatus: entry.status,
      browserBundleCode: null,
      browserBundleSourceMap: null,
      typeFiles: {},
    }
  }

  const currentEntry = await ensureCurrentBrowserBundle(entry)
  if (!currentEntry.typeFilesPath) {
    return {
      cacheKey: currentEntry.cacheKey,
      packageName: currentEntry.packageName,
      packageVersion: currentEntry.packageVersion,
      typesPackageName: currentEntry.typesPackageName,
      typesPackageVersion: currentEntry.typesPackageVersion,
      downloadStatus: currentEntry.status,
      browserBundleCode: null,
      browserBundleSourceMap: null,
      typeFiles: {},
    }
  }

  const typeFiles = JSON.parse(await readFile(currentEntry.typeFilesPath, 'utf8')) as Record<string, string>
  const browserBundleCode = currentEntry.browserBundlePath ? await readFile(currentEntry.browserBundlePath, 'utf8') : null
  const browserBundleSourceMap = currentEntry.browserBundleSourceMapPath
    ? await readFile(currentEntry.browserBundleSourceMapPath, 'utf8')
    : null

  return {
    cacheKey: currentEntry.cacheKey,
    packageName: currentEntry.packageName,
    packageVersion: currentEntry.packageVersion,
    typesPackageName: currentEntry.typesPackageName,
    typesPackageVersion: currentEntry.typesPackageVersion,
    downloadStatus: 'ready',
    browserBundleCode,
    browserBundleSourceMap,
    typeFiles,
  }
}

async function ensureCurrentBrowserBundle(entry: RegistryEntry) {
  if (entry.buildVersion === BROWSER_BUNDLE_FORMAT_VERSION) {
    return entry
  }

  if (!entry.cacheDirectory) {
    return entry
  }

  const browserBundle = await buildBrowserBundle(entry.cacheDirectory, entry.packageName)
  const browserBundlePath = entry.browserBundlePath ?? path.join(entry.cacheDirectory, 'browser-bundle.cjs')
  await writeFile(browserBundlePath, browserBundle.code)
  if (entry.browserBundleSourceMapPath && browserBundle.sourceMap) {
    await writeFile(entry.browserBundleSourceMapPath, browserBundle.sourceMap)
  }

  const nextEntry: RegistryEntry = {
    ...entry,
    browserBundlePath,
    browserBundleSourceMapPath: browserBundle.sourceMap && entry.browserBundleSourceMapPath ? entry.browserBundleSourceMapPath : null,
    buildVersion: BROWSER_BUNDLE_FORMAT_VERSION,
    updatedAt: Date.now(),
  }
  await updateRegistryEntry(entry.cacheKey, nextEntry)
  return nextEntry
}

type NpmPackageMetadata = {
  versions: Record<string, Record<string, unknown>>
  time?: Record<string, string>
}

function getConfig() {
  if (!config) {
    throw new Error('Script package registry is not configured')
  }

  return config
}

async function loadRegistry(): Promise<RegistryDocument> {
  const registryConfig = getConfig()
  try {
    const raw = await readFile(registryConfig.registryPath, 'utf8')
    return registrySchema.parse(JSON.parse(raw))
  } catch (error) {
    if (isNodeError(error, 'ENOENT')) {
      return { entries: {} }
    }

    return { entries: {} }
  }
}

async function saveRegistry(document: RegistryDocument) {
  const registryConfig = getConfig()
  await mkdir(registryConfig.baseDirectory, { recursive: true })
  await writeFile(registryConfig.registryPath, JSON.stringify(document, null, 2))
}

async function updateRegistryEntry(cacheKey: string, entry: RegistryEntry) {
  const registry = await loadRegistry()
  registry.entries[cacheKey] = entry
  await saveRegistry(registry)
}

async function deleteRegistryEntry(cacheKey: string) {
  const registry = await loadRegistry()
  delete registry.entries[cacheKey]
  await saveRegistry(registry)
}

async function fetchNpmPackageMetadata(packageName: string): Promise<NpmPackageMetadata> {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(packageName)}`)
  if (!response.ok) {
    throw new Error(`Failed to fetch package metadata for ${packageName}: ${response.status} ${response.statusText}`)
  }

  return (await response.json()) as NpmPackageMetadata
}

function pickSuggestedVersion(metadata: NpmPackageMetadata) {
  const cutoff = Date.now() - DAYS_30_MS

  return Object.entries(metadata.time ?? {})
    .filter(([version]) => version !== 'created' && version !== 'modified' && !version.includes('-'))
    .map(([version, publishedAt]) => ({ version, publishedAt: Date.parse(publishedAt) }))
    .filter(entry => Number.isFinite(entry.publishedAt) && entry.publishedAt <= cutoff && metadata.versions[entry.version])
    .sort((left, right) => right.publishedAt - left.publishedAt)
    .at(0)?.version ?? null
}

function hasBuiltInTypeDeclarations(manifest: Record<string, unknown>) {
  return typeof manifest.types === 'string' || typeof manifest.typings === 'string'
}

async function runNpmInstall(workingDirectory: string, specs: string[]) {
  await runCommand('npm', ['install', '--ignore-scripts', '--no-save', '--package-lock=false', '--install-links=false', ...specs], {
    cwd: workingDirectory,
  })
}

async function validateInstalledTree(nodeModulesPath: string) {
  const packageJsonPaths = await collectPackageJsonPaths(nodeModulesPath)
  for (const packageJsonPath of packageJsonPaths) {
    const manifest = JSON.parse(await readFile(packageJsonPath, 'utf8')) as Record<string, unknown>
    validatePackageManifest(packageJsonPath, manifest)
  }

  const nativeModulePaths = await collectFiles(nodeModulesPath, filePath => filePath.endsWith('.node'))
  if (nativeModulePaths.length > 0) {
    throw new Error(`Native addon files are not supported: ${nativeModulePaths[0]}`)
  }
}

function validatePackageManifest(packageJsonPath: string, manifest: Record<string, unknown>) {
  const scripts = typeof manifest.scripts === 'object' && manifest.scripts !== null ? (manifest.scripts as Record<string, unknown>) : {}
  const forbiddenScripts = ['preinstall', 'install', 'postinstall', 'prepare', 'prepack'].filter(
    scriptName => typeof scripts[scriptName] === 'string' && scripts[scriptName]
  )
  if (forbiddenScripts.length > 0) {
    throw new Error(`Install scripts are not supported (${forbiddenScripts.join(', ')}) in ${packageJsonPath}`)
  }

  if (manifest.gypfile === true) {
    throw new Error(`Native addon packages are not supported: ${packageJsonPath}`)
  }

  if ('binary' in manifest || 'bin' in manifest) {
    throw new Error(`Binary packages are not supported: ${packageJsonPath}`)
  }
}

async function collectTypeFiles(nodeModulesPath: string) {
  const filePaths = await collectFiles(nodeModulesPath, filePath => {
    return filePath.endsWith('.d.ts') || filePath.endsWith('.d.cts') || filePath.endsWith('.d.mts') || filePath.endsWith('package.json')
  })
  const files: Record<string, string> = {}
  for (const filePath of filePaths) {
    files[path.relative(nodeModulesPath, filePath)] = await readFile(filePath, 'utf8')
  }

  return files
}

async function buildBrowserBundle(workingDirectory: string, packageName: string) {
  try {
    const packageManifest = await readInstalledPackageManifest(workingDirectory, packageName)
    const peerDependencies = Object.keys(
      typeof packageManifest.peerDependencies === 'object' && packageManifest.peerDependencies !== null
        ? (packageManifest.peerDependencies as Record<string, string>)
        : {}
    )
    const result = await esbuild.build({
      absWorkingDir: workingDirectory,
      stdin: {
        contents: `export * from ${JSON.stringify(packageName)};\nimport * as mod from ${JSON.stringify(packageName)};\nexport default mod;`,
        sourcefile: 'kova-script-package-entry.ts',
        resolveDir: workingDirectory,
        loader: 'ts',
      },
      bundle: true,
      platform: 'browser',
      format: 'cjs',
      write: false,
      external: ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'react-dom', ...peerDependencies],
      target: 'es2022',
    })

    const code = result.outputFiles[0]?.text ?? null
    if (!code) {
      throw new Error(`esbuild did not return bundled output for ${packageName}`)
    }

    return { code, sourceMap: null }
  } catch (error) {
    if (error instanceof Error) {
      throw new Error(`Could not build browser bundle for ${packageName}: ${error.message}`)
    }

    throw error
  }
}

async function readInstalledPackageManifest(workingDirectory: string, packageName: string) {
  return JSON.parse(await readFile(path.join(workingDirectory, 'node_modules', packageName, 'package.json'), 'utf8')) as Record<string, unknown>
}

async function collectPackageJsonPaths(nodeModulesPath: string) {
  return collectFiles(nodeModulesPath, filePath => filePath.endsWith('package.json'))
}

async function collectFiles(directoryPath: string, predicate: (filePath: string) => boolean): Promise<string[]> {
  const results: string[] = []
  const entries = await readdir(directoryPath, { withFileTypes: true })
  for (const entry of entries) {
    const filePath = path.join(directoryPath, entry.name)
    if (entry.isDirectory()) {
      results.push(...(await collectFiles(filePath, predicate)))
      continue
    }

    if (predicate(filePath)) {
      results.push(filePath)
    }
  }

  return results
}

function normalizeDownloadInput(input: DownloadScriptPackageInput) {
  return {
    packageName: normalizeScriptPackageName(input.packageName),
    packageVersion: normalizeScriptPackageVersion(input.packageVersion),
    typesPackageName: input.typesPackageName ? normalizeScriptPackageName(input.typesPackageName) : null,
    typesPackageVersion: input.typesPackageVersion ? normalizeScriptPackageVersion(input.typesPackageVersion) : null,
  }
}

function validateDownloadInput(input: DownloadScriptPackageInput) {
  if (!input.packageName) {
    return 'Package name is required'
  }

  if (!isExactScriptPackageVersion(input.packageVersion)) {
    return 'Package version must be an exact version'
  }

  if ((input.typesPackageName === null) !== (input.typesPackageVersion === null)) {
    return 'Types package name and version must both be provided'
  }

  if (input.typesPackageVersion !== null && !isExactScriptPackageVersion(input.typesPackageVersion)) {
    return 'Types package version must be an exact version'
  }

  return null
}

function sanitizeForFileName(value: string) {
  return value.replace(/[^A-Za-z0-9._-]+/g, '_')
}

async function runCommand(command: string, args: string[], options: { cwd: string }) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: 'pipe',
      env: {
        ...process.env,
        npm_config_ignore_scripts: 'true',
      },
    })
    let stderr = ''
    child.stderr.on('data', chunk => {
      stderr += chunk.toString()
    })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(stderr.trim() || `${command} ${args.join(' ')} failed with code ${code ?? 'unknown'}`))
    })
  })
}

async function pathExists(filePath: string) {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error && error.code === code
}

export function buildScriptPackageBrowserBundleUrl(cacheDirectory: string) {
  return pathToFileURL(path.join(cacheDirectory, 'browser-bundle.cjs')).toString()
}
