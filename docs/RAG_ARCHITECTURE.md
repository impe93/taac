# TaacNotes — RAG Architecture (Production-Ready)

Documento architetturale per il sistema RAG (Retrieval Augmented Generation) di TaacNotes. Descrive l'architettura, le soluzioni adottate, e il funzionamento del sistema in base al modello di embedding scelto.

## Indice

1. [Panoramica e Obiettivi](#1-panoramica-e-obiettivi)
2. [Stack Tecnologico](#2-stack-tecnologico)
3. [Modello di Embedding](#3-modello-di-embedding)
4. [Pipeline di Indicizzazione](#4-pipeline-di-indicizzazione)
5. [Chunking Structure-Aware](#5-chunking-structure-aware)
6. [Contextual Chunk Headers](#6-contextual-chunk-headers)
7. [Storage e Schema Database](#7-storage-e-schema-database)
8. [Hybrid Search (BM25 + Vector)](#8-hybrid-search-bm25--vector)
9. [Scoring e Relevance](#9-scoring-e-relevance)
10. [Multi-Chunk Retrieval](#10-multi-chunk-retrieval)
11. [Indicizzazione Incrementale](#11-indicizzazione-incrementale)
12. [Gestione Memoria (16GB)](#12-gestione-memoria-16gb)
13. [Ricerca Standalone (senza Chat)](#13-ricerca-standalone-senza-chat)
14. [Architettura Componenti](#14-architettura-componenti)
15. [Flusso Dati Completo](#15-flusso-dati-completo)
16. [Fasi di Implementazione](#16-fasi-di-implementazione)

---

## 1. Panoramica e Obiettivi

### 1.1 Cosa fa il sistema RAG

Il sistema RAG permette all'utente di fare domande sulle proprie note e ricevere risposte contestualizzate dall'LLM locale. Funziona interamente in locale, senza inviare dati a server esterni.

### 1.2 Requisiti

| Requisito | Descrizione |
|---|---|
| **Locale al 100%** | Nessun dato esce dal dispositivo. Embedding e inferenza avvengono in locale. |
| **16GB RAM** | Deve funzionare su sistemi con 16GB di RAM senza rallentamenti significativi. |
| **Multilingua** | Le note possono essere in qualsiasi lingua. Il sistema deve gestire ricerche cross-lingua. |
| **Per-space** | Ogni spazio ha il proprio database vettoriale indipendente. |
| **Score accurati** | I risultati devono avere punteggi di rilevanza che riflettono realmente la pertinenza semantica. |
| **Contesto completo** | Se un'informazione è distribuita su più chunk, il sistema deve recuperarli tutti. |
| **Ricerca standalone** | La ricerca semantica deve funzionare anche senza il modello di chat caricato. |
| **Scala target** | Fino a ~500 note per spazio (max 5 spazi, ~2500 note totali). |

### 1.3 Problemi del POC attuale

| Problema | Causa | Soluzione |
|---|---|---|
| Score poco precisi | Rescaling arbitrario e assenza di keyword matching | Hybrid search + scoring calibrato |
| Note irrilevanti nei risultati | Threshold troppo basso (20%) e assenza di BM25 | Threshold più alto + BM25 per keyword match |
| Contesto incompleto | Un solo chunk per nota, senza espansione | Window expansion + parent-child retrieval |
| Perdita di struttura | Markdown strippato completamente prima del chunking | Chunking structure-aware che preserva sezioni |
| No indexing automatico | L'utente deve triggherare il reindex manualmente | Auto-indexing con debounce al salvataggio |
| Re-embedding inutile | Full delete + reindex anche se la nota non è cambiata | Content-hash per delta indexing |

---

## 2. Stack Tecnologico

| Componente | Tecnologia | Ruolo |
|---|---|---|
| LLM Runtime | `node-llama-cpp` v3+ | Inferenza locale per chat ed embedding |
| Embedding Model | `nomic-embed-text-v2-moe` Q8 GGUF | Generazione embedding 768-dim |
| Vector Storage | `sqlite-vec` (vec0) | KNN search con distanza coseno |
| Full-Text Search | SQLite FTS5 (built-in) | BM25 keyword search per hybrid retrieval |
| Database | `better-sqlite3` | Accesso a SQLite sincrono dal main process |
| Chat Models | Qwen3-4B Q8 / Llama 3.1 8B Q8 | Generazione risposte |

---

## 3. Modello di Embedding

### 3.1 nomic-embed-text-v2-moe

| Proprietà | Valore |
|---|---|
| Architettura | Mixture-of-Experts (475M params, 305M attivi) |
| Dimensioni embedding | 768 (nativo), supporta Matryoshka truncation a 256 |
| Quantizzazione | Q8_0 (~488MB su disco, ~600MB in RAM) |
| Lingue | 100+ (multilingua nativo) |
| Context length | 8192 tokens |
| Training data | 1.6 miliardi di coppie di testo |

### 3.2 Task Prefix (OBBLIGATORI)

Il modello è stato addestrato con prefix asimmetrici. **Senza prefix, la qualità della ricerca degrada significativamente.**

| Operazione | Prefix | Esempio |
|---|---|---|
| Indicizzazione documento | `search_document: ` | `search_document: Questo è il contenuto della nota...` |
| Query di ricerca | `search_query: ` | `search_query: Come configurare l'autenticazione?` |

### 3.3 Normalizzazione L2

**Non più necessaria.** Con il vec0 configurato con `distance_metric=cosine`, la normalizzazione è gestita internamente da sqlite-vec. Il modello produce già vettori quasi-normalizzati. La chiamata `normalizeVector()` va rimossa per semplificare il codice e risparmiare cicli CPU.

### 3.4 Cache del Contesto

L'`LlamaEmbeddingContext` va cached a livello di `EmbeddingService` e riutilizzato per tutte le operazioni di embedding, evitando riallocazioni costose ad ogni chiamata.

```typescript
// EmbeddingService
private embeddingContext: LlamaEmbeddingContext | null = null

private async getOrCreateContext(): Promise<LlamaEmbeddingContext> {
  if (!this.embeddingContext) {
    this.embeddingContext = await this.aiManager.getEmbeddingContext(this.embeddingModelId)
  }
  return this.embeddingContext
}
```

---

## 4. Pipeline di Indicizzazione

### 4.1 Flusso completo

```
Nota salvata dall'utente
  │
  ▼
Debounce (3 secondi dopo l'ultimo salvataggio)
  │
  ▼
Content-hash check: la nota è cambiata?
  ├─ NO → Skip (nessun lavoro)
  │
  ▼ SI
Estrai testo dal formato Lexical (JSON → plain text)
  │
  ▼
Chunking structure-aware (sezioni Markdown)
  │
  ▼
Per ogni chunk:
  ├─ Aggiungi contextual header (titolo nota + sezione)
  ├─ Genera embedding con prefix "search_document: "
  └─ Salva in sqlite-vec + FTS5
  │
  ▼
Aggiorna content_hash nell'indexing_status table
```

### 4.2 Estrazione testo

Il contenuto delle note è in formato Lexical (JSON dell'editor). La funzione `extractTextFromLexicalContent()` in `aiHandlers.ts` converte il JSON in plain text preservando la struttura dei paragrafi.

**Importante**: nella nuova implementazione, il Markdown NON viene completamente strippato. Si rimuovono solo gli elementi non-semantici:
- Immagini (`![alt](url)` → mantieni solo `alt` se presente)
- URL dei link (`[text](url)` → mantieni solo `text`)
- Tag HTML
- Linee orizzontali (`---`)

Si **preservano** invece:
- Marcatori di header (`#`, `##`, `###`)
- Marcatori di lista (`-`, `*`, `1.`)
- Enfasi (`**bold**`, `*italic*`)
- Blockquote (`>`)
- Code blocks (come testo, senza syntax markers)

---

## 5. Chunking Structure-Aware

### 5.1 Perché non il chunking token-based puro

Il POC attuale:
1. Strippa tutto il Markdown → testo piatto
2. Splitta su paragrafi (`\n\n`)
3. Accumula paragrafi fino a 256 token

Problemi:
- Una lista di 10 elementi viene spezzata a metà
- Un header viene separato dal suo contenuto
- Sezioni semanticamente diverse vengono fuse in un unico chunk

### 5.2 Algoritmo structure-aware

```
Input: testo Markdown della nota

Step 1: PARSE SEZIONI
  Splitta su header (H1/H2/H3) → ogni header + suo contenuto = una "sezione"
  Il testo prima del primo header = sezione "intro" (senza header)

Step 2: PER OGNI SEZIONE
  IF token_count(sezione) <= maxChunkTokens (384):
    → La sezione diventa UN chunk intero
    → section_id = hash(noteId + headerText)

  ELSE IF token_count(sezione) > maxChunkTokens:
    → Splitta internamente rispettando sotto-strutture:
      - Mai spezzare nel mezzo di un list item
      - Mai spezzare nel mezzo di un blockquote
      - Mai spezzare nel mezzo di una tabella
      - Splitta su doppi newline (paragrafi) come fallback
    → Tutti i sub-chunk condividono lo stesso section_id
    → Overlap di 32 token tra sub-chunk consecutivi

Step 3: FILTRO MINIMO
  Scarta chunk con meno di 10 token (frammenti inutili)

Step 4: MERGE SEZIONI CORTE
  IF token_count(sezione) < minChunkTokens (32):
    → Mergia con la sezione successiva
```

### 5.3 Parametri di chunking

| Parametro | Valore | Motivazione |
|---|---|---|
| `maxChunkTokens` | 384 | Bilancio tra precisione di retrieval e completezza del contesto. 256 è troppo corto per sezioni strutturate. |
| `overlapTokens` | 32 | ~8% overlap, applicato solo quando una sezione viene sub-chunkizzata |
| `minChunkTokens` | 32 | Sotto questa soglia, la sezione viene mergiata con la successiva |

### 5.4 Struttura del chunk risultante

```typescript
interface StructuredChunk {
  text: string           // Testo del chunk (Markdown leggero preservato)
  index: number          // Posizione ordinale del chunk nella nota
  sectionId: string      // ID della sezione Markdown di appartenenza
  sectionHeader: string  // Testo dell'header della sezione (es. "## Action Items")
  startOffset: number    // Offset carattere nel testo originale
  endOffset: number      // Fine offset
}
```

---

## 6. Contextual Chunk Headers

### 6.1 Il problema

Quando il modello di embedding processa un chunk come:

> "Comprare il latte, chiamare il dentista, inviare il report a Sara"

Non ha nessun contesto su cosa sia questa lista, a quale nota appartenga, o in quale sezione si trovi.

### 6.2 La soluzione

Prima di generare l'embedding, si antepone un **contextual header** al testo del chunk:

```
Note: "Meeting Notes - Gennaio 2026" | Section: "Action Items" | Comprare il latte, chiamare il dentista, inviare il report a Sara
```

Questo fornisce al modello di embedding informazioni cruciali sulla provenienza e il significato del chunk. La ricerca mostra una riduzione del ~35% nei fallimenti di retrieval.

### 6.3 Implementazione

```typescript
function buildEmbeddingText(chunk: StructuredChunk, noteTitle: string): string {
  const parts = [`Note: "${noteTitle}"`]

  if (chunk.sectionHeader) {
    parts.push(`Section: "${chunk.sectionHeader}"`)
  }

  parts.push(chunk.text)
  return parts.join(' | ')
}

// In indexNote():
const textToEmbed = buildEmbeddingText(chunk, note.title)
const embedding = await embedDocument(textToEmbed)  // aggiunge "search_document: " prefix

// Ma nel database si salva chunk.text originale (senza header)
// per la visualizzazione nella UI
```

**Nota**: il contextual header viene usato SOLO per l'embedding. Nel database `embeddings.content` si salva il testo originale del chunk (per la visualizzazione nella UI e per il contesto all'LLM).

---

## 7. Storage e Schema Database

### 7.1 Percorso database

```
{userData}/spaces/{spaceId}/database/vectors.db
```

Ogni spazio ha il proprio database vettoriale isolato.

### 7.2 Schema SQL

```sql
-- Metadati dei chunk
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,                    -- Testo originale del chunk (per display)
  section_id TEXT,                          -- ID della sezione Markdown
  section_header TEXT,                      -- Header della sezione (es. "## Action Items")
  metadata TEXT,                            -- JSON: {noteTitle, folderId, totalChunks, ...}
  embedding_model TEXT,                     -- ID del modello che ha generato l'embedding
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE(note_id, chunk_index)
);

CREATE INDEX idx_embeddings_note_id ON embeddings(note_id);
CREATE INDEX idx_embeddings_section_id ON embeddings(section_id);

-- Vettori per KNN search (sqlite-vec)
CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
  id TEXT PRIMARY KEY,
  embedding float[768] distance_metric=cosine
);

-- Full-Text Search per hybrid search (BM25)
CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_fts USING fts5(
  content,
  note_title,
  content='embeddings',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- Trigger per sincronizzare FTS5 con la tabella embeddings
CREATE TRIGGER IF NOT EXISTS embeddings_ai AFTER INSERT ON embeddings BEGIN
  INSERT INTO embeddings_fts(rowid, content, note_title)
  VALUES (new.rowid, new.content, json_extract(new.metadata, '$.noteTitle'));
END;

CREATE TRIGGER IF NOT EXISTS embeddings_ad AFTER DELETE ON embeddings BEGIN
  INSERT INTO embeddings_fts(embeddings_fts, rowid, content, note_title)
  VALUES ('delete', old.rowid, old.content, json_extract(old.metadata, '$.noteTitle'));
END;

CREATE TRIGGER IF NOT EXISTS embeddings_au AFTER UPDATE ON embeddings BEGIN
  INSERT INTO embeddings_fts(embeddings_fts, rowid, content, note_title)
  VALUES ('delete', old.rowid, old.content, json_extract(old.metadata, '$.noteTitle'));
  INSERT INTO embeddings_fts(rowid, content, note_title)
  VALUES (new.rowid, new.content, json_extract(new.metadata, '$.noteTitle'));
END;

-- Stato dell'indicizzazione per delta indexing
CREATE TABLE IF NOT EXISTS indexing_status (
  note_id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL,              -- SHA-256 del contenuto della nota
  indexed_at TEXT DEFAULT (datetime('now')),
  chunk_count INTEGER NOT NULL
);

-- Metadata del database
CREATE TABLE IF NOT EXISTS db_meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
```

### 7.3 Dimensione stimata

Per ~500 note con media 5 chunk/nota = ~2500 chunk:
- Vettori: 2500 × 768 × 4 bytes = ~7.5 MB
- Metadati + FTS5: ~5-10 MB
- **Totale: ~15-20 MB per spazio** (trascurabile)

---

## 8. Hybrid Search (BM25 + Vector)

### 8.1 Perché hybrid search

La ricerca vettoriale pura fallisce su:
- **Nomi propri e termini tecnici**: "cosa ho scritto su React hooks?" — il vettore cattura il concetto ma non il termine esatto
- **Date e identificatori**: "nota del 15 gennaio" — nessun significato semantico, solo keyword match
- **Query corte e ambigue**: "deploy" — potrebbe matchare molte cose semanticamente

BM25 (keyword search) eccelle esattamente dove il vector search fallisce, e viceversa.

### 8.2 Architettura della ricerca

```
Query dell'utente: "Come configurare React hooks nel progetto?"
  │
  ├──────────────────────────────────────┐
  │                                      │
  ▼                                      ▼
VECTOR SEARCH                       BM25 SEARCH (FTS5)
  │                                      │
  │ embedQuery(query)                    │ FTS5 MATCH query
  │ vec0 KNN (k=20)                     │ BM25 ranking (top 20)
  │                                      │
  │ Risultato: chunk ordinati            │ Risultato: chunk ordinati
  │ per distanza coseno                  │ per score BM25
  │                                      │
  └──────────┬───────────────────────────┘
             │
             ▼
    RECIPROCAL RANK FUSION (RRF)
             │
             │ Merge dei due ranking
             │ con pesi differenziati
             │
             ▼
    HEURISTIC RE-RANKING
             │
             │ Boost per: recency, same-note grouping,
             │ title match
             │
             ▼
    Top-N risultati finali (default N=10)
```

### 8.3 Reciprocal Rank Fusion (RRF)

RRF combina due ranking senza dover normalizzare score che hanno scale diverse (BM25 è unbounded, cosine distance è 0-2).

**Formula:**

```
RRF_score(doc) = Σ (weight_i / (k + rank_i(doc)))
```

- `k = 60` (costante standard che previene che i risultati top-1 dominino)
- `weight_vector = 1.0` (la similarità semantica ha più peso)
- `weight_bm25 = 0.7` (il keyword match è complementare)

**Esempio:**

| Documento | Rank Vector | Rank BM25 | RRF Score |
|---|---|---|---|
| Chunk A | 1 | 3 | 1.0/(60+1) + 0.7/(60+3) = 0.0275 |
| Chunk B | 2 | 1 | 1.0/(60+2) + 0.7/(60+1) = 0.0276 |
| Chunk C | 5 | - | 1.0/(60+5) = 0.0154 |
| Chunk D | - | 2 | 0.7/(60+2) = 0.0113 |

Chunk B vince perché è forte su entrambi i ranking.

### 8.4 Implementazione

```typescript
interface HybridSearchOptions {
  query: string
  limit: number
  vectorWeight?: number      // default 1.0
  bm25Weight?: number        // default 0.7
  rrfK?: number              // default 60
  noteIds?: string[]         // filtro opzionale per note specifiche
  contextWindow?: number     // default 1 (chunk adiacenti da espandere)
}

interface RankedResult {
  id: string
  noteId: string
  content: string
  sectionId: string | null
  sectionHeader: string | null
  metadata: Record<string, unknown>
  rrfScore: number
  vectorDistance: number | null   // null se trovato solo via BM25
  bm25Rank: number | null        // null se trovato solo via vector
}
```

### 8.5 Query BM25

```sql
SELECT
  e.id, e.note_id, e.content, e.section_id, e.section_header, e.metadata,
  rank AS bm25_score
FROM embeddings_fts
JOIN embeddings e ON embeddings_fts.rowid = e.rowid
WHERE embeddings_fts MATCH ?
ORDER BY rank
LIMIT ?
```

FTS5 utilizza il tokenizer `unicode61` che supporta caratteri Unicode (multilingua). Il `rank` è il punteggio BM25 negativo (più negativo = più rilevante).

---

## 9. Scoring e Relevance

### 9.1 Heuristic Re-Ranking

Dopo la fusione RRF, si applicano boost euristici per migliorare l'ordinamento:

```typescript
function applyHeuristicBoosts(results: RankedResult[], query: string): RankedResult[] {
  return results.map(result => {
    let boost = 0

    // 1. TITLE MATCH: se il titolo della nota contiene termini della query
    const queryTerms = query.toLowerCase().split(/\s+/)
    const title = (result.metadata.noteTitle as string || '').toLowerCase()
    const titleMatches = queryTerms.filter(t => t.length > 2 && title.includes(t)).length
    if (titleMatches > 0) {
      boost += 0.003 * titleMatches  // boost leggero per match nel titolo
    }

    // 2. RECENCY: note modificate di recente sono probabilmente più rilevanti
    const updatedAt = result.metadata.updatedAt as string
    if (updatedAt) {
      const daysSinceUpdate = (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24)
      if (daysSinceUpdate < 7) boost += 0.002        // ultima settimana
      else if (daysSinceUpdate < 30) boost += 0.001   // ultimo mese
    }

    // 3. SAME-NOTE GROUPING: se più chunk della stessa nota matchano,
    //    la nota è probabilmente molto rilevante
    //    (gestito a livello superiore, non per singolo chunk)

    return { ...result, rrfScore: result.rrfScore + boost }
  }).sort((a, b) => b.rrfScore - a.rrfScore)
}
```

### 9.2 Same-Note Grouping

Quando più chunk della stessa nota appaiono nei risultati, la nota è probabilmente molto rilevante. Il sistema raggruppa i risultati per nota e applica un boost proporzionale:

```typescript
function applySameNoteBoost(results: RankedResult[]): RankedResult[] {
  // Conta quanti chunk per nota
  const noteChunkCount = new Map<string, number>()
  for (const r of results) {
    noteChunkCount.set(r.noteId, (noteChunkCount.get(r.noteId) || 0) + 1)
  }

  return results.map(r => {
    const count = noteChunkCount.get(r.noteId) || 1
    if (count > 1) {
      // Boost logaritmico: 2 chunk = +0.002, 3 chunk = +0.003, ecc.
      return { ...r, rrfScore: r.rrfScore + 0.002 * Math.log2(count) }
    }
    return r
  })
}
```

### 9.3 Relevance Score per la UI

Per mostrare all'utente uno score comprensibile (0-100%), si converte il punteggio RRF:

```typescript
function rrfToRelevancePercent(rrfScore: number, maxScore: number): number {
  // Normalizza rispetto allo score massimo nel result set
  const normalized = maxScore > 0 ? rrfScore / maxScore : 0
  return Math.round(normalized * 100)
}
```

Questo approccio è più robusto del rescaling arbitrario della distanza coseno perché:
- Lo score è relativo ai risultati trovati (il migliore è sempre 100%)
- Non dipende da range hardcoded del modello (il vecchio [0.15, 0.55])
- È intuitivo: "questo chunk è rilevante all'80% rispetto al chunk più rilevante"

### 9.4 Threshold di rilevanza

| Parametro | Valore | Motivazione |
|---|---|---|
| Threshold minimo RRF | Calcolato come `maxRRF * 0.25` | Filtra risultati con meno del 25% della rilevanza del migliore |
| Threshold minimo vector | Cosine distance < 1.2 | Esclude chunk semanticamente irrilevanti prima di RRF |

Il threshold non è più un valore fisso hardcoded, ma relativo al result set. Se il miglior risultato ha un RRF score di 0.030, tutto ciò sotto 0.0075 viene filtrato.

---

## 10. Multi-Chunk Retrieval

### 10.1 Il problema

Una domanda come "quali sono gli action items del meeting?" potrebbe matchare un chunk che contiene solo 3 dei 7 action items, perché la lista è stata splittata. L'utente si aspetta la lista completa.

### 10.2 Strategia a due livelli

#### Livello 1: Window Expansion (chunk adiacenti)

Per ogni chunk matchato all'indice N, si recuperano anche i chunk N-1 e N+1 della stessa nota. I chunk vengono concatenati in ordine.

```typescript
async expandWithWindow(
  matchedChunks: RankedResult[],
  windowSize: number = 1  // chunk prima/dopo
): Promise<ExpandedResult[]> {
  const expanded: ExpandedResult[] = []

  for (const chunk of matchedChunks) {
    // Trova tutti i chunk della stessa nota nell'intorno
    const adjacentChunks = await this.getChunksByNoteAndRange(
      chunk.noteId,
      chunk.chunkIndex - windowSize,
      chunk.chunkIndex + windowSize
    )

    // Concatena in ordine, rimuovendo duplicati
    const combinedContent = adjacentChunks
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map(c => c.content)
      .join('\n\n')

    expanded.push({
      ...chunk,
      expandedContent: combinedContent,
      chunkRange: {
        from: Math.max(0, chunk.chunkIndex - windowSize),
        to: chunk.chunkIndex + windowSize
      }
    })
  }

  return deduplicateOverlaps(expanded)
}
```

```sql
-- Query per chunk adiacenti
SELECT id, chunk_index, content, section_id, section_header
FROM embeddings
WHERE note_id = ?
  AND chunk_index BETWEEN ? AND ?
ORDER BY chunk_index
```

#### Livello 2: Section-Based Retrieval (sezione completa)

Quando un chunk matcha, si recuperano TUTTI i chunk con lo stesso `section_id`. Questo garantisce che l'LLM veda la sezione completa (es. tutta la lista di action items).

```typescript
async expandToSection(matchedChunks: RankedResult[]): Promise<ExpandedResult[]> {
  const expanded: ExpandedResult[] = []
  const processedSections = new Set<string>()

  for (const chunk of matchedChunks) {
    if (!chunk.sectionId || processedSections.has(chunk.sectionId)) continue
    processedSections.add(chunk.sectionId)

    // Recupera tutti i chunk della stessa sezione
    const sectionChunks = await this.getChunksBySection(chunk.sectionId)

    const combinedContent = sectionChunks
      .sort((a, b) => a.chunkIndex - b.chunkIndex)
      .map(c => c.content)
      .join('\n\n')

    expanded.push({
      ...chunk,
      expandedContent: combinedContent,
      sectionHeader: chunk.sectionHeader,
      chunkRange: {
        from: sectionChunks[0].chunkIndex,
        to: sectionChunks[sectionChunks.length - 1].chunkIndex
      }
    })
  }

  return expanded
}
```

```sql
-- Query per sezione completa
SELECT id, chunk_index, content, section_header
FROM embeddings
WHERE section_id = ?
ORDER BY chunk_index
```

### 10.3 Strategia di espansione

L'algoritmo di ricerca combina entrambi i livelli:

1. **Hybrid Search** → Top 20 chunk (via RRF)
2. **Heuristic re-ranking** → Top 10 chunk riordinati
3. **Section expansion**: per ogni chunk nel top 10, se ha un `section_id`, recupera la sezione completa
4. **Window expansion**: per chunk senza `section_id` (es. dalla sezione "intro"), applica window expansion ±1
5. **Deduplicazione**: rimuovi chunk duplicati (stessa nota, stesso range)
6. **Token budget**: tronca se il contesto totale supera il budget token dell'LLM

### 10.4 Token Budget

Il contesto espanso non deve superare un budget ragionevole per l'LLM:

| Modello | Context Window | Budget RAG consigliato |
|---|---|---|
| Qwen3-4B Q8 | 32K tokens | ~4K tokens per contesto RAG |
| Llama 3.1 8B Q8 | 8K tokens | ~2K tokens per contesto RAG |

Se il contesto espanso supera il budget, si troncano i risultati con score più basso.

---

## 11. Indicizzazione Incrementale

### 11.1 Auto-indexing con debounce

Quando una nota viene salvata, il sistema la ri-indicizza automaticamente con un debounce di 3 secondi:

```
Utente salva nota (edit) → t=0
Utente salva nota (edit) → t=1s (debounce reset)
Utente salva nota (edit) → t=2s (debounce reset)
Utente smette di editare → t=5s → trigger indexing (3s dopo ultimo save)
```

### 11.2 Content-Hash Delta Indexing

Prima di ri-indicizzare una nota, si confronta il hash SHA-256 del contenuto attuale con quello salvato:

```typescript
async isNoteStale(noteId: string, currentContent: string): Promise<boolean> {
  const currentHash = crypto.createHash('sha256').update(currentContent).digest('hex')
  const storedStatus = this.db.prepare(
    'SELECT content_hash FROM indexing_status WHERE note_id = ?'
  ).get(noteId)

  if (!storedStatus) return true  // Mai indicizzata
  return storedStatus.content_hash !== currentHash
}
```

Questo elimina l'80-90% del lavoro di re-embedding durante operazioni batch, dato che la maggior parte delle note non cambia.

### 11.3 Indexing Queue

Una coda gestisce l'indicizzazione in background senza bloccare la UI:

```typescript
class IndexingQueue {
  private queue: Map<string, IndexingJob> = new Map()  // noteId → job (deduplicato)
  private isProcessing = false
  private debounceTimers: Map<string, NodeJS.Timeout> = new Map()

  // Aggiunge o aggiorna un job nella coda (con debounce per nota)
  enqueue(noteId: string, spaceId: string, content: string): void {
    // Cancella timer precedente per questa nota
    const existingTimer = this.debounceTimers.get(noteId)
    if (existingTimer) clearTimeout(existingTimer)

    // Nuovo timer con debounce 3s
    this.debounceTimers.set(noteId, setTimeout(() => {
      this.queue.set(noteId, { noteId, spaceId, content })
      this.debounceTimers.delete(noteId)
      this.processNext()
    }, 3000))
  }

  // Processa un job alla volta, yieldando tra i chunk
  private async processNext(): Promise<void> {
    if (this.isProcessing || this.queue.size === 0) return
    this.isProcessing = true

    const [noteId, job] = this.queue.entries().next().value
    this.queue.delete(noteId)

    try {
      // Check se la nota è cambiata
      const isStale = await this.embeddingService.isNoteStale(noteId, job.content)
      if (!isStale) {
        this.isProcessing = false
        this.processNext()
        return
      }

      // Indicizza con yield tra chunk per non bloccare l'event loop
      await this.embeddingService.indexNote(job.spaceId, noteId, job.content, {
        onChunkIndexed: () => {
          // Yield all'event loop per permettere l'elaborazione IPC
          return new Promise(resolve => setImmediate(resolve))
        }
      })
    } catch (error) {
      console.error(`Indexing failed for note ${noteId}:`, error)
    } finally {
      this.isProcessing = false
      this.processNext()  // Processa il prossimo job
    }
  }
}
```

### 11.4 Hook nel salvataggio note

Il trigger si aggancia all'IPC handler di salvataggio note esistente:

```typescript
// In fileHandlers.ts o aiHandlers.ts
ipcMain.handle('file:saveNote', async (event, spaceId, noteId, content) => {
  // 1. Salva la nota nel filesystem (logica esistente)
  await fileSystemManager.saveNote(noteId, content)

  // 2. Accoda l'indicizzazione (debounced, non-blocking)
  indexingQueue.enqueue(noteId, spaceId, content)

  return { success: true }
})
```

### 11.5 Batch Initial Indexing

Quando uno spazio viene aperto per la prima volta (o l'utente richiede un full reindex):

```
1. Carica tutte le note dello spazio
2. Per ogni nota: controlla content_hash
3. Filtra solo le note stale (hash diverso o non indicizzate)
4. Accoda le note stale nell'IndexingQueue
5. Emetti eventi di progresso (ai:indexing-progress) per la UI
```

---

## 12. Gestione Memoria (16GB)

### 12.1 Budget di memoria

| Componente | Memoria stimata |
|---|---|
| macOS / OS | 3-4 GB |
| Electron (main + renderer) | 500MB - 1GB |
| nomic-embed-text-v2-moe Q8 | ~600MB |
| Qwen3-4B-Instruct Q8 | ~5GB |
| Llama 3.1 8B Q8 | ~9.5GB |
| **Disponibile per modelli** | **~11-12 GB** |

### 12.2 Strategia: Embedding Always-On

Il modello di embedding rimane caricato in memoria per tutta la durata dell'app. A 600MB, è leggero rispetto al budget totale e serve sia per l'indicizzazione continua che per le query di ricerca.

Il modello di chat viene caricato **on-demand** quando l'utente apre la chat o invia il primo messaggio, e scaricato dopo un timeout di inattività (5 minuti configurabile).

```
Stato iniziale:
  [Embedding Model: LOADED] [Chat Model: NOT LOADED]
  Memoria usata: ~600MB

Utente apre la chat:
  [Embedding Model: LOADED] [Chat Model: LOADING...]
  Memoria usata: ~600MB + ~5GB = ~5.6GB (con Qwen3-4B)

Utente smette di chattare per 5 minuti:
  [Embedding Model: LOADED] [Chat Model: UNLOADED]
  Memoria usata: ~600MB
```

### 12.3 Memory Check pre-caricamento

Prima di caricare un modello di chat, il sistema verifica la memoria disponibile:

```typescript
async canLoadChatModel(modelId: string): Promise<{ canLoad: boolean; reason?: string }> {
  const modelDef = ModelRegistry.getModel(modelId)
  if (!modelDef) return { canLoad: false, reason: 'Modello non trovato' }

  const mem = await si.mem()
  const availableBytes = mem.available
  const requiredBytes = modelDef.sizeBytes * 1.3  // 30% safety margin

  if (availableBytes < requiredBytes) {
    return {
      canLoad: false,
      reason: `Memoria insufficiente. Disponibile: ${formatBytes(availableBytes)}, ` +
              `richiesto: ${formatBytes(requiredBytes)}. ` +
              `Chiudi alcune applicazioni o usa un modello più piccolo.`
    }
  }

  return { canLoad: true }
}
```

### 12.4 Idle Timeout per il modello di chat

```typescript
private chatIdleTimer: NodeJS.Timeout | null = null
private readonly CHAT_IDLE_TIMEOUT_MS = 5 * 60 * 1000  // 5 minuti

onChatActivity(): void {
  // Reset del timer ad ogni attività di chat
  if (this.chatIdleTimer) clearTimeout(this.chatIdleTimer)
  this.chatIdleTimer = setTimeout(() => {
    this.unloadChatModel()
  }, this.CHAT_IDLE_TIMEOUT_MS)
}

private async unloadChatModel(): Promise<void> {
  // Scarica solo il modello di chat, l'embedding resta caricato
  await this.aiManager.unloadModel(this.chatModelId)
  this.chatIdleTimer = null
}
```

---

## 13. Ricerca Standalone (senza Chat)

### 13.1 Architettura

La ricerca semantica nelle note funziona indipendentemente dal modello di chat. Richiede solo il modello di embedding (sempre caricato).

```
Utente cerca "meeting di lunedì"
  │
  ▼
Embedding model genera il vettore della query
  │
  ▼
Hybrid search (vector + BM25) nel database dello spazio
  │
  ▼
Re-ranking euristico + espansione contesto
  │
  ▼
Risultati mostrati nella UI con:
  - Titolo della nota
  - Sezione matchata
  - Excerpt con highlight dei termini
  - Score di rilevanza (0-100%)
  │
  ▼
Click su un risultato → navigazione alla nota
```

### 13.2 IPC Handler

```typescript
ipcMain.handle('ai:searchNotes', async (event, spaceId, query, options) => {
  // Non richiede il modello di chat, solo l'embedding
  const embeddingService = EmbeddingService.getInstance()
  const vectorDB = VectorDBManager.getInstance(spaceId, dbPath)

  // Genera embedding della query
  const queryEmbedding = await embeddingService.embedQuery(query)

  // Hybrid search
  const results = await vectorDB.hybridSearch({
    query,
    queryEmbedding,
    limit: options.limit || 10,
    contextWindow: options.contextWindow || 1,
    noteIds: options.noteIds
  })

  return results
})
```

---

## 14. Architettura Componenti

### 14.1 Diagramma dei componenti

```
┌──────────────────────────────────────────────────────────┐
│                    RENDERER PROCESS                       │
│                                                           │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │ ChatInterface│  │ SearchPanel  │  │ NoteEditor      │ │
│  │ (RAG Chat)  │  │ (Standalone) │  │ (auto-index)    │ │
│  └──────┬───────┘  └──────┬───────┘  └───────┬─────────┘ │
│         │                  │                  │           │
│  ┌──────┴──────────────────┴──────────────────┴─────────┐│
│  │              React Hooks (useVectorSearch,            ││
│  │              useAIChat, useIndexingStatus)            ││
│  └──────────────────────┬───────────────────────────────┘│
└─────────────────────────┼────────────────────────────────┘
                          │ IPC
┌─────────────────────────┼────────────────────────────────┐
│                    MAIN PROCESS                           │
│                          │                                │
│  ┌───────────────────────▼───────────────────────────┐   │
│  │               AI IPC Handlers                      │   │
│  │  (ai:searchNotes, ai:indexNote, ai:generateResponse│   │
│  └───┬──────────┬──────────┬──────────────┬──────────┘   │
│      │          │          │              │               │
│  ┌───▼───┐ ┌───▼────┐ ┌───▼──────────┐ ┌▼────────────┐ │
│  │ AI    │ │Embedding│ │ VectorDB     │ │ Indexing    │  │
│  │Manager│ │Service  │ │ Manager      │ │ Queue       │  │
│  │       │ │         │ │              │ │             │  │
│  │-model │ │-chunking│ │-vec0 (KNN)  │ │-debounce    │  │
│  │ load  │ │-embed   │ │-FTS5 (BM25) │ │-hash check  │  │
│  │-chat  │ │-context │ │-hybrid      │ │-background  │  │
│  │ gen   │ │ headers │ │ search      │ │ processing  │  │
│  │-idle  │ │         │ │-RRF fusion  │ │             │  │
│  │ mgmt  │ │         │ │-expansion   │ │             │  │
│  └───────┘ └─────────┘ └─────────────┘ └─────────────┘  │
│                                                           │
│  ┌─────────────────────────────────────────────────────┐ │
│  │               Per-Space SQLite Databases             │ │
│  │  spaces/{id}/database/vectors.db                     │ │
│  │  [embeddings] [vec_embeddings] [embeddings_fts]      │ │
│  │  [indexing_status] [db_meta]                         │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

### 14.2 File principali

| File | Responsabilità |
|---|---|
| `src/main/ai/AIManager.ts` | Lifecycle modelli, chat generation, idle timeout |
| `src/main/ai/EmbeddingService.ts` | Chunking structure-aware, embedding con contextual headers |
| `src/main/ai/VectorDBManager.ts` | Storage, hybrid search, RRF, expansion, FTS5 sync |
| `src/main/ai/IndexingQueue.ts` | **(NUOVO)** Coda di indicizzazione con debounce e yielding |
| `src/main/ai/types.ts` | Tipi condivisi (StructuredChunk, HybridSearchOptions, ecc.) |
| `src/main/ipc/aiHandlers.ts` | IPC handlers per search, indexing, chat |
| `src/renderer/src/components/ai/ChatInterface.tsx` | UI chat con RAG context |
| `src/renderer/src/components/ai/ChatContextNotes.tsx` | Display risultati con score |

---

## 15. Flusso Dati Completo

### 15.1 Flusso di indicizzazione (background)

```
1. Utente edita nota e salva
2. IPC: file:saveNote → salva su filesystem
3. IndexingQueue.enqueue(noteId) → debounce 3s
4. Dopo 3s senza altri save:
   a. isNoteStale(noteId, content) → SHA-256 check
   b. Se stale:
      - extractTextFromLexicalContent(content)
      - structureAwareChunk(text) → StructuredChunk[]
      - Per ogni chunk:
        - buildEmbeddingText(chunk, noteTitle) → testo con contextual header
        - embedDocument(enrichedText) → Float32Array[768]
        - setImmediate() → yield event loop
      - Transaction:
        - DELETE FROM embeddings WHERE note_id = ?
        - DELETE FROM vec_embeddings WHERE id IN (...)
        - INSERT into embeddings + vec_embeddings (FTS5 auto-sync via trigger)
        - UPDATE indexing_status SET content_hash = ?, chunk_count = ?
5. Emetti ai:indexing-progress per la UI
```

### 15.2 Flusso di ricerca (RAG chat)

```
1. Utente invia messaggio nella chat
2. ChatInterface.handleSend(content)
3. searchRelevantNotes(content):
   a. IPC: ai:searchNotes(spaceId, query, options)
   b. embedQuery(query) → "search_query: " + query → Float32Array[768]
   c. hybridSearch():
      - Vector KNN: vec0 MATCH queryVec, k=20
      - BM25: FTS5 MATCH queryTerms, LIMIT 20
      - RRF fusion (k=60, weights: vec=1.0, bm25=0.7)
      - Heuristic boosts (recency, title match, same-note)
      - Filter: RRF score >= 25% del max
   d. expandResults():
      - Section expansion: fetch tutti i chunk dello stesso section_id
      - Window expansion: fetch chunk ±1 per chunk senza section_id
      - Deduplicazione
      - Token budget trimming
   e. Return ExpandedResult[]
4. buildContextPrompt(results, userMessage):
   ```
   Contesto dalle tue note:

   [Nota: "Meeting Notes" | Sezione: "Action Items" | Rilevanza: 95%]
   - Comprare il latte
   - Chiamare il dentista
   - Inviare il report a Sara
   ...

   [Nota: "Progetto React" | Sezione: "Setup" | Rilevanza: 72%]
   Per configurare il progetto...
   ...

   Domanda: {userMessage}
   ```
5. sendMessage(apiMessages) → AI streaming response
6. Mostra risposta + context notes nella UI
```

---

## 16. Fasi di Implementazione

### Fase 1: Quick Wins (1-2 giorni ciascuno)

| # | Modifica | Impatto | File coinvolti |
|---|---|---|---|
| 1 | Rimuovi `normalizeVector()` | Semplificazione, performance | `EmbeddingService.ts` |
| 2 | Cache `LlamaEmbeddingContext` | Riduce overhead allocazioni | `EmbeddingService.ts` |
| 3 | Contextual chunk headers | ~35% meno fallimenti retrieval | `EmbeddingService.ts` |
| 4 | Content-hash delta indexing | 80-90% meno re-embedding | `VectorDBManager.ts`, `EmbeddingService.ts` |

### Fase 2: Core (3-5 giorni ciascuno)

| # | Modifica | Impatto | File coinvolti |
|---|---|---|---|
| 5 | FTS5 table + hybrid search con RRF | Miglioramento qualità retrieval significativo | `VectorDBManager.ts` |
| 6 | Chunking structure-aware | Chunk di qualità superiore | `EmbeddingService.ts` |
| 7 | Window + section expansion | Contesto completo per l'LLM | `VectorDBManager.ts`, `ChatInterface.tsx` |
| 8 | Nuovo sistema di scoring (RRF-based) | Score più accurati e calibrati | `ChatContextNotes.tsx`, `VectorDBManager.ts` |

### Fase 3: Architettura (1-2 settimane)

| # | Modifica | Impatto | File coinvolti |
|---|---|---|---|
| 9 | IndexingQueue con debounce e yielding | Indicizzazione background non-blocking | Nuovo `IndexingQueue.ts`, IPC handlers |
| 10 | Auto-indexing al salvataggio note | Zero intervento utente | `fileHandlers.ts`, `aiHandlers.ts` |
| 11 | Chat model idle timeout + memory check | Gestione memoria ottimale per 16GB | `AIManager.ts` |
| 12 | Ricerca standalone (senza chat) | Funzionalità indipendente dal chat model | UI + IPC handlers |

### Fase 4: Ottimizzazioni future (quando necessario)

| # | Modifica | Quando | Impatto |
|---|---|---|---|
| 13 | Matryoshka truncation a 256 dim | Se vector search supera 100ms | ~3x speedup ricerca |
| 14 | Worker thread per embedding | Se il main thread si blocca visibilmente | Indicizzazione parallela reale |

---

## Appendice A: Riferimenti

- [Firecrawl: Best Chunking Strategies for RAG 2025](https://www.firecrawl.dev/blog/best-chunking-strategies-rag-2025)
- [Alex Garcia: Hybrid full-text search and vector search with SQLite](https://alexgarcia.xyz/blog/2024/sqlite-vec-hybrid-search/index.html)
- [NirDiamant/RAG_Techniques: Contextual Chunk Headers](https://github.com/NirDiamant/RAG_Techniques)
- [Hugging Face: nomic-embed-text-v2-moe](https://huggingface.co/nomic-ai/nomic-embed-text-v2-moe)
- [sqlite-vec: Stable Release](https://alexgarcia.xyz/blog/2024/sqlite-vec-stable-release/index.html)
- [SQLite FTS5 Extension](https://www.sqlite.org/fts5.html)
- [Elastic: Weighted Reciprocal Rank Fusion](https://www.elastic.co/search-labs/blog/weighted-reciprocal-rank-fusion-rrf)

## Appendice B: Glossario

| Termine | Descrizione |
|---|---|
| **BM25** | Algoritmo di ranking per keyword search (Best Match 25). Considera frequenza termini e lunghezza documenti. |
| **Cosine Distance** | Metrica di distanza tra vettori. 0 = identici, 2 = opposti. `similarity = 1 - distance`. |
| **FTS5** | Full-Text Search 5, modulo SQLite built-in per ricerca testo con ranking BM25. |
| **KNN** | K-Nearest Neighbors, ricerca dei K vettori più vicini a un vettore query. |
| **RRF** | Reciprocal Rank Fusion, metodo per combinare ranking da sistemi di scoring diversi. |
| **vec0** | Virtual table di sqlite-vec per storage e ricerca vettoriale. |
| **Contextual Header** | Metadati (titolo, sezione) preposti al testo del chunk prima dell'embedding. |
| **Section ID** | Identificatore della sezione Markdown a cui un chunk appartiene. |
| **Window Expansion** | Recupero dei chunk adiacenti (N-1, N+1) per fornire contesto più ampio. |
