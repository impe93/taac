import { type FC } from 'react'
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
      <div className="flex size-20 items-center justify-center rounded-[22px] border border-border bg-linear-to-b from-secondary to-background shadow-lg">
        <span className="font-serif text-5xl italic leading-none text-primary">t</span>
      </div>
      <div className="space-y-2">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Welcome to TaacNotes</h1>
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
