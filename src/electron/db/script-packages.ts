import { and, desc, eq, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import {
  buildScriptPackageCacheKey,
  isExactScriptPackageVersion,
  normalizeScriptPackageName,
  normalizeScriptPackageVersion,
  type CreateScriptPackageInput,
  type DeleteScriptPackageInput,
  type ScriptPackageRecord,
  type UpdateScriptPackageInput,
} from '../../common/ScriptPackages.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { scriptPackages } from './schema.js'

type ScriptPackageRow = typeof scriptPackages.$inferSelect

export async function listScriptPackages(): Promise<ScriptPackageRecord[]> {
  const db = getDb()

  return db
    .select()
    .from(scriptPackages)
    .where(isNull(scriptPackages.deletedAt))
    .orderBy(scriptPackages.packageName, scriptPackages.packageVersion, desc(scriptPackages.createdAt))
    .all()
    .map(toScriptPackageRecord)
}

export async function createScriptPackage(input: CreateScriptPackageInput): Promise<GenericResult<ScriptPackageRecord>> {
  const db = getDb()
  const normalized = normalizeScriptPackageInput(input)
  const validationError = validateScriptPackageInput(normalized)
  if (validationError) {
    return GenericError.Message(validationError)
  }

  try {
    const matchingRows = db
      .select()
      .from(scriptPackages)
      .where(
        and(
          eq(scriptPackages.packageName, normalized.packageName),
          eq(scriptPackages.packageVersion, normalized.packageVersion),
          normalized.typesPackageName === null
            ? isNull(scriptPackages.typesPackageName)
            : eq(scriptPackages.typesPackageName, normalized.typesPackageName),
          normalized.typesPackageVersion === null
            ? isNull(scriptPackages.typesPackageVersion)
            : eq(scriptPackages.typesPackageVersion, normalized.typesPackageVersion),
        )
      )
      .orderBy(desc(scriptPackages.deletedAt), desc(scriptPackages.createdAt))
      .all()

    const duplicate = matchingRows.find(row => row.deletedAt === null)

    if (duplicate) {
      return GenericError.Message(`Package ${buildScriptPackageDisplayName(normalized)} already exists in this workspace`)
    }

    const now = Date.now()
    const deletedDuplicate = matchingRows.find(row => row.deletedAt !== null)
    if (deletedDuplicate) {
      db.update(scriptPackages).set({ createdAt: now, deletedAt: null }).where(eq(scriptPackages.id, deletedDuplicate.id)).run()
      return Result.Success(
        toScriptPackageRecord({
          ...deletedDuplicate,
          createdAt: now,
          deletedAt: null,
        })
      )
    }

    const row: ScriptPackageRow = {
      id: crypto.randomUUID(),
      packageName: normalized.packageName,
      packageVersion: normalized.packageVersion,
      typesPackageName: normalized.typesPackageName,
      typesPackageVersion: normalized.typesPackageVersion,
      createdAt: now,
      deletedAt: null,
    }

    db.insert(scriptPackages).values(row).run()
    return Result.Success(toScriptPackageRecord(row))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteScriptPackage(input: DeleteScriptPackageInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    const result = db
      .update(scriptPackages)
      .set({ deletedAt: Date.now() })
      .where(and(eq(scriptPackages.id, input.id), isNull(scriptPackages.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Package not found')
    }

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateScriptPackage(input: UpdateScriptPackageInput): Promise<GenericResult<ScriptPackageRecord>> {
  const db = getDb()

  try {
    const existing = db.select().from(scriptPackages).where(and(eq(scriptPackages.id, input.id), isNull(scriptPackages.deletedAt))).get()
    if (!existing) {
      return GenericError.Message('Package not found')
    }

    const normalized = normalizeScriptPackageInput({
      packageName: existing.packageName,
      packageVersion: existing.packageVersion,
      typesPackageName: input.typesPackageName,
      typesPackageVersion: input.typesPackageVersion,
    })
    const validationError = validateScriptPackageInput(normalized)
    if (validationError) {
      return GenericError.Message(validationError)
    }

    const duplicate = db
      .select({ id: scriptPackages.id })
      .from(scriptPackages)
      .where(
        and(
          eq(scriptPackages.packageName, existing.packageName),
          eq(scriptPackages.packageVersion, existing.packageVersion),
          normalized.typesPackageName === null
            ? isNull(scriptPackages.typesPackageName)
            : eq(scriptPackages.typesPackageName, normalized.typesPackageName),
          normalized.typesPackageVersion === null
            ? isNull(scriptPackages.typesPackageVersion)
            : eq(scriptPackages.typesPackageVersion, normalized.typesPackageVersion),
          isNull(scriptPackages.deletedAt)
        )
      )
      .get()

    if (duplicate && duplicate.id !== existing.id) {
      return GenericError.Message(`Package ${buildScriptPackageDisplayName(normalized)} already exists in this workspace`)
    }

    db.update(scriptPackages)
      .set({
        typesPackageName: normalized.typesPackageName,
        typesPackageVersion: normalized.typesPackageVersion,
      })
      .where(eq(scriptPackages.id, existing.id))
      .run()

    return Result.Success(
      toScriptPackageRecord({
        ...existing,
        typesPackageName: normalized.typesPackageName,
        typesPackageVersion: normalized.typesPackageVersion,
      })
    )
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function listScriptPackagesByPackageName(packageName: string) {
  const db = getDb()
  const normalizedPackageName = normalizeScriptPackageName(packageName)

  return db
    .select()
    .from(scriptPackages)
    .where(and(eq(scriptPackages.packageName, normalizedPackageName), isNull(scriptPackages.deletedAt)))
    .orderBy(scriptPackages.packageVersion, desc(scriptPackages.createdAt))
    .all()
    .map(toScriptPackageRecord)
}

export async function findMatchingScriptPackage(input: {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
}) {
  const db = getDb()
  const normalized = normalizeScriptPackageInput(input)

  const row = db
    .select()
    .from(scriptPackages)
    .where(
      and(
        eq(scriptPackages.packageName, normalized.packageName),
        eq(scriptPackages.packageVersion, normalized.packageVersion),
        normalized.typesPackageName === null
          ? isNull(scriptPackages.typesPackageName)
          : eq(scriptPackages.typesPackageName, normalized.typesPackageName),
        normalized.typesPackageVersion === null
          ? isNull(scriptPackages.typesPackageVersion)
          : eq(scriptPackages.typesPackageVersion, normalized.typesPackageVersion),
        isNull(scriptPackages.deletedAt)
      )
    )
    .get()

  return row ? toScriptPackageRecord(row) : null
}

export async function listScriptPackageCandidatesForSpecifier(packageName: string) {
  const db = getDb()
  const normalizedPackageName = normalizeScriptPackageName(packageName)

  return db
    .select()
    .from(scriptPackages)
    .where(and(eq(scriptPackages.packageName, normalizedPackageName), isNull(scriptPackages.deletedAt)))
    .all()
    .map(toScriptPackageRecord)
}

export function buildScriptPackageDisplayName(input: {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
}) {
  const primary = `${input.packageName}@${input.packageVersion}`
  if (!input.typesPackageName || !input.typesPackageVersion) {
    return primary
  }

  return `${primary} + ${input.typesPackageName}@${input.typesPackageVersion}`
}

export function toScriptPackageCacheKey(record: Pick<ScriptPackageRecord, 'packageName' | 'packageVersion' | 'typesPackageName' | 'typesPackageVersion'>) {
  return buildScriptPackageCacheKey(record)
}

function normalizeScriptPackageInput(input: {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
}) {
  return {
    packageName: normalizeScriptPackageName(input.packageName),
    packageVersion: normalizeScriptPackageVersion(input.packageVersion),
    typesPackageName: input.typesPackageName ? normalizeScriptPackageName(input.typesPackageName) : null,
    typesPackageVersion: input.typesPackageVersion ? normalizeScriptPackageVersion(input.typesPackageVersion) : null,
  }
}

function validateScriptPackageInput(input: {
  packageName: string
  packageVersion: string
  typesPackageName: string | null
  typesPackageVersion: string | null
}) {
  if (!input.packageName) {
    return 'Package name is required'
  }

  if (!input.packageVersion || !isExactScriptPackageVersion(input.packageVersion)) {
    return 'Package version must be an exact version'
  }

  if ((input.typesPackageName === null) !== (input.typesPackageVersion === null)) {
    return 'Types package name and version must both be provided'
  }

  if (input.typesPackageVersion && !isExactScriptPackageVersion(input.typesPackageVersion)) {
    return 'Types package version must be an exact version'
  }

  return null
}

function toScriptPackageRecord(row: ScriptPackageRow): ScriptPackageRecord {
  return {
    id: row.id,
    packageName: row.packageName,
    packageVersion: row.packageVersion,
    typesPackageName: row.typesPackageName,
    typesPackageVersion: row.typesPackageVersion,
    createdAt: row.createdAt,
    deletedAt: row.deletedAt,
  }
}
