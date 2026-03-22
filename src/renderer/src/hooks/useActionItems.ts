import { useState, useCallback } from 'react'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { updateNote, selectActiveSpaceId } from '@renderer/store/slices/notesTreeSlice'
import type { ActionItem, MeetingMetadata } from '@preload/types'

interface UseActionItemsReturn {
  actionItems: ActionItem[]
  toggleItem: (itemId: string) => Promise<void>
  isUpdating: boolean
}

export function useActionItems(
  noteId: string,
  folderId: string,
  initialActionItems: ActionItem[],
  metadata: MeetingMetadata
): UseActionItemsReturn {
  const dispatch = useAppDispatch()
  const activeSpaceId = useAppSelector(selectActiveSpaceId)
  const [actionItems, setActionItems] = useState<ActionItem[]>(initialActionItems)
  const [isUpdating, setIsUpdating] = useState(false)

  const toggleItem = useCallback(
    async (itemId: string): Promise<void> => {
      if (!activeSpaceId || isUpdating) return

      const updatedItems = actionItems.map((item) =>
        item.id === itemId ? { ...item, completed: !item.completed } : item
      )

      // Optimistic update
      setActionItems(updatedItems)
      setIsUpdating(true)

      try {
        const updatedMetadata: MeetingMetadata = { ...metadata, actionItems: updatedItems }
        await dispatch(
          updateNote({
            spaceId: activeSpaceId,
            folderId,
            noteId,
            updates: { meetingMetadata: updatedMetadata }
          })
        ).unwrap()
      } catch (error) {
        // Rollback on failure
        setActionItems(actionItems)
        console.error('Failed to toggle action item:', error)
      } finally {
        setIsUpdating(false)
      }
    },
    [dispatch, activeSpaceId, folderId, noteId, actionItems, metadata, isUpdating]
  )

  return { actionItems, toggleItem, isUpdating }
}
