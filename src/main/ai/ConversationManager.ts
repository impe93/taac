/**
 * Conversation Manager (Global)
 *
 * Manages AI conversation persistence:
 * - Global storage (not per-space)
 * - Can reference notes from multiple spaces
 * - CRUD operations for conversations
 * - File-based persistence in {userData}/conversations/{id}.json
 *
 * Reference: docs/AI_ARCHITECTURE.md section 6.6
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'
import type {
  Conversation,
  ConversationSummary,
  ChatMessage,
  NoteReference,
  ChatRole
} from './types'
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
   * Reset singleton instance (for testing)
   */
  static resetInstance(): void {
    ConversationManager.instance = null
  }

  /**
   * Initialize and load all conversations from disk
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Create conversations directory if it doesn't exist
    await fs.mkdir(this.conversationsDir, { recursive: true })

    // Load all existing conversations
    await this.loadAllConversations()

    this.initialized = true
  }

  /**
   * Load all conversations from disk
   */
  private async loadAllConversations(): Promise<void> {
    try {
      const files = await fs.readdir(this.conversationsDir)

      for (const file of files) {
        if (file.endsWith('.json')) {
          const filePath = join(this.conversationsDir, file)
          try {
            const content = await fs.readFile(filePath, 'utf-8')
            const conversation = JSON.parse(content) as Conversation
            if (!conversation?.id) throw new Error('conversation file missing id')
            this.conversations.set(conversation.id, conversation)
          } catch (error) {
            // Quarantine corrupt/truncated files (e.g. from an interrupted write)
            // so they don't break startup or get re-read on every launch.
            console.error(`Failed to load conversation file ${file}, quarantining:`, error)
            await fs.rename(filePath, `${filePath}.corrupt`).catch(() => {})
          }
        }
      }
    } catch (error) {
      console.error('Failed to load conversations:', error)
    }
  }

  /**
   * Save a conversation to disk
   */
  private async saveConversation(conversation: Conversation): Promise<void> {
    const filePath = join(this.conversationsDir, `${conversation.id}.json`)
    // Atomic write: write to a temp file then rename, so an interrupted write
    // can never leave a truncated/empty JSON file that breaks the next startup.
    const tmpPath = `${filePath}.${uuidv4()}.tmp`
    await fs.writeFile(tmpPath, JSON.stringify(conversation, null, 2), 'utf-8')
    await fs.rename(tmpPath, filePath)
  }

  /**
   * Create a new conversation
   */
  async createConversation(
    title: string,
    modelId: string,
    systemPrompt?: string
  ): Promise<Conversation> {
    const now = new Date().toISOString()

    const conversation: Conversation = {
      id: uuidv4(),
      title,
      modelId,
      systemPrompt,
      messages: [],
      noteContext: [],
      createdAt: now,
      updatedAt: now,
      metadata: {
        totalTokens: 0
      }
    }

    // Add system message if provided
    if (systemPrompt) {
      conversation.messages.push({
        id: uuidv4(),
        role: 'system',
        content: systemPrompt,
        timestamp: now
      })
    }

    this.conversations.set(conversation.id, conversation)
    await this.saveConversation(conversation)

    return conversation
  }

  /**
   * Add a message to a conversation
   */
  async addMessage(
    conversationId: string,
    role: ChatRole,
    content: string,
    noteReferences?: NoteReference[]
  ): Promise<ChatMessage> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId)
    }

    const message: ChatMessage = {
      id: uuidv4(),
      role,
      content,
      timestamp: new Date().toISOString(),
      noteReferences
    }

    conversation.messages.push(message)
    conversation.updatedAt = new Date().toISOString()

    // Add note references to context if not already present
    if (noteReferences) {
      for (const ref of noteReferences) {
        const exists = conversation.noteContext.some(
          (n) => n.noteId === ref.noteId && n.spaceId === ref.spaceId
        )
        if (!exists) {
          conversation.noteContext.push(ref)
        }
      }
    }

    await this.saveConversation(conversation)
    return message
  }

  /**
   * Remove the last non-system message from a conversation
   */
  async removeLastMessage(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId)
    }

    if (conversation.messages.length > 0) {
      const lastMsg = conversation.messages[conversation.messages.length - 1]
      if (lastMsg.role !== 'system') {
        conversation.messages.pop()
        conversation.updatedAt = new Date().toISOString()
        await this.saveConversation(conversation)
      }
    }
  }

  /**
   * Add a note to conversation context
   */
  async addNoteToContext(conversationId: string, noteRef: NoteReference): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId)
    }

    // Avoid duplicates
    const exists = conversation.noteContext.some(
      (n) => n.noteId === noteRef.noteId && n.spaceId === noteRef.spaceId
    )

    if (!exists) {
      conversation.noteContext.push(noteRef)
      conversation.updatedAt = new Date().toISOString()
      await this.saveConversation(conversation)
    }
  }

  /**
   * Remove a note from conversation context
   */
  async removeNoteFromContext(conversationId: string, noteId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId)
    }

    const originalLength = conversation.noteContext.length
    conversation.noteContext = conversation.noteContext.filter((n) => n.noteId !== noteId)

    if (conversation.noteContext.length !== originalLength) {
      conversation.updatedAt = new Date().toISOString()
      await this.saveConversation(conversation)
    }
  }

  /**
   * Get a conversation by ID
   */
  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id)
  }

  /**
   * List all conversations (summary only), sorted by updatedAt descending
   */
  listConversations(): ConversationSummary[] {
    return Array.from(this.conversations.values())
      .map((c) => ({
        id: c.id,
        title: c.title,
        modelId: c.modelId,
        messageCount: c.messages.length,
        noteCount: c.noteContext.length,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      }))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
  }

  /**
   * Update conversation title
   */
  async updateConversationTitle(id: string, title: string): Promise<void> {
    const conversation = this.conversations.get(id)
    if (!conversation) {
      throw new ConversationNotFoundError(id)
    }

    conversation.title = title
    conversation.updatedAt = new Date().toISOString()
    await this.saveConversation(conversation)
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(id: string): Promise<void> {
    if (!this.conversations.has(id)) {
      throw new ConversationNotFoundError(id)
    }

    this.conversations.delete(id)

    const filePath = join(this.conversationsDir, `${id}.json`)
    try {
      await fs.unlink(filePath)
    } catch (error) {
      // File might not exist, that's fine
      console.warn(`Could not delete conversation file: ${filePath}`, error)
    }
  }

  /**
   * Build context prompt from referenced notes
   * Used to inject note context into the conversation
   */
  buildContextPrompt(conversation: Conversation): string {
    if (conversation.noteContext.length === 0) {
      return ''
    }

    let contextPrompt = '\n\n## Referenced Notes Context:\n\n'

    for (const note of conversation.noteContext) {
      contextPrompt += `### ${note.title}\n`
      if (note.relevanceScore !== undefined) {
        contextPrompt += `*Relevance: ${(note.relevanceScore * 100).toFixed(1)}%*\n\n`
      }
      contextPrompt += `${note.excerpt}\n\n`
      contextPrompt += '---\n\n'
    }

    return contextPrompt
  }

  /**
   * Get conversations directory path
   */
  getConversationsDir(): string {
    return this.conversationsDir
  }

  /**
   * Check if manager is initialized
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * Get total number of conversations
   */
  getConversationCount(): number {
    return this.conversations.size
  }

  /**
   * Search conversations by title
   */
  searchConversations(query: string): ConversationSummary[] {
    const lowerQuery = query.toLowerCase()
    return this.listConversations().filter((c) => c.title.toLowerCase().includes(lowerQuery))
  }

  /**
   * Update conversation metadata (e.g., token count)
   */
  async updateMetadata(
    conversationId: string,
    metadata: Partial<Conversation['metadata']>
  ): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId)
    }

    conversation.metadata = { ...conversation.metadata, ...metadata }
    conversation.updatedAt = new Date().toISOString()
    await this.saveConversation(conversation)
  }

  /**
   * Clear all notes from conversation context
   */
  async clearNoteContext(conversationId: string): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId)
    }

    if (conversation.noteContext.length > 0) {
      conversation.noteContext = []
      conversation.updatedAt = new Date().toISOString()
      await this.saveConversation(conversation)
    }
  }

  /**
   * Get messages from a conversation (with optional pagination)
   */
  getMessages(conversationId: string, limit?: number, offset?: number): ChatMessage[] {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new ConversationNotFoundError(conversationId)
    }

    let messages = conversation.messages

    if (offset !== undefined) {
      messages = messages.slice(offset)
    }

    if (limit !== undefined) {
      messages = messages.slice(0, limit)
    }

    return messages
  }
}
