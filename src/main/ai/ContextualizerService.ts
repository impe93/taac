/**
 * Contextualizer Service
 *
 * Implements Anthropic-style "Contextual Retrieval": before embedding a chunk,
 * an LLM generates a short context that situates the chunk within its source
 * note. That context is prepended to the embedded text and indexed by BM25,
 * which sharply improves retrieval on chunks that rely on note-level context
 * (pronouns, implicit entities, dates).
 *
 * This is expensive (one LLM call per chunk of long notes), so it is opt-in and
 * runs in the background indexing queue. It degrades gracefully: on timeout or
 * failure it returns an empty string and indexing falls back to plain embeddings.
 *
 * Architecture: Singleton with lazy reuse of the chat model via AIManager.
 */

import type { AIManager } from './AIManager'

/** Max time to wait for a single context generation before giving up */
const CONTEXT_TIMEOUT_MS = 8000

/** Max tokens for the generated context (one short sentence) */
const MAX_CONTEXT_TOKENS = 80

/**
 * Notes shorter than this don't need contextualization: they fit in a single
 * chunk, so the chunk already *is* the whole note. Skipping them keeps indexing
 * fast for the typical short note.
 */
const MIN_NOTE_CHARS_FOR_CONTEXT = 1200

/** Cap the note text fed to the LLM to bound latency/memory on consumer hardware */
const MAX_NOTE_CHARS = 6000

/**
 * ContextualizerService — generates per-chunk situating context via the chat LLM.
 */
export class ContextualizerService {
  private static instance: ContextualizerService | null = null

  private aiManager: AIManager
  private modelId: string

  private constructor(aiManager: AIManager, modelId: string) {
    this.aiManager = aiManager
    this.modelId = modelId
  }

  /**
   * Get the singleton instance. The chat model id is refreshed each call so the
   * service always targets whichever chat model is currently preferred/loaded.
   */
  static getInstance(aiManager: AIManager, modelId: string): ContextualizerService {
    if (!ContextualizerService.instance) {
      ContextualizerService.instance = new ContextualizerService(aiManager, modelId)
    } else {
      ContextualizerService.instance.modelId = modelId
    }
    return ContextualizerService.instance
  }

  /**
   * Whether a note is worth contextualizing (long enough to span multiple chunks).
   */
  shouldContextualize(noteText: string): boolean {
    return noteText.trim().length >= MIN_NOTE_CHARS_FOR_CONTEXT
  }

  /**
   * Generate a short context situating `chunkText` within `noteText`.
   * Returns '' on timeout/failure so indexing degrades to plain embeddings.
   */
  async generateContext(noteText: string, chunkText: string): Promise<string> {
    try {
      return await Promise.race([
        this.callLLM(noteText, chunkText),
        new Promise<string>((resolve) => setTimeout(() => resolve(''), CONTEXT_TIMEOUT_MS))
      ])
    } catch (error) {
      console.error('[Contextualizer] Generation failed, using no context:', error)
      return ''
    }
  }

  private async callLLM(noteText: string, chunkText: string): Promise<string> {
    const note = noteText.length > MAX_NOTE_CHARS ? noteText.slice(0, MAX_NOTE_CHARS) : noteText

    const systemPrompt = `You situate a text chunk within its source note to improve search retrieval.
Rules:
- Reply with ONE short sentence (max 25 words) describing what the chunk is about and how it fits in the note.
- Reply in the SAME language as the note.
- Surface key entities the chunk only refers to implicitly (people, projects, dates, topics).
- Output ONLY the context sentence — no preamble, no quotes, no labels.`

    const userPrompt = `<note>
${note}
</note>

Here is the chunk to situate within the note:
<chunk>
${chunkText}
</chunk>`

    const messages = [
      { role: 'system' as const, content: systemPrompt },
      { role: 'user' as const, content: userPrompt }
    ]

    const generator = this.aiManager.generateChatCompletion(this.modelId, messages, {
      maxTokens: MAX_CONTEXT_TOKENS,
      temperature: 0,
      isolated: true,
      contextSize: 4096
    })

    let full = ''
    for await (const chunk of generator) {
      full += chunk
    }

    return full.trim().replace(/\s+/g, ' ')
  }
}
