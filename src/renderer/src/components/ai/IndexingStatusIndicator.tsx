import { type FC } from 'react'
import { Database, Download, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@renderer/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@renderer/components/ui/tooltip'
import { useAutoIndexStatus } from '@renderer/hooks/useAutoIndexStatus'
import { useEnsureEmbeddingModel } from '@renderer/hooks/useVectorSearch'
import { cn } from '@renderer/lib/utils'

/**
 * Compact indicator in the header bar showing:
 * - Animated icon when auto-indexing is active
 * - Warning icon + download action when the embedding model is missing
 * - Nothing when idle (hidden)
 */
export const IndexingStatusIndicator: FC = () => {
  const { isIndexing, currentNoteTitle, queueSize } = useAutoIndexStatus()
  const {
    isAvailable: isModelAvailable,
    downloadEmbeddingModel,
    isDownloading,
    downloadProgress,
    isLoading: isCheckingModel
  } = useEnsureEmbeddingModel()

  // Show download prompt based on the authoritative download-status query, which
  // refetches when a download completes. (We intentionally don't use the sticky
  // `embeddingModelNeeded` IPC flag here — it never resets, so the button would
  // linger after the model is downloaded.)
  const showModelNeeded = !isCheckingModel && !isModelAvailable

  // When downloading, show progress
  if (isDownloading && downloadProgress) {
    const percent = Math.round(downloadProgress.percentage)
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className="size-8 pointer-events-none">
            <Download className="size-4 animate-pulse text-primary" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>Downloading embedding model: {percent}%</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  // When model is missing, show warning with download action
  if (showModelNeeded) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 relative"
            onClick={downloadEmbeddingModel}
          >
            <Database className="size-4 text-muted-foreground" />
            <AlertTriangle className="size-2.5 text-amber-500 absolute -top-0.5 -right-0.5" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="max-w-60">
          <p className="font-medium">Embedding model not downloaded</p>
          <p className="text-xs text-muted-foreground">
            Click to download and enable automatic AI search
          </p>
        </TooltipContent>
      </Tooltip>
    )
  }

  // When indexing is active, show animated indicator
  if (isIndexing) {
    const tooltipText = currentNoteTitle
      ? `Indexing: "${currentNoteTitle}"${queueSize > 0 ? ` (+${queueSize} queued)` : ''}`
      : 'Indexing...'

    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="icon" className={cn('size-8 pointer-events-none')}>
            <Loader2 className="size-4 animate-spin text-primary" />
          </Button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          <p>{tooltipText}</p>
        </TooltipContent>
      </Tooltip>
    )
  }

  // Idle — render nothing
  return null
}
