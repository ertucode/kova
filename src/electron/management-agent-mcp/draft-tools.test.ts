import { describe, expect, it } from 'vitest'
import { createEmptyManagementAgentPlan } from '../../common/ManagementAgent.js'
import { removeFolderCreationFromDraft } from './draft-tools.js'

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
})
