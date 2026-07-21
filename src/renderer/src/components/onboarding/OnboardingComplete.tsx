import { type FC } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2 } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Card, CardContent } from '@renderer/components/ui/card'
import { Separator } from '@renderer/components/ui/separator'
import { useAppDispatch } from '@renderer/store/hooks'
import { switchActiveSpace, loadTree } from '@renderer/store/slices/notesTreeSlice'
import type { OnboardingAction, OnboardingState } from './OnboardingWizard'

interface OnboardingCompleteProps {
  state: OnboardingState
  dispatch: React.Dispatch<OnboardingAction>
}

export const OnboardingComplete: FC<OnboardingCompleteProps> = ({ state }) => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const dispatch = useAppDispatch()

  const handleComplete = async (): Promise<void> => {
    await window.config.set('onboardingCompleted', true)
    queryClient.setQueryData(['config', 'onboardingCompleted'], true)

    let spaces = await window.space.list()
    if (spaces.length === 0) {
      await window.space.create('Personal', 'Home')
      spaces = await window.space.list()
    }

    let activeSpaceId = await window.config.get('activeSpaceId')
    if (!activeSpaceId && spaces.length > 0) {
      activeSpaceId = spaces[0].id
      await window.config.set('activeSpaceId', activeSpaceId)
      queryClient.setQueryData(['config', 'activeSpaceId'], activeSpaceId)
    }

    // Sync Redux state so the sidebar tree is populated immediately after navigation,
    // without requiring a full app restart (ReduxInitializer only runs once on mount).
    if (activeSpaceId) {
      dispatch(switchActiveSpace(activeSpaceId))
      dispatch(loadTree({ spaceId: activeSpaceId }))
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
        <h1 className="font-serif text-4xl font-normal tracking-tight">You&apos;re all set!</h1>
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
        Start Using Taac
      </Button>
    </div>
  )
}
