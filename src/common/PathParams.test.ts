import { describe, expect, it } from 'vitest'
import {
  applyPathParamsToUrl,
  applySearchParamsToUrl,
  extractPathParamNames,
  syncPathParamsWithUrl,
  syncSearchParamsWithUrl,
  syncUrlWithPathParams,
  syncUrlWithSearchParams,
} from './PathParams.js'

describe('PathParams', () => {
  it('extracts unique path param names from the URL path', () => {
    expect(extractPathParamNames('https://api.example.com/users/:userId/orders/:orderId?tab=1')).toEqual(['userId', 'orderId'])
  })

  it('syncs path param rows from URL placeholders while preserving values', () => {
    expect(syncPathParamsWithUrl('https://api.example.com/users/:userId/orders/:orderId', 'userId:42 // Primary user')).toBe(
      'userId:42 // Primary user\norderId:'
    )
  })

  it('syncs URL placeholders from path param rows', () => {
    expect(syncUrlWithPathParams('https://api.example.com/users/:userId', 'accountId:42\norderId:55')).toBe(
      'https://api.example.com/users/:accountId/:orderId'
    )
  })

  it('resolves path params and reports empty values', () => {
    expect(applyPathParamsToUrl('https://api.example.com/users/:userId/orders/:orderId', 'userId:42\norderId:')).toEqual({
      url: 'https://api.example.com/users/42/orders/:orderId',
      missingNames: ['orderId'],
    })
  })

  it('syncs search param rows from the URL query string while preserving descriptions', () => {
    expect(syncSearchParamsWithUrl('https://api.example.com/users?page=2&sort=desc', 'page:1 // Pagination')).toBe(
      'page:2 // Pagination\nsort:desc'
    )
  })

  it('keeps existing search param row order stable while syncing URL values', () => {
    expect(syncSearchParamsWithUrl('https://api.example.com/users?sort=desc', 'page:1\nsort:asc\nfilter:active')).toBe(
      'page:1\nsort:desc\nfilter:active'
    )
  })

  it('appends newly introduced URL search params after existing rows', () => {
    expect(syncSearchParamsWithUrl('https://api.example.com/users?sort=desc&page=2', 'filter:active\nsort:asc')).toBe(
      'filter:active\nsort:desc\npage:2'
    )
  })

  it('syncs the URL query string from search param rows', () => {
    expect(syncUrlWithSearchParams('https://api.example.com/users?old=1#hash', 'page:2\n//hidden:3\nsort:desc')).toBe(
      'https://api.example.com/users?page=2&sort=desc#hash'
    )
  })

  it('applies stored search params to the URL', () => {
    expect(applySearchParamsToUrl('https://api.example.com/users#hash', 'page:{{page}}\nsort:desc', { page: '2' })).toBe(
      'https://api.example.com/users?page=2&sort=desc#hash'
    )
  })
})
