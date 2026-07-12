import type { ModelDefinition } from '@main/ai/types'

/**
 * Short capability label shown as a badge next to each model in a feature card.
 */
export const modelLabel = (model: ModelDefinition): string => {
  const caps = model.capabilities
  if (caps.includes('chat')) return 'Chat'
  if (caps.includes('embedding')) return 'Search'
  if (caps.includes('reranking')) return 'Reranker'
  if (caps.includes('transcription')) return model.format === 'mlx' ? 'Realtime' : 'Transcription'
  if (caps.includes('vad')) return 'Voice activity'
  if (caps.includes('diarization')) return 'Diarization'
  return 'Model'
}
