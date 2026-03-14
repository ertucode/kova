import type { RequestBodyType, RequestRawType } from './Requests.js'

export type RequestExampleRecord = {
  id: string
  requestId: string
  name: string
  position: number
  requestHeaders: string
  requestBody: string
  requestBodyType: RequestBodyType
  requestRawType: RequestRawType
  responseStatus: number
  responseStatusText: string
  responseHeaders: string
  responseBody: string
  createdAt: number
  updatedAt: number
  deletedAt: number | null
}

export type CreateRequestExampleInput = {
  requestId: string
  name: string
  requestHeaders: string
  requestBody: string
  requestBodyType: RequestBodyType
  requestRawType: RequestRawType
  responseStatus: number
  responseStatusText: string
  responseHeaders: string
  responseBody: string
}

export type GetRequestExampleInput = {
  id: string
}

export type UpdateRequestExampleInput = {
  id: string
  name: string
  requestHeaders: string
  requestBody: string
  requestBodyType: RequestBodyType
  requestRawType: RequestRawType
  responseStatus: number
  responseStatusText: string
  responseHeaders: string
  responseBody: string
}

export type DeleteRequestExampleInput = {
  id: string
}

export type MoveRequestExampleInput = {
  id: string
  requestId: string
  targetPosition: number
}
