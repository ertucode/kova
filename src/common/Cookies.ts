export type CookieSameSite = 'strict' | 'lax' | 'none'

export type CookieRecord = {
  id: string
  name: string
  value: string
  domain: string
  path: string
  hostOnly: boolean
  secure: boolean
  httpOnly: boolean
  sameSite: CookieSameSite | null
  expiresAt: number | null
  createdAt: number
  updatedAt: number
}

export type CreateCookieInput = {
  name: string
  value: string
  domain: string
  path: string
  hostOnly: boolean
  secure: boolean
  httpOnly: boolean
  sameSite: CookieSameSite | null
  expiresAt: number | null
}

export type UpdateCookieInput = CreateCookieInput & {
  id: string
}

export type DeleteCookieInput = {
  id: string
}

export type ClearCookiesInput = {
  domain?: string
}
