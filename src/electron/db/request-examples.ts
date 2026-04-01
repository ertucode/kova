import { and, asc, eq, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type { RequestBodyType, RequestRawType } from '../../common/Requests.js'
import type {
  CreateRequestExampleInput,
  DeleteRequestExampleInput,
  GetRequestExampleInput,
  MoveRequestExampleInput,
  RequestExampleRecord,
  UpdateRequestExampleInput,
} from '../../common/RequestExamples.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { requestExamples, requests } from './schema.js'

type RequestExampleRow = typeof requestExamples.$inferSelect

export async function createRequestExample(input: CreateRequestExampleInput): Promise<GenericResult<RequestExampleRecord>> {
  const db = getDb()
  const name = input.name.trim()
  if (!name) {
    return GenericError.Message('Example name is required')
  }

  try {
    const item = db.transaction(tx => {
      ensureRequestExists(tx, input.requestId)
      const position = getNextExamplePosition(tx, input.requestId)
      const now = Date.now()
      const row: RequestExampleRow = {
        id: crypto.randomUUID(),
        requestId: input.requestId,
        name,
        position,
        requestHeaders: input.requestHeaders,
        requestBody: input.requestBody,
        requestBodyType: input.requestBodyType,
        requestRawType: input.requestRawType,
        responseStatus: input.responseStatus,
        responseStatusText: input.responseStatusText,
        responseHeaders: input.responseHeaders,
        responseBody: input.responseBody,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }
      tx.insert(requestExamples).values(row).run()
      return row
    })

    return Result.Success(toRequestExampleRecord(item))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function getRequestExample(input: GetRequestExampleInput): Promise<GenericResult<RequestExampleRecord>> {
  const db = getDb()
  try {
    const row = db.select().from(requestExamples).where(and(eq(requestExamples.id, input.id), isNull(requestExamples.deletedAt))).get()
    if (!row) {
      return GenericError.Message('Example not found')
    }
    return Result.Success(toRequestExampleRecord(row))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateRequestExample(input: UpdateRequestExampleInput): Promise<GenericResult<RequestExampleRecord>> {
  const db = getDb()
  const name = input.name.trim()
  if (!name) {
    return GenericError.Message('Example name is required')
  }

  try {
    const result = db.update(requestExamples).set({
      name,
      requestHeaders: input.requestHeaders,
      requestBody: input.requestBody,
      requestBodyType: input.requestBodyType,
      requestRawType: input.requestRawType,
      responseStatus: input.responseStatus,
      responseStatusText: input.responseStatusText,
      responseHeaders: input.responseHeaders,
      responseBody: input.responseBody,
      updatedAt: Date.now(),
    }).where(and(eq(requestExamples.id, input.id), isNull(requestExamples.deletedAt))).run()

    if (result.changes === 0) {
      return GenericError.Message('Example not found')
    }

    const row = db.select().from(requestExamples).where(and(eq(requestExamples.id, input.id), isNull(requestExamples.deletedAt))).get()
    if (!row) {
      return GenericError.Message('Example not found')
    }

    return Result.Success(toRequestExampleRecord(row))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteRequestExample(input: DeleteRequestExampleInput): Promise<GenericResult<void>> {
  const db = getDb()
  try {
    const result = db.update(requestExamples).set({ deletedAt: Date.now() }).where(and(eq(requestExamples.id, input.id), isNull(requestExamples.deletedAt))).run()
    if (result.changes === 0) {
      return GenericError.Message('Example not found')
    }
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function moveRequestExample(input: MoveRequestExampleInput): Promise<GenericResult<void>> {
  const db = getDb()
  try {
    db.transaction(tx => {
      const rows = tx.select().from(requestExamples)
        .where(and(eq(requestExamples.requestId, input.requestId), isNull(requestExamples.deletedAt)))
        .orderBy(asc(requestExamples.position), asc(requestExamples.createdAt))
        .all()

      const currentIndex = rows.findIndex(row => row.id === input.id)
      if (currentIndex < 0) {
        throw new Error('Example not found')
      }

      const [current] = rows.splice(currentIndex, 1)
      const targetIndex = Math.max(0, Math.min(input.targetPosition, rows.length))
      rows.splice(targetIndex, 0, current)

      rows.forEach((row, index) => {
        tx.update(requestExamples).set({ position: index }).where(eq(requestExamples.id, row.id)).run()
      })
    })

    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function listRequestExamplesByRequestIds(requestIds: string[]) {
  if (requestIds.length === 0) {
    return [] as RequestExampleRecord[]
  }

  const db = getDb()
  const rows = db.select().from(requestExamples)
    .where(isNull(requestExamples.deletedAt))
    .orderBy(asc(requestExamples.requestId), asc(requestExamples.position), asc(requestExamples.createdAt))
    .all()
    .filter(row => requestIds.includes(row.requestId))

  return rows.map(toRequestExampleRecord)
}

export function markRequestExamplesDeleted(requestId: string, deletedAt: number, db: ReturnType<typeof getDb> = getDb()) {
  db.update(requestExamples).set({ deletedAt }).where(and(eq(requestExamples.requestId, requestId), isNull(requestExamples.deletedAt))).run()
}

function ensureRequestExists(db: ReturnType<typeof getDb>, requestId: string) {
  const request = db.select({ id: requests.id }).from(requests).where(and(eq(requests.id, requestId), isNull(requests.deletedAt))).get()
  if (!request) {
    throw new Error('Request not found')
  }
}

function getNextExamplePosition(db: ReturnType<typeof getDb>, requestId: string) {
  return db.select({ id: requestExamples.id }).from(requestExamples)
    .where(and(eq(requestExamples.requestId, requestId), isNull(requestExamples.deletedAt)))
    .all().length
}

function toRequestExampleRecord(row: RequestExampleRow): RequestExampleRecord {
  return {
    id: row.id,
    requestId: row.requestId,
    name: row.name,
    position: row.position,
    requestHeaders: row.requestHeaders,
    requestBody: row.requestBody,
    requestBodyType: row.requestBodyType as RequestBodyType,
    requestRawType: row.requestRawType as RequestRawType,
    responseStatus: row.responseStatus,
    responseStatusText: row.responseStatusText,
    responseHeaders: row.responseHeaders,
    responseBody: row.responseBody,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    deletedAt: row.deletedAt,
  }
}
