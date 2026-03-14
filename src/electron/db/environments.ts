import { and, desc, eq, inArray, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  CreateEnvironmentInput,
  DeleteEnvironmentInput,
  EnvironmentRecord,
  UpdateEnvironmentInput,
} from '../../common/Environments.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { environments } from './schema.js'

type EnvironmentRow = typeof environments.$inferSelect

export async function listEnvironments(): Promise<EnvironmentRecord[]> {
  const db = getDb()

  return db
    .select()
    .from(environments)
    .where(isNull(environments.deletedAt))
    .orderBy(desc(environments.priority), desc(environments.createdAt))
    .all()
    .map(toEnvironmentRecord)
}

export async function getEnvironmentsByIds(ids: string[]): Promise<EnvironmentRecord[]> {
  if (ids.length === 0) {
    return []
  }

  const db = getDb()
  return db
    .select()
    .from(environments)
    .where(and(inArray(environments.id, ids), isNull(environments.deletedAt)))
    .all()
    .map(toEnvironmentRecord)
}

export async function createEnvironment(input: CreateEnvironmentInput): Promise<GenericResult<EnvironmentRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Environment name is required')
  }

  try {
    const now = Date.now()
    const environment: EnvironmentRow = {
      id: crypto.randomUUID(),
      name,
      variables: '',
      priority: 0,
      createdAt: now,
      deletedAt: null,
    }

    db.insert(environments).values(environment).run()
    return Result.Success(toEnvironmentRecord(environment))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateEnvironment(input: UpdateEnvironmentInput): Promise<GenericResult<EnvironmentRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Environment name is required')
  }

  if (!Number.isInteger(input.priority)) {
    return GenericError.Message('Environment priority must be an integer')
  }

  try {
    const result = db
      .update(environments)
      .set({
        name,
        variables: input.variables,
        priority: input.priority,
      })
      .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Environment not found')
    }

    const environment = db
      .select()
      .from(environments)
      .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
      .get()

    if (!environment || environment.deletedAt !== null) {
      return GenericError.Message('Environment not found')
    }

    return Result.Success(toEnvironmentRecord(environment))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteEnvironment(input: DeleteEnvironmentInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    const result = db
      .update(environments)
      .set({ deletedAt: Date.now() })
      .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Environment not found')
    }

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateEnvironmentVariables(input: { id: string; variables: string }) {
  const db = getDb()

  const environment = db
    .select()
    .from(environments)
    .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
    .get()

  if (!environment || environment.deletedAt !== null) {
    throw new Error('Environment not found')
  }

  db.update(environments)
    .set({ variables: input.variables })
    .where(and(eq(environments.id, input.id), isNull(environments.deletedAt)))
    .run()

  return toEnvironmentRecord({ ...environment, variables: input.variables })
}

function toEnvironmentRecord(environment: EnvironmentRow): EnvironmentRecord {
  return {
    id: environment.id,
    name: environment.name,
    variables: environment.variables,
    priority: environment.priority,
    createdAt: environment.createdAt,
    deletedAt: environment.deletedAt,
  }
}
