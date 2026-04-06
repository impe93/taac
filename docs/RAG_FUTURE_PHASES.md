# RAG Future Phases

This document outlines planned RAG improvements that build on the current v2 implementation (reranking, context formatting, query expansion).

## Phase 4: Contextual Retrieval (Indexing-Time Enhancement)

**Impact**: ~49% reduction in retrieval failures (based on Anthropic's research).

### Concept

At indexing time, use the chat model to generate a 50-100 token contextual prefix for each chunk. This prefix explains where the chunk fits within its parent note, giving it awareness of the broader document context that is lost during chunking.

Example: A chunk from a meeting note might get the prefix _"This chunk is from meeting notes with Alessandro on March 15, discussing the Q2 marketing budget."_ — even if the chunk itself only contains budget numbers.

### Implementation Plan

#### Database Migration (`VectorDBManager.ts`)

- Add column `contextual_prefix TEXT` to `embeddings` table
- New migration method `migrateContextualPrefix()` following existing pattern
- Increment `EMBEDDING_SCHEMA_VERSION` from 3 to 4 (forces re-indexing)

#### EmbeddingService Changes

New method:

```typescript
async generateContextualPrefix(
  fullNoteContent: string,
  chunkText: string,
  noteTitle: string,
  chatModelId: string
): Promise<string>
```

- Uses AIManager in isolated mode (256 token context, 100 max output)
- Modifies `buildEmbeddingText()` to prepend prefix: `Context: "{prefix}" | {existingText}`

#### Indexing Strategy

- **Auto-indexing** (background, 3s debounce): NO contextual retrieval — too slow, requires chat model
- **"Index All" explicit**: YES contextual retrieval when chat model is available
- New IPC handler `ai:indexAllNotesWithContext` for explicit contextual indexing

### Considerations

- Indexing becomes ~3-5x slower per chunk (one LLM call per chunk)
- Requires chat model loaded during indexing (~4GB additional memory)
- Contextual prefixes are optional — system degrades gracefully without them

---

## Phase 5: HyDE (Hypothetical Document Embeddings)

**Impact**: Significant for vague/conversational queries (e.g., "what was I working on last week?").

### Concept

For vague queries, generate a hypothetical answer first, then embed that answer and search with it. This bridges the vocabulary gap between questions and answers — a question about "budget" might match a note about "financial planning" better when the hypothetical answer uses both terms.

### Implementation Plan

#### QueryExpander Extension

Add method to existing `QueryExpander`:

```typescript
async generateHypotheticalAnswer(query: string, chatModelId: string): Promise<string>
```

- Prompt: "Write a brief paragraph that would answer this question based on personal notes: {query}"
- 150 max output tokens

#### Search Handler Integration

- **Trigger condition**: Query is a question (contains `?` or starts with who/what/when/where/why/how) AND is short (<15 words)
- Generate embedding of the hypothetical answer
- Search with BOTH: original query embedding + HyDE embedding
- Merge results via RRF (treating each as a separate ranking)

### Considerations

- Adds ~500-1500ms latency (one LLM call + one embedding)
- Only useful for conversational queries; keyword-heavy queries don't benefit
- Requires chat model to be loaded
- Should be triggered selectively based on query classification
