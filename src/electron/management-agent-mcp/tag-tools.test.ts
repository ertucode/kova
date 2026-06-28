import { describe, expect, it } from 'vitest'
import { createEmptyManagementAgentPlan } from '../../common/ManagementAgent.js'
import { removeTagCreationFromDraft } from './tag-tools.js'

describe('removeTagCreationFromDraft', () => {
  it('removes the planned tag creation and cleans dependent draft tag references', () => {
    const plan = {
      ...createEmptyManagementAgentPlan(),
      tagsToCreate: [
        { id: 'tag-planned', name: 'Planned', color: null },
        { id: 'tag-keep', name: 'Keep', color: '#fff' },
      ],
      itemTagUpdates: [
        { itemType: 'folder' as const, itemId: 'folder-1', tagIds: ['tag-planned', 'tag-keep'] },
        { itemType: 'request' as const, itemId: 'request-1', tagIds: ['tag-planned'] },
      ],
      tagItemUpdates: [
        { tagId: 'tag-planned', items: [{ itemType: 'folder' as const, itemId: 'folder-1' }] },
        { tagId: 'tag-keep', items: [{ itemType: 'request' as const, itemId: 'request-1' }] },
      ],
    }

    const result = removeTagCreationFromDraft(plan, 'tag-planned')

    expect(result.draft.tagsToCreate.map(tag => tag.id)).toEqual(['tag-keep'])
    expect(result.draft.itemTagUpdates).toEqual([
      { itemType: 'folder', itemId: 'folder-1', tagIds: ['tag-keep'] },
    ])
    expect(result.draft.tagItemUpdates).toEqual([
      { tagId: 'tag-keep', items: [{ itemType: 'request', itemId: 'request-1' }] },
    ])
    expect(result.result).toEqual({
      removedTagId: 'tag-planned',
      removedTagItemUpdateIds: ['tag-planned'],
      cleanedItemTagUpdateKeys: ['folder:folder-1', 'request:request-1'],
    })
  })

  it('throws when the planned tag creation does not exist', () => {
    expect(() => removeTagCreationFromDraft(createEmptyManagementAgentPlan(), 'missing-tag')).toThrow(
      'Planned tag creation not found.'
    )
  })
})
