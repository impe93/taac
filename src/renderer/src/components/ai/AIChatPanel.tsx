import { useState, useCallback, useEffect, useRef, type FC } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import { Badge } from '@renderer/components/ui/badge'
import { ConversationList } from './ConversationList'
import { ChatInterface } from './ChatInterface'
import { useAppDispatch } from '@renderer/store/hooks'
import { store } from '@renderer/store'
import { selectNoteById, selectNote } from '@renderer/store/slices/notesTreeSlice'
import {
  useCreateConversation,
  useAddNoteToConversation,
  useAddMessage
} from '@renderer/hooks/useConversations'
import { useAIQuickAction, type AIQuickActionType } from '@renderer/hooks/useAIQuickAction'
import { useSpaces, useActiveSpace } from '@renderer/hooks/useSpaces'
import { useDownloadedModels } from '@renderer/hooks/useModels'
import { useLoadedModels } from '@renderer/hooks/useAI'
import { useIndexAllNotes, useEnsureEmbeddingModel } from '@renderer/hooks/useVectorSearch'
import { useDefaultModelId } from '@renderer/hooks/useDefaultModel'
import { toast } from 'sonner'
import { cn } from '@renderer/lib/utils'
import {
  MessageSquarePlus,
  Settings2,
  Sparkles,
  FolderOpen,
  ChevronDown,
  Cpu,
  Database,
  Loader2
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
  const [selectedModelId, setSelectedModelId] = useState<string | undefined>(undefined)

  // Model hooks
  const hookDefaultModelId = useDefaultModelId()
  const { data: downloadedModels } = useDownloadedModels()
  const { loadedModels, loadModel, isLoadingModel, unloadModel, isUnloadingModel } =
    useLoadedModels()

  // Effective model ID: user selection > prop > hook default
  const effectiveModelId = selectedModelId ?? defaultModelId ?? hookDefaultModelId

  // Check if current model is loaded
  const isCurrentModelLoaded = loadedModels.some((m) => m.id === effectiveModelId)

  // Filter to only chat models (not embedding models)
  const chatModels = downloadedModels?.filter((m) => m.capabilities.includes('chat')) ?? []

  const createConversation = useCreateConversation()
  const addNoteToConversation = useAddNoteToConversation()
  const addMessage = useAddMessage()
  const { pendingAction, clearAction } = useAIQuickAction()
  const { data: spaces } = useSpaces()
  const activeSpace = useActiveSpace()
  const isProcessingActionRef = useRef(false)

  // Navigation hooks for note click handler
  const navigate = useNavigate()
  const dispatch = useAppDispatch()

  // Effective space for RAG operations
  const effectiveSpaceId = selectedSpaceId ?? activeSpace?.id

  // Index all notes hook
  const {
    indexAll,
    isIndexing,
    progress: indexingProgress
  } = useIndexAllNotes(effectiveSpaceId ?? '')

  // Embedding model status for RAG
  const {
    isAvailable: isEmbeddingAvailable,
    downloadEmbeddingModel,
    isDownloading: isDownloadingEmbedding,
    downloadProgress: embeddingProgress
  } = useEnsureEmbeddingModel()

  const handleSelectConversation = useCallback((conversationId: string): void => {
    setSelectedConversationId(conversationId)
  }, [])

  const handleCreateConversation = useCallback(async (): Promise<void> => {
    const result = await createConversation.mutateAsync({
      title: 'New conversation',
      modelId: effectiveModelId
    })
    setSelectedConversationId(result.id)
  }, [createConversation, effectiveModelId])

  const handleBack = useCallback((): void => {
    setSelectedConversationId(null)
  }, [])

  const handleDeleteConversation = useCallback((): void => {
    setSelectedConversationId(null)
  }, [])

  const handleNoteClick = useCallback(
    (noteId: string): void => {
      // Try to get the note from Redux state to obtain folderId
      // Using store.getState() instead of useAppSelector to avoid Hook rules violation
      const state = store.getState()
      const note = selectNoteById(noteId)(state)

      if (note) {
        // If note is in state, update selection (for sidebar highlighting)
        dispatch(selectNote({ noteId, folderId: note.folderId }))
      }

      // Navigate to note (works even if note not in current space)
      navigate({ to: '/note/$noteId', params: { noteId } })
    },
    [navigate, dispatch]
  )

  // Process pending quick actions from note editor
  useEffect(() => {
    if (!pendingAction || isProcessingActionRef.current) return

    const processAction = async (): Promise<void> => {
      isProcessingActionRef.current = true

      try {
        const conversationTitles: Record<AIQuickActionType, string> = {
          ask: `Chat: ${pendingAction.noteRef.title}`,
          summarize: `Summary: ${pendingAction.noteRef.title}`,
          explain: `Explanation: ${pendingAction.noteRef.title}`
        }

        const conversation = await createConversation.mutateAsync({
          title: conversationTitles[pendingAction.type],
          modelId: effectiveModelId
        })

        await addNoteToConversation.mutateAsync({
          conversationId: conversation.id,
          noteRef: pendingAction.noteRef
        })

        if (pendingAction.type === 'summarize') {
          await addMessage.mutateAsync({
            conversationId: conversation.id,
            role: 'user',
            content: 'Summarize this note concisely, highlighting the key points.'
          })
        } else if (pendingAction.type === 'explain' && pendingAction.selectedText) {
          await addMessage.mutateAsync({
            conversationId: conversation.id,
            role: 'user',
            content: `Explain the following text clearly and simply:\n\n"${pendingAction.selectedText}"`
          })
        }

        setSelectedConversationId(conversation.id)
        toast.success('Note added to AI context')
      } catch (error) {
        console.error('Failed to process AI quick action:', error)
        toast.error('Error creating conversation')
      } finally {
        isProcessingActionRef.current = false
        clearAction()
      }
    }

    processAction()
  }, [
    pendingAction,
    createConversation,
    addNoteToConversation,
    addMessage,
    effectiveModelId,
    clearAction
  ])

  // Render conversation list view
  if (!selectedConversationId) {
    return (
      <div className={cn('flex h-full flex-col overflow-hidden', className)}>
        {/* Compact settings */}
        <Collapsible open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <div className="flex items-center justify-between border-b px-3 py-2">
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-7 gap-1.5 px-2">
                <Settings2 className="size-3.5" />
                <span className="text-xs">Settings</span>
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
              <span className="text-xs">New</span>
            </Button>
          </div>

          <CollapsibleContent>
            <div className="space-y-2 border-b bg-muted/30 px-3 py-2">
              {/* Model selector */}
              <div className="flex items-center gap-2">
                <Cpu className="size-3.5 shrink-0 text-muted-foreground" />
                <Select value={effectiveModelId} onValueChange={setSelectedModelId}>
                  <SelectTrigger className="h-7 flex-1 text-xs">
                    <SelectValue placeholder="Select model" />
                  </SelectTrigger>
                  <SelectContent>
                    {chatModels.map((model) => (
                      <SelectItem key={model.id} value={model.id} className="text-xs">
                        <div className="flex items-center gap-2">
                          <span>{model.name}</span>
                          {loadedModels.some((m) => m.id === model.id) && (
                            <Badge variant="default" className="h-4 px-1 text-[10px]">
                              Loaded
                            </Badge>
                          )}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Load/Unload model */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Cpu className="size-3.5" />
                  Model status
                </span>
                {isCurrentModelLoaded ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => unloadModel(effectiveModelId)}
                    disabled={isUnloadingModel}
                  >
                    {isUnloadingModel ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
                    Unload
                  </Button>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => loadModel(effectiveModelId)}
                    disabled={isLoadingModel || !effectiveModelId}
                  >
                    {isLoadingModel ? <Loader2 className="mr-1 size-3 animate-spin" /> : null}
                    Load
                  </Button>
                )}
              </div>

              {/* Space selector */}
              <div className="flex items-center gap-2">
                <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" />
                <Select value={effectiveSpaceId ?? ''} onValueChange={setSelectedSpaceId}>
                  <SelectTrigger className="h-7 flex-1 text-xs">
                    <SelectValue placeholder="Select space" />
                  </SelectTrigger>
                  <SelectContent>
                    {spaces?.map((space) => (
                      <SelectItem key={space.id} value={space.id} className="text-xs">
                        {space.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* RAG toggle */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Sparkles className="size-3.5" />
                  Contextual search
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

              {/* Embedding model status - only show when RAG is enabled */}
              {enableRAG && (
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Sparkles className="size-3.5" />
                    Embedding model
                  </span>
                  {isEmbeddingAvailable ? (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px] text-green-600">
                      Ready
                    </Badge>
                  ) : (
                    <Button
                      variant="default"
                      size="sm"
                      className="h-6 px-2 text-xs"
                      onClick={downloadEmbeddingModel}
                      disabled={isDownloadingEmbedding}
                    >
                      {isDownloadingEmbedding ? (
                        <>
                          <Loader2 className="mr-1 size-3 animate-spin" />
                          {embeddingProgress?.percentage ?? 0}%
                        </>
                      ) : (
                        'Download'
                      )}
                    </Button>
                  )}
                </div>
              )}

              {/* Index all notes */}
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Database className="size-3.5" />
                  Index notes
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => indexAll()}
                  disabled={isIndexing || !effectiveSpaceId}
                >
                  {isIndexing ? (
                    <>
                      <Loader2 className="mr-1 size-3 animate-spin" />
                      {indexingProgress
                        ? indexingProgress.status === 'checking'
                          ? `Checking ${indexingProgress.current}/${indexingProgress.total}`
                          : `${indexingProgress.current}/${indexingProgress.total}`
                        : 'Indexing...'}
                    </>
                  ) : (
                    'Index All'
                  )}
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Conversation list */}
        <ConversationList
          className="min-h-0 flex-1"
          onSelectConversation={handleSelectConversation}
          selectedId={selectedConversationId ?? undefined}
        />
      </div>
    )
  }

  // Render chat view - ChatInterface has its own header with back button
  return (
    <div className={cn('flex h-full flex-col', className)}>
      <ChatInterface
        conversationId={selectedConversationId}
        modelId={effectiveModelId}
        spaceId={effectiveSpaceId}
        enableRAG={enableRAG}
        onClose={handleBack}
        onDelete={handleDeleteConversation}
        onNoteClick={handleNoteClick}
      />
    </div>
  )
}
