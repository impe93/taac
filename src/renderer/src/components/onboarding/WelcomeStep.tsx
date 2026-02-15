import { type FC } from 'react'
import { NotebookPen } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import type { OnboardingAction } from './OnboardingWizard'

interface WelcomeStepProps {
  dispatch: React.Dispatch<OnboardingAction>
}

export const WelcomeStep: FC<WelcomeStepProps> = ({ dispatch }) => {
  const handleGetStarted = (): void => {
    dispatch({ type: 'NEXT_STEP' })
  }

  return (
    <div className="flex flex-col items-center space-y-6 text-center">
      <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
        <NotebookPen className="size-8 text-primary" />
      </div>
      <div className="space-y-2">
        <h1 className="text-3xl font-bold tracking-tight">Welcome to TaacNotes</h1>
        <p className="text-lg text-muted-foreground">
          Your AI-native note-taking app. Let&apos;s get you set up in just a few steps.
        </p>
      </div>
      <Button size="lg" onClick={handleGetStarted}>
        Get Started
      </Button>
    </div>
  )
}
