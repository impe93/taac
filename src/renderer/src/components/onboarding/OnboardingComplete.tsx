import { type FC } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Separator } from '@renderer/components/ui/separator'
import type { OnboardingAction, OnboardingState } from './OnboardingWizard'

interface OnboardingCompleteProps {
  state: OnboardingState
  dispatch: React.Dispatch<OnboardingAction>
}

export const OnboardingComplete: FC<OnboardingCompleteProps> = ({ state }) => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const handleComplete = async (): Promise<void> => {
    await window.config.set('onboardingCompleted', true)
    queryClient.setQueryData(['config', 'onboardingCompleted'], true)

    const spaces = await window.space.list()
    if (spaces.length === 0) {
      await window.space.create('Personal', 'Home')
    }

    const activeSpaceId = await window.config.get('activeSpaceId')
    if (!activeSpaceId) {
      const currentSpaces = await window.space.list()
      if (currentSpaces.length > 0) {
        await window.config.set('activeSpaceId', currentSpaces[0].id)
        queryClient.setQueryData(['config', 'activeSpaceId'], currentSpaces[0].id)
      }
    }

    navigate({ to: '/' })
  }

  const importSummary = state.import.skipped
    ? 'Skipped'
    : state.import.importResult
      ? `${state.import.importResult.importedNotes} notes in ${state.import.importResult.importedFolders} folders imported`
      : 'Skipped'

  const modelsSummary =
    state.models.chatModelDownloaded || state.models.embeddingModelDownloaded
      ? 'Downloaded'
      : 'Skipped'

  return (
    <div className="flex flex-col items-center space-y-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <CheckCircle2 className="size-8 text-primary" />
      </div>

      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">You&apos;re all set!</h1>
        <p className="text-muted-foreground">
          Your notes are ready and AI is set up. Start writing, searching, and exploring.
        </p>
      </div>

      <Card className="w-full">
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Import</span>
            <span className="text-sm font-medium">{importSummary}</span>
          </div>
          <Separator />
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">AI Models</span>
            <span className="text-sm font-medium">{modelsSummary}</span>
          </div>
        </CardContent>
      </Card>

      <Button size="lg" onClick={handleComplete}>
        Start Using TaacNotes
      </Button>
    </div>
  )
}
