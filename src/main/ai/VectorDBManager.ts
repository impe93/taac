/**
 * Vector Database Manager (Per-Space)
 *
 * Manages sqlite-vec vector database operations:
 * - Stores note embeddings for semantic search
 * - Per-space database isolation
 * - CRUD operations for embeddings
 *
 * Reference: docs/AI_ARCHITECTURE.md section 6.5
 */

import type { EmbeddingResult, SearchResult } from './types'
import { VectorDBError } from './errors'

// TODO: Import better-sqlite3 when implementing
// import Database from 'better-sqlite3'

export interface VectorDBConfig {
  dbPath: string
  embeddingDimension: number
}

export class VectorDBManager {
  private static instances: Map<string, VectorDBManager> = new Map()

  // TODO: Replace with actual Database type
  // private db: Database.Database | null = null
  private _config: VectorDBConfig
  private initialized: boolean = false

  private constructor(config: VectorDBConfig) {
    this._config = config
  }

  /**
   * Get or create instance for a space
   */
  static getInstance(spaceId: string, dbPath: string): VectorDBManager {
    const existing = this.instances.get(spaceId)
    if (existing) return existing

    const instance = new VectorDBManager({
      dbPath,
      embeddingDimension: 768 // nomic-embed-text dimension
    })
    this.instances.set(spaceId, instance)
    return instance
  }

  /**
   * Initialize database with sqlite-vec extension
   * TODO: Implement database initialization
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    try {
      // TODO: Implement with:
      // - Create database connection
      // - Load sqlite-vec extension
      // - Create embeddings table with vector column
      // - Create indexes

      this.initialized = true
    } catch (error) {
      throw new VectorDBError(
        'initialize',
        error instanceof Error ? error.message : 'Unknown error'
      )
    }
  }

  /**
   * Store embedding for a note chunk
   * TODO: Implement embedding storage
   */
  async storeEmbedding(_embedding: EmbeddingResult): Promise<void> {
    // TODO: Insert embedding into database
    throw new Error('Not implemented')
  }

  /**
   * Store multiple embeddings in a batch
   * TODO: Implement batch storage
   */
  async storeEmbeddings(_embeddings: EmbeddingResult[]): Promise<void> {
    // TODO: Batch insert embeddings using transaction
    throw new Error('Not implemented')
  }

  /**
   * Search for similar notes
   * TODO: Implement vector similarity search
   */
  async search(_queryEmbedding: number[], _limit: number = 10): Promise<SearchResult[]> {
    // TODO: Implement KNN search using sqlite-vec
    throw new Error('Not implemented')
  }

  /**
   * Delete embeddings for a note
   * TODO: Implement deletion
   */
  async deleteNoteEmbeddings(_noteId: string): Promise<void> {
    // TODO: Delete all chunks for a note
  }

  /**
   * Check if a note is indexed
   * TODO: Implement check
   */
  async isNoteIndexed(_noteId: string): Promise<boolean> {
    // TODO: Check if embeddings exist for note
    return false
  }

  /**
   * Get all indexed note IDs
   * TODO: Implement listing
   */
  async getIndexedNoteIds(): Promise<string[]> {
    // TODO: Return unique note IDs in database
    return []
  }

  /**
   * Clear all embeddings
   * TODO: Implement clearing
   */
  async clear(): Promise<void> {
    // TODO: Delete all embeddings
  }

  /**
   * Close database connection
   * TODO: Implement cleanup
   */
  async close(): Promise<void> {
    // TODO: Close database connection
    this.initialized = false
  }

  /**
   * Remove instance for a space (used when space is deleted)
   */
  static removeInstance(spaceId: string): void {
    const instance = this.instances.get(spaceId)
    if (instance) {
      instance.close()
      this.instances.delete(spaceId)
    }
  }

  /**
   * Get database configuration
   */
  getConfig(): VectorDBConfig {
    return this._config
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }
}
