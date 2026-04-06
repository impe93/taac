/**
 * Query Expander
 *
 * Generates alternative phrasings of a user's search query to improve retrieval recall.
 * Uses the chat model in isolated mode to produce 2-3 reformulations, then searches
 * with all variants and merges results via RRF.
 *
 * Only activates for short queries (<10 words) where vocabulary mismatch is most likely.
 */

import type { AIManager } from './AIManager'

/** Maximum time to wait for query expansion before falling back to original query */
const EXPANSION_TIMEOUT_MS = 2000

/** Maximum word count for queries eligible for expansion */
const MAX_WORDS_FOR_EXPANSION = 10

/** Maximum tokens for the expansion response */
const MAX_EXPANSION_TOKENS = 100

/**
 * QueryExpander — generates alternative search query phrasings
 */
export class QueryExpander {
  private aiManager: AIManager

  constructor(aiManager: AIManager) {
    this.aiManager = aiManager
  }

  /**
   * Check if a query should be expanded (short queries benefit most)
   */
  shouldExpand(query: string): boolean {
    const wordCount = query.trim().split(/\s+/).length
    return wordCount <= MAX_WORDS_FOR_EXPANSION
  }

  /**
   * Generate alternative phrasings for a search query.
   *
   * @param query - The original user query
   * @param chatModelId - The chat model to use for expansion
   * @returns Array of queries: [originalQuery, ...expansions]
   */
  async expandQuery(query: string, chatModelId: string): Promise<string[]> {
    if (!this.shouldExpand(query)) {
      return [query]
    }

    try {
      const result = await this.generateExpansions(query, chatModelId)
      return [query, ...result]
    } catch (error) {
      console.error('[QueryExpander] Expansion failed, using original query:', error)
      return [query]
    }
  }

  /**
   * Generate expansions with timeout protection
   */
  private async generateExpansions(query: string, chatModelId: string): Promise<string[]> {
    const expansionPromise = this.callLLM(query, chatModelId)

    const timeoutPromise = new Promise<string[]>((resolve) => {
      setTimeout(() => resolve([]), EXPANSION_TIMEOUT_MS)
    })

    return Promise.race([expansionPromise, timeoutPromise])
  }

  /**
   * Call the LLM to generate alternative phrasings
   */
  private async callLLM(query: string, chatModelId: string): Promise<string[]> {
    const systemPrompt = `You are a search query reformulator. Given a search query, generate 2-3 alternative phrasings that preserve the same intent but use different words or phrasing.
Rules:
- Return ONLY the alternative queries, one per line
- No numbering, no explanations, no prefixes
- Keep each alternative concise (similar length to the original)
- Use synonyms, rephrasings, or different angles on the same topic`

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: `Query: ${query}` }
    ]

    const generator = this.aiManager.generateChatCompletion(chatModelId, messages, {
      maxTokens: MAX_EXPANSION_TOKENS,
      temperature: 0.7,
      isolated: true,
      contextSize: 256
    })

    // Collect all chunks from the generator
    let fullResponse = ''
    for await (const chunk of generator) {
      fullResponse += chunk
    }

    // Parse the response: one query per line, filter empty lines
    const expansions = fullResponse
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && line.length < 200)
      .slice(0, 3) // Cap at 3 expansions

    return expansions
  }
}
