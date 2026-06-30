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

  it('updates only provided request fields when applying a request patch', async () => {
    const { updateRequestFromPlan } = await import('./management-agent.js')
    const run = vi.fn()
    const where = vi.fn(() => ({ run }))
    const set = vi.fn(() => ({ where }))
    const update = vi.fn(() => ({ set }))
    const tx = { update } as never

    updateRequestFromPlan(tx, {
      requestId: 'request-1',
      url: 'https://example.com/patched',
      preferredResponseBodyView: 'visualizer',
      saveToHistory: false,
    })

    expect(set).toHaveBeenCalledWith({
      url: 'https://example.com/patched',
      preferredResponseBodyView: 'visualizer',
      prefersResponseVisualizer: true,
      saveToHistory: false,
    })
    expect(run).toHaveBeenCalledTimes(1)
  })

  it('skips the database update when a request patch has no fields to write', async () => {
    const { updateRequestFromPlan } = await import('./management-agent.js')
    const set = vi.fn()
    const update = vi.fn(() => ({ set }))
    const tx = { update } as never

    updateRequestFromPlan(tx, { requestId: 'request-1' })

    expect(update).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })
})
