/**
 * Reranker Service
 *
 * Cross-encoder reranking for improving search result relevance.
 * Uses node-llama-cpp's LlamaRankingContext to re-score (query, document) pairs
 * after initial hybrid search retrieval.
 *
 * Architecture: Singleton with lazy initialization.
 * The ranking context is created on first use and cached until the model is unloaded.
 */

import type { LlamaRankingContext } from 'node-llama-cpp'
import type { AIManager } from './AIManager'
import { ModelRegistry } from './ModelRegistry'

/** A document to be reranked */
export interface RerankDocument {
  id: string
  content: string
}

/** Result from reranking with normalized score */
export interface RerankResult {
  id: string
  score: number // 0-1, probability of relevance
}

/** Default reranker model ID */
const DEFAULT_RERANKER_MODEL_ID = 'qwen3-reranker-0.6b-q8'

/**
 * RerankerService — singleton that manages cross-encoder reranking
 */
export class RerankerService {
  private static instance: RerankerService | null = null

  private aiManager: AIManager
  private rankingContext: LlamaRankingContext | null = null
  private modelId: string

  private constructor(aiManager: AIManager, modelId?: string) {
    this.aiManager = aiManager
    this.modelId = modelId ?? DEFAULT_RERANKER_MODEL_ID

    // Invalidate cached context when the reranker model is unloaded
    this.aiManager.onModelUnload((unloadedId: string) => {
      if (unloadedId === this.modelId) {
        this.invalidateContext()
      }
    })
  }

  /**
   * Get singleton instance
   */
  static getInstance(aiManager: AIManager, modelId?: string): RerankerService {
    if (!RerankerService.instance) {
      RerankerService.instance = new RerankerService(aiManager, modelId)
    }
    return RerankerService.instance
  }

  /**
   * Check if the reranker model is available (downloaded)
   */
  isModelAvailable(): boolean {
    const model = ModelRegistry.getModel(this.modelId)
    return !!model
  }

  /**
   * Get the reranker model ID
   */
  getModelId(): string {
    return this.modelId
  }

  /**
   * Rerank a set of documents by relevance to a query.
   *
   * Uses cross-encoder scoring — each (query, document) pair is evaluated together,
   * giving much better relevance judgment than bi-encoder (embedding) similarity.
   *
   * @param query - The user's search query
   * @param documents - Documents to rerank (id + content with metadata)
   * @param topK - Maximum number of results to return (default: all)
   * @returns Sorted results with scores (highest relevance first)
   */
  async rerank(query: string, documents: RerankDocument[], topK?: number): Promise<RerankResult[]> {
    if (documents.length === 0) return []

    const context = await this.getOrCreateContext()

    // Use rankAndSort for efficient batch scoring
    const docContents = documents.map((d) => d.content)
    const ranked = await context.rankAndSort(query, docContents)

    // Map back to document IDs
    const contentToId = new Map(documents.map((d) => [d.content, d.id]))
    const results: RerankResult[] = ranked.map((r) => ({
      id: contentToId.get(r.document)!,
      score: r.score
    }))

    if (topK && topK < results.length) {
      return results.slice(0, topK)
    }

    return results
  }

  /**
   * Invalidate the cached ranking context (e.g. when model is unloaded)
   */
  invalidateContext(): void {
    if (this.rankingContext) {
      this.rankingContext.dispose().catch((err) => {
        console.error('[RerankerService] Error disposing ranking context:', err)
      })
      this.rankingContext = null
      console.log('[RerankerService] Ranking context invalidated')
    }
  }

  /**
   * Dispose all resources
   */
  async dispose(): Promise<void> {
    this.invalidateContext()
    RerankerService.instance = null
  }

  /**
   * Get or create the ranking context (lazy initialization)
   */
  private async getOrCreateContext(): Promise<LlamaRankingContext> {
    if (this.rankingContext && !this.rankingContext.disposed) {
      return this.rankingContext
    }

    console.log(`[RerankerService] Creating ranking context for model ${this.modelId}`)
    this.rankingContext = await this.aiManager.createRankingContext(this.modelId)
    return this.rankingContext
  }
}
