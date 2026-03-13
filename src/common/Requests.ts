export type RequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'

export type RequestBodyType = 'raw' | 'form-data' | 'x-www-form-urlencoded' | 'none'

export type RequestRawType = 'json' | 'text'

export type HttpRequestRecord = {
  id: string
  name: string
  method: RequestMethod
  url: string
  preRequestScript: string
  postRequestScript: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
  createdAt: number
  deletedAt: number | null
}

export type CreateRequestInput = {
  parentFolderId: string | null
  name: string
}

export type GetRequestInput = {
  id: string
}

export type UpdateRequestInput = {
  id: string
  name: string
  method: RequestMethod
  url: string
  preRequestScript: string
  postRequestScript: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
}

export type DeleteRequestInput = {
  id: string
}

export type SendRequestInput = {
  method: RequestMethod
  url: string
  headers: string
  body: string
  bodyType: RequestBodyType
  rawType: RequestRawType
}

export type SendRequestResponse = {
  status: number
  statusText: string
  headers: string
  body: string
  durationMs: number
}
