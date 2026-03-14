import { createDefaultHttpAuth, parseHttpAuth, serializeHttpAuth } from '../../common/Auth.js'
import { and, eq, isNull } from 'drizzle-orm'
import { GenericError, type GenericResult } from '../../common/GenericError.js'
import type {
  CreateRequestInput,
  DeleteRequestInput,
  DuplicateRequestInput,
  GetRequestInput,
  HttpRequestRecord,
  RequestBodyType,
  RequestMethod,
  RequestRawType,
  UpdateRequestInput,
} from '../../common/Requests.js'
import { Result } from '../../common/Result.js'
import { getDb } from './index.js'
import { markRequestExamplesDeleted } from './request-examples.js'
import { requests, treeItems } from './schema.js'
import { ensureParentFolderExists, insertTreeItem, insertTreeItemAtPosition, markTreeItemDeleted } from './tree-items.js'

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
        pathParams: '',
        searchParams: '',
        authJson: serializeHttpAuth(createDefaultHttpAuth()),
        preRequestScript: '',
        postRequestScript: '',
        headers: '',
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
        pathParams: input.pathParams,
        searchParams: input.searchParams,
        authJson: serializeHttpAuth(input.auth),
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
    markRequestExamplesDeleted(input.id, now)
    return Result.Success(undefined)
  } catch (error) {
    return GenericError.Unknown(error)
  }
}

export async function duplicateRequest(input: DuplicateRequestInput): Promise<GenericResult<HttpRequestRecord>> {
  const db = getDb()

  try {
    const duplicated = db.transaction(tx => {
      const sourceRequest = tx
        .select()
        .from(requests)
        .where(and(eq(requests.id, input.id), isNull(requests.deletedAt)))
        .get()

      if (!sourceRequest) {
        throw new Error('Request not found')
      }

      const sourceTreeItem = tx
        .select({ rowId: treeItems.id, parentFolderId: treeItems.parentFolderId, position: treeItems.position })
        .from(treeItems)
        .where(and(eq(treeItems.itemType, 'request'), eq(treeItems.itemId, input.id), isNull(treeItems.deletedAt)))
        .get()

      if (!sourceTreeItem) {
        throw new Error('Request tree item not found')
      }

      const siblingTreeItems = tx
        .select({ rowId: treeItems.id })
        .from(treeItems)
        .where(
          sourceTreeItem.parentFolderId
            ? and(eq(treeItems.parentFolderId, sourceTreeItem.parentFolderId), isNull(treeItems.deletedAt))
            : and(isNull(treeItems.parentFolderId), isNull(treeItems.deletedAt))
        )
        .orderBy(treeItems.position, treeItems.createdAt)
        .all()
      const sourceIndex = siblingTreeItems.findIndex(sibling => sibling.rowId === sourceTreeItem.rowId)

      if (sourceIndex < 0) {
        throw new Error('Request tree item order not found')
      }

      const now = Date.now()
      const request: RequestRow = {
        ...sourceRequest,
        id: crypto.randomUUID(),
        name: buildDuplicateRequestName(tx, sourceTreeItem.parentFolderId, sourceRequest.name),
        createdAt: now,
        deletedAt: null,
      }

      tx.insert(requests).values(request).run()
      insertTreeItemAtPosition(tx, {
        parentFolderId: sourceTreeItem.parentFolderId,
        itemType: 'request',
        itemId: request.id,
        position: sourceIndex + 1,
      })
      return request
    })

    return Result.Success(toRequestRecord(duplicated))
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
    pathParams: request.pathParams,
    searchParams: request.searchParams,
    auth: parseHttpAuth(request.authJson),
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

function buildDuplicateRequestName(db: ReturnType<typeof getDb>, parentFolderId: string | null, sourceName: string) {
  const siblingRequestNames = db
    .select({ name: requests.name })
    .from(requests)
    .innerJoin(treeItems, and(eq(treeItems.itemId, requests.id), eq(treeItems.itemType, 'request'), isNull(treeItems.deletedAt)))
    .where(
      and(
        isNull(requests.deletedAt),
        parentFolderId ? eq(treeItems.parentFolderId, parentFolderId) : isNull(treeItems.parentFolderId)
      )
    )
    .all()
    .map(row => row.name)

  const baseName = sourceName.replace(/ \(\d+\)$/u, '')
  let index = 2

  while (siblingRequestNames.includes(`${baseName} (${index})`)) {
    index += 1
  }

  return `${baseName} (${index})`
}
