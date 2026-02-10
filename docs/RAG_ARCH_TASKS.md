# RAG Architecture — Task di Implementazione

Questo documento suddivide l'implementazione della nuova architettura RAG (descritta in `docs/RAG_ARCHITECTURE.md`) in task ordinati logicamente e raggruppati per macro-funzionalità. Ogni task include un prompt da utilizzare con Claude Code.

> **Legenda stato**: ⬜ Da fare | 🔲 In corso | ✅ Completato

---

## Indice Macro-Funzionalità

1. [A — Quick Wins e Ottimizzazioni Base](#a--quick-wins-e-ottimizzazioni-base)
2. [B — Schema Database e Migrazione](#b--schema-database-e-migrazione)
3. [C — Chunking Structure-Aware](#c--chunking-structure-aware)
4. [D — Hybrid Search (BM25 + Vector + RRF)](#d--hybrid-search-bm25--vector--rrf)
5. [E — Scoring e Relevance](#e--scoring-e-relevance)
6. [F — Multi-Chunk Retrieval ed Expansion](#f--multi-chunk-retrieval-ed-expansion)
7. [G — Indicizzazione Incrementale e Auto-Indexing](#g--indicizzazione-incrementale-e-auto-indexing)
8. [H — Gestione Memoria e Lifecycle Modelli](#h--gestione-memoria-e-lifecycle-modelli)
9. [I — Ricerca Standalone (senza Chat)](#i--ricerca-standalone-senza-chat)
10. [J — Integrazione UI e Prompt Engineering](#j--integrazione-ui-e-prompt-engineering)

---

## A — Quick Wins e Ottimizzazioni Base

Modifiche rapide e a basso rischio che migliorano le fondamenta prima delle feature principali.

---

### Task A1 — Rimuovere la normalizzazione L2 dei vettori ✅

**File coinvolti:** `src/main/ai/EmbeddingService.ts`
**Sezione RAG_ARCHITECTURE.md:** §3.3 Normalizzazione L2

**Descrizione:**
Il VectorDBManager utilizza già `distance_metric=cosine` nella tabella vec0, quindi la normalizzazione L2 manuale è ridondante. Rimuovere la chiamata a `normalizeVector()` in EmbeddingService per semplificare il codice e risparmiare cicli CPU.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "3.3 Normalizzazione L2".

Contesto: il VectorDBManager crea la tabella vec0 con `distance_metric=cosine`, quindi sqlite-vec gestisce internamente la normalizzazione. La funzione `normalizeVector()` chiamata in EmbeddingService è ridondante.

Task:
1. Leggi `src/main/ai/EmbeddingService.ts` e individua dove viene chiamata `normalizeVector()` o dove i vettori vengono normalizzati manualmente prima dell'inserimento.
2. Rimuovi la logica di normalizzazione L2 (la funzione e le sue invocazioni).
3. Verifica che nessun altro file importi o utilizzi `normalizeVector()`. Se la funzione è definita come utility condivisa, rimuovila solo se non ha altri consumer.
4. Assicurati che i vettori prodotti da `embedDocument()`, `embedQuery()` e `embedText()` vengano restituiti così come escono dal modello, senza post-processing.
5. Esegui `pnpm typecheck` per verificare che non ci siano errori di tipo.

NON modificare la tabella vec0 né VectorDBManager — la distance_metric=cosine è già configurata correttamente.
```

---

### Task A2 — Cache dell'embedding context ✅

**File coinvolti:** `src/main/ai/EmbeddingService.ts`, `src/main/ai/AIManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §3.4 Cache del Contesto

**Descrizione:**
Attualmente ogni operazione di embedding potrebbe ricreare un `LlamaEmbeddingContext`. Implementare una cache a livello di EmbeddingService che riutilizza il contesto per tutte le operazioni, evitando riallocazioni costose.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "3.4 Cache del Contesto".

Contesto: ogni chiamata a embedDocument/embedQuery/embedText in EmbeddingService potrebbe ricreare un LlamaEmbeddingContext. Questo è costoso e va evitato cachando il contesto.

Task:
1. Leggi `src/main/ai/EmbeddingService.ts` e `src/main/ai/AIManager.ts` per capire come viene attualmente creato e gestito il LlamaEmbeddingContext.
2. Aggiungi un campo privato `embeddingContext: LlamaEmbeddingContext | null` in EmbeddingService.
3. Implementa un metodo privato `getOrCreateContext()` che:
   - Se il contesto esiste e il modello non è cambiato, lo riutilizza.
   - Se il contesto non esiste o il modello è cambiato, lo (ri)crea chiamando AIManager.
   - Gestisca il caso in cui il modello viene scaricato (invalida il contesto).
4. Modifica tutti i metodi di embedding (`embedText`, `embedDocument`, `embedQuery`) per usare `getOrCreateContext()` invece di creare un contesto ad ogni chiamata.
5. Aggiungi un metodo `dispose()` o `invalidateContext()` per permettere la pulizia esplicita (chiamata da AIManager quando il modello viene scaricato).
6. Esegui `pnpm typecheck` per verificare la correttezza dei tipi.

Ricorda: node-llama-cpp è ESM, usa solo type-only imports al top level e dynamic import() per i valori.
```

---

### Task A3 — Contextual Chunk Headers ✅

**File coinvolti:** `src/main/ai/EmbeddingService.ts`
**Sezione RAG_ARCHITECTURE.md:** §6 Contextual Chunk Headers

**Descrizione:**
Prima di generare l'embedding, anteporre al testo del chunk un header contestuale con titolo della nota e sezione di appartenenza. Il testo arricchito è usato SOLO per l'embedding; nel database si salva il testo originale.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "6. Contextual Chunk Headers" (§6.1, §6.2, §6.3).

Contesto: quando l'embedding model processa un chunk isolato, non ha contesto sulla nota o sezione di appartenenza. Anteporre un "contextual header" migliora la qualità del retrieval del ~35%.

Task:
1. Leggi `src/main/ai/EmbeddingService.ts`, in particolare il metodo `indexNote()` e il flusso di generazione embedding.
2. Implementa la funzione `buildEmbeddingText(chunk, noteTitle)` come descritto nella sezione §6.3 del documento architetturale:
   - Formato: `Note: "{noteTitle}" | Section: "{sectionHeader}" | {chunk.text}`
   - Se `sectionHeader` è assente, ometti la parte Section.
3. Modifica il metodo `indexNote()` (o il punto dove si genera l'embedding per ogni chunk) per:
   - Usare `buildEmbeddingText()` per costruire il testo da passare a `embedDocument()`.
   - Continuare a salvare `chunk.text` originale (senza header) nel campo `content` del database.
4. Il chunk attualmente potrebbe non avere un campo `sectionHeader`. Per ora, usa il titolo della nota come unico contesto aggiuntivo. Il campo `sectionHeader` verrà aggiunto nel Task C (chunking structure-aware).
5. Esegui `pnpm typecheck`.

IMPORTANTE: il contextual header va usato SOLO per l'embedding. Nel database `embeddings.content` si salva il testo originale del chunk per la visualizzazione nella UI e per il contesto passato all'LLM.
```

---

### Task A4 — Content-hash per delta indexing ✅

**File coinvolti:** `src/main/ai/VectorDBManager.ts`, `src/main/ai/EmbeddingService.ts`, `src/main/ipc/aiHandlers.ts`
**Sezione RAG_ARCHITECTURE.md:** §11.2 Content-Hash Delta Indexing

**Descrizione:**
Prima di re-indicizzare una nota, confrontare il hash SHA-256 del contenuto attuale con quello salvato nella tabella `indexing_status`. Se non è cambiato, skip. Elimina l'80-90% del lavoro di re-embedding durante operazioni batch.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "11.2 Content-Hash Delta Indexing" e lo schema della tabella `indexing_status` in §7.2.

Contesto: attualmente ogni reindex rigenera gli embedding di tutte le note, anche se non sono cambiate. Confrontando un hash SHA-256 del contenuto si può evitare lavoro inutile.

Task:
1. Leggi `src/main/ai/VectorDBManager.ts` e il metodo `initialize()` per capire come vengono create le tabelle.
2. Aggiungi la creazione della tabella `indexing_status` nell'inizializzazione del database:
   ```sql
   CREATE TABLE IF NOT EXISTS indexing_status (
     note_id TEXT PRIMARY KEY,
     content_hash TEXT NOT NULL,
     indexed_at TEXT DEFAULT (datetime('now')),
     chunk_count INTEGER NOT NULL
   );
   ```
3. Aggiungi i metodi a VectorDBManager:
   - `isNoteStale(noteId: string, currentContent: string): boolean` — confronta SHA-256 del contenuto con quello salvato.
   - `updateIndexingStatus(noteId: string, contentHash: string, chunkCount: number): void` — aggiorna/inserisce lo stato.
   - `getIndexingStatus(noteId: string)` — restituisce hash e data.
4. Modifica `src/main/ai/EmbeddingService.ts` nel metodo `indexNote()` per:
   - Prima di tutto, chiamare `vectorDB.isNoteStale()`. Se la nota non è stale, return early.
   - Dopo l'indicizzazione completa, chiamare `vectorDB.updateIndexingStatus()`.
5. Modifica `src/main/ipc/aiHandlers.ts` nell'handler `ai:indexAllNotes` per:
   - Passare il contenuto originale al check di staleness.
   - Emettere nel progresso quante note sono state skippate.
6. Usa `crypto.createHash('sha256')` di Node.js per generare l'hash.
7. Esegui `pnpm typecheck`.
```

---

## B — Schema Database e Migrazione

Evoluzione dello schema per supportare le nuove feature (FTS5, section_id, triggers).

---

### Task B1 — Estendere lo schema embeddings con section_id e section_header ✅

**File coinvolti:** `src/main/ai/VectorDBManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §7.2 Schema SQL

**Descrizione:**
Aggiungere le colonne `section_id` e `section_header` alla tabella `embeddings` per supportare il chunking structure-aware e il section-based retrieval.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "7.2 Schema SQL" — colonne `section_id` e `section_header` nella tabella `embeddings`.

Contesto: lo schema attuale della tabella `embeddings` non ha le colonne `section_id` e `section_header` necessarie per il chunking structure-aware e il section-based retrieval.

Task:
1. Leggi `src/main/ai/VectorDBManager.ts`, in particolare il metodo `initialize()` dove viene creato lo schema e dove avvengono le migrazioni.
2. Aggiungi una migrazione sicura che:
   - Controlla se le colonne `section_id TEXT` e `section_header TEXT` esistono già nella tabella `embeddings`.
   - Se non esistono, le aggiunge con `ALTER TABLE embeddings ADD COLUMN`.
   - Crea l'indice `idx_embeddings_section_id` su `section_id` (se non esiste).
3. Aggiorna il metodo `upsertDocument()` (o equivalente) per accettare e salvare `section_id` e `section_header`.
4. Aggiorna i tipi/interfacce di input/output dei metodi di VectorDBManager per includere i nuovi campi (opzionali per retrocompatibilità).
5. Traccia la migrazione nel sistema `db_meta` esistente (es. `migration_section_fields = 'done'`).
6. Esegui `pnpm typecheck`.

NOTA: la migrazione deve essere safe per database esistenti — non distruggere dati. Usa `ALTER TABLE ADD COLUMN` che in SQLite è sempre safe.
```

---

### Task B2 — Creare la tabella FTS5 con triggers di sincronizzazione ✅

**File coinvolti:** `src/main/ai/VectorDBManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §7.2 Schema SQL (tabella `embeddings_fts` e triggers)

**Descrizione:**
Creare la virtual table FTS5 per keyword search BM25 e i triggers per mantenerla sincronizzata con la tabella `embeddings`. Questo è prerequisito per l'hybrid search.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "7.2 Schema SQL" — tabella `embeddings_fts` e i 3 trigger (embeddings_ai, embeddings_ad, embeddings_au).

Contesto: per implementare l'hybrid search (Task D) serve una tabella FTS5 che indicizza il contenuto dei chunk per keyword search BM25. La tabella deve restare sincronizzata con `embeddings` tramite trigger SQLite.

Task:
1. Leggi `src/main/ai/VectorDBManager.ts` per capire l'inizializzazione del database e il sistema di migrazioni.
2. Aggiungi la creazione della virtual table FTS5:
   ```sql
   CREATE VIRTUAL TABLE IF NOT EXISTS embeddings_fts USING fts5(
     content,
     note_title,
     content='embeddings',
     content_rowid='rowid',
     tokenize='unicode61'
   );
   ```
3. Crea i 3 trigger di sincronizzazione (INSERT, DELETE, UPDATE) come definiti nel §7.2 del documento architetturale. I trigger devono estrarre `noteTitle` dal campo `metadata` JSON.
4. Gestisci la migrazione per database esistenti:
   - Se la tabella FTS5 non esiste, creala.
   - Se la tabella FTS5 esiste ma è vuota e `embeddings` ha dati, fai un rebuild: `INSERT INTO embeddings_fts(embeddings_fts) VALUES('rebuild')`.
   - Crea i trigger solo se non esistono già.
5. Traccia la migrazione in `db_meta`.
6. Esegui `pnpm typecheck`.

IMPORTANTE: FTS5 utilizza `content='embeddings'` (content-sync mode). Questo significa che il contenuto testuale viene letto dalla tabella `embeddings` tramite il rowid. I trigger DEVONO essere corretti altrimenti FTS5 e embeddings vanno fuori sync.
```

---

## C — Chunking Structure-Aware

Sostituzione del chunking token-based con uno structure-aware che rispetta la struttura Markdown.

---

### Task C1 — Riscrittura dell'estrazione testo da Markdown ✅

**File coinvolti:** `src/main/ai/EmbeddingService.ts`, `src/main/ipc/aiHandlers.ts`
**Sezione RAG_ARCHITECTURE.md:** §4.2 Estrazione testo

**Descrizione:**
Modificare l'estrazione del testo per preservare la struttura leggera del Markdown (headers, liste, enfasi) rimuovendo solo gli elementi non-semantici (immagini, URL, HTML, linee orizzontali).

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "4.2 Estrazione testo".

Contesto: attualmente `extractTextFromMarkdown()` in EmbeddingService strippa TUTTO il Markdown trasformandolo in testo piatto. Questo causa perdita di struttura. La nuova implementazione deve preservare i marcatori semantici.

Task:
1. Leggi `src/main/ai/EmbeddingService.ts` e trova il metodo `extractTextFromMarkdown()` (o equivalente).
2. Leggi anche `src/main/ipc/aiHandlers.ts` e trova `extractTextFromLexicalContent()` per capire come il JSON Lexical viene convertito in testo.
3. Riscrivi la funzione di estrazione testo seguendo le regole della §4.2:
   - **RIMUOVI**: immagini (`![alt](url)` → mantieni solo `alt`), URL dei link (`[text](url)` → mantieni solo `text`), tag HTML, linee orizzontali (`---`)
   - **PRESERVA**: marcatori di header (`#`, `##`, `###`), marcatori di lista (`-`, `*`, `1.`), enfasi (`**bold**`, `*italic*`), blockquote (`>`), code blocks (come testo, senza syntax markers ` ``` `)
4. La funzione deve poter operare sia su Markdown puro che sul testo estratto da Lexical.
5. Scrivi la funzione in modo che sia facilmente testabile (input string, output string, nessuna dipendenza esterna).
6. Esegui `pnpm typecheck`.

NOTA: questa funzione è un prerequisito per il chunking structure-aware (Task C2) perché l'algoritmo di chunking si basa sulla presenza dei marcatori `#` per identificare le sezioni.
```

---

### Task C2 — Implementare il chunking structure-aware ⬜

**File coinvolti:** `src/main/ai/EmbeddingService.ts`
**Sezione RAG_ARCHITECTURE.md:** §5 Chunking Structure-Aware (§5.2, §5.3, §5.4)

**Descrizione:**
Sostituire l'algoritmo di chunking token-based puro con uno structure-aware che splitta il testo sulle sezioni Markdown, rispetta sotto-strutture (liste, blockquote, tabelle), e produce chunk con metadati di sezione.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "5. Chunking Structure-Aware" (§5.2 Algoritmo, §5.3 Parametri, §5.4 Struttura risultante).

Contesto: il chunking attuale splitta su paragrafi accumulando fino a 256 token, senza rispettare sezioni Markdown. Il nuovo algoritmo deve: (1) parsare sezioni da header H1/H2/H3, (2) mantenere sezioni corte intere, (3) splittare sezioni lunghe rispettando sotto-strutture.

Task:
1. Leggi `src/main/ai/EmbeddingService.ts`, in particolare `chunkText()` e metodi correlati per capire l'interfaccia attuale.
2. Definisci l'interfaccia `StructuredChunk` come da §5.4:
   ```typescript
   interface StructuredChunk {
     text: string
     index: number
     sectionId: string
     sectionHeader: string
     startOffset: number
     endOffset: number
   }
   ```
   Aggiungi questa interfaccia nel file dei tipi appropriato (es. `src/main/ai/types.ts` se esiste, altrimenti nello stesso file).
3. Implementa il metodo `structureAwareChunk(text: string, noteId: string, options?)` che:
   - **Step 1**: Splitta il testo sugli header (`# `, `## `, `### `) — ogni header + contenuto = una "sezione". Il testo prima del primo header = sezione "intro".
   - **Step 2**: Per ogni sezione:
     - Se `token_count(sezione) <= maxChunkTokens (384)` → la sezione diventa UN chunk. Genera `sectionId = hash(noteId + headerText)`.
     - Se `token_count(sezione) > maxChunkTokens` → splitta internamente: MAI spezzare nel mezzo di un list item, blockquote o tabella. Splitta su doppi newline come fallback. Overlap di 32 token tra sub-chunk. Tutti i sub-chunk condividono lo stesso `sectionId`.
   - **Step 3**: Scarta chunk con meno di 10 token.
   - **Step 4**: Mergia sezioni con meno di 32 token (`minChunkTokens`) con la sezione successiva.
4. Il conteggio token DEVE usare il tokenizer del modello (come fa `chunkText()` attualmente). Il metodo è quindi async.
5. Parametri: `maxChunkTokens = 384`, `overlapTokens = 32`, `minChunkTokens = 32` (come da §5.3).
6. Aggiorna `indexNote()` per usare `structureAwareChunk()` al posto di `chunkText()`, passando i metadati di sezione (`sectionId`, `sectionHeader`) al VectorDBManager.
7. Mantieni il vecchio metodo `chunkText()` come fallback (potrebbe servire per testi non-Markdown) ma il path principale deve usare il nuovo algoritmo.
8. Esegui `pnpm typecheck`.
```

---

### Task C3 — Aggiornare indexNote() per i chunk strutturati ⬜

**File coinvolti:** `src/main/ai/EmbeddingService.ts`, `src/main/ai/VectorDBManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §4.1 Pipeline di Indicizzazione, §6.3 Implementazione headers

**Descrizione:**
Aggiornare il flusso di indicizzazione per utilizzare i `StructuredChunk` del nuovo chunking, salvando `section_id` e `section_header` nel database e usando il contextual header per l'embedding.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "4.1 Pipeline di Indicizzazione" e "6.3 Implementazione" dei contextual headers.

Contesto: i Task C1 e C2 hanno introdotto l'estrazione testo preservante struttura e il chunking structure-aware. Ora il flusso di `indexNote()` deve essere aggiornato per:
1. Usare i `StructuredChunk` (con `sectionId`, `sectionHeader`).
2. Usare `buildEmbeddingText()` (dal Task A3) con i dati di sezione.
3. Salvare `section_id` e `section_header` nel database (campi aggiunti nel Task B1).

Task:
1. Leggi `src/main/ai/EmbeddingService.ts` (metodo `indexNote()`) e `src/main/ai/VectorDBManager.ts` (metodo `upsertDocument()`).
2. Modifica `indexNote()` per:
   - Usare la nuova estrazione testo (Task C1) che preserva struttura Markdown leggera.
   - Chiamare `structureAwareChunk()` (Task C2) invece di `chunkText()`.
   - Per ogni `StructuredChunk`:
     - Costruire il testo arricchito con `buildEmbeddingText(chunk, noteTitle)` (Task A3), includendo ora `sectionHeader`.
     - Generare embedding con `embedDocument(enrichedText)`.
     - Salvare nel DB con `section_id`, `section_header` e il `content` originale (senza header).
3. Aggiorna la chiamata a `upsertDocument()` (o equivalente) per passare `section_id` e `section_header`.
4. Aggiorna il campo `metadata` JSON per includere `totalChunks`, `noteTitle`, e qualsiasi altro metadato utile.
5. Verifica che la cancellazione dei vecchi chunk (`deleteDocumentsForNote`) funzioni ancora correttamente con i nuovi campi.
6. Esegui `pnpm typecheck`.

Dipendenze: Task A3, B1, C1, C2 devono essere completati prima di questo.
```

---

## D — Hybrid Search (BM25 + Vector + RRF)

Implementazione della ricerca ibrida che combina similarità vettoriale e keyword search.

---

### Task D1 — Implementare la query BM25 su FTS5 ⬜

**File coinvolti:** `src/main/ai/VectorDBManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §8.5 Query BM25

**Descrizione:**
Aggiungere a VectorDBManager un metodo per eseguire ricerche BM25 sulla tabella FTS5, restituendo risultati ordinati per rilevanza keyword.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "8.5 Query BM25".

Contesto: la tabella FTS5 `embeddings_fts` è stata creata nel Task B2. Ora serve un metodo per eseguire query BM25 (keyword search) su di essa.

Task:
1. Leggi `src/main/ai/VectorDBManager.ts` per capire il pattern attuale dei metodi di query.
2. Implementa un metodo `bm25Search(query: string, limit: number, noteIds?: string[])` che:
   - Esegue la query SQL FTS5 come da §8.5:
     ```sql
     SELECT e.id, e.note_id, e.content, e.section_id, e.section_header, e.metadata,
            rank AS bm25_score
     FROM embeddings_fts
     JOIN embeddings e ON embeddings_fts.rowid = e.rowid
     WHERE embeddings_fts MATCH ?
     ORDER BY rank
     LIMIT ?
     ```
   - Se `noteIds` è fornito, aggiunge un filtro `AND e.note_id IN (...)`.
   - Gestisce il caso in cui la query contiene caratteri speciali FTS5 (escape o sanitizzazione).
   - Restituisce un array di risultati con `id`, `noteId`, `content`, `sectionId`, `sectionHeader`, `metadata` (parsed da JSON), e `bm25Score`.
3. Il `rank` di FTS5 è negativo (più negativo = più rilevante). Documentalo nel tipo di ritorno.
4. Gestisci gli errori (es. tabella FTS5 vuota, query invalida) con fallback graceful (ritorna array vuoto).
5. Esegui `pnpm typecheck`.

NOTA: il tokenizer `unicode61` supporta caratteri Unicode multilingua. Non serve preprocessing speciale per lingue non-inglesi.
```

---

### Task D2 — Implementare Reciprocal Rank Fusion (RRF) ⬜

**File coinvolti:** `src/main/ai/VectorDBManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §8.3 Reciprocal Rank Fusion (RRF), §8.4 Implementazione

**Descrizione:**
Implementare l'algoritmo RRF per fondere i ranking della ricerca vettoriale e BM25 in un unico ranking combinato.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "8.3 Reciprocal Rank Fusion (RRF)" e "8.4 Implementazione".

Contesto: la ricerca ibrida produce due ranking separati (vector KNN e BM25). RRF li combina senza dover normalizzare score che hanno scale diverse.

Task:
1. Leggi `src/main/ai/VectorDBManager.ts`.
2. Definisci le interfacce come da §8.4:
   ```typescript
   interface HybridSearchOptions {
     query: string
     queryEmbedding: Float32Array
     limit: number
     vectorWeight?: number    // default 1.0
     bm25Weight?: number      // default 0.7
     rrfK?: number            // default 60
     noteIds?: string[]
     contextWindow?: number   // default 1
   }

   interface RankedResult {
     id: string
     noteId: string
     chunkIndex: number
     content: string
     sectionId: string | null
     sectionHeader: string | null
     metadata: Record<string, unknown>
     rrfScore: number
     vectorDistance: number | null
     bm25Rank: number | null
   }
   ```
3. Implementa il metodo `hybridSearch(options: HybridSearchOptions): RankedResult[]` che:
   - Esegue in parallelo (o sequenzialmente) vector KNN (k=20) e BM25 (limit=20).
   - Per ogni documento, calcola: `RRF_score = Σ (weight_i / (k + rank_i))`.
   - Unisce i risultati: un doc trovato solo da vector ha `bm25Rank = null` e vice versa.
   - Ordina per `rrfScore` decrescente.
   - Applica un pre-filtro sulla vector distance: escludi chunk con cosine distance > 1.2 prima di RRF.
   - Restituisce i top `limit` risultati.
4. I parametri default sono: `vectorWeight = 1.0`, `bm25Weight = 0.7`, `rrfK = 60`.
5. Gestisci il caso limite: se FTS5 è vuota (nessun dato indicizzato), fai fallback a solo vector search.
6. Esegui `pnpm typecheck`.

NOTA: la formula RRF è `RRF_score(doc) = Σ (weight_i / (k + rank_i(doc)))` dove rank parte da 1 (il primo risultato ha rank 1).
```

---

### Task D3 — Aggiornare il metodo search() esistente per usare hybrid search ⬜

**File coinvolti:** `src/main/ai/VectorDBManager.ts`, `src/main/ipc/aiHandlers.ts`
**Sezione RAG_ARCHITECTURE.md:** §8.2 Architettura della ricerca

**Descrizione:**
Sostituire il metodo `search()` puro-vettoriale con il nuovo `hybridSearch()` nell'IPC handler `ai:searchNotes`.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "8.2 Architettura della ricerca".

Contesto: l'IPC handler `ai:searchNotes` attualmente chiama `VectorDBManager.search()` che fa solo KNN vettoriale. Deve essere aggiornato per usare `hybridSearch()` (Task D2).

Task:
1. Leggi `src/main/ipc/aiHandlers.ts` e trova l'handler `ai:searchNotes`.
2. Modifica l'handler per:
   - Generare l'embedding della query con `embedQuery()`.
   - Chiamare `vectorDB.hybridSearch()` passando sia la query testuale (per BM25) che l'embedding (per vector KNN).
   - Passare le opzioni dell'utente (limit, noteIds, ecc.).
3. Aggiorna il tipo di ritorno dell'IPC: il risultato ora include `rrfScore` invece di solo `distance`.
4. Mantieni retrocompatibilità: se il caller passa opzioni vecchie, il sistema deve comunque funzionare (i default di hybridSearch gestiscono i valori mancanti).
5. Aggiorna il tipo in `src/preload/types.ts` (o dove sono definiti i tipi IPC) per riflettere il nuovo formato di risposta.
6. Esegui `pnpm typecheck`.

Dipendenze: Task D1 e D2 devono essere completati.
```

---

## E — Scoring e Relevance

Nuovo sistema di scoring basato su RRF con boost euristici.

---

### Task E1 — Implementare heuristic re-ranking e same-note boost ⬜

**File coinvolti:** `src/main/ai/VectorDBManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §9.1 Heuristic Re-Ranking, §9.2 Same-Note Grouping

**Descrizione:**
Dopo la fusione RRF, applicare boost euristici per title match, recency, e raggruppamento per nota.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "9.1 Heuristic Re-Ranking" e "9.2 Same-Note Grouping".

Contesto: dopo il merge RRF (Task D2), i risultati vanno ulteriormente riordinati con boost euristici per migliorare la rilevanza percepita dall'utente.

Task:
1. Leggi `src/main/ai/VectorDBManager.ts`.
2. Implementa la funzione `applyHeuristicBoosts(results, query)` come da §9.1:
   - **Title match**: se il titolo della nota contiene termini della query (> 2 caratteri), boost di +0.003 per match.
   - **Recency**: se `metadata.updatedAt` è < 7 giorni fa → +0.002, < 30 giorni → +0.001.
   - Riordina per rrfScore decrescente dopo i boost.
3. Implementa la funzione `applySameNoteBoost(results)` come da §9.2:
   - Conta quanti chunk per nota appaiono nei risultati.
   - Se > 1: boost logaritmico di +0.002 * Math.log2(count).
4. Integra queste funzioni nella pipeline di `hybridSearch()`:
   - Dopo il merge RRF → `applySameNoteBoost()` → `applyHeuristicBoosts()` → return top N.
5. Le funzioni devono essere pure (input → output, nessun side effect) e facilmente testabili.
6. Esegui `pnpm typecheck`.
```

---

### Task E2 — Nuovo sistema di scoring per la UI e threshold dinamico ⬜

**File coinvolti:** `src/renderer/src/components/ai/ChatContextNotes.tsx`, `src/main/ai/VectorDBManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §9.3 Relevance Score per la UI, §9.4 Threshold di rilevanza

**Descrizione:**
Sostituire il rescaling arbitrario `[0.15, 0.55] → [0, 100]` con un sistema basato su RRF normalizzato al max score. Implementare threshold dinamico.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "9.3 Relevance Score per la UI" e "9.4 Threshold di rilevanza".

Contesto: il sistema attuale in ChatContextNotes.tsx usa `distanceToRelevance()` che rescala arbitrariamente la cosine distance in un range [0.15, 0.55]. Il nuovo sistema usa score RRF normalizzati al migliore risultato.

Task:
1. Leggi `src/renderer/src/components/ai/ChatContextNotes.tsx` e trova `distanceToRelevance()`.
2. Leggi `src/renderer/src/components/ai/ChatInterface.tsx` e trova dove viene usato `RAG_RELEVANCE_THRESHOLD`.

**Lato backend (VectorDBManager):**
3. In `hybridSearch()`, prima di restituire i risultati:
   - Calcola `maxRRF = Math.max(...results.map(r => r.rrfScore))`.
   - Filtra risultati con `rrfScore < maxRRF * 0.25` (threshold dinamico al 25% del migliore).
   - Aggiungi un campo `relevancePercent` calcolato come: `Math.round((rrfScore / maxRRF) * 100)`.
   - Applica anche il pre-filtro vector distance < 1.2 (dal Task D2) per escludere chunk semanticamente irrilevanti.

**Lato frontend (ChatContextNotes + ChatInterface):**
4. Sostituisci `distanceToRelevance()` con un semplice accesso a `result.relevancePercent` (già calcolato dal backend).
5. Rimuovi `RAG_RELEVANCE_THRESHOLD` da ChatInterface — il filtraggio ora avviene nel backend.
6. Aggiorna i badge di colore se necessario con le nuove soglie.
7. Esegui `pnpm typecheck`.

IMPORTANTE: il relevance score è ora RELATIVO al result set (il migliore è sempre 100%). Non dipende più da range hardcoded del modello.
```

---

## F — Multi-Chunk Retrieval ed Expansion

Recupero di contesto espanso per fornire all'LLM informazioni complete.

---

### Task F1 — Implementare window expansion (chunk adiacenti) ⬜

**File coinvolti:** `src/main/ai/VectorDBManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §10.2 Livello 1: Window Expansion

**Descrizione:**
Per ogni chunk matchato, recuperare anche i chunk adiacenti (N-1, N+1) della stessa nota per fornire contesto più ampio.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "10.2 Strategia a due livelli — Livello 1: Window Expansion".

Contesto: un chunk matchato potrebbe contenere solo parte di un'informazione. Recuperando i chunk adiacenti si fornisce un contesto più completo all'LLM.

Task:
1. Leggi `src/main/ai/VectorDBManager.ts`.
2. Implementa il metodo `getChunksByNoteAndRange(noteId, fromIndex, toIndex)`:
   ```sql
   SELECT id, chunk_index, content, section_id, section_header
   FROM embeddings
   WHERE note_id = ? AND chunk_index BETWEEN ? AND ?
   ORDER BY chunk_index
   ```
3. Implementa il metodo `expandWithWindow(matchedChunks, windowSize = 1)` come da §10.2:
   - Per ogni chunk matchato all'indice N, recupera i chunk da N-windowSize a N+windowSize.
   - Concatena i chunk in ordine per `chunk_index`, separandoli con `\n\n`.
   - Restituisce un `ExpandedResult` che contiene:
     - Tutti i campi del `RankedResult` originale.
     - `expandedContent: string` — contenuto concatenato dei chunk espansi.
     - `chunkRange: { from: number, to: number }` — range effettivo dei chunk inclusi.
4. Implementa `deduplicateOverlaps(expanded)`: se due chunk espansi si sovrappongono (stessa nota, range che si intersecano), uniscili in un unico risultato espanso.
5. Esegui `pnpm typecheck`.
```

---

### Task F2 — Implementare section-based retrieval ⬜

**File coinvolti:** `src/main/ai/VectorDBManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §10.2 Livello 2: Section-Based Retrieval

**Descrizione:**
Quando un chunk matcha, recuperare TUTTI i chunk con lo stesso `section_id` per garantire che l'LLM veda la sezione completa.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "10.2 Strategia a due livelli — Livello 2: Section-Based Retrieval".

Contesto: una domanda come "quali sono gli action items?" potrebbe matchare un chunk con solo 3 di 7 items. Recuperando l'intera sezione, l'LLM ha il contesto completo.

Task:
1. Leggi `src/main/ai/VectorDBManager.ts`.
2. Implementa il metodo `getChunksBySection(sectionId)`:
   ```sql
   SELECT id, chunk_index, content, section_header
   FROM embeddings
   WHERE section_id = ?
   ORDER BY chunk_index
   ```
3. Implementa il metodo `expandToSection(matchedChunks)` come da §10.2:
   - Per ogni chunk matchato che ha un `sectionId`:
     - Se la sezione è già stata processata (Set di sectionId), skip.
     - Recupera TUTTI i chunk con lo stesso `sectionId`.
     - Concatena in ordine per `chunk_index`.
   - Restituisce `ExpandedResult[]` con `expandedContent` e `sectionHeader`.
4. Per i chunk SENZA `sectionId` (sezione "intro" o chunk da vecchio sistema), NON espandere tramite section — saranno gestiti dal window expansion (Task F1).
5. Esegui `pnpm typecheck`.
```

---

### Task F3 — Pipeline di espansione completa con token budget ⬜

**File coinvolti:** `src/main/ai/VectorDBManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §10.3 Strategia di espansione, §10.4 Token Budget

**Descrizione:**
Combinare window expansion e section expansion in una pipeline unica con deduplicazione e token budget.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "10.3 Strategia di espansione" e "10.4 Token Budget".

Contesto: i metodi di espansione (Task F1 e F2) devono essere combinati in una pipeline coerente che rispetta un budget di token per il contesto LLM.

Task:
1. Leggi `src/main/ai/VectorDBManager.ts`.
2. Implementa il metodo `expandResults(rankedResults, options?)` che orchestra la pipeline:
   - **Step 1**: Prendi i top-N risultati dal ranking (default N=10).
   - **Step 2**: Per ogni chunk con `sectionId` → `expandToSection()`.
   - **Step 3**: Per ogni chunk senza `sectionId` → `expandWithWindow(±1)`.
   - **Step 4**: Deduplicazione — rimuovi chunk duplicati (stessa nota, chunk_index già incluso).
   - **Step 5**: Token budget — calcola il numero approssimativo di token per ogni risultato espanso (stima ~4 chars per token). Se il totale supera il budget, tronca i risultati con score più basso.
3. Parametri del token budget come da §10.4:
   - Default: 4000 token (ragionevole per Qwen3-4B con 32K context).
   - Configurabile via opzioni.
4. Il metodo deve restituire `ExpandedResult[]` ordinati per rrfScore decrescente.
5. Integra `expandResults()` nella pipeline di `hybridSearch()` come ultimo step prima del return.
6. Esegui `pnpm typecheck`.

Dipendenze: Task F1 e F2 devono essere completati.
```

---

## G — Indicizzazione Incrementale e Auto-Indexing

Sistema di indicizzazione automatico con debounce e background processing.

---

### Task G1 — Creare la classe IndexingQueue ⬜

**File coinvolti:** Nuovo file `src/main/ai/IndexingQueue.ts`
**Sezione RAG_ARCHITECTURE.md:** §11.3 Indexing Queue

**Descrizione:**
Creare la classe `IndexingQueue` che gestisce l'indicizzazione in background con debounce per nota, processing sequenziale, e yielding all'event loop.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "11.3 Indexing Queue".

Contesto: attualmente l'indicizzazione è sincrona e bloccante. La nuova IndexingQueue processa job in background, uno alla volta, con debounce per nota e yield tra i chunk per non bloccare l'event loop.

Task:
1. Leggi `src/main/ai/EmbeddingService.ts` per capire l'interfaccia di `indexNote()`.
2. Leggi `src/main/ai/VectorDBManager.ts` per capire `isNoteStale()` (Task A4).
3. Crea il nuovo file `src/main/ai/IndexingQueue.ts` con la classe `IndexingQueue` come da §11.3:
   - Proprietà private:
     - `queue: Map<string, IndexingJob>` — noteId → job (deduplicato).
     - `isProcessing: boolean`
     - `debounceTimers: Map<string, NodeJS.Timeout>`
   - Metodo `enqueue(noteId, spaceId, content, noteTitle)`:
     - Cancella timer di debounce precedente per questa nota.
     - Imposta nuovo timer a 3 secondi.
     - Allo scadere: aggiunge il job alla coda e chiama `processNext()`.
   - Metodo privato `processNext()`:
     - Se sta già processando o coda vuota, return.
     - Prende il primo job dalla coda (FIFO).
     - Controlla `isNoteStale()` — se non è stale, skip.
     - Chiama `indexNote()` con callback `onChunkIndexed` che fa `setImmediate()` per yield.
     - In caso di errore, logga ma non blocca.
     - Alla fine (finally), `isProcessing = false` e chiama `processNext()` ricorsivamente.
   - Metodo `dispose()` per cancellare tutti i timer.
4. La classe deve emettere eventi di progresso (es. via callback o EventEmitter) per aggiornare la UI.
5. Esporta la classe e i tipi necessari (`IndexingJob`, opzioni, eventi).
6. Esegui `pnpm typecheck`.

NOTA: la coda è `Map<string, IndexingJob>` per deduplicare automaticamente: se una nota viene salvata 5 volte, c'è un solo job in coda con il contenuto più recente.
```

---

### Task G2 — Hook di auto-indexing nel salvataggio note ⬜

**File coinvolti:** `src/main/ipc/aiHandlers.ts` (o `fileHandlers.ts`), `src/main/ai/IndexingQueue.ts`
**Sezione RAG_ARCHITECTURE.md:** §11.1 Auto-indexing con debounce, §11.4 Hook nel salvataggio note

**Descrizione:**
Integrare l'IndexingQueue nel flusso di salvataggio note esistente, così che ogni nota viene auto-indicizzata dopo il salvataggio.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "11.1 Auto-indexing con debounce" e "11.4 Hook nel salvataggio note".

Contesto: la IndexingQueue (Task G1) è pronta. Ora va integrata nel flusso IPC di salvataggio note per triggerare l'indicizzazione automatica.

Task:
1. Leggi `src/main/ipc/aiHandlers.ts` e identifica come è strutturato il sistema IPC.
2. Leggi i file handler (cerca `file:saveNote` o l'handler di salvataggio note) per capire dove avviene il save.
3. Trova o crea un punto di integrazione dove, dopo il salvataggio della nota:
   - Si crea/ottiene un'istanza singleton di `IndexingQueue` (per spazio o globale).
   - Si chiama `indexingQueue.enqueue(noteId, spaceId, content, noteTitle)`.
   - L'operazione è non-blocking (la funzione enqueue ritorna subito).
4. Gestisci il lifecycle:
   - La IndexingQueue va inizializzata quando lo spazio viene aperto (e il modello di embedding è disponibile).
   - Va disposta quando lo spazio viene chiuso.
   - Se il modello di embedding non è disponibile, l'enqueue deve fare noop o accodare per dopo.
5. Aggiungi un nuovo IPC event `ai:indexing-progress` che la IndexingQueue emette per aggiornare la UI sullo stato dell'indicizzazione in background.
6. Esegui `pnpm typecheck`.

NOTA: l'enqueue NON deve bloccare il salvataggio della nota. Il flusso è: salva nota (sincrono) → enqueue indexing (async, background) → ritorna success all'utente immediatamente.
```

---

### Task G3 — Batch initial indexing ottimizzato ⬜

**File coinvolti:** `src/main/ipc/aiHandlers.ts`, `src/main/ai/IndexingQueue.ts`
**Sezione RAG_ARCHITECTURE.md:** §11.5 Batch Initial Indexing

**Descrizione:**
Quando uno spazio viene aperto per la prima volta (o l'utente richiede un full reindex), indicizzare tutte le note in batch usando content-hash per skippare quelle non cambiate.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "11.5 Batch Initial Indexing".

Contesto: il batch indexing esistente (`ai:indexAllNotes`) reindicizza tutto. Il nuovo sistema deve: (1) controllare il content-hash di ogni nota, (2) skippare le note non cambiate, (3) accodare solo le note stale nella IndexingQueue, (4) emettere eventi di progresso accurati.

Task:
1. Leggi `src/main/ipc/aiHandlers.ts` e trova l'handler `ai:indexAllNotes`.
2. Modifica (o crea una nuova versione di) l'handler per:
   - Caricare tutte le note dello spazio.
   - Per ogni nota:
     - Estrarre il contenuto testuale.
     - Controllare `isNoteStale()` tramite content-hash.
     - Se stale: accodare nella IndexingQueue.
     - Se non stale: incrementare il contatore "skipped".
   - Emettere l'evento `ai:indexing-progress` con: `{ total, indexed, skipped, current, status }`.
3. La UI deve poter distinguere tra:
   - `status: 'checking'` — fase di hash check.
   - `status: 'indexing'` — fase di indicizzazione effettiva.
   - `status: 'complete'` — operazione conclusa.
4. Gestisci lo scenario in cui l'utente chiude la finestra durante il batch: la IndexingQueue deve poter fare cleanup.
5. Esegui `pnpm typecheck`.
```

---

## H — Gestione Memoria e Lifecycle Modelli

Ottimizzazione della memoria per sistemi con 16GB RAM.

---

### Task H1 — Implementare idle timeout per il modello di chat ⬜

**File coinvolti:** `src/main/ai/AIManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §12.2 Strategia: Embedding Always-On, §12.4 Idle Timeout

**Descrizione:**
Il modello di chat deve essere scaricato dalla memoria dopo un periodo di inattività (5 minuti), mantenendo sempre caricato il modello di embedding.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "12.2 Strategia: Embedding Always-On" e "12.4 Idle Timeout per il modello di chat".

Contesto: su sistemi con 16GB RAM, il modello di embedding (~600MB) può restare caricato sempre, ma il modello di chat (~5-9.5GB) deve essere scaricato quando non in uso per liberare memoria.

Task:
1. Leggi `src/main/ai/AIManager.ts` per capire il sistema attuale di gestione modelli (loadModel, unloadModel, idle cleanup).
2. Implementa il meccanismo di idle timeout dedicato al modello di chat:
   - Proprietà `chatIdleTimer: NodeJS.Timeout | null` e `CHAT_IDLE_TIMEOUT_MS = 5 * 60 * 1000`.
   - Metodo `onChatActivity()` che resetta il timer ad ogni attività di chat (generazione, messaggio, ecc.).
   - Allo scadere del timer: `unloadModel(chatModelId)` — scarica SOLO il modello di chat, l'embedding resta caricato.
3. Integra `onChatActivity()` nel flusso di `generateChatCompletion()` (o equivalente) per resettare il timer ad ogni uso della chat.
4. Distingui tra il modello di embedding (tipo 'embedding' nel ModelRegistry) e il modello di chat (tipo 'chat'). L'embedding NON deve mai essere scaricato dall'idle timeout.
5. Il timeout deve essere cancellabile (es. se l'utente torna a chattare prima dei 5 minuti).
6. Aggiungi un metodo `dispose()` per cancellare il timer al cleanup.
7. Esegui `pnpm typecheck`.

NOTA: il sistema esistente ha già un `cleanupInterval` per modelli inutilizzati. Il nuovo idle timeout è SPECIFICO per il modello di chat e più aggressivo (5 min vs. il cleanup generale).
```

---

### Task H2 — Memory check pre-caricamento modello ⬜

**File coinvolti:** `src/main/ai/AIManager.ts`
**Sezione RAG_ARCHITECTURE.md:** §12.3 Memory Check pre-caricamento

**Descrizione:**
Prima di caricare un modello di chat, verificare che ci sia abbastanza memoria disponibile con un margine di sicurezza del 30%.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "12.3 Memory Check pre-caricamento".

Contesto: su sistemi con 16GB RAM, caricare il modello di chat senza verificare la memoria può causare swap o crash. Serve un check preventivo.

Task:
1. Leggi `src/main/ai/AIManager.ts` e `src/main/ai/HardwareDetector.ts` per capire come vengono rilevate le informazioni hardware.
2. Implementa il metodo `canLoadChatModel(modelId: string): Promise<{ canLoad: boolean; reason?: string }>`:
   - Ottieni la definizione del modello da ModelRegistry.
   - Rileva la memoria disponibile (usa `systeminformation` — probabilmente già usato da HardwareDetector, o `os.freemem()` di Node.js).
   - Calcola la memoria richiesta: `modelDef.sizeBytes * 1.3` (30% safety margin).
   - Se la memoria disponibile è insufficiente, ritorna `{ canLoad: false, reason: "..." }` con un messaggio user-friendly in italiano.
3. Integra il check in `loadModel()` (o nel punto appropriato): se il modello è di tipo 'chat', chiama `canLoadChatModel()` prima di procedere.
4. Propaga il risultato al renderer via IPC: se il modello non può essere caricato, il frontend deve mostrare un messaggio all'utente (es. "Memoria insufficiente...").
5. Esegui `pnpm typecheck`.

NOTA: il check deve essere veloce e non bloccare. Usa dati di memoria dal sistema operativo, non profilazione.
```

---

## I — Ricerca Standalone (senza Chat)

Ricerca semantica che funziona indipendentemente dal modello di chat.

---

### Task I1 — IPC handler per ricerca standalone ⬜

**File coinvolti:** `src/main/ipc/aiHandlers.ts`
**Sezione RAG_ARCHITECTURE.md:** §13 Ricerca Standalone

**Descrizione:**
La ricerca semantica nelle note deve funzionare anche senza il modello di chat caricato, richiedendo solo il modello di embedding (sempre caricato).

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "13. Ricerca Standalone (senza Chat)" (§13.1, §13.2).

Contesto: la ricerca nelle note deve funzionare indipendentemente dal modello di chat. Richiede solo il modello di embedding (che con l'architettura "always-on" di Task H1 è sempre caricato).

Task:
1. Leggi `src/main/ipc/aiHandlers.ts` e l'handler `ai:searchNotes` esistente.
2. Verifica o modifica l'handler `ai:searchNotes` per:
   - NON richiedere che il modello di chat sia caricato.
   - Richiedere SOLO che il modello di embedding sia disponibile.
   - Se il modello di embedding non è caricato, caricarlo on-demand (è leggero, ~600MB).
3. Assicurati che il flusso sia:
   - Ricevi query + spaceId + options.
   - Genera embedding della query con `embedQuery()`.
   - Esegui `hybridSearch()` (Task D2) nel database dello spazio.
   - Ritorna i risultati con `relevancePercent`, `sectionHeader`, `expandedContent`.
4. Aggiungi un handler `ai:getSearchCapability` che ritorna `{ available: boolean, reason?: string }`:
   - `available = true` se il modello di embedding è scaricato e ci sono note indicizzate.
   - `available = false` con reason se il modello manca o non ci sono note indicizzate.
5. Esegui `pnpm typecheck`.
```

---

### Task I2 — Componente UI SearchPanel per ricerca standalone ⬜

**File coinvolti:** Nuovo/Esistente componente in `src/renderer/src/components/ai/`
**Sezione RAG_ARCHITECTURE.md:** §13.1 Architettura (UI)

**Descrizione:**
Creare (o adattare) un componente di ricerca semantica che l'utente può usare senza aprire la chat, con risultati che includono titolo, sezione, excerpt con highlight e score.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "13.1 Architettura" — la parte UI del flusso di ricerca standalone.

Contesto: la ricerca semantica deve essere accessibile anche senza la chat. Serve un componente UI che permetta all'utente di cercare nelle proprie note e navigare ai risultati.

Task:
1. Leggi i componenti AI esistenti in `src/renderer/src/components/ai/` per capire pattern e stili usati.
2. Verifica se esiste già un componente di ricerca (SearchPanel, SearchBar, ecc.) che può essere esteso, altrimenti creane uno nuovo.
3. Il componente `SearchPanel` (o nome appropriato) deve:
   - Avere un input di ricerca con debounce (300ms).
   - Chiamare `window.ai.searchNotes()` (o l'IPC appropriato) al submit.
   - Mostrare i risultati come una lista con:
     - Titolo della nota.
     - Sezione matchata (se disponibile).
     - Excerpt del contenuto con i termini di ricerca evidenziati (highlight).
     - Score di rilevanza (badge 0-100%).
   - Click su un risultato → navigazione alla nota (usa `onNoteClick` callback come ChatContextNotes).
   - Mostrare stato vuoto, loading, e nessun risultato.
4. Usa Shadcn/UI components e TailwindCSS v4 per lo styling. Segui il pattern dei componenti esistenti.
5. Il componente deve verificare la search capability tramite `ai:getSearchCapability` e mostrare un messaggio se non disponibile.
6. Esegui `pnpm typecheck`.

NOTA: questo componente è per la ricerca standalone, separato dalla chat. Non deve avere dipendenze dal modello di chat.
```

---

## J — Integrazione UI e Prompt Engineering

Integrazione finale con il frontend e ottimizzazione del prompt per l'LLM.

---

### Task J1 — Aggiornare ChatInterface per il nuovo sistema RAG ⬜

**File coinvolti:** `src/renderer/src/components/ai/ChatInterface.tsx`
**Sezione RAG_ARCHITECTURE.md:** §15.2 Flusso di ricerca (RAG chat)

**Descrizione:**
Aggiornare il componente ChatInterface per utilizzare i nuovi risultati hybrid search con expansion, il nuovo scoring, e il context prompt arricchito.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "15.2 Flusso di ricerca (RAG chat)".

Contesto: il ChatInterface attuale usa il vecchio sistema di ricerca (solo vector, scoring arbitrario, singolo chunk). Deve essere aggiornato per usare i risultati del nuovo hybrid search con expansion.

Task:
1. Leggi `src/renderer/src/components/ai/ChatInterface.tsx`.
2. Aggiorna il metodo `searchRelevantNotes()` (o equivalente) per:
   - Ricevere i nuovi risultati con `relevancePercent`, `sectionHeader`, `expandedContent`.
   - NON filtrare più con `RAG_RELEVANCE_THRESHOLD` hardcoded — il filtering avviene nel backend.
   - Mappare i risultati nel formato atteso da `contextNotes` state, includendo i nuovi campi.
3. Aggiorna `buildContextPrompt()` per usare il nuovo formato come da §15.2:
   ```
   Contesto dalle tue note:

   [Nota: "Meeting Notes" | Sezione: "Action Items" | Rilevanza: 95%]
   - Comprare il latte
   - Chiamare il dentista
   ...

   [Nota: "Progetto React" | Sezione: "Setup" | Rilevanza: 72%]
   Per configurare il progetto...
   ...

   Domanda: {userMessage}
   ```
   - Usa `expandedContent` (non il singolo chunk) come testo del contesto.
   - Includi `sectionHeader` se disponibile.
   - Includi `relevancePercent`.
4. Rimuovi il vecchio `RAG_RELEVANCE_THRESHOLD` e la costante `DEFAULT_RAG_SEARCH_LIMIT` (se sostituita dal backend).
5. Esegui `pnpm typecheck`.
```

---

### Task J2 — Aggiornare ChatContextNotes per i nuovi dati ⬜

**File coinvolti:** `src/renderer/src/components/ai/ChatContextNotes.tsx`
**Sezione RAG_ARCHITECTURE.md:** §9.3 Relevance Score per la UI

**Descrizione:**
Aggiornare il componente ChatContextNotes per mostrare i nuovi dati: sezione, score RRF-based, contenuto espanso.

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "9.3 Relevance Score per la UI".

Contesto: ChatContextNotes mostra le note contestuali usate dal RAG. Con il nuovo sistema ha accesso a più informazioni: sezione, score basato su RRF, contenuto espanso.

Task:
1. Leggi `src/renderer/src/components/ai/ChatContextNotes.tsx`.
2. Aggiornamenti:
   - **Rimuovi `distanceToRelevance()`** — non serve più, il backend fornisce `relevancePercent` direttamente.
   - **Mostra sezione**: se il risultato ha `sectionHeader`, mostralo sotto il titolo della nota (es. "Meeting Notes → Action Items").
   - **Mostra score**: usa `relevancePercent` direttamente per il badge.
   - **Excerpt**: se il risultato ha `expandedContent`, usalo per l'excerpt espandibile (è il contesto completo della sezione o della finestra).
   - **Badge colors**: aggiorna le soglie per il nuovo scoring:
     - 70%+ → colore forte (rilevanza alta).
     - 40-69% → colore medio.
     - <40% → colore debole.
3. Aggiorna i tipi delle props per accettare i nuovi campi del risultato.
4. Mantieni le funzionalità esistenti: expand/collapse, click per navigare, rimuovi dal contesto.
5. Esegui `pnpm typecheck`.
```

---

### Task J3 — Aggiornare i tipi condivisi e l'interfaccia IPC ⬜

**File coinvolti:** `src/preload/types.ts`, `src/preload/index.d.ts`, `src/main/ai/types.ts`
**Sezione RAG_ARCHITECTURE.md:** §8.4, §5.4, §14.2

**Descrizione:**
Aggiornare i tipi TypeScript condivisi tra main e renderer per riflettere le nuove interfacce (StructuredChunk, HybridSearchOptions, RankedResult, ExpandedResult).

**Prompt:**

```
Riferimento architetturale: docs/RAG_ARCHITECTURE.md, sezione "8.4 Implementazione" (interfacce), "5.4 Struttura del chunk risultante" e "14.2 File principali".

Contesto: i task precedenti hanno introdotto nuovi tipi (StructuredChunk, HybridSearchOptions, RankedResult, ExpandedResult, ecc.) che devono essere esposti correttamente nel sistema di tipi.

Task:
1. Leggi `src/main/ai/types.ts` (se esiste) per i tipi AI condivisi.
2. Leggi `src/preload/types.ts` e `src/preload/index.d.ts` per i tipi IPC esposti al renderer.
3. Assicurati che i seguenti tipi siano definiti e coerenti:
   - `StructuredChunk` — da §5.4 (text, index, sectionId, sectionHeader, startOffset, endOffset).
   - `HybridSearchOptions` — da §8.4 (query, queryEmbedding, limit, weights, ecc.).
   - `RankedResult` — da §8.4 (con rrfScore, vectorDistance, bm25Rank).
   - `ExpandedResult` — estende RankedResult con expandedContent e chunkRange.
   - `SearchResult` aggiornato per il renderer — con relevancePercent, sectionHeader, expandedContent.
   - `IndexingProgress` — per gli eventi di progresso { total, indexed, skipped, current, status }.
4. Aggiorna l'interfaccia IPC nel preload per riflettere:
   - `ai:searchNotes` ritorna il nuovo formato di risultato.
   - `ai:indexing-progress` emette il nuovo formato di progresso.
   - `ai:getSearchCapability` (nuovo handler da Task I1).
5. Risolvi eventuali discrepanze di tipo tra i file toccati dai task precedenti.
6. Esegui `pnpm typecheck` e risolvi tutti gli errori.

NOTA: questo task è un "cleanup" tipografico. Va eseguito per ultimo per assicurarsi che tutti i tipi siano allineati dopo i task precedenti.
```

---

## Ordine di Esecuzione Consigliato

```
Fase 1 — Quick Wins (A)
  A1 → A2 → A3 → A4     (indipendenti tra loro, ma A3 prepara per C3)

Fase 2 — Schema (B)
  B1 → B2                 (B1 prima perché B2 potrebbe usare section_id)

Fase 3 — Chunking (C)
  C1 → C2 → C3            (sequenziali, dipendono da A3 e B1)

Fase 4 — Hybrid Search (D)
  D1 → D2 → D3            (sequenziali, dipendono da B2)

Fase 5 — Scoring (E)
  E1 → E2                 (dipendono da D2)

Fase 6 — Expansion (F)
  F1 → F2 → F3            (sequenziali, dipendono da B1 per section_id)

Fase 7 — Auto-Indexing (G)
  G1 → G2 → G3            (sequenziali, dipendono da A4)

Fase 8 — Memoria (H)
  H1 → H2                 (indipendenti dal resto, eseguibili in parallelo con G)

Fase 9 — Ricerca Standalone (I)
  I1 → I2                 (dipendono da D3 e H1)

Fase 10 — Integrazione UI (J)
  J1 → J2 → J3            (dipendono da E2, F3 — vanno fatti per ultimi)
```

### Grafo delle Dipendenze Critiche

```
A1 ──┐
A2 ──┤
A3 ──┼── C3
A4 ──┼────────── G1 → G2 → G3
     │
B1 ──┼── C2 → C3
B2 ──┼── D1 → D2 → D3
     │              │
C1 ──┘              ├── E1 → E2 ──── J1 → J2
C2 ─── C3           │
                    └── I1 → I2
F1 ──┐
F2 ──┼── F3 ────── J1
     │
H1 ──┼── I1
H2 ──┘

J3 ── (dopo tutti gli altri, cleanup tipi)
```

---

## Note per l'Esecutore

1. **Ogni task è auto-contenuto**: il prompt include tutto il contesto necessario e le reference specifiche al documento architetturale.
2. **Esegui sempre `pnpm typecheck`** alla fine di ogni task per verificare la correttezza.
3. **Non modificare file non elencati** nel task a meno che non sia strettamente necessario per la compilazione.
4. **I task della stessa fase possono essere eseguiti in ordine**: rispetta le dipendenze nel grafo sopra.
5. **Testa incrementalmente**: dopo ogni fase, il sistema dovrebbe essere funzionante (anche se con le vecchie feature per le parti non ancora aggiornate).
