import { and, eq, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  CreateRequestInput,
  DeleteRequestInput,
  GetRequestInput,
  HttpRequestRecord,
  RequestBodyType,
  RequestMethod,
  RequestRawType,
  UpdateRequestInput,
} from '../../common/Requests.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { requests } from './schema.js'
import { ensureParentFolderExists, insertTreeItem, markTreeItemDeleted } from './tree-items.js'

type RequestRow = typeof requests.$inferSelect

const REQUEST_METHODS: RequestMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
const REQUEST_BODY_TYPES: RequestBodyType[] = ['raw', 'form-data', 'x-www-form-urlencoded', 'none']
const REQUEST_RAW_TYPES: RequestRawType[] = ['json', 'text']

export async function createRequest(input: CreateRequestInput): Promise<GenericResult<HttpRequestRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Request name is required')
  }

  try {
    const request = db.transaction(tx => {
      ensureParentFolderExists(tx, input.parentFolderId)

      const now = Date.now()
      const request: RequestRow = {
        id: crypto.randomUUID(),
        name,
        method: 'GET',
        url: '',
        preRequestScript: '',
        postRequestScript: '',
        headers: '[]',
        body: '',
        bodyType: 'none',
        rawType: 'json',
        createdAt: now,
        deletedAt: null,
      }

      tx.insert(requests).values(request).run()
      insertTreeItem(tx, { parentFolderId: input.parentFolderId, itemType: 'request', itemId: request.id })
      return request
    })

    return Result.Success(toRequestRecord(request))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function getRequest(input: GetRequestInput): Promise<GenericResult<HttpRequestRecord>> {
  const db = getDb()

  try {
    const request = db
      .select()
      .from(requests)
      .where(and(eq(requests.id, input.id), isNull(requests.deletedAt)))
      .get()

    if (!request) {
      return GenericError.Message('Request not found')
    }

    return Result.Success(toRequestRecord(request))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function updateRequest(input: UpdateRequestInput): Promise<GenericResult<HttpRequestRecord>> {
  const db = getDb()
  const name = input.name.trim()

  if (!name) {
    return GenericError.Message('Request name is required')
  }

  if (!REQUEST_METHODS.includes(input.method)) {
    return GenericError.Message('Invalid request method')
  }

  if (!REQUEST_BODY_TYPES.includes(input.bodyType)) {
    return GenericError.Message('Invalid request body type')
  }

  if (!REQUEST_RAW_TYPES.includes(input.rawType)) {
    return GenericError.Message('Invalid request raw type')
  }

  try {
    const result = db
      .update(requests)
      .set({
        name,
        method: input.method,
        url: input.url,
        preRequestScript: input.preRequestScript,
        postRequestScript: input.postRequestScript,
        headers: input.headers,
        body: input.body,
        bodyType: input.bodyType,
        rawType: input.rawType,
      })
      .where(and(eq(requests.id, input.id), isNull(requests.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Request not found')
    }

    const request = db
      .select()
      .from(requests)
      .where(and(eq(requests.id, input.id), isNull(requests.deletedAt)))
      .get()

    if (!request) {
      return GenericError.Message('Request not found')
    }

    return Result.Success(toRequestRecord(request))
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function deleteRequest(input: DeleteRequestInput): Promise<GenericResult<void>> {
  const db = getDb()

  try {
    const now = Date.now()
    const result = db
      .update(requests)
      .set({ deletedAt: now })
      .where(and(eq(requests.id, input.id), isNull(requests.deletedAt)))
      .run()

    if (result.changes === 0) {
      return GenericError.Message('Request not found')
    }

    markTreeItemDeleted(db, { itemType: 'request', itemId: input.id, deletedAt: now })
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

function toRequestRecord(request: RequestRow): HttpRequestRecord {
  return {
    id: request.id,
    name: request.name,
    method: request.method as RequestMethod,
    url: request.url,
    preRequestScript: request.preRequestScript,
    postRequestScript: request.postRequestScript,
    headers: request.headers,
    body: request.body,
    bodyType: request.bodyType as RequestBodyType,
    rawType: request.rawType as RequestRawType,
    createdAt: request.createdAt,
    deletedAt: request.deletedAt,
  }
}
