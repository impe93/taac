import { type FC } from 'react'
import { Checkbox } from '@renderer/components/ui/checkbox'
import { cn } from '@renderer/lib/utils'
import { useActionItems } from '@renderer/hooks/useActionItems'
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
  actionItems: initialActionItems,
  metadata
}) => {
  const { actionItems, toggleItem, isUpdating } = useActionItems(
    noteId,
    folderId,
    initialActionItems,
    metadata
  )

  if (actionItems.length === 0) return null

  return (
    <div className="flex flex-col gap-2">
      {actionItems.map((item) => (
        <div key={item.id} className="flex items-start gap-3 py-1">
          <Checkbox
            id={`action-${item.id}`}
            checked={item.completed}
            onCheckedChange={() => toggleItem(item.id)}
            disabled={isUpdating}
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
