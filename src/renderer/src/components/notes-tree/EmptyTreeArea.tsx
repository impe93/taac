import { type FC } from 'react'
import { EmptySpaceContextMenu } from './EmptySpaceContextMenu'

interface EmptyTreeAreaProps {
  onCreateNote: () => void
  onCreateFolder: () => void
  children: React.ReactNode
}

export const EmptyTreeArea: FC<EmptyTreeAreaProps> = ({
  onCreateNote,
  onCreateFolder,
  children
}) => {
  return (
    <EmptySpaceContextMenu onCreateNote={onCreateNote} onCreateFolder={onCreateFolder}>
      <div className="min-h-[200px] w-full">{children}</div>
    </EmptySpaceContextMenu>
  )
}
