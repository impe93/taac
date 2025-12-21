import { type FC, useState } from 'react'
import { Button } from '@renderer/components/ui/button'
import { useSpaces, useActiveSpace, useSwitchSpace } from '@renderer/hooks/useSpaces'
import { Plus } from 'lucide-react'
import * as Icons from 'lucide-react'
import { CreateSpaceDialog } from './create-space-dialog'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger
} from '@renderer/components/ui/tooltip'

export const SpaceSelector: FC = () => {
  const { data: spaces, isLoading } = useSpaces()
  const activeSpace = useActiveSpace()
  const switchSpace = useSwitchSpace()
  const [showCreateDialog, setShowCreateDialog] = useState(false)

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 mb-2">
        <div className="text-sm text-muted-foreground">Loading spaces...</div>
      </div>
    )
  }

  if (!spaces || spaces.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 mb-2">
        <Button variant="outline" size="sm" onClick={() => setShowCreateDialog(true)}>
          <Plus className="size-4 mr-2" />
          Create Space
        </Button>
        <CreateSpaceDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
      </div>
    )
  }

  return (
    <>
      <TooltipProvider>
        <div className="flex items-center justify-center gap-1 mb-2">
          {spaces.map((space) => {
            const Icon = (Icons[space.icon as keyof typeof Icons] || Icons.Home) as any
            const isActive = activeSpace?.id === space.id

            return (
              <Tooltip key={space.id}>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className={`size-8 hover:bg-accent/30 ${isActive ? 'text-foreground' : 'text-muted-foreground'}`}
                    onClick={() => switchSpace.mutate(space.id)}
                    disabled={switchSpace.isPending}
                  >
                    <Icon className="size-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>{space.name}</p>
                </TooltipContent>
              </Tooltip>
            )
          })}

          {spaces.length < 5 && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-8 text-muted-foreground hover:bg-accent/30"
                  onClick={() => setShowCreateDialog(true)}
                >
                  <Plus className="size-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top">
                <p>Create New Space</p>
              </TooltipContent>
            </Tooltip>
          )}
        </div>
      </TooltipProvider>

      <CreateSpaceDialog open={showCreateDialog} onOpenChange={setShowCreateDialog} />
    </>
  )
}
