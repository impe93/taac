import { useState, useCallback, useEffect, useRef, type FC } from 'react'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@renderer/components/ui/select'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger
} from '@renderer/components/ui/collapsible'
import { Button } from '@renderer/components/ui/button'
import { ScrollArea } from '@renderer/components/ui/scroll-area'
import { ConversationList } from './ConversationList'
import { ChatInterface } from './ChatInterface'
import {
  useCreateConversation,
  useAddNoteToConversation,
  useAddMessage
} from '@renderer/hooks/useConversations'
import { useAIQuickAction, type AIQuickActionType } from '@renderer/hooks/useAIQuickAction'
import { useSpaces, useActiveSpace } from '@renderer/hooks/useSpaces'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import {
  MessageSquarePlus,
  Settings2,
  Sparkles,
  FolderOpen,
  ChevronDown
} from 'lucide-react'

interface AIChatPanelProps {
  className?: string
  defaultModelId?: string
}

export const AIChatPanel: FC<AIChatPanelProps> = ({ className, defaultModelId }) => {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null)
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | undefined>(undefined)
  const [enableRAG, setEnableRAG] = useState(true)
  const [isSettingsOpen, setIsSettingsOpen] = useState(false)

  const modelId = defaultModelId ?? 'default'
  const createConversation = useCreateConversation()
  const addNoteToConversation = useAddNoteToConversation()
  const addMessage = useAddMessage()
  const { pendingAction, clearAction } = useAIQuickAction()
  const { data: spaces } = useSpaces()
  const activeSpace = useActiveSpace()
  const isProcessingActionRef = useRef(false)

  const handleSelectConversation = useCallback((conversationId: string): void => {
    setSelectedConversationId(conversationId)
  }, [])

  const handleCreateConversation = useCallback(async (): Promise<void> => {
    const result = await createConversation.mutateAsync({
      title: 'Nuova conversazione',
      modelId
    })
    setSelectedConversationId(result.id)
  }, [createConversation, modelId])

  const handleBack = useCallback((): void => {
    setSelectedConversationId(null)
  }, [])

  const handleDeleteConversation = useCallback((): void => {
    setSelectedConversationId(null)
  }, [])

  const effectiveSpaceId = selectedSpaceId ?? activeSpace?.id

  // Process pending quick actions from note editor
  useEffect(() => {
    if (!pendingAction || isProcessingActionRef.current) return

    const processAction = async (): Promise<void> => {
      isProcessingActionRef.current = true

      try {
        const conversationTitles: Record<AIQuickActionType, string> = {
          ask: `Chat: ${pendingAction.noteRef.title}`,
          summarize: `Riassunto: ${pendingAction.noteRef.title}`,
          explain: `Spiegazione: ${pendingAction.noteRef.title}`
        }

        const conversation = await createConversation.mutateAsync({
          title: conversationTitles[pendingAction.type],
          modelId
        })

        await addNoteToConversation.mutateAsync({
          conversationId: conversation.id,
          noteRef: pendingAction.noteRef
        })

        if (pendingAction.type === 'summarize') {
          await addMessage.mutateAsync({
            conversationId: conversation.id,
            role: 'user',
            content: 'Riassumi questa nota in modo conciso, evidenziando i punti chiave.'
          })
        } else if (pendingAction.type === 'explain' && pendingAction.selectedText) {
          await addMessage.mutateAsync({
            conversationId: conversation.id,
            role: 'user',
            content: `Spiega il seguente testo in modo chiaro e semplice:\n\n"${pendingAction.selectedText}"`
          })
        }

        setSelectedConversationId(conversation.id)
        toast.success('Nota aggiunta al contesto AI')
      } catch (error) {
        console.error('Failed to process AI quick action:', error)
        toast.error('Errore durante la creazione della conversazione')
      } finally {
        isProcessingActionRef.current = false
        clearAction()
      }
    }

    processAction()
  }, [pendingAction, createConversation, addNoteToConversation, addMessage, modelId, clearAction])

  // Render conversation list view
  if (!selectedConversationId) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        {/* Compact settings */}
        <Collapsible open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2">
                <Settings2 className="size-3.5" />
                <span className="text-xs">Impostazioni</span>
                <ChevronDown
                  className={cn('size-3 transition-transform', isSettingsOpen && 'rotate-180')}
                />
              </Button>
            </CollapsibleTrigger>
            <Button
              onClick={handleCreateConversation}
              disabled={createConversation.isPending}
              size="sm"
              className="h-7 gap-1.5 px-2"
            >
              <MessageSquarePlus className="size-3.5" />
              <span className="text-xs">Nuova</span>
            </Button>
          </div>

          <CollapsibleContent>
            <div className="space-y-2 border-b bg-muted/30 px-3 py-2">
              {/* Space selector */}
              <div className="flex items-center gap-2">
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                <Select value={effectiveSpaceId ?? ''} onValueChange={setSelectedSpaceId}>
                  <SelectTrigger className="h-7 flex-1 text-xs">
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
                  <Sparkles className="size-3.5" />
                  Ricerca contestuale
                </span>
                <Button
                  variant={enableRAG ? 'default' : 'outline'}
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setEnableRAG(!enableRAG)}
                >
                  {enableRAG ? 'On' : 'Off'}
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Conversation list */}
        <ScrollArea className="flex-1">
          <ConversationList
            onSelectConversation={handleSelectConversation}
            selectedId={selectedConversationId ?? undefined}
            onNewConversation={handleCreateConversation}
          />
        </ScrollArea>
      </div>
    )
  }

  // Render chat view - ChatInterface has its own header with back button
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <ChatInterface
        conversationId={selectedConversationId}
        modelId={modelId}
        spaceId={effectiveSpaceId}
        enableRAG={enableRAG}
        onClose={handleBack}
        onDelete={handleDeleteConversation}
      />
    </div>
  )
}
