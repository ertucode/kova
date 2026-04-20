import { describe, expect, it } from 'vitest'
import { buildPastedValue, isFullValueReplacement } from './urlPaste'

describe('urlPaste', () => {
  it('replaces the selected URL segment and preserves the trailing suffix', () => {
    expect(
      buildPastedValue({
        value: 'https://jsonplaceholder.typicode.com/posts?userId=1&key=value',
        pasteText: 'https://jsonplaceholder.typicode.com/posts?userId=2',
        selectionFrom: 0,
        selectionTo: 'https://jsonplaceholder.typicode.com/posts?userId=1'.length,
      })
    ).toBe('https://jsonplaceholder.typicode.com/posts?userId=2&key=value')
  })

  it('replaces a middle selection with different pasted text', () => {
    expect(
      buildPastedValue({
        value: 'https://api.example.com/users/123/orders?limit=10',
        pasteText: 'accounts/456',
        selectionFrom: 'https://api.example.com/'.length,
        selectionTo: 'https://api.example.com/users/123'.length,
      })
    ).toBe('https://api.example.com/accounts/456/orders?limit=10')
  })

  it('detects when paste replaces the whole value', () => {
    expect(
      isFullValueReplacement({
        value: 'https://api.example.com/users?page=1',
        selectionFrom: 0,
        selectionTo: 'https://api.example.com/users?page=1'.length,
      })
    ).toBe(true)
  })

  it('does not treat partial selection replacement as full replacement', () => {
    expect(
      isFullValueReplacement({
        value: 'https://api.example.com/users?page=1&sort=desc',
        selectionFrom: 0,
        selectionTo: 'https://api.example.com/users?page=1'.length,
      })
    ).toBe(false)
  })
})
