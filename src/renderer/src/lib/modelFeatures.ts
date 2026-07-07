/**
 * Shared model-feature bundling logic for the onboarding wizard and the settings
 * page. Groups the curated models by user-facing feature (chat / search /
 * meeting), resolves the recommended vs. alternative variants for the current
 * hardware profile, and computes aggregate download progress across a bundle.
 */

import { Bot, Search, Mic } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { DownloadProgress, ModelDefinition, ModelProfile } from '@main/ai/types'

// =============================================================================
// Curated bundles per feature
// =============================================================================

export type FeatureKey = 'chat' | 'search' | 'meeting'

export interface CuratedFeature {
  key: FeatureKey
  icon: LucideIcon
  label: string
  description: string
  losesIfSkipped: string
  optional: boolean
}

export const FEATURES: CuratedFeature[] = [
  {
    key: 'chat',
    icon: Bot,
    label: 'AI Chat',
    description: 'Converse naturally with an AI assistant that runs entirely on your device.',
    losesIfSkipped:
      'Without this model you won’t be able to chat with your notes or generate AI content.',
    optional: false
  },
  {
    key: 'search',
    icon: Search,
    label: 'Semantic Search',
    description: 'Find your notes by meaning, not just keywords. Powered by local RAG.',
    losesIfSkipped:
      'Without these models, advanced search and contextual note retrieval will be disabled.',
    optional: false
  },
  {
    key: 'meeting',
    icon: Mic,
    label: 'Meeting Notes',
    description:
      'Record meetings, automatically transcribe audio, and identify different speakers — all offline.',
    losesIfSkipped:
      'Without these models you won’t be able to record meetings or generate automatic transcriptions and summaries.',
    optional: true
  }
]

/**
 * Recommended (tier-optimal) models that make a feature functional.
 */
export const resolveFeatureModels = (profile: ModelProfile, key: FeatureKey): ModelDefinition[] => {
  const { features, supportsRealtimeAsr } = profile

  switch (key) {
    case 'chat':
      return [features.chat]
    case 'search':
      return [features.search.embedding, features.search.reranker]
    case 'meeting': {
      const models: ModelDefinition[] = [features.meeting.whisper]
      if (supportsRealtimeAsr && features.meeting.asr) {
        models.push(features.meeting.asr)
      }
      if (supportsRealtimeAsr && features.meeting.vad) {
        models.push(features.meeting.vad)
      }
      models.push(...features.meeting.diarization)
      return models
    }
  }
}

/**
 * Non-recommended but compatible variants (more/less powerful) for a feature.
 * Only meeting transcription currently exposes alternatives; chat and search
 * are single-model features.
 */
export const resolveFeatureAlternatives = (
  profile: ModelProfile,
  key: FeatureKey
): ModelDefinition[] => {
  if (key !== 'meeting') return []
  const { whisper, asr } = profile.alternatives
  return [...whisper, ...asr]
}

// =============================================================================
// Aggregate download progress across a feature bundle
// =============================================================================

export interface FeatureProgress {
  bytesDownloaded: number
  totalBytes: number
  percentage: number
  activeModelId: string | null
  activeStatus: DownloadProgress['status'] | null
  activeSpeed: number
  activeEta: number
  lastError: string | null
}

/**
 * Sum download progress over a set of models into a single feature-level view.
 * `isComplete` reports whether a model is already fully available (downloaded on
 * disk or completed in the current session).
 */
export const computeFeatureProgress = (
  models: ModelDefinition[],
  progressMap: Map<string, DownloadProgress>,
  isComplete: (modelId: string) => boolean
): FeatureProgress => {
  let bytesDownloaded = 0
  let totalBytes = 0
  let activeModelId: string | null = null
  let activeStatus: DownloadProgress['status'] | null = null
  let activeSpeed = 0
  let activeEta = 0
  let lastError: string | null = null

  for (const m of models) {
    const p = progressMap.get(m.id)
    if (!p) {
      if (isComplete(m.id)) {
        bytesDownloaded += m.sizeBytes
        totalBytes += m.sizeBytes
      } else {
        totalBytes += m.sizeBytes
      }
      continue
    }
    bytesDownloaded += p.bytesDownloaded || (p.status === 'completed' ? m.sizeBytes : 0)
    totalBytes += p.totalBytes || m.sizeBytes
    if (p.status === 'downloading' || p.status === 'pending' || p.status === 'paused') {
      activeModelId = m.id
      activeStatus = p.status
      activeSpeed = p.speed
      activeEta = p.eta
    }
    if (p.status === 'error' && p.error) lastError = p.error
  }

  const percentage = totalBytes > 0 ? (bytesDownloaded / totalBytes) * 100 : 0

  return {
    bytesDownloaded,
    totalBytes,
    percentage,
    activeModelId,
    activeStatus,
    activeSpeed,
    activeEta,
    lastError
  }
}
