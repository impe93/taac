import { type ReactNode } from 'react'
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router'
import { Plus, Bot, Download } from 'lucide-react'
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent
} from '@renderer/components/ui/card'
import { Button } from '@renderer/components/ui/button'
import { useAppDispatch, useAppSelector } from '@renderer/store/hooks'
import { createNote, selectActiveSpaceId } from '@renderer/store/slices/notesTreeSlice'
import { useAIChatPanel } from '@renderer/hooks/useAIChatPanel'
import { useDownloadedModels } from '@renderer/hooks/useModels'

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const onboardingDone = await window.config.get('onboardingCompleted')
    if (!onboardingDone) {
      throw redirect({ to: '/onboarding' })
    }
  },
  component: HomeView
})

function HomeView(): ReactNode {
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const activeSpaceId = useAppSelector(selectActiveSpaceId)
  const { open: openAIPanel } = useAIChatPanel()
  const { data: downloadedModels } = useDownloadedModels()

  const hasModelsDownloaded = downloadedModels && downloadedModels.length > 0

  const handleCreateNote = async (): Promise<void> => {
    if (!activeSpaceId) return

    const result = await dispatch(
      createNote({
        spaceId: activeSpaceId,
        folderId: 'root',
        title: 'Untitled',
        content: ''
      })
    )

    if (createNote.fulfilled.match(result)) {
      navigate({ to: '/note/$noteId', params: { noteId: result.payload.note.id } })
    }
  }

  const handleGoToAISettings = (): void => {
    navigate({ to: '/settings' })
  }

  const handleOpenAIPanel = (): void => {
    openAIPanel()
  }

  return (
    <div className="flex h-full flex-col items-center justify-center">
      <div className="w-full max-w-3xl space-y-8">
        <div className="space-y-2 text-center">
          <h1 className="text-3xl font-bold tracking-tight">Welcome to TaacNotes</h1>
          <p className="text-muted-foreground">
            Your AI-powered note-taking workspace. Write, organize, and search your notes with the
            help of local AI.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardHeader>
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Plus className="size-5 text-primary" />
              </div>
              <CardTitle className="text-base">Create a Note</CardTitle>
              <CardDescription>Start writing a new note in your workspace.</CardDescription>
            </CardHeader>
            <CardContent>
              <Button onClick={handleCreateNote} className="w-full">
                New Note
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Download className="size-5 text-primary" />
              </div>
              <CardTitle className="text-base">AI Models</CardTitle>
              <CardDescription>
                {hasModelsDownloaded
                  ? 'Manage your downloaded AI models.'
                  : 'Download AI models to enable local intelligence.'}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={handleGoToAISettings} className="w-full">
                {hasModelsDownloaded ? 'Manage Models' : 'Download Models'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
                <Bot className="size-5 text-primary" />
              </div>
              <CardTitle className="text-base">AI Assistant</CardTitle>
              <CardDescription>
                Chat with your AI assistant to search and explore your notes.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Button variant="outline" onClick={handleOpenAIPanel} className="w-full">
                Open Assistant
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
