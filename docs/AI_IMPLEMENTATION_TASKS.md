# AI Implementation Tasks

Documento di pianificazione per l'implementazione delle funzionalità AI in TaacNotes. Ogni task è progettato per essere completato in una singola iterazione con Claude Code.

**Riferimento architettura**: `docs/AI_ARCHITECTURE.md`

---

## Indice Fasi

1. [Fase 1: Foundation](#fase-1-foundation)
2. [Fase 2: Model Management](#fase-2-model-management)
3. [Fase 3: Chat / Inference](#fase-3-chat--inference)
4. [Fase 4: RAG System](#fase-4-rag-system)
5. [Fase 5: Conversations](#fase-5-conversations)
6. [Fase 6: Onboarding & Polish](#fase-6-onboarding--polish)

---

## Fase 1: Foundation

### Task 1.1: Installazione dipendenze AI (FATTO)

**Descrizione**: Installare tutte le dipendenze npm necessarie per l'integrazione AI locale: `node-llama-cpp`, `systeminformation`, `better-sqlite3`, e `@huggingface/gguf`. Verificare che le dipendenze siano installate correttamente.

**Prompt**:

```
Installa le dipendenze necessarie per l'integrazione AI in TaacNotes:
- node-llama-cpp (^3.0.0) - per inference LLM locale
- systeminformation (^5.22.0) - per hardware detection
- better-sqlite3 (^11.0.0) - per vector database
- @huggingface/gguf (^0.1.0) - per parsing metadata GGUF
- uuid - per generazione ID univoci (se non già presente)

Dopo l'installazione, verifica che non ci siano conflitti di dipendenze e aggiorna il package.json. Riferimento architettura: docs/AI_ARCHITECTURE.md sezione 3.
```

---

### Task 1.2: Configurazione Electron Vite per moduli nativi (FATTO)

**Descrizione**: Configurare `electron.vite.config.ts` per gestire correttamente i moduli nativi (`node-llama-cpp`, `better-sqlite3`). Questi moduli devono essere esternalizzati dal bundler per funzionare in Electron.

**Prompt**:

```
Modifica electron.vite.config.ts per supportare i moduli nativi AI:

1. Nel blocco `main`, configura externalizeDepsPlugin per:
   - Escludere 'electron-store' (già presente)
   - Includere 'node-llama-cpp' e 'better-sqlite3' come external

2. Aggiungi rollupOptions.external per marcare esplicitamente i moduli nativi

Riferimento: docs/AI_ARCHITECTURE.md sezione 10.2. Assicurati che la configurazione esistente non venga compromessa.
```

---

### Task 1.3: Creazione struttura directory AI (FATTO)

**Descrizione**: Creare la struttura di directory per i moduli AI nel main process. Creare i file placeholder con export vuoti per definire l'architettura.

**Prompt**:

```
Crea la struttura directory per i moduli AI in src/main/ai/:

1. Crea la cartella src/main/ai/
2. Crea i seguenti file con export placeholder:
   - index.ts (export barrel file)
   - types.ts (tipi TypeScript condivisi)
   - errors.ts (classi errore custom)
   - AIManager.ts
   - HardwareDetector.ts
   - ModelRegistry.ts
   - ModelDownloader.ts
   - VectorDBManager.ts
   - ConversationManager.ts
   - EmbeddingService.ts

Per ora crea solo la struttura con commenti TODO. Riferimento: docs/AI_ARCHITECTURE.md sezione 5.
```

---

### Task 1.4: Implementazione types.ts (FATTO)

**Descrizione**: Implementare tutte le interfacce e tipi TypeScript condivisi per il modulo AI, come definito nell'architettura.

**Prompt**:

```
Implementa src/main/ai/types.ts con tutte le interfacce TypeScript per il modulo AI:

- HardwareInfo (CPU, memory, GPU info con tier)
- GPUInfo (name, vendor, vramBytes, hasCuda, hasMetal, hasVulkan)
- ModelDefinition (id, name, filename, downloadUrl, sizeBytes, layers, capabilities, hardwareTier)
- ModelRecommendation (modelId, reason, estimatedPerformance, gpuLayersRecommended)
- DownloadProgress (modelId, bytesDownloaded, totalBytes, percentage, speed, eta, status)
- ChatMessage (id, role, content, timestamp, noteReferences)
- NoteReference (noteId, spaceId, title, excerpt, relevanceScore)
- Conversation e ConversationSummary
- SearchResult
- GenerationOptions (maxTokens, temperature, topP, stopSequences)
- VectorDocument
- ChunkingOptions

Riferimento completo: docs/AI_ARCHITECTURE.md Appendice A.
```

---

### Task 1.5: Implementazione errors.ts (FATTO)

**Descrizione**: Implementare le classi di errore custom per una gestione errori consistente nel modulo AI.

**Prompt**:

```
Implementa src/main/ai/errors.ts con le classi di errore custom:

- AIError (classe base con code, message, recoverable)
- ModelNotFoundError
- ModelNotDownloadedError
- InsufficientMemoryError
- GPUNotAvailableError
- ContextSizeExceededError
- DownloadFailedError
- EmbeddingFailedError

Includi anche una utility function formatBytes(). Riferimento: docs/AI_ARCHITECTURE.md sezione 12.1.
```

---

### Task 1.6: Implementazione HardwareDetector (FATTO)

**Descrizione**: Implementare il modulo HardwareDetector che rileva CPU, RAM, GPU e classifica il sistema in tier hardware (low, medium, high, ultra).

**Prompt**:

```
Implementa src/main/ai/HardwareDetector.ts:

1. Classe statica HardwareDetector con:
   - detect(): Promise<HardwareInfo> - rileva hardware con systeminformation
   - getModelRecommendations(): Promise<ModelRecommendation[]> - suggerisce modelli per tier
   - calculateTier() - calcola tier basato su CPU cores, RAM, GPU VRAM
   - detectCuda() - verifica supporto CUDA (NVIDIA)
   - detectVulkan() - verifica supporto Vulkan (AMD/Intel)
   - clearCache() - per testing

2. Logica tier:
   - Ultra: score >= 8 (CPU 8+ cores, RAM 32GB+, VRAM 16GB+)
   - High: score >= 5
   - Medium: score >= 3
   - Low: score < 3
   - Bonus per Apple Silicon con unified memory

Riferimento: docs/AI_ARCHITECTURE.md sezione 6.2.
```

---

### Task 1.7: Implementazione ModelRegistry (FATTO)

**Descrizione**: Implementare il registro dei modelli curati con la lista di modelli testati per ogni tier hardware.

**Prompt**:

```
Implementa src/main/ai/ModelRegistry.ts:

1. Array CURATED_MODELS con modelli per ogni tier:
   - LOW: Phi-3 Mini Q4 (2.3GB), Qwen2 1.5B Q8 (1.6GB)
   - MEDIUM: Llama 3.1 8B Q4 (4.9GB), Mistral 7B Q4 (4.4GB)
   - HIGH: Llama 3.1 8B Q8 (8.5GB), DeepSeek Coder 6.7B Q8 (7.2GB)
   - ULTRA: Llama 3.1 70B Q4 (42.5GB)
   - EMBEDDING: Nomic Embed v1.5 (137MB), BGE Small EN v1.5 (66MB)

2. Classe statica ModelRegistry con:
   - getModel(id): ModelDefinition | undefined
   - getModelByFilename(filename): ModelDefinition | undefined
   - getAllModels(): ModelDefinition[]
   - getModelsForTier(tier): ModelDefinition[]
   - getChatModels(): ModelDefinition[]
   - getEmbeddingModels(): ModelDefinition[]
   - formatSize(bytes): string

Riferimento: docs/AI_ARCHITECTURE.md sezione 6.4.
```

---

### Task 1.8: IPC Handlers base per Hardware (FATTO)

**Descrizione**: Creare gli IPC handlers per esporre le funzionalità di hardware detection al renderer process.

**Prompt**:

```
Crea src/main/ipc/aiHandlers.ts con gli IPC handlers base:

1. Funzione registerAIHandlers(getOrCreateFsManager) che registra:
   - 'ai:getHardwareInfo' - ritorna HardwareDetector.detect()
   - 'ai:getModelRecommendations' - ritorna HardwareDetector.getModelRecommendations()
   - 'ai:listAvailableModels' - ritorna ModelRegistry.getAllModels()

2. Importa i moduli necessari da ../ai/

3. Aggiorna src/main/index.ts per chiamare registerAIHandlers() all'avvio dell'app

Riferimento: docs/AI_ARCHITECTURE.md sezione 7, handlers HARDWARE DETECTION e parte di MODEL MANAGEMENT.
```

---

### Task 1.9: Preload API per Hardware (FATTO)

**Descrizione**: Estendere il preload script per esporre le API di hardware detection al renderer.

**Prompt**:

```
Estendi src/preload/index.ts per esporre l'API AI:

1. Crea oggetto aiAPI con:
   - getHardwareInfo: () => ipcRenderer.invoke('ai:getHardwareInfo')
   - getModelRecommendations: () => ipcRenderer.invoke('ai:getModelRecommendations')
   - listAvailableModels: () => ipcRenderer.invoke('ai:listAvailableModels')

2. Esporta via contextBridge.exposeInMainWorld('ai', aiAPI)

3. Aggiorna src/preload/index.d.ts con le type definitions per window.ai

Riferimento: docs/AI_ARCHITECTURE.md sezione 8.
```

---

### Task 1.10: React Hooks per Hardware (FATTO)

**Descrizione**: Creare i React hooks con TanStack Query per accedere alle informazioni hardware e ai modelli disponibili.

**Prompt**:

```
Crea src/renderer/src/hooks/useHardware.ts con i seguenti hooks:

1. useHardwareInfo() - query per HardwareInfo con staleTime: Infinity
2. useModelRecommendations() - query per raccomandazioni modelli
3. useAvailableModels() - query per lista modelli disponibili

Usa TanStack Query con pattern esistenti nel progetto. Le query keys devono seguire il pattern ['ai', 'hardware'], ['ai', 'recommendations'], ['ai', 'models', 'available'].

Riferimento: docs/AI_ARCHITECTURE.md sezione 9.
```

---

### Task 1.11: Componente HardwareInfoCard (FATTO)

**Descrizione**: Creare un componente UI per visualizzare le informazioni hardware rilevate e il tier assegnato.

**Prompt**:

```
Crea src/renderer/src/components/ai/HardwareInfoCard.tsx:

1. Componente che usa useHardwareInfo() hook
2. Mostra:
   - CPU: brand, cores, speed
   - RAM: total, available
   - GPU: name, VRAM, backend supportato (CUDA/Metal/Vulkan)
   - Tier badge colorato (low=red, medium=yellow, high=green, ultra=purple)
3. Stati loading e error gestiti
4. Usa Shadcn/UI Card component
5. Stile con TailwindCSS

Questo componente sarà usato nella pagina settings e nell'onboarding.
```

---

## Fase 2: Model Management

### Task 2.1: Implementazione ModelDownloader (FATTO)

**Descrizione**: Implementare il modulo per il download dei modelli con supporto per progress reporting, pause e resume.

**Prompt**:

```
Implementa src/main/ai/ModelDownloader.ts:

1. Classe ModelDownloader extends EventEmitter con:
   - initialize(): crea directory models/ e .temp/
   - downloadModel(modelId, url, filename): download con streaming
   - pauseDownload(modelId): abort controller
   - resumeDownload(modelId): riprende con Range header
   - cancelDownload(modelId): cancella e rimuove temp file
   - isModelDownloaded(modelId): verifica esistenza
   - getDownloadedModels(): lista modelli scaricati
   - deleteModel(modelId): rimuove modello
   - cleanupOldTempFiles(): pulizia temp > 7 giorni

2. Emette eventi 'progress' con DownloadProgress

3. Supporto resume: salva in .temp/{modelId}.part

4. Storage: {userData}/models/

Riferimento: docs/AI_ARCHITECTURE.md sezione 6.3.
```

---

### Task 2.2: IPC Handlers per Model Management (FATTO)

**Descrizione**: Aggiungere gli IPC handlers per gestire download, caricamento e rimozione modelli.

**Prompt**:

```
Estendi src/main/ipc/aiHandlers.ts con gli handlers per model management:

1. Aggiungi handlers:
   - 'ai:listDownloadedModels'
   - 'ai:isModelDownloaded' (modelId)
   - 'ai:downloadModel' (modelId)
   - 'ai:pauseDownload' (modelId)
   - 'ai:resumeDownload' (modelId)
   - 'ai:cancelDownload' (modelId)
   - 'ai:deleteModel' (modelId)

2. Inizializza ModelDownloader in registerAIHandlers()

3. Forward eventi 'progress' dal downloader a tutte le BrowserWindow tramite:
   win.webContents.send('ai:download-progress', progress)

Riferimento: docs/AI_ARCHITECTURE.md sezione 7, MODEL MANAGEMENT handlers.
```

---

### Task 2.3: Preload API per Model Management (FATTO)

**Descrizione**: Estendere la preload API con le funzioni per gestire i modelli.

**Prompt**:

```
Estendi src/preload/index.ts con le API per model management:

1. Aggiungi a aiAPI:
   - listDownloadedModels()
   - isModelDownloaded(modelId)
   - downloadModel(modelId)
   - pauseDownload(modelId)
   - resumeDownload(modelId)
   - cancelDownload(modelId)
   - deleteModel(modelId)
   - onDownloadProgress(callback) - listener per eventi progress con cleanup

2. Aggiorna index.d.ts con i tipi

Riferimento: docs/AI_ARCHITECTURE.md sezione 8.
```

---

### Task 2.4: React Hooks per Model Management (FATTO)

**Descrizione**: Creare gli hooks React per gestire download e stato dei modelli.

**Prompt**:

```
Crea src/renderer/src/hooks/useModels.ts con:

1. useDownloadedModels() - query lista modelli scaricati
2. useModelDownload() - hook complesso con:
   - progress state (Map<modelId, DownloadProgress>)
   - useEffect per sottoscriversi a onDownloadProgress
   - download/pause/resume/cancel mutations
   - Invalida query ['ai', 'models', 'downloaded'] su completion
3. useDeleteModel() - mutation per eliminare modello

Pattern: usa useState per progress real-time, TanStack Query per lista modelli.

Riferimento: docs/AI_ARCHITECTURE.md sezione 9.
```

---

### Task 2.5: Componente ModelCard (FATTO)

**Descrizione**: Creare il componente per visualizzare un singolo modello con stato download e azioni.

**Prompt**:

```
Crea src/renderer/src/components/ai/ModelCard.tsx:

1. Props: model (ModelDefinition), isDownloaded, downloadProgress?, onDownload, onDelete
2. Mostra:
   - Nome e descrizione modello
   - Size formattata
   - Badge tier hardware
   - Badge capabilities (chat, embedding, code)
   - Se non scaricato: bottone Download
   - Se in download: progress bar con %, speed, ETA, bottoni pause/cancel
   - Se scaricato: badge "Downloaded", bottone Delete
3. Usa Shadcn/UI components (Card, Button, Progress, Badge)
4. Animazioni smooth per progress bar
```

---

### Task 2.6: Componente ModelLibrary (FATTO)

**Descrizione**: Creare la vista completa della libreria modelli con filtri per tier e capabilities.

**Prompt**:

```
Crea src/renderer/src/components/ai/ModelLibrary.tsx:

1. Usa useAvailableModels(), useDownloadedModels(), useModelDownload(), useHardwareInfo()
2. Filtri:
   - Tabs: "All", "Recommended", "Downloaded"
   - Filter per tier: low, medium, high, ultra
   - Filter per capability: chat, embedding, code
3. Grid di ModelCard
4. Sezione "Recommended for your hardware" in evidenza
5. Stato empty per ogni tab
6. Loading skeleton mentre carica

Questo componente sarà la pagina principale per gestire i modelli.
```

---

### Task 2.7: Route Settings AI (FATTO)

**Descrizione**: Creare la route per le impostazioni AI con la libreria modelli integrata.

**Prompt**:

```
Crea src/renderer/src/routes/settings/ai.tsx (o modifica settings se esiste):

1. Layout con tabs: "Models", "Hardware", "Configuration"
2. Tab Models: integra ModelLibrary component
3. Tab Hardware: integra HardwareInfoCard component
4. Tab Configuration: placeholder per future impostazioni AI

Se la struttura settings è diversa, adatta l'implementazione mantenendo la separazione logica.

Assicurati che la route sia registrata in TanStack Router.
```

---

## Fase 3: Chat / Inference

### Task 3.1: Implementazione AIManager base (FATTO)

**Descrizione**: Implementare il singleton AIManager che gestisce l'inizializzazione di llama.cpp e il caricamento modelli.

**Prompt**:

```
Implementa src/main/ai/AIManager.ts (versione base senza chat):

1. Classe singleton AIManager con:
   - getInstance(): AIManager
   - initialize(): init llama.cpp con GPU backend appropriato
   - loadModel(modelId): carica modello con GPU layers ottimali
   - unloadModel(modelId): scarica modello e libera memoria
   - getLoadedModels(): lista ID modelli caricati
   - isInitialized(): boolean
   - dispose(): cleanup completo

2. Gestione memoria:
   - MAX_LOADED_MODELS = 2
   - IDLE_UNLOAD_TIMEOUT = 5 minuti
   - Map<modelId, LoadedModel>
   - cleanupInterval per unload modelli idle
   - unloadLeastRecentlyUsed()

3. GPU optimization:
   - calculateOptimalGpuLayers(modelDef): calcola layers GPU da VRAM

4. Integrazione con HardwareDetector per rilevare backend GPU

Riferimento: docs/AI_ARCHITECTURE.md sezione 6.1 (prima parte).
```

---

### Task 3.2: AIManager - Chat Completion con streaming (FATTO)

**Descrizione**: Estendere AIManager con le funzionalità di chat completion e streaming.

**Prompt**:

```
Estendi src/main/ai/AIManager.ts con chat completion:

1. Aggiungi metodi:
   - getChatContext(modelId, contextSize?): crea/riusa LlamaContext
   - generateChatCompletion(modelId, messages, options): AsyncGenerator che yielda chunks

2. generateChatCompletion deve:
   - Caricare modello se non caricato
   - Creare LlamaChat dalla sequence
   - Convertire messages in formato llama.cpp
   - Usare onTextChunk callback per streaming
   - Yield ogni chunk di testo
   - Return finale con response completa e tokensUsed

3. Gestione contextSequence per conversazioni continue

Riferimento: docs/AI_ARCHITECTURE.md sezione 6.1 (metodo generateChatCompletion).
```

---

### Task 3.3: IPC Handlers per Inference (FATTO)

**Descrizione**: Aggiungere gli IPC handlers per l'inizializzazione AI e la generazione risposte con streaming.

**Prompt**:

```
Estendi src/main/ipc/aiHandlers.ts con handlers inference:

1. Aggiungi handlers:
   - 'ai:initialize' - inizializza AIManager, ModelDownloader, ConversationManager
   - 'ai:isInitialized' - ritorna stato inizializzazione
   - 'ai:loadModel' (modelId) - carica modello in memoria
   - 'ai:unloadModel' (modelId) - scarica modello
   - 'ai:getLoadedModels' - lista modelli caricati
   - 'ai:generateResponse' (modelId, messages, options) - con streaming

2. Per generateResponse:
   - Itera su asyncGenerator
   - Invia chunks via webContents.send('ai:response-chunk', { chunk, fullResponse })
   - Return finale { response: fullResponse }

Riferimento: docs/AI_ARCHITECTURE.md sezione 7, INITIALIZATION e CHAT/INFERENCE.
```

---

### Task 3.4: Preload API per Inference (FATTO)

**Descrizione**: Estendere la preload API con le funzioni per chat e streaming.

**Prompt**:

```
Estendi src/preload/index.ts con API inference:

1. Aggiungi a aiAPI:
   - initialize()
   - isInitialized()
   - loadModel(modelId)
   - unloadModel(modelId)
   - getLoadedModels()
   - generateResponse(modelId, messages, options)
   - onResponseChunk(callback) - listener per streaming chunks con cleanup

2. Aggiorna index.d.ts con i tipi per messages e options

Riferimento: docs/AI_ARCHITECTURE.md sezione 8.
```

---

### Task 3.5: React Hook useAIChat (FATTO)

**Descrizione**: Creare l'hook principale per gestire chat AI con streaming delle risposte.

**Prompt**:

```
Crea src/renderer/src/hooks/useAI.ts:

1. useAIInitialize() - mutation per inizializzare + query per stato
2. useLoadedModels() - query con refetchInterval per polling stato modelli
3. useAIChat(modelId) - hook per chat con:
   - useState per isGenerating e currentResponse
   - useEffect per sottoscriversi a onResponseChunk
   - sendMessage(messages, options): Promise<string> che:
     - Setta isGenerating = true
     - Resetta currentResponse
     - Chiama generateResponse
     - Return response finale
   - Return { sendMessage, isGenerating, currentResponse }

Pattern streaming: aggiorna currentResponse ad ogni chunk per UI real-time.

Riferimento: docs/AI_ARCHITECTURE.md sezione 9.
```

---

### Task 3.6: Componente ChatMessage

**Descrizione**: Creare il componente per visualizzare un singolo messaggio nella chat.

**Prompt**:

```
Crea src/renderer/src/components/ai/ChatMessage.tsx:

1. Props: message (ChatMessage), isStreaming?
2. Layout:
   - Avatar diverso per user/assistant
   - Nome ruolo
   - Timestamp formattato
   - Contenuto messaggio con markdown rendering
   - Se isStreaming: cursore lampeggiante alla fine
3. Se ci sono noteReferences: mostra chip/badge con titoli note
4. Stile differenziato per user (allineato destra) e assistant (allineato sinistra)
5. Usa componenti Shadcn/UI (Avatar, Card)
```

---

### Task 3.7: Componente ChatInput

**Descrizione**: Creare il componente input per inviare messaggi alla chat.

**Prompt**:

```
Crea src/renderer/src/components/ai/ChatInput.tsx:

1. Props: onSend(message), isDisabled, placeholder?
2. Features:
   - Textarea auto-resize
   - Send con Enter (Shift+Enter per newline)
   - Bottone send
   - Disabled state durante generazione
3. Accessibilità: aria-label, keyboard navigation
4. Stile: border, focus ring, padding consistente
5. Usa Shadcn/UI Textarea e Button
```

---

### Task 3.8: Componente ChatInterface

**Descrizione**: Creare l'interfaccia chat completa che integra messaggi, input e gestione stato.

**Prompt**:

```
Crea src/renderer/src/components/ai/ChatInterface.tsx:

1. Props: modelId, initialMessages?, systemPrompt?
2. State: messages array locale
3. Integra useAIChat(modelId)
4. Layout:
   - Header con nome modello e status
   - ScrollArea con lista ChatMessage
   - Auto-scroll a nuovo messaggio
   - ChatInput in fondo
5. Logica:
   - handleSend: aggiungi user message, chiama sendMessage, aggiungi assistant response
   - Mostra messaggio streaming in tempo reale come ultimo messaggio
6. Empty state: "Start a conversation..."
7. Loading state: skeleton mentre carica modello

Questo è il componente base per la chat, verrà integrato con conversazioni persistenti nella Fase 5.
```

---

### Task 3.9: Pagina Chat standalone

**Descrizione**: Creare una route per testare la chat AI standalone, utile per development e debug.

**Prompt**:

```
Crea src/renderer/src/routes/ai/chat.tsx:

1. Route /ai/chat per chat AI standalone
2. Componenti:
   - Model selector dropdown (usa useDownloadedModels)
   - Se nessun modello scaricato: messaggio con link a /settings/ai
   - ChatInterface con modello selezionato
3. State: selectedModelId
4. Inizializza AI se non inizializzato (useAIInitialize)
5. Mostra warning se modello non caricato con tempo di caricamento stimato

Questa pagina è per testing, la chat principale sarà nella sidebar.
```

---

## Fase 4: RAG System

### Task 4.1: Setup sqlite-vec extension

**Descrizione**: Configurare il bundling dell'extension nativa sqlite-vec per ogni piattaforma.

**Prompt**:

```
Configura sqlite-vec per TaacNotes:

1. Installa sqlite-vec come dipendenza
2. Crea directory resources/native/ per extension binarie
3. Configura electron-builder per includere extension native:
   - darwin-arm64, darwin-x64
   - win32-x64
   - linux-x64
4. Crea script postinstall per scaricare binari precompilati sqlite-vec
5. Documenta processo build per ogni piattaforma

Se sqlite-vec non è disponibile come npm package, valuta alternative come includere binari precompilati o buildare da source.
```

---

### Task 4.2: Implementazione VectorDBManager

**Descrizione**: Implementare il manager per il database vettoriale per-space usando better-sqlite3 e sqlite-vec.

**Prompt**:

```
Implementa src/main/ai/VectorDBManager.ts:

1. Classe VectorDBManager con:
   - constructor(spaceId, embeddingDimension = 768)
   - initialize(): crea DB, carica extension, crea tabelle
   - upsertDocument(doc: VectorDocument): inserisce/aggiorna documento
   - deleteDocumentsForNote(noteId): rimuove tutti i chunks di una nota
   - search(queryEmbedding, limit, noteIds?): ricerca semantica
   - getDocumentCount(): conta documenti
   - getIndexedNoteIds(): lista note indicizzate
   - close(): chiude connessione

2. Schema DB:
   - Tabella documents: id, note_id, chunk_index, content, metadata, created_at
   - Tabella virtuale vec_documents: id, embedding float[768]

3. Path: {userData}/spaces/{spaceId}/database/vectors.db

4. getExtensionPath(): determina path extension per platform/arch

Riferimento: docs/AI_ARCHITECTURE.md sezione 6.5.
```

---

### Task 4.3: Implementazione EmbeddingService

**Descrizione**: Implementare il servizio per generare embeddings e indicizzare note.

**Prompt**:

```
Implementa src/main/ai/EmbeddingService.ts:

1. Classe EmbeddingService con:
   - constructor(aiManager: AIManager)
   - setEmbeddingModel(modelId): configura modello embedding
   - embedText(text): genera embedding singolo
   - embedTexts(texts): batch embedding
   - indexNote(note, vectorDB, options?): indicizza nota completa

2. indexNote deve:
   - Estrarre testo da Lexical state con extractTextFromLexical()
   - Chunking con chunkText(text, options)
   - Generare embedding per ogni chunk
   - Upsert in VectorDB

3. Chunking options default:
   - maxChunkSize: 512
   - overlapSize: 50
   - splitOnParagraph: true

4. extractTextFromLexical: ricorsivo su nodi Lexical per estrarre testo

Riferimento: docs/AI_ARCHITECTURE.md sezione 6.7.
```

---

### Task 4.4: AIManager - Embedding Context

**Descrizione**: Estendere AIManager per supportare embedding context oltre a chat context.

**Prompt**:

```
Estendi src/main/ai/AIManager.ts per embedding:

1. Aggiungi a LoadedModel:
   - embeddingContext: LlamaEmbeddingContext | null

2. Aggiungi metodo:
   - getEmbeddingContext(modelId): crea/riusa LlamaEmbeddingContext

3. Modifica unloadModel per disporre anche embeddingContext

4. Il modello embedding di default è 'nomic-embed-text-v1.5'

Riferimento: docs/AI_ARCHITECTURE.md sezione 6.1, metodo getEmbeddingContext.
```

---

### Task 4.5: IPC Handlers per Vector Search

**Descrizione**: Aggiungere gli IPC handlers per indicizzazione e ricerca semantica.

**Prompt**:

```
Estendi src/main/ipc/aiHandlers.ts con handlers RAG:

1. Gestione VectorDBManager per-space:
   - Map<spaceId, VectorDBManager>
   - getOrCreateVectorDB(spaceId)

2. Handlers:
   - 'ai:initializeVectorDB' (spaceId)
   - 'ai:indexNote' (spaceId, noteId, folderId)
   - 'ai:indexAllNotes' (spaceId) - con progress via webContents.send
   - 'ai:searchNotes' (spaceId, query, limit?, noteIds?)
   - 'ai:getIndexedNotes' (spaceId)
   - 'ai:deleteNoteIndex' (spaceId, noteId)

3. indexAllNotes deve:
   - Ottenere folder tree da FileSystemManager
   - Iterare ricorsivamente tutte le note
   - Inviare progress 'ai:indexing-progress' ad ogni nota

Riferimento: docs/AI_ARCHITECTURE.md sezione 7, VECTOR SEARCH / RAG.
```

---

### Task 4.6: Preload API per Vector Search

**Descrizione**: Estendere la preload API con le funzioni per RAG.

**Prompt**:

```
Estendi src/preload/index.ts con API vector search:

1. Aggiungi a aiAPI:
   - initializeVectorDB(spaceId)
   - indexNote(spaceId, noteId, folderId)
   - indexAllNotes(spaceId)
   - searchNotes(spaceId, query, limit?, noteIds?)
   - getIndexedNotes(spaceId)
   - deleteNoteIndex(spaceId, noteId)
   - onIndexingProgress(callback) - listener per progress indexing

2. Aggiorna index.d.ts con i tipi

Riferimento: docs/AI_ARCHITECTURE.md sezione 8.
```

---

### Task 4.7: React Hooks per Vector Search

**Descrizione**: Creare gli hooks React per gestire indicizzazione e ricerca semantica.

**Prompt**:

```
Crea src/renderer/src/hooks/useVectorSearch.ts:

1. useIndexedNotes(spaceId) - query lista note indicizzate
2. useIndexNote() - mutation per indicizzare singola nota
3. useIndexAllNotes(spaceId) - hook con:
   - progress state (current, total, noteTitle)
   - useEffect per onIndexingProgress
   - indexAll mutation
   - isIndexing state
4. useVectorSearch(spaceId) - mutation per search con query, limit, noteIds
5. useDeleteNoteIndex() - mutation per rimuovere indice nota

Pattern: invalidare query ['ai', 'indexed', spaceId] dopo modifiche.

Riferimento: docs/AI_ARCHITECTURE.md sezione 9.
```

---

### Task 4.8: Auto-indexing al salvataggio nota

**Descrizione**: Integrare l'auto-indexing quando una nota viene salvata.

**Prompt**:

```
Modifica il flusso di salvataggio note per auto-indexing:

1. Trova dove viene chiamata la mutation per salvare/aggiornare una nota
2. Dopo successo del salvataggio, se AI è inizializzato:
   - Chiama window.ai.indexNote(spaceId, noteId, folderId)
   - Non bloccare UI, esegui in background
3. Aggiungi config option 'autoIndexNotes' (default: true)
4. Se autoIndexNotes è false, non indicizzare automaticamente

Considera di usare un worker o debouncing per evitare indicizzazioni troppo frequenti durante editing attivo.
```

---

### Task 4.9: Componente SearchResults

**Descrizione**: Creare il componente per visualizzare i risultati della ricerca semantica.

**Prompt**:

```
Crea src/renderer/src/components/ai/SearchResults.tsx:

1. Props: results (SearchResult[]), onSelectNote(noteId), isLoading
2. Per ogni risultato mostra:
   - Titolo nota (da metadata)
   - Snippet contenuto con highlight query terms
   - Distance/relevance score come badge
   - Click per navigare alla nota
3. Empty state: "No results found"
4. Loading state: skeleton
5. Usa Shadcn/UI Card, ScrollArea

Questo componente sarà usato nella chat per mostrare note rilevanti.
```

---

### Task 4.10: Integrazione RAG nella Chat

**Descrizione**: Integrare la ricerca semantica nel flusso di chat per arricchire il contesto.

**Prompt**:

```
Estendi ChatInterface per supportare RAG:

1. Props aggiuntive: spaceId?, enableRAG?
2. Se enableRAG e spaceId:
   - Prima di inviare messaggio, cerca note rilevanti con searchNotes
   - Costruisci context prompt con risultati ricerca
   - Mostra note usate come context sotto l'input
3. Nuovo componente ChatContextNotes:
   - Lista note in context con possibilità di rimuovere
   - Click per espandere/vedere excerpt
4. Modifica handleSend per:
   - Cercare note rilevanti
   - Prepend context al prompt
   - Salvare noteReferences nel messaggio

Pattern: "Given the following notes as context:\n[notes]\n\nUser question: [message]"
```

---

## Fase 5: Conversations

### Task 5.1: Implementazione ConversationManager

**Descrizione**: Implementare il manager per la persistenza delle conversazioni globali.

**Prompt**:

```
Implementa src/main/ai/ConversationManager.ts:

1. Classe ConversationManager con:
   - initialize(): crea directory conversations/, carica conversazioni esistenti
   - createConversation(title, modelId, systemPrompt?): crea nuova
   - addMessage(conversationId, role, content, noteRefs?): aggiunge messaggio
   - addNoteToContext(conversationId, noteRef): aggiunge nota a context
   - removeNoteFromContext(conversationId, noteId): rimuove nota
   - getConversation(id): ritorna conversazione completa
   - listConversations(): ritorna lista ConversationSummary ordinata per updatedAt
   - updateConversationTitle(id, title)
   - deleteConversation(id)
   - buildContextPrompt(conversation): costruisce prompt da noteContext

2. Persistenza: {userData}/conversations/{id}.json
3. Map<id, Conversation> in memoria per accesso veloce

Riferimento: docs/AI_ARCHITECTURE.md sezione 6.6.
```

---

### Task 5.2: IPC Handlers per Conversations

**Descrizione**: Aggiungere gli IPC handlers per gestire le conversazioni.

**Prompt**:

```
Estendi src/main/ipc/aiHandlers.ts con handlers conversazioni:

1. Handlers:
   - 'ai:createConversation' (title, modelId, systemPrompt?)
   - 'ai:getConversation' (conversationId)
   - 'ai:listConversations'
   - 'ai:addMessage' (conversationId, role, content, noteRefs?)
   - 'ai:updateConversationTitle' (conversationId, title)
   - 'ai:addNoteToConversation' (conversationId, noteRef)
   - 'ai:removeNoteFromConversation' (conversationId, noteId)
   - 'ai:deleteConversation' (conversationId)

2. Inizializza ConversationManager in registerAIHandlers()

Riferimento: docs/AI_ARCHITECTURE.md sezione 7, CONVERSATIONS.
```

---

### Task 5.3: Preload API per Conversations

**Descrizione**: Estendere la preload API con le funzioni per gestire conversazioni.

**Prompt**:

```
Estendi src/preload/index.ts con API conversations:

1. Aggiungi a aiAPI:
   - createConversation(title, modelId, systemPrompt?)
   - getConversation(id)
   - listConversations()
   - addMessage(conversationId, role, content, noteRefs?)
   - updateConversationTitle(conversationId, title)
   - addNoteToConversation(conversationId, noteRef)
   - removeNoteFromConversation(conversationId, noteId)
   - deleteConversation(id)

2. Aggiorna index.d.ts con i tipi

Riferimento: docs/AI_ARCHITECTURE.md sezione 8.
```

---

### Task 5.4: React Hooks per Conversations

**Descrizione**: Creare gli hooks React per gestire le conversazioni.

**Prompt**:

```
Crea src/renderer/src/hooks/useConversations.ts:

1. useConversations() - query lista conversazioni
2. useConversation(id) - query singola conversazione (enabled: !!id)
3. useCreateConversation() - mutation con invalidation
4. useAddMessage() - mutation con invalidation della conversazione specifica
5. useUpdateConversationTitle() - mutation
6. useDeleteConversation() - mutation con invalidation lista
7. useAddNoteToConversation() - mutation
8. useRemoveNoteFromConversation() - mutation

Query keys: ['ai', 'conversations'], ['ai', 'conversation', id]

Riferimento: docs/AI_ARCHITECTURE.md sezione 9.
```

---

### Task 5.5: Componente ConversationList

**Descrizione**: Creare il componente per visualizzare la lista delle conversazioni.

**Prompt**:

```
Crea src/renderer/src/components/ai/ConversationList.tsx:

1. Props: onSelectConversation(id), selectedId?, onNewConversation
2. Usa useConversations() hook
3. Per ogni conversazione mostra:
   - Titolo (troncato se lungo)
   - Modello usato come badge
   - Numero messaggi
   - Data ultimo aggiornamento (relativa: "2h ago")
   - Menu contestuale: Rename, Delete
4. Bottone "New Conversation" in cima
5. Empty state: "No conversations yet"
6. Evidenzia conversazione selezionata
7. Ordine: più recenti in alto
```

---

### Task 5.6: Componente ConversationHeader

**Descrizione**: Creare l'header della conversazione con titolo editabile e azioni.

**Prompt**:

```
Crea src/renderer/src/components/ai/ConversationHeader.tsx:

1. Props: conversation (Conversation), onTitleChange, onDelete, onClose
2. Features:
   - Titolo editabile inline (click to edit)
   - Badge modello
   - Conteggio note in context
   - Menu azioni: Delete conversation, Clear context
   - Bottone close/back
3. Usa useUpdateConversationTitle mutation
4. Conferma prima di delete
```

---

### Task 5.7: Refactor ChatInterface per Conversations

**Descrizione**: Modificare ChatInterface per supportare conversazioni persistenti.

**Prompt**:

```
Modifica ChatInterface per integrazione con conversazioni:

1. Props modificate:
   - conversationId?: string (se presente, usa conversazione persistente)
   - Mantieni modalità standalone per chat senza persistenza

2. Se conversationId:
   - Usa useConversation(conversationId) per caricare messaggi
   - Usa useAddMessage per aggiungere messaggi
   - Carica noteContext dalla conversazione
   - Mostra ConversationHeader

3. Separa logica:
   - useChatState(conversationId?) hook che gestisce:
     - Messaggi (da query o state locale)
     - Add message (mutation o state update)

4. Integrazione RAG: usa buildContextPrompt per note in context
```

---

### Task 5.8: Componente AIChatPanel

**Descrizione**: Creare il pannello chat completo con lista conversazioni e chat interface.

**Prompt**:

```
Crea src/renderer/src/components/ai/AIChatPanel.tsx:

1. Layout split:
   - Sinistra (resizable): ConversationList
   - Destra: ChatInterface con conversazione selezionata

2. State: selectedConversationId
3. Se nessuna conversazione selezionata: mostra prompt per crearne una
4. Bottone collapse per nascondere lista conversazioni
5. Mobile responsive: drawer per lista conversazioni
6. Integra:
   - Model selector per nuove conversazioni
   - Space selector per RAG context

Questo sarà il componente principale per l'esperienza AI.
```

---

### Task 5.9: Integrazione AIChatPanel nella sidebar

**Descrizione**: Integrare il pannello chat AI nella sidebar dell'applicazione.

**Prompt**:

```
Integra AIChatPanel nella UI principale:

1. Opzione A - Tab nella sidebar:
   - Aggiungi tab "AI Chat" nella sidebar esistente
   - Icona: MessageSquare o Bot da Lucide

2. Opzione B - Pannello laterale destro:
   - Bottone nella toolbar per aprire/chiudere
   - Pannello slide-in da destra
   - Resizable

3. Salva stato apertura in config
4. Shortcut keyboard: Cmd/Ctrl + Shift + A

Valuta quale opzione si integra meglio con il design esistente della sidebar notes-tree.
```

---

### Task 5.10: Quick actions da nota a chat

**Descrizione**: Aggiungere azioni rapide per inviare contenuto nota alla chat AI.

**Prompt**:

```
Aggiungi quick actions per AI dalla nota attiva:

1. Nel toolbar dell'editor o menu contestuale:
   - "Ask AI about this note" - apre chat con nota in context
   - "Summarize this note" - prompt predefinito per summarize
   - "Explain this" - per selezione di testo

2. Implementa:
   - Se chat panel chiuso, aprilo
   - Crea nuova conversazione o usa quella attiva
   - Aggiungi nota a noteContext
   - Se "Summarize" o "Explain": invia messaggio automatico

3. Mostra toast di conferma "Note added to AI context"
```

---

## Fase 6: Onboarding & Polish

### Task 6.1: Redux slice per AI state

**Descrizione**: Creare uno slice Redux per gestire lo stato globale AI (se necessario per stato UI).

**Prompt**:

```
Valuta se serve Redux slice per AI state:

1. Analizza se lo stato AI può essere gestito interamente con TanStack Query
2. Se serve Redux, crea src/renderer/src/store/slices/aiSlice.ts per:
   - isAIInitialized
   - currentModelId (modello attivo per chat)
   - chatPanelOpen
   - selectedConversationId

3. Se TanStack Query è sufficiente:
   - Documenta pattern usato
   - Considera useAIStore hook con Zustand come alternativa più leggera

Obiettivo: evitare duplicazione stato tra Redux e TanStack Query.
```

---

### Task 6.2: AI Config schema e persistence

**Descrizione**: Implementare la configurazione AI persistente con electron-store.

**Prompt**:

```
Estendi il sistema di configurazione per AI:

1. Aggiungi AIConfig interface al config schema:
   - defaultChatModelId: string | null
   - defaultEmbeddingModelId: string = 'nomic-embed-text-v1.5'
   - maxContextSize: number = 4096
   - defaultTemperature: number = 0.7
   - defaultMaxTokens: number = 2048
   - autoUnloadIdleModels: boolean = true
   - idleUnloadTimeoutMs: number = 300000
   - maxLoadedModels: number = 2
   - chunkSize: number = 512
   - chunkOverlap: number = 50
   - searchResultsLimit: number = 10
   - autoIndexNotes: boolean = true
   - showHardwareWarnings: boolean = true
   - streamResponses: boolean = true
   - onboardingCompleted: boolean = false
   - hardwareTier: string | null

2. Crea IPC handlers per get/set AI config
3. Crea React hooks useAIConfig, useSetAIConfig

Riferimento: docs/AI_ARCHITECTURE.md sezione 10.1.
```

---

### Task 6.3: Componente AISettingsPanel

**Descrizione**: Creare il pannello impostazioni AI completo.

**Prompt**:

```
Crea src/renderer/src/components/ai/AISettingsPanel.tsx:

1. Sezioni:
   - Models: default chat model, default embedding model
   - Inference: temperature slider, max tokens, context size
   - Memory: auto unload toggle, idle timeout, max loaded models
   - RAG: chunk size, overlap, search results limit, auto-index toggle
   - UI: stream responses toggle, hardware warnings toggle

2. Per ogni setting:
   - Label con descrizione tooltip
   - Input appropriato (slider, toggle, select, number)
   - Valore default indicato

3. Usa useAIConfig e useSetAIConfig hooks
4. Bottone "Reset to defaults"
5. Validazione input

Integra in /settings/ai route.
```

---

### Task 6.4: Wizard Onboarding - Step 1: Welcome

**Descrizione**: Creare il primo step dell'onboarding AI wizard.

**Prompt**:

```
Crea src/renderer/src/components/ai/onboarding/OnboardingWelcome.tsx:

1. Step 1 del wizard onboarding AI
2. Contenuto:
   - Titolo: "Enable AI Features"
   - Descrizione delle funzionalità AI disponibili:
     - Local LLM chat
     - Semantic search in notes
     - AI-powered note assistance
   - Emphasis su privacy (tutto locale)
   - Illustrazione/icona AI
3. Bottoni: "Skip" (salta onboarding), "Get Started"
4. Progress indicator (step 1 di 4)
```

---

### Task 6.5: Wizard Onboarding - Step 2: Hardware Detection

**Descrizione**: Creare lo step di hardware detection dell'onboarding.

**Prompt**:

```
Crea src/renderer/src/components/ai/onboarding/OnboardingHardware.tsx:

1. Step 2: Hardware detection
2. Flow:
   - Mostra spinner "Analyzing your hardware..."
   - Chiama useHardwareInfo
   - Mostra risultato con HardwareInfoCard
   - Mostra tier assegnato con spiegazione
   - Se tier low: warning con suggerimenti
3. Salva hardwareTier in config
4. Bottoni: "Back", "Continue"
```

---

### Task 6.6: Wizard Onboarding - Step 3: Model Selection

**Descrizione**: Creare lo step di selezione modello dell'onboarding.

**Prompt**:

```
Crea src/renderer/src/components/ai/onboarding/OnboardingModelSelect.tsx:

1. Step 3: Model selection
2. Mostra modelli raccomandati per il tier (useModelRecommendations)
3. Per ogni modello raccomandato:
   - Nome e descrizione
   - Size
   - Estimated performance badge
   - Radio button per selezionare
4. Link "See all models" per utenti avanzati
5. State: selectedModelId
6. Bottoni: "Back", "Download & Continue"
```

---

### Task 6.7: Wizard Onboarding - Step 4: Download Progress

**Descrizione**: Creare lo step di download modello dell'onboarding.

**Prompt**:

```
Crea src/renderer/src/components/ai/onboarding/OnboardingDownload.tsx:

1. Step 4: Model download
2. Avvia automaticamente download del modello selezionato
3. Mostra:
   - Progress bar grande
   - Percentuale, speed, ETA
   - Nome file scaricato
   - Bottone "Pause" / "Resume"
4. Al completamento:
   - Success message
   - Salva defaultChatModelId in config
   - Set onboardingCompleted = true
5. Bottoni: "Back" (cancella download), "Finish" (solo se completato)
```

---

### Task 6.8: Componente OnboardingWizard

**Descrizione**: Creare il container wizard che orchestra tutti gli step.

**Prompt**:

```
Crea src/renderer/src/components/ai/onboarding/OnboardingWizard.tsx:

1. Container per tutti gli step onboarding
2. State: currentStep, selectedModelId, hardwareTier
3. Renderizza step corrente:
   - 0: OnboardingWelcome
   - 1: OnboardingHardware
   - 2: OnboardingModelSelect
   - 3: OnboardingDownload
4. Progress bar in header
5. Gestisce navigazione back/next
6. Props: onComplete, onSkip
7. Modal/Dialog full-screen con backdrop
```

---

### Task 6.9: Trigger onboarding al primo accesso AI

**Descrizione**: Integrare il wizard onboarding nel flusso dell'app.

**Prompt**:

```
Integra OnboardingWizard nell'app:

1. Crea hook useAIOnboarding:
   - Legge onboardingCompleted da config
   - Return { shouldShowOnboarding, completeOnboarding, skipOnboarding }

2. Nel componente principale (o AIChatPanel):
   - Se shouldShowOnboarding e utente tenta di usare AI:
     - Mostra OnboardingWizard
   - Altrimenti procedi normalmente

3. Aggiungi anche entry point manuale:
   - Bottone "Setup AI" in settings se non completato
   - Bottone "Re-run setup" se completato

4. Dopo skip o complete, non mostrare più automaticamente
```

---

### Task 6.10: Error boundaries e fallback UI

**Descrizione**: Implementare gestione errori robusta per componenti AI.

**Prompt**:

```
Implementa error handling per componenti AI:

1. Crea AIErrorBoundary component:
   - Cattura errori nei componenti AI
   - Mostra UI di fallback con:
     - Messaggio errore user-friendly
     - Bottone "Retry"
     - Link a troubleshooting/settings

2. Mappa error codes a messaggi:
   - MODEL_NOT_DOWNLOADED: "Please download a model first"
   - INSUFFICIENT_MEMORY: "Not enough memory..."
   - GPU_NOT_AVAILABLE: "Running on CPU..."

3. Wrappa componenti critici:
   - ChatInterface
   - ModelLibrary
   - OnboardingWizard

4. Toast notifications per errori non-blocking
```

---

### Task 6.11: Loading states e skeletons

**Descrizione**: Creare componenti skeleton per tutti gli stati di caricamento AI.

**Prompt**:

```
Crea skeletons per componenti AI:

1. ChatMessageSkeleton - per messaggi in caricamento
2. ModelCardSkeleton - per lista modelli
3. ConversationListSkeleton - per lista conversazioni
4. SearchResultsSkeleton - per risultati ricerca
5. HardwareInfoSkeleton - per info hardware

Usa Shadcn/UI Skeleton component.
Applica nei rispettivi componenti durante isLoading.

Pattern consistente: stessa struttura del componente reale ma con elementi skeleton.
```

---

### Task 6.12: Keyboard shortcuts AI

**Descrizione**: Implementare shortcuts da tastiera per funzionalità AI.

**Prompt**:

```
Implementa keyboard shortcuts per AI:

1. Shortcuts globali:
   - Cmd/Ctrl + Shift + A: Toggle AI chat panel
   - Cmd/Ctrl + Shift + S: Semantic search (focus search input)

2. In chat:
   - Cmd/Ctrl + Enter: Send message (alternativa a Enter)
   - Escape: Close chat panel
   - Cmd/Ctrl + N: New conversation

3. In note editor:
   - Cmd/Ctrl + Shift + Q: Ask AI about selection

4. Implementa con useHotkeys hook o event listener globale
5. Mostra shortcuts in tooltip dei bottoni
6. Aggiungi sezione shortcuts in settings/help
```

---

### Task 6.13: Performance optimization

**Descrizione**: Ottimizzare le performance dei componenti AI.

**Prompt**:

```
Ottimizza performance componenti AI:

1. Memoization:
   - React.memo su ChatMessage, ModelCard
   - useMemo per liste filtrate/ordinate
   - useCallback per handlers

2. Virtualization:
   - Usa @tanstack/react-virtual per lista messaggi lunga
   - Virtualizza ConversationList se > 50 items

3. Debouncing:
   - Debounce search query (300ms)
   - Debounce auto-save indicizzazione

4. Lazy loading:
   - Lazy load componenti AI (React.lazy)
   - Code split per route AI

5. Verifica con React DevTools Profiler
```

---

### Task 6.14: Testing e2e per flusso AI

**Descrizione**: Creare test end-to-end per i flussi principali AI.

**Prompt**:

```
Crea test per flussi AI (se test framework presente):

1. Test onboarding:
   - Wizard completo con mock hardware
   - Skip onboarding

2. Test model management:
   - Download model (mock)
   - Delete model

3. Test chat:
   - Send message
   - Receive streaming response
   - New conversation

4. Test RAG:
   - Index note
   - Search notes
   - Use context in chat

Se non c'è test framework, crea checklist manuale QA in docs/AI_QA_CHECKLIST.md
```

---

### Task 6.15: Documentazione utente AI

**Descrizione**: Creare documentazione per le funzionalità AI.

**Prompt**:

```
Aggiorna documentazione con sezione AI:

1. Aggiorna README.md con sezione "AI Features":
   - Overview funzionalità
   - Hardware requirements
   - Supported models

2. Crea docs/AI_USER_GUIDE.md:
   - Getting started with AI
   - Downloading models
   - Using the chat
   - Semantic search
   - Tips for better results
   - Troubleshooting common issues

3. Aggiungi inline help/tooltips nei componenti AI

Non creare documentazione eccessiva, mantienila concisa e utile.
```

---

## Note Implementative

### Ordine di esecuzione consigliato

1. Completa **Fase 1** interamente prima di procedere
2. **Fase 2** può iniziare solo dopo Task 1.1-1.5
3. **Fase 3** richiede Fase 2 completata
4. **Fase 4** può procedere in parallelo con Fase 3 (dopo Task 3.1)
5. **Fase 5** richiede Fase 3 e 4 completate
6. **Fase 6** è indipendente e può essere fatta incrementalmente

### Dipendenze critiche

- `node-llama-cpp` richiede build nativi per ogni piattaforma
- `sqlite-vec` extension deve essere bundled correttamente
- Test su macOS (Metal), Windows (CUDA), Linux prima di release

### Rischi e mitigazioni

| Rischio                    | Mitigazione                                         |
| -------------------------- | --------------------------------------------------- |
| Build nativi falliscono    | Documentare processo build, CI/CD per ogni platform |
| Memoria insufficiente      | Limiti conservativi, warning chiari                 |
| Download modelli lenti     | Progress UI, pause/resume, retry automatico         |
| sqlite-vec incompatibilità | Fallback a ricerca full-text se necessario          |

---

_Documento generato per TaacNotes AI Implementation - v1.0_
