import { useMemo } from 'react'
import { useDownloadedModels } from './useModels'

const DIARIZATION_MODEL_IDS = [
  'sherpa-onnx-pyannote-segmentation',
  'sherpa-onnx-3dspeaker-embedding'
]

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
    const hasDiarization = DIARIZATION_MODEL_IDS.every((id) => downloadedIds.has(id))
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
