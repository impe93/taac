import { type FC } from 'react'
import { Bot, FileText, Layout, Search } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import type { OnboardingAction } from './OnboardingWizard'
import { TutorialCard } from './TutorialCard'

interface TutorialStepProps {
  dispatch: React.Dispatch<OnboardingAction>
}

const TUTORIAL_CARDS = [
  {
    icon: FileText,
    title: 'Writing Notes',
    description:
      'Create notes with the rich Markdown editor. Organize them into folders within your spaces. Notes auto-save as you type.'
  },
  {
    icon: Layout,
    title: 'Spaces',
    description:
      'Spaces keep your notes organized by project, topic, or context. You can create up to 5 spaces, each completely isolated. Switch between them from the sidebar.'
  },
  {
    icon: Bot,
    title: 'AI Assistant',
    description:
      'Load an AI model and open the chat panel (Cmd+Shift+A) to ask questions, get summaries, and brainstorm — all powered by a local LLM running on your machine. No data leaves your device.'
  },
  {
    icon: Search,
    title: 'Smart Search',
    description:
      'Your notes are automatically indexed for semantic search. The embedding model understands meaning, not just keywords — so searching "vacation plans" finds notes about "trip to Italy" too.'
  }
] as const

export const TutorialStep: FC<TutorialStepProps> = ({ dispatch }) => {
  const handleGetStarted = (): void => {
    dispatch({ type: 'NEXT_STEP' })
  }

  return (
    <div className="flex flex-col items-center space-y-6">
      <div className="space-y-2 text-center">
        <h1 className="font-serif text-4xl font-normal tracking-tight">Get to Know Taac</h1>
      </div>

      <div className="grid w-full grid-cols-2 gap-4">
        {TUTORIAL_CARDS.map((card) => (
          <TutorialCard
            key={card.title}
            icon={card.icon}
            title={card.title}
            description={card.description}
          />
        ))}
      </div>

      <Button size="lg" onClick={handleGetStarted}>
        Get Started
      </Button>
    </div>
  )
}
