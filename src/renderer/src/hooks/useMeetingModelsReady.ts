import { useMemo } from 'react'
import { useDownloadedModels } from './useModels'

/** Segmentation model is always required */
const SEGMENTATION_MODEL_ID = 'sherpa-onnx-pyannote-segmentation'

/** At least one embedding model is required — NeMo TitaNet Small is the preferred (faster) option */
const EMBEDDING_MODEL_IDS = ['sherpa-onnx-nemo-titanet-small', 'sherpa-onnx-3dspeaker-embedding']

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
    const hasEmbedding = EMBEDDING_MODEL_IDS.some((id) => downloadedIds.has(id))
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
