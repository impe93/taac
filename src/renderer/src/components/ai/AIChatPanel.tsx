import { useState, useCallback, type FC, type ReactNode } from 'react'
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle
} from '@renderer/components/ui/resizable'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger
} from '@renderer/components/ui/drawer'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import { Button } from '@renderer/components/ui/button'
import { Badge } from '@renderer/components/ui/badge'
import { ConversationList } from './ConversationList'
import { ChatInterface } from './ChatInterface'
import { useCreateConversation } from '@renderer/hooks/useConversations'
import { useSpaces, useActiveSpace } from '@renderer/hooks/useSpaces'
import { cn } from '@renderer/lib/utils'
import {
  PanelLeftClose,
  PanelLeft,
  MessageSquarePlus,
  Bot,
  Menu,
  Sparkles,
  FolderOpen
} from 'lucide-react'

interface AIChatPanelProps {
  className?: string
  defaultModelId?: string
}

export const AIChatPanel: FC<AIChatPanelProps> = ({ className, defaultModelId }) => {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(false)
  const [isMobileDrawerOpen, setIsMobileDrawerOpen] = useState(false)
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | undefined>(undefined)
  const [enableRAG, setEnableRAG] = useState(true)

  const modelId = defaultModelId ?? 'default'
  const createConversation = useCreateConversation()
  const { data: spaces } = useSpaces()
  const activeSpace = useActiveSpace()

  const handleSelectConversation = useCallback((conversationId: string): void => {
    setSelectedConversationId(conversationId)
    setIsMobileDrawerOpen(false)
  }, [])

  const handleCreateConversation = useCallback(async (): Promise<void> => {
    const result = await createConversation.mutateAsync({
      title: 'Nuova conversazione',
      modelId
    })
    setSelectedConversationId(result.id)
    setIsMobileDrawerOpen(false)
  }, [createConversation, modelId])

  const handleCloseConversation = useCallback((): void => {
    setSelectedConversationId(null)
  }, [])

  const handleDeleteConversation = useCallback((): void => {
    setSelectedConversationId(null)
  }, [])

  const togglePanel = useCallback((): void => {
    setIsPanelCollapsed((prev) => !prev)
  }, [])

  const effectiveSpaceId = selectedSpaceId ?? activeSpace?.id

  const renderConversationListContent = (): ReactNode => (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b p-3">
        <h2 className="flex items-center gap-2 text-sm font-medium">
          <Bot className="size-4" />
          Conversazioni AI
        </h2>
        <Button variant="ghost" size="icon" className="size-8" onClick={togglePanel}>
          <PanelLeftClose className="size-4" />
        </Button>
      </div>

      {/* Selettori */}
      <div className="space-y-3 border-b p-3">
        {/* Space selector per RAG */}
        <div className="space-y-1.5">
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <FolderOpen className="size-3" />
            Contesto RAG
          </label>
          <Select value={effectiveSpaceId ?? ''} onValueChange={setSelectedSpaceId}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="Seleziona space" />
            </SelectTrigger>
            <SelectContent>
              {spaces?.map((space) => (
                <SelectItem key={space.id} value={space.id} className="text-xs">
                  <span className="flex items-center gap-2">
                    <span>{space.icon}</span>
                    <span>{space.name}</span>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* RAG toggle */}
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sparkles className="size-3" />
            Ricerca contestuale
          </span>
          <Button
            variant={enableRAG ? 'default' : 'outline'}
            size="sm"
            className="h-6 px-2 text-xs"
            onClick={() => setEnableRAG(!enableRAG)}
          >
            {enableRAG ? 'Attiva' : 'Disattiva'}
          </Button>
        </div>
      </div>

      {/* Conversation list */}
      <div className="min-h-0 flex-1">
        <ConversationList
          onSelectConversation={handleSelectConversation}
          selectedId={selectedConversationId ?? undefined}
          onNewConversation={handleCreateConversation}
        />
      </div>

      {/* Create button */}
      <div className="border-t p-3">
        <Button
          onClick={handleCreateConversation}
          disabled={createConversation.isPending}
          className="w-full gap-2"
          size="sm"
        >
          <MessageSquarePlus className="size-4" />
          Nuova conversazione
        </Button>
      </div>
    </div>
  )

  const renderEmptyState = (): ReactNode => (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8">
      <div className="flex size-20 items-center justify-center rounded-full bg-primary/10">
        <Bot className="size-10 text-primary" />
      </div>
      <div className="max-w-md text-center">
        <h3 className="mb-2 text-lg font-semibold">Assistente AI</h3>
        <p className="mb-6 text-sm text-muted-foreground">
          Seleziona una conversazione esistente o creane una nuova per iniziare a chattare con
          l&apos;AI. Le conversazioni supportano il contesto delle tue note tramite RAG.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Button
          onClick={handleCreateConversation}
          disabled={createConversation.isPending}
          className="gap-2"
        >
          <MessageSquarePlus className="size-4" />
          Crea nuova conversazione
        </Button>

        {effectiveSpaceId && (
          <Badge variant="outline" className="mx-auto gap-1.5">
            <FolderOpen className="size-3" />
            Contesto: {spaces?.find((s) => s.id === effectiveSpaceId)?.name ?? 'Space selezionato'}
          </Badge>
        )}
      </div>
    </div>
  )

  const renderChatArea = (): ReactNode => {
    if (!selectedConversationId) {
      return renderEmptyState()
    }

    return (
      <div className="flex h-full flex-col">
        {/* Mobile header with menu */}
        <div className="flex items-center gap-2 border-b p-2 md:hidden">
          <Drawer open={isMobileDrawerOpen} onOpenChange={setIsMobileDrawerOpen}>
            <DrawerTrigger asChild>
              <Button variant="ghost" size="icon" className="size-8">
                <Menu className="size-4" />
              </Button>
            </DrawerTrigger>
            <DrawerContent className="h-[85vh]">
              <DrawerHeader className="sr-only">
                <DrawerTitle>Conversazioni</DrawerTitle>
              </DrawerHeader>
              {renderConversationListContent()}
            </DrawerContent>
          </Drawer>
          <span className="text-sm font-medium">Chat AI</span>
        </div>

        {/* Chat interface */}
        <div className="min-h-0 flex-1">
          <ChatInterface
            conversationId={selectedConversationId}
            modelId={modelId}
            spaceId={effectiveSpaceId}
            enableRAG={enableRAG}
            onClose={handleCloseConversation}
            onDelete={handleDeleteConversation}
          />
        </div>
      </div>
    )
  }

  return (
    <div className={cn('flex h-full', className)}>
      {/* Desktop layout with resizable panels */}
      <div className="hidden h-full w-full md:flex">
        {isPanelCollapsed ? (
          <>
            {/* Collapsed panel - show expand button */}
            <div className="flex w-12 flex-col items-center border-r py-3">
              <Button variant="ghost" size="icon" className="size-8" onClick={togglePanel}>
                <PanelLeft className="size-4" />
              </Button>
            </div>
            <div className="min-w-0 flex-1">{renderChatArea()}</div>
          </>
        ) : (
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={30} minSize={20} maxSize={40}>
              {renderConversationListContent()}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={70}>{renderChatArea()}</ResizablePanel>
          </ResizablePanelGroup>
        )}
      </div>

      {/* Mobile layout */}
      <div className="flex h-full w-full flex-col md:hidden">
        {selectedConversationId ? (
          renderChatArea()
        ) : (
          <>
            {/* Mobile header */}
            <div className="flex items-center justify-between border-b p-3">
              <h2 className="flex items-center gap-2 text-sm font-medium">
                <Bot className="size-4" />
                Conversazioni AI
              </h2>
            </div>

            {/* Selettori mobile */}
            <div className="space-y-3 border-b p-3">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FolderOpen className="size-3" />
                  Contesto RAG
                </label>
                <Select value={effectiveSpaceId ?? ''} onValueChange={setSelectedSpaceId}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue placeholder="Seleziona space" />
                  </SelectTrigger>
                  <SelectContent>
                    {spaces?.map((space) => (
                      <SelectItem key={space.id} value={space.id} className="text-xs">
                        <span className="flex items-center gap-2">
                          <span>{space.icon}</span>
                          <span>{space.name}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="size-3" />
                  Ricerca contestuale
                </span>
                <Button
                  variant={enableRAG ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setEnableRAG(!enableRAG)}
                >
                  {enableRAG ? 'Attiva' : 'Disattiva'}
                </Button>
              </div>
            </div>

            {/* Conversation list mobile */}
            <div className="min-h-0 flex-1">
              <ConversationList
                onSelectConversation={handleSelectConversation}
                selectedId={selectedConversationId ?? undefined}
                onNewConversation={handleCreateConversation}
              />
            </div>

            {/* Create button mobile */}
            <div className="border-t p-3">
              <Button
                onClick={handleCreateConversation}
                disabled={createConversation.isPending}
                className="w-full gap-2"
                size="sm"
              >
                <MessageSquarePlus className="size-4" />
                Nuova conversazione
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
