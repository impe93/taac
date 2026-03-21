import { type FC, useCallback } from 'react'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { cn } from '@renderer/lib/utils'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { updateNote, selectActiveSpaceId } from '@renderer/store/slices/notesTreeSlice'
import type { ActionItem, MeetingMetadata } from '@preload/types'

interface ActionItemsListProps {
  noteId: string
  folderId: string
  actionItems: ActionItem[]
  metadata: MeetingMetadata
}

export const ActionItemsList: FC<ActionItemsListProps> = ({
  noteId,
  folderId,
  actionItems,
  metadata
}) => {
  const dispatch = useAppDispatch()
  const activeSpaceId = useAppSelector(selectActiveSpaceId)

  const handleToggle = useCallback(
    async (itemId: string, completed: boolean): Promise<void> => {
      if (!activeSpaceId) return

      const updatedItems = actionItems.map((item) =>
        item.id === itemId ? { ...item, completed } : item
      )
      const updatedMetadata: MeetingMetadata = { ...metadata, actionItems: updatedItems }

      await dispatch(
        updateNote({
          spaceId: activeSpaceId,
          folderId,
          noteId,
          updates: { meetingMetadata: updatedMetadata }
        })
      )
    },
    [dispatch, activeSpaceId, folderId, noteId, actionItems, metadata]
  )

  if (actionItems.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {actionItems.map((item) => (
        <div key={item.id} className="flex items-start gap-3 py-1">
          <Checkbox
            id={`action-${item.id}`}
            checked={item.completed}
            onCheckedChange={(checked) => handleToggle(item.id, Boolean(checked))}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-0.5 flex-1 min-w-0">
            <label
              htmlFor={`action-${item.id}`}
              className={cn(
                'text-sm cursor-pointer',
                item.completed && 'line-through text-muted-foreground'
              )}
            >
              {item.text}
            </label>
            {item.assignee && (
              <span className="text-xs text-muted-foreground">{item.assignee}</span>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}
