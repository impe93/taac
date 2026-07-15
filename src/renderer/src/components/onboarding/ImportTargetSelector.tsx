import { type FC } from 'react'
import { ArrowLeft, FolderInput, Plus } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Input } from '@renderer/components/ui/input'
import { Label } from '@renderer/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { cn } from '@renderer/lib/utils'
import { useSpaces } from '@renderer/hooks/useSpaces'
import type { OnboardingAction, OnboardingState } from './OnboardingWizard'

interface ImportTargetSelectorProps {
  state: OnboardingState
  dispatch: React.Dispatch<OnboardingAction>
  onContinue: () => void
  onBack: () => void
}

export const ImportTargetSelector: FC<ImportTargetSelectorProps> = ({
  state,
  dispatch,
  onContinue,
  onBack
}) => {
  const { data: spaces } = useSpaces()

  const { targetMode, newSpaceName, source, targetSpaceId } = state.import
  const hasSpaces = spaces && spaces.length > 0
  const sourceLabel =
    source === 'apple-notes' ? 'Apple Notes' : source === 'joplin' ? 'Joplin' : 'Obsidian'

  const canContinue =
    (targetMode === 'new-space' && newSpaceName.trim().length > 0) ||
    (targetMode === 'existing-space' && targetSpaceId !== null)

  const handleSelectNewSpace = (): void => {
    dispatch({ type: 'SET_IMPORT_TARGET', mode: 'new-space' })
  }

  const handleSelectExistingSpace = (spaceId: string): void => {
    dispatch({ type: 'SET_IMPORT_TARGET', mode: 'existing-space', spaceId })
  }

  const handleSpaceNameChange = (name: string): void => {
    dispatch({ type: 'SET_NEW_SPACE_NAME', name })
  }

  const handleContinue = (): void => {
    onContinue()
  }

  const handleBack = (): void => {
    onBack()
  }

  return (
    <div className="flex flex-col items-center space-y-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <FolderInput className="size-8 text-primary" />
      </div>

      <div className="space-y-2">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Choose Destination</h1>
        <p className="text-lg text-muted-foreground">
          Where should your {sourceLabel} notes be imported?
        </p>
      </div>

      <div className="grid w-full gap-4">
        {/* Create new space */}
        <Card
          className={cn(
            'cursor-pointer text-left transition-colors',
            targetMode === 'new-space' && 'border-primary'
          )}
          onClick={handleSelectNewSpace}
        >
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Plus className="size-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Create new space</p>
                <p className="text-sm text-muted-foreground">
                  A dedicated space for your imported notes
                </p>
              </div>
            </div>

            {targetMode === 'new-space' && (
              <div className="grid gap-2" onClick={(e) => e.stopPropagation()}>
                <Label htmlFor="space-name">Space name</Label>
                <Input
                  id="space-name"
                  placeholder="e.g., Apple Notes, Obsidian"
                  value={newSpaceName}
                  onChange={(e) => handleSpaceNameChange(e.target.value)}
                  maxLength={50}
                />
              </div>
            )}
          </CardContent>
        </Card>

        {/* Add to existing space */}
        <Card
          className={cn(
            'text-left transition-colors',
            targetMode === 'existing-space' && 'border-primary',
            hasSpaces ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'
          )}
          onClick={() => {
            if (hasSpaces && spaces.length > 0) {
              handleSelectExistingSpace(targetSpaceId ?? spaces[0].id)
            }
          }}
        >
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center gap-3">
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <FolderInput className="size-5 text-primary" />
              </div>
              <div>
                <p className="font-semibold">Add to existing space</p>
                <p className="text-sm text-muted-foreground">
                  {hasSpaces
                    ? 'Import into one of your existing spaces'
                    : 'No existing spaces available'}
                </p>
              </div>
            </div>

            {targetMode === 'existing-space' && hasSpaces && (
              <div className="grid gap-2" onClick={(e) => e.stopPropagation()}>
                <Label htmlFor="space-select">Select space</Label>
                <Select
                  value={targetSpaceId ?? undefined}
                  onValueChange={(value) => handleSelectExistingSpace(value)}
                >
                  <SelectTrigger id="space-select" className="w-full">
                    <SelectValue placeholder="Choose a space..." />
                  </SelectTrigger>
                  <SelectContent>
                    {spaces.map((space) => (
                      <SelectItem key={space.id} value={space.id}>
                        {space.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="flex items-center gap-3">
        <Button variant="ghost" onClick={handleBack}>
          <ArrowLeft className="size-4" />
          Back
        </Button>
        <Button size="lg" onClick={handleContinue} disabled={!canContinue}>
          Continue
        </Button>
      </div>
    </div>
  )
}
