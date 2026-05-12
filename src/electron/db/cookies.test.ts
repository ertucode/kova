import { describe, expect, it } from 'vitest'
import { cookieMatchesUrl, getSetCookieHeaderValuesFromEntries, parseSetCookieHeader } from './cookies.js'

describe('parseSetCookieHeader', () => {
  it('parses host-only cookies with default path', () => {
    const parsed = parseSetCookieHeader('session=abc123; HttpOnly; Secure; SameSite=Lax', new URL('https://api.example.com/users/42'))

    expect(parsed).toEqual({
      name: 'session',
      value: 'abc123',
      domain: 'api.example.com',
      path: '/users',
      hostOnly: true,
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      expiresAt: null,
    })
  })

  it('resolves domain cookies and max-age expiration', () => {
    const parsed = parseSetCookieHeader('theme=dark; Domain=.example.com; Path=/app; Max-Age=60', new URL('https://api.example.com/app/page'), 1_000)

    expect(parsed).toEqual({
      name: 'theme',
      value: 'dark',
      domain: 'example.com',
      path: '/app',
      hostOnly: false,
      secure: false,
      httpOnly: false,
      sameSite: null,
      expiresAt: 61_000,
    })
  })

  it('rejects cookies for unrelated domains', () => {
    const parsed = parseSetCookieHeader('theme=dark; Domain=elsewhere.com', new URL('https://api.example.com/app/page'))
    expect(parsed).toBeNull()
  })
})

describe('getSetCookieHeaderValuesFromEntries', () => {
  it('splits a combined set-cookie header entry', () => {
    expect(
      getSetCookieHeaderValuesFromEntries([
        [
          'set-cookie',
          'investag-auth=token; Domain=v2-api.investag.co; Path=/; Secure; SameSite=None; HttpOnly, theme=dark; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
        ],
      ])
    ).toEqual([
      'investag-auth=token; Domain=v2-api.investag.co; Path=/; Secure; SameSite=None; HttpOnly',
      'theme=dark; Expires=Wed, 21 Oct 2026 07:28:00 GMT; Path=/',
    ])
  })

  it('extracts set-cookie values from header entries', () => {
    expect(
      getSetCookieHeaderValuesFromEntries([
        ['content-type', 'application/json'],
        [
          'set-cookie',
          'investag-auth=token; Domain=v2-api.investag.co; Path=/; Secure; SameSite=None; HttpOnly',
        ],
      ])
    ).toEqual(['investag-auth=token; Domain=v2-api.investag.co; Path=/; Secure; SameSite=None; HttpOnly'])
  })
})

describe('cookieMatchesUrl', () => {
  it('matches domain cookies across subdomains and path prefixes', () => {
    expect(
      cookieMatchesUrl(
        {
          domain: 'example.com',
          path: '/api',
          hostOnly: false,
          secure: false,
          expiresAt: null,
        },
        new URL('https://sub.example.com/api/users')
      )
    ).toBe(true)
  })

  it('does not send secure cookies over http', () => {
    expect(
      cookieMatchesUrl(
        {
          domain: 'example.com',
          path: '/',
          hostOnly: true,
          secure: true,
          expiresAt: null,
        },
        new URL('http://example.com/')
      )
    ).toBe(false)
  })

  it('does not match sibling paths', () => {
    expect(
      cookieMatchesUrl(
        {
          domain: 'example.com',
          path: '/api',
          hostOnly: true,
          secure: false,
          expiresAt: null,
        },
        new URL('https://example.com/apiv2')
      )
    ).toBe(false)
  })
})
