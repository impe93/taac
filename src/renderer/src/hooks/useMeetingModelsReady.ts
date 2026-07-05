import { useMemo } from 'react'
import { useDownloadedModels } from './useModels'

/** Segmentation model is always required */
const SEGMENTATION_MODEL_ID = 'sherpa-onnx-pyannote-segmentation'

/** Speaker embedding model — NeMo TitaNet Small (fast, sole supported option) */
const EMBEDDING_MODEL_ID = 'sherpa-onnx-nemo-titanet-small'

interface MeetingModelsStatus {
  isReady: boolean
  missingCategories: string[]
}

export const useMeetingModelsReady = (): MeetingModelsStatus => {
  const { data: downloadedModels } = useDownloadedModels()

  return useMemo(() => {
    const downloaded = downloadedModels ?? []
    const downloadedIds = new Set(downloaded.map((m) => m.id))

    const hasTranscription = downloaded.some((m) => m.capabilities.includes('transcription'))
    const hasSegmentation = downloadedIds.has(SEGMENTATION_MODEL_ID)
    const hasEmbedding = downloadedIds.has(EMBEDDING_MODEL_ID)
    const hasDiarization = hasSegmentation && hasEmbedding
    const hasChat = downloaded.some((m) => m.capabilities.includes('chat'))

    const missingCategories: string[] = []
    if (!hasTranscription) missingCategories.push('transcription')
    if (!hasDiarization) missingCategories.push('speaker identification')
    if (!hasChat) missingCategories.push('AI chat')

    return {
      isReady: missingCategories.length === 0,
      missingCategories
    }
  }, [downloadedModels])
}
