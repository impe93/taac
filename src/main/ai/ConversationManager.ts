/**
 * Conversation Manager (Global)
 *
 * Manages AI conversation persistence:
 * - Global storage (not per-space)
 * - Can reference notes from multiple spaces
 * - CRUD operations for conversations
 *
 * Reference: docs/AI_ARCHITECTURE.md section 6.6
 */

import type { Conversation, ChatMessage, NoteReference } from './types'
import { ConversationNotFoundError } from './errors'

export class ConversationManager {
  private static instance: ConversationManager | null = null
  private conversationsDir: string
  private conversations: Map<string, Conversation> = new Map()
  private initialized: boolean = false

  private constructor(conversationsDir: string) {
    this.conversationsDir = conversationsDir
  }

  /**
   * Get singleton instance
   */
  static getInstance(conversationsDir: string): ConversationManager {
    if (!ConversationManager.instance) {
      ConversationManager.instance = new ConversationManager(conversationsDir)
    }
    return ConversationManager.instance
  }

  /**
   * Initialize and load conversations from disk
   * TODO: Implement loading
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // TODO: Scan conversationsDir and load all .json files
    // TODO: Populate conversations Map

    this.initialized = true
  }

  /**
   * Create a new conversation
   * TODO: Implement creation
   */
  async create(
    title: string,
    modelId: string,
    initialMessage?: ChatMessage
  ): Promise<Conversation> {
    const id = this.generateId()
    const now = Date.now()

    const conversation: Conversation = {
      id,
      title,
      messages: initialMessage ? [initialMessage] : [],
      modelId,
      createdAt: now,
      updatedAt: now,
      noteReferences: []
    }

    this.conversations.set(id, conversation)

    // TODO: Persist to disk

    return conversation
  }

  /**
   * Get a conversation by ID
   */
  get(conversationId: string): Conversation {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId)
    }
    return conversation
  }

  /**
   * Get all conversations
   */
  getAll(): Conversation[] {
    return Array.from(this.conversations.values()).sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /**
   * Add a message to a conversation
   * TODO: Implement with persistence
   */
  async addMessage(conversationId: string, message: ChatMessage): Promise<void> {
    const conversation = this.get(conversationId)
    conversation.messages.push(message)
    conversation.updatedAt = Date.now()

    // TODO: Persist to disk
  }

  /**
   * Add a note reference to a conversation
   * TODO: Implement with persistence
   */
  async addNoteReference(conversationId: string, reference: NoteReference): Promise<void> {
    const conversation = this.get(conversationId)

    // Avoid duplicates
    const exists = conversation.noteReferences.some(
      (r) => r.spaceId === reference.spaceId && r.noteId === reference.noteId
    )
    if (!exists) {
      conversation.noteReferences.push(reference)
      conversation.updatedAt = Date.now()
    }

    // TODO: Persist to disk
  }

  /**
   * Update conversation title
   * TODO: Implement with persistence
   */
  async updateTitle(conversationId: string, title: string): Promise<void> {
    const conversation = this.get(conversationId)
    conversation.title = title
    conversation.updatedAt = Date.now()

    // TODO: Persist to disk
  }

  /**
   * Delete a conversation
   * TODO: Implement with file deletion
   */
  async delete(conversationId: string): Promise<void> {
    if (!this.conversations.has(conversationId)) {
      throw new ConversationNotFoundError(conversationId)
    }

    this.conversations.delete(conversationId)

    // TODO: Delete file from disk
  }

  /**
   * Search conversations by title
   */
  search(query: string): Conversation[] {
    const lowerQuery = query.toLowerCase()
    return this.getAll().filter((c) => c.title.toLowerCase().includes(lowerQuery))
  }

  /**
   * Generate unique conversation ID
   */
  private generateId(): string {
    return `conv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Get conversations directory path
   */
  getConversationsDir(): string {
    return this.conversationsDir
  }
}
