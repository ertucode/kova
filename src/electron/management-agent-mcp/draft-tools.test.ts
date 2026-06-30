import { describe, expect, it } from 'vitest'
import { createEmptyManagementAgentPlan } from '../../common/ManagementAgent.js'
import {
  planFolderDeletionOnDraft,
  planFolderUpdateOnDraft,
  planRequestDeletionOnDraft,
  planRequestUpdateOnDraft,
  requestFieldChangesToUpdatePlanItem,
  removeFolderCreationFromDraft,
} from './draft-tools.js'

describe('removeFolderCreationFromDraft', () => {
  it('removes a planned folder subtree and planned requests within that subtree', () => {
    const plan = {
      ...createEmptyManagementAgentPlan(),
      foldersToCreate: [
        { id: 'folder-root', parentFolderId: null, parentScope: 'workspace-root' as const, name: 'Root' },
        { id: 'folder-child', parentFolderId: 'folder-root', name: 'Child' },
        { id: 'folder-other', parentFolderId: null, name: 'Other' },
      ],
      requestsToCreate: [
        {
          id: 'request-root',
          parentFolderId: 'folder-root',
          name: 'Root Request',
          method: 'GET' as const,
          url: 'https://example.com/root',
          pathParams: '',
          searchParams: '',
          auth: { type: 'inherit' as const },
          headers: '',
          body: '',
          bodyType: 'none' as const,
          rawType: 'json' as const,
          graphqlQuery: '',
          graphqlVariables: '',
          preRequestScript: '',
          postRequestScript: '',
          testScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw' as const,
          saveToHistory: true,
        },
        {
          id: 'request-child',
          parentFolderId: 'folder-child',
          name: 'Child Request',
          method: 'GET' as const,
          url: 'https://example.com/child',
          pathParams: '',
          searchParams: '',
          auth: { type: 'inherit' as const },
          headers: '',
          body: '',
          bodyType: 'none' as const,
          rawType: 'json' as const,
          graphqlQuery: '',
          graphqlVariables: '',
          preRequestScript: '',
          postRequestScript: '',
          testScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw' as const,
          saveToHistory: true,
        },
        {
          id: 'request-other',
          parentFolderId: 'folder-other',
          name: 'Other Request',
          method: 'GET' as const,
          url: 'https://example.com/other',
          pathParams: '',
          searchParams: '',
          auth: { type: 'inherit' as const },
          headers: '',
          body: '',
          bodyType: 'none' as const,
          rawType: 'json' as const,
          graphqlQuery: '',
          graphqlVariables: '',
          preRequestScript: '',
          postRequestScript: '',
          testScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw' as const,
          saveToHistory: true,
        },
      ],
    }

    const result = removeFolderCreationFromDraft(plan, 'folder-root')

    expect(result.draft.foldersToCreate.map(folder => folder.id)).toEqual(['folder-other'])
    expect(result.draft.requestsToCreate.map(request => request.id)).toEqual(['request-other'])
    expect(result.result).toEqual({
      removedFolderIds: ['folder-root', 'folder-child'],
      removedRequestIds: ['request-root', 'request-child'],
    })
  })

  it('throws when the planned folder creation does not exist', () => {
    expect(() => removeFolderCreationFromDraft(createEmptyManagementAgentPlan(), 'missing-folder')).toThrow(
      'Planned folder creation not found.'
    )
  })

  it('replaces a folder update and clears a conflicting planned folder deletion', () => {
    const plan = {
      ...createEmptyManagementAgentPlan(),
      foldersToDelete: [{ folderId: 'folder-1' }],
    }

    const result = planFolderUpdateOnDraft(plan, {
      folderId: 'folder-1',
      name: 'Users',
      description: 'Updated',
      headers: 'x-team:api',
      auth: { type: 'inherit' },
      preRequestScript: '',
      postRequestScript: '',
      runConfig: {
        selectionMode: 'tests-only',
        selectedRequestIds: [],
        executionMode: 'sequential',
        continueOnFailure: true,
      },
    })

    expect(result.draft.foldersToDelete).toEqual([])
    expect(result.draft.foldersToUpdate).toEqual([expect.objectContaining({ folderId: 'folder-1', name: 'Users' })])
  })

  it('plans a request deletion and clears a conflicting request update', () => {
    const plan = {
      ...createEmptyManagementAgentPlan(),
      requestsToUpdate: [
        {
          requestId: 'request-1',
          name: 'Old',
          method: 'GET' as const,
          url: 'https://example.com',
          pathParams: '',
          searchParams: '',
          auth: { type: 'inherit' as const },
          headers: '',
          body: '',
          bodyType: 'none' as const,
          rawType: 'json' as const,
          graphqlQuery: '',
          graphqlVariables: '',
          preRequestScript: '',
          postRequestScript: '',
          testScript: '',
          responseVisualizer: '',
          responseTableAccessor: '',
          preferredResponseBodyView: 'raw' as const,
          saveToHistory: true,
        },
      ],
    }

    const result = planRequestDeletionOnDraft(plan, 'request-1')

    expect(result.draft.requestsToUpdate).toEqual([])
    expect(result.draft.requestsToDelete).toEqual([{ requestId: 'request-1' }])
  })

  it('plans a folder deletion and clears a conflicting folder update', () => {
    const plan = {
      ...createEmptyManagementAgentPlan(),
      foldersToUpdate: [
        {
          folderId: 'folder-1',
          name: 'Users',
          description: '',
          headers: '',
          auth: { type: 'inherit' as const },
          preRequestScript: '',
          postRequestScript: '',
          runConfig: {
            selectionMode: 'tests-only' as const,
            selectedRequestIds: [],
            executionMode: 'sequential' as const,
            continueOnFailure: true,
          },
        },
      ],
    }

    const result = planFolderDeletionOnDraft(plan, 'folder-1')

    expect(result.draft.foldersToUpdate).toEqual([])
    expect(result.draft.foldersToDelete).toEqual([{ folderId: 'folder-1' }])
  })

  it('stores only the provided fields for a planned request patch', () => {
    const plan = createEmptyManagementAgentPlan()

    const result = planRequestUpdateOnDraft(
      plan,
      requestFieldChangesToUpdatePlanItem({
        requestId: 'request-1',
        changes: [
          { field: 'url', value: 'https://example.com/patched' },
          { field: 'preferredResponseBodyView', value: 'visualizer' },
        ],
      })
    )

    expect(result.draft.requestsToUpdate).toEqual([
      {
        requestId: 'request-1',
        url: 'https://example.com/patched',
        preferredResponseBodyView: 'visualizer',
      },
    ])
  })

  it('throws when the same request field is changed more than once', () => {
    expect(() =>
      requestFieldChangesToUpdatePlanItem({
        requestId: 'request-1',
        changes: [
          { field: 'url', value: 'https://example.com/one' },
          { field: 'url', value: 'https://example.com/two' },
        ],
      })
    ).toThrow('Duplicate request field change "url".')
  })
})
