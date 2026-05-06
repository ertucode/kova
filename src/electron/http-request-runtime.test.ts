import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildCurlCommand, buildFetchSnippet, buildResolvedRequestBody } from './http-request-runtime.js'

describe('buildResolvedRequestBody', () => {
  it('treats empty trimmed raw JSON bodies as no body', async () => {
    const result = await buildResolvedRequestBody(
      {
        bodyType: 'raw',
        body: '  \n\t  ',
        rawType: 'json',
      },
      {}
    )

    expect(result).toEqual({ success: true, data: { kind: 'none' } })
  })

  it('normalizes valid raw JSON5 bodies', async () => {
    const result = await buildResolvedRequestBody(
      {
        bodyType: 'raw',
        body: "{foo:'bar', trailing:[1,2,],}",
        rawType: 'json',
      },
      {}
    )

    expect(result).toEqual({ success: true, data: { kind: 'raw', value: '{"foo":"bar","trailing":[1,2]}' } })
  })

  it('rejects invalid raw JSON bodies', async () => {
    const result = await buildResolvedRequestBody(
      {
        bodyType: 'raw',
        body: '{',
        rawType: 'json',
      },
      {}
    )

    expect(result.success).toBe(false)
    if (result.success) {
      throw new Error('Expected invalid JSON body to fail')
    }

    expect(result.error).toEqual({ type: 'message', message: 'Invalid JSON body: JSON5: invalid end of input at 1:2' })
  })

  it('resolves form-data text and file entries', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'kova-http-request-runtime-'))
    const filePath = path.join(tempDirectory, 'avatar.txt')
    await writeFile(filePath, 'hello file')

    try {
      const result = await buildResolvedRequestBody(
        {
          bodyType: 'form-data',
          body: `name:text:Ada\navatar:file:${filePath}`,
          rawType: 'json',
        },
        {}
      )

      expect(result.success).toBe(true)
      if (!result.success) {
        throw new Error('Expected form-data body to resolve')
      }

      expect(result.data).toEqual({
        kind: 'form-data',
        entries: [
          { key: 'name', type: 'text', value: 'Ada' },
          {
            key: 'avatar',
            type: 'file',
            value: filePath,
            fileName: 'avatar.txt',
            bytes: expect.any(Uint8Array),
          },
        ],
      })
    } finally {
      await rm(tempDirectory, { recursive: true, force: true })
    }
  })

  it('builds curl and fetch snippets for file form-data', async () => {
    const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'kova-http-request-codegen-'))
    const filePath = path.join(tempDirectory, 'avatar.txt')
    await writeFile(filePath, 'hello file')

    try {
      const resolvedBody = await buildResolvedRequestBody(
        {
          bodyType: 'form-data',
          body: `name:text:Ada\navatar:file:${filePath}`,
          rawType: 'json',
        },
        {}
      )

      if (!resolvedBody.success || resolvedBody.data.kind !== 'form-data') {
        throw new Error('Expected form-data body to resolve')
      }

      const curl = buildCurlCommand({
        method: 'POST',
        url: 'https://api.example.com/upload',
        headers: new Headers(),
        resolvedBody: resolvedBody.data,
      })

      const fetchSnippet = await buildFetchSnippet({
        method: 'POST',
        url: 'https://api.example.com/upload',
        headers: new Headers(),
        resolvedBody: resolvedBody.data,
      })

      expect(curl).toContain(`avatar=@${filePath}`)
      expect(fetchSnippet).toContain('const decodeBase64 = value => Uint8Array.from(atob(value), character => character.charCodeAt(0))')
      expect(fetchSnippet).toContain('new File([formDataFileBytes1], "avatar.txt")')
      expect(fetchSnippet).toContain('formData.append("name", "Ada")')
    } finally {
      await rm(tempDirectory, { recursive: true, force: true })
    }
  })
})
