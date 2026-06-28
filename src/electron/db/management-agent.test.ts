import { beforeEach, describe, expect, it, vi } from 'vitest'

const deleteFolderWithOperation = vi.fn()
const deleteRequestWithOperation = vi.fn()

vi.mock('./folders.js', () => ({
  deleteFolderWithOperation,
}))

vi.mock('./requests.js', () => ({
  deleteRequestWithOperation,
}))

describe('management-agent delete helpers', () => {
  beforeEach(() => {
    deleteFolderWithOperation.mockReset()
    deleteRequestWithOperation.mockReset()
  })

  it('routes request plan deletions through the shared undoable delete helper', async () => {
    const { deleteRequestFromPlan } = await import('./management-agent.js')
    const tx = {} as never

    deleteRequestFromPlan(tx, 'request-1')

    expect(deleteRequestWithOperation).toHaveBeenCalledWith(tx, 'request-1')
  })

  it('routes folder plan deletions through the shared undoable delete helper', async () => {
    const { deleteFolderFromPlan } = await import('./management-agent.js')
    const tx = {} as never

    deleteFolderFromPlan(tx, 'folder-1')

    expect(deleteFolderWithOperation).toHaveBeenCalledWith(tx, 'folder-1')
  })
})
