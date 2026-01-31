# TaacNotes AI Architecture

Documento architetturale per l'integrazione di funzionalità AI locali in TaacNotes utilizzando llama.cpp.

## Indice

1. [Panoramica](#1-panoramica)
2. [Requisiti e Obiettivi](#2-requisiti-e-obiettivi)
3. [Stack Tecnologico](#3-stack-tecnologico)
4. [Architettura di Alto Livello](#4-architettura-di-alto-livello)
5. [Struttura Directory](#5-struttura-directory)
6. [Componenti Core](#6-componenti-core)
7. [IPC Handlers](#7-ipc-handlers)
8. [Preload API](#8-preload-api)
9. [React Hooks](#9-react-hooks)
10. [Configurazione](#10-configurazione)
11. [Flussi di Dati](#11-flussi-di-dati)
12. [Gestione Errori](#12-gestione-errori)
13. [Fasi di Implementazione](#13-fasi-di-implementazione)
14. [Risorse e Riferimenti](#14-risorse-e-riferimenti)

---

## 1. Panoramica

TaacNotes integrerà funzionalità AI locali per permettere agli utenti di:

- **Analizzare l'hardware** del proprio computer e ricevere raccomandazioni sul miglior LLM locale
- **Scaricare e gestire modelli LLM** direttamente dall'applicazione senza setup complessi
- **Creare conversazioni AI** con contesto derivato dalle note (RAG - Retrieval Augmented Generation)

L'architettura segue i pattern esistenti nel codebase (Manager classes, IPC handlers, TanStack Query hooks) adattandoli alle specificità dell'inferenza AI locale.

---

## 2. Requisiti e Obiettivi

### 2.1 Requisiti Funzionali

| Requisito                    | Descrizione                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------ |
| **Hardware Detection**       | Rilevare CPU, RAM, GPU/VRAM per classificare il sistema in tier di performance |
| **Model Recommendations**    | Suggerire modelli appropriati basati sul tier hardware                         |
| **Model Download**           | Download integrato con progress bar, pause/resume support                      |
| **Chat Interface**           | Conversazioni con streaming delle risposte                                     |
| **RAG Integration**          | Ricerca semantica nelle note per arricchire il contesto AI                     |
| **Conversation Persistence** | Salvataggio conversazioni globali con riferimenti a note multiple              |

### 2.2 Requisiti Non Funzionali

| Requisito             | Specifiche                                                    |
| --------------------- | ------------------------------------------------------------- |
| **Accelerazione GPU** | Metal (macOS), CUDA (Windows/Linux Nvidia), Vulkan (fallback) |
| **Memory Management** | Auto-unload modelli idle, max 2 modelli caricati              |
| **Privacy**           | Tutto locale, nessun dato inviato a server esterni            |
| **UX**                | Onboarding guidato, minimal friction per utenti non tecnici   |

### 2.3 Decisioni Architetturali

| Decisione        | Scelta         | Motivazione                                                       |
| ---------------- | -------------- | ----------------------------------------------------------------- |
| Libreria LLM     | node-llama-cpp | Flessibile, GPU support nativo, documentazione Electron completa  |
| Persistence Chat | Globale        | Conversazioni indipendenti da note ma con riferimenti multi-space |
| Hardware Support | Multi-platform | CPU + Metal (macOS) + CUDA (Win/Linux) per massima performance    |
| Model Selection  | Curated List   | Lista testata (2-3 per tier) con download integrato               |

---

## 3. Stack Tecnologico

### 3.1 Dipendenze Principali

```json
{
  "dependencies": {
    "node-llama-cpp": "^3.0.0",
    "better-sqlite3": "^11.0.0",
    "systeminformation": "^5.22.0",
    "@huggingface/gguf": "^0.1.0"
  }
}
```

### 3.2 Descrizione Librerie

| Libreria              | Scopo                               | Note                                              |
| --------------------- | ----------------------------------- | ------------------------------------------------- |
| **node-llama-cpp**    | Binding Node.js per llama.cpp       | Supporta Metal/CUDA/Vulkan, embeddings, streaming |
| **better-sqlite3**    | Database SQLite sincronico          | Base per sqlite-vec extension                     |
| **sqlite-vec**        | Estensione SQLite per vector search | Loaded come extension nativa                      |
| **systeminformation** | Rilevamento hardware                | CPU, RAM, GPU, VRAM detection                     |
| **@huggingface/gguf** | Parsing metadata GGUF               | Validazione modelli, info quantizzazione          |

### 3.3 Native Modules

I seguenti moduli richiedono build nativi:

- `node-llama-cpp` - Binari precompilati per Metal/CUDA/Vulkan
- `better-sqlite3` - Binding SQLite nativi
- `sqlite-vec` - Extension nativa per ogni piattaforma

---

## 4. Architettura di Alto Livello

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              RENDERER PROCESS                                │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────────────────────────┐  │
│  │  React Hooks  │  │  Redux Store  │  │     TanStack Query Cache        │  │
│  │   useAI*()    │  │   aiSlice     │  │      ['ai:*'] query keys        │  │
│  └───────┬───────┘  └───────┬───────┘  └───────────────┬─────────────────┘  │
│          │                  │                          │                     │
│          └──────────────────┴──────────────────────────┘                     │
│                              │                                               │
│                        contextBridge                                         │
│                         window.ai                                            │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               │ IPC (ai:*)
┌──────────────────────────────┼───────────────────────────────────────────────┐
│                         MAIN PROCESS                                         │
│                              │                                               │
│  ┌───────────────────────────┴─────────────────────────────┐                │
│  │                    AI IPC Handlers                       │                │
│  │               src/main/ipc/aiHandlers.ts                │                │
│  └───────────────────────────┬─────────────────────────────┘                │
│                              │                                               │
│  ┌───────────────────────────┴─────────────────────────────┐                │
│  │                 AIManager (Singleton)                    │                │
│  │               src/main/ai/AIManager.ts                  │                │
│  │  ┌─────────────────┐ ┌─────────────────┐ ┌───────────┐  │                │
│  │  │ HardwareDetector│ │  ModelDownloader│ │EmbeddingSvc│  │                │
│  │  └─────────────────┘ └─────────────────┘ └───────────┘  │                │
│  └─────────────────────────────────────────────────────────┘                │
│                              │                                               │
│  ┌───────────────────────────┴─────────────────────────────┐                │
│  │              VectorDBManager (Per-Space)                 │                │
│  │            src/main/ai/VectorDBManager.ts               │                │
│  │                                                          │                │
│  │   Space A: vectors.db    Space B: vectors.db            │                │
│  └─────────────────────────────────────────────────────────┘                │
│                              │                                               │
│  ┌───────────────────────────┴─────────────────────────────┐                │
│  │             ConversationManager (Global)                 │                │
│  │          src/main/ai/ConversationManager.ts             │                │
│  │                                                          │                │
│  │   {userData}/conversations/*.json                       │                │
│  └─────────────────────────────────────────────────────────┘                │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.1 Pattern Chiave

| Pattern       | Applicazione        | Motivazione                                                 |
| ------------- | ------------------- | ----------------------------------------------------------- |
| **Singleton** | AIManager           | Modelli condivisi tra space, gestione memoria centralizzata |
| **Per-Space** | VectorDBManager     | Isolamento dati, ogni space ha il suo vector DB             |
| **Global**    | ConversationManager | Conversazioni possono referenziare note da space diversi    |
| **Lazy Init** | Tutti i manager     | Inizializzazione on-demand per performance                  |

---

## 5. Struttura Directory

```
src/
├── main/
│   ├── ai/
│   │   ├── index.ts                    # Export tutti i moduli AI
│   │   ├── AIManager.ts                # Orchestratore principale (singleton)
│   │   ├── HardwareDetector.ts         # Rilevamento CPU/RAM/GPU + tier
│   │   ├── ModelDownloader.ts          # Download con progress/pause/resume
│   │   ├── ModelRegistry.ts            # Definizioni modelli curati
│   │   ├── VectorDBManager.ts          # sqlite-vec wrapper per-space
│   │   ├── ConversationManager.ts      # Persistenza conversazioni
│   │   ├── EmbeddingService.ts         # Text chunking + embedding
│   │   ├── errors.ts                   # Classi errore custom
│   │   └── types.ts                    # Tipi TypeScript condivisi
│   ├── ipc/
│   │   ├── aiHandlers.ts               # IPC handlers per AI
│   │   └── ... (handlers esistenti)
│   └── index.ts                        # Aggiungere init AIManager
├── preload/
│   ├── index.ts                        # Aggiungere window.ai API
│   └── index.d.ts                      # Tipi per AI API
└── renderer/
    └── src/
        ├── hooks/
        │   ├── useAI.ts                # Hooks inference/chat
        │   ├── useHardware.ts          # Hooks hardware detection
        │   ├── useModels.ts            # Hooks gestione modelli
        │   ├── useConversations.ts     # Hooks conversazioni
        │   └── useVectorSearch.ts      # Hooks RAG/semantic search
        └── store/
            └── slices/
                └── aiSlice.ts          # Redux slice per AI state
```

### 5.1 Storage Paths

```
{userData}/
├── models/                          # Modelli GGUF scaricati
│   ├── .temp/                       # Download parziali per resume
│   │   └── {modelId}.part
│   ├── Phi-3-mini-4k-instruct-Q4_K_M.gguf
│   └── nomic-embed-text-v1.5.Q8_0.gguf
├── conversations/                   # Conversazioni persistenti
│   ├── {conversationId}.json
│   └── ...
└── spaces/
    └── {spaceId}/
        └── database/
            └── vectors.db           # Vector DB per-space
```

---

## 6. Componenti Core

### 6.1 AIManager (Singleton)

Il componente centrale che orchestra tutte le operazioni AI.

```typescript
// src/main/ai/AIManager.ts

import {
  getLlama,
  Llama,
  LlamaModel,
  LlamaContext,
  LlamaChat,
  LlamaEmbeddingContext
} from 'node-llama-cpp'
import { app } from 'electron'
import { join } from 'path'
import { HardwareDetector, HardwareInfo } from './HardwareDetector'
import { ModelRegistry, ModelDefinition } from './ModelRegistry'

export interface AIManagerConfig {
  modelsDir: string
  maxContextSize: number
  defaultGpuLayers: number | 'auto'
}

export interface LoadedModel {
  id: string
  model: LlamaModel
  context: LlamaContext | null
  embeddingContext: LlamaEmbeddingContext | null
  lastUsed: number
  memoryUsage: number
}

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

export interface GenerationOptions {
  maxTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
}

export interface ChatCompletionResult {
  response: string
  tokensUsed: number
}

export class AIManager {
  private static instance: AIManager | null = null

  private llama: Llama | null = null
  private loadedModels: Map<string, LoadedModel> = new Map()
  private config: AIManagerConfig
  private hardwareInfo: HardwareInfo | null = null
  private initialized: boolean = false

  // Memory management constants
  private readonly MAX_LOADED_MODELS = 2
  private readonly IDLE_UNLOAD_TIMEOUT = 5 * 60 * 1000 // 5 minutes
  private cleanupInterval: NodeJS.Timeout | null = null

  private constructor() {
    this.config = {
      modelsDir: join(app.getPath('userData'), 'models'),
      maxContextSize: 4096,
      defaultGpuLayers: 'auto'
    }
  }

  /**
   * Get singleton instance
   */
  static getInstance(): AIManager {
    if (!AIManager.instance) {
      AIManager.instance = new AIManager()
    }
    return AIManager.instance
  }

  /**
   * Initialize llama.cpp with detected GPU backend
   */
  async initialize(): Promise<void> {
    if (this.initialized) return

    // Detect hardware first
    const hardware = await HardwareDetector.detect()
    this.hardwareInfo = hardware

    // Determine optimal GPU backend
    let gpuBackend: 'cuda' | 'metal' | 'vulkan' | false = false
    if (hardware.gpu.hasCuda) {
      gpuBackend = 'cuda'
    } else if (hardware.gpu.hasMetal) {
      gpuBackend = 'metal'
    } else if (hardware.gpu.hasVulkan) {
      gpuBackend = 'vulkan'
    }

    // Initialize llama.cpp
    this.llama = await getLlama({
      gpu: gpuBackend
    })

    this.initialized = true

    // Start idle model cleanup interval
    this.cleanupInterval = setInterval(
      () => this.cleanupIdleModels(),
      60000 // Check every minute
    )
  }

  /**
   * Load a model with automatic GPU layer optimization
   */
  async loadModel(modelId: string): Promise<LoadedModel> {
    if (!this.llama) {
      throw new Error('AIManager not initialized. Call initialize() first.')
    }

    // Return cached if already loaded
    const existing = this.loadedModels.get(modelId)
    if (existing) {
      existing.lastUsed = Date.now()
      return existing
    }

    // Enforce max loaded models limit
    if (this.loadedModels.size >= this.MAX_LOADED_MODELS) {
      await this.unloadLeastRecentlyUsed()
    }

    // Get model definition
    const modelDef = ModelRegistry.getModel(modelId)
    if (!modelDef) {
      throw new Error(`Unknown model: ${modelId}`)
    }

    const modelPath = join(this.config.modelsDir, modelDef.filename)

    // Calculate optimal GPU layers based on available VRAM
    const gpuLayers = this.calculateOptimalGpuLayers(modelDef)

    // Load the model
    const model = await this.llama.loadModel({
      modelPath,
      gpuLayers,
      defaultContextFlashAttention: true
    })

    const loadedModel: LoadedModel = {
      id: modelId,
      model,
      context: null,
      embeddingContext: null,
      lastUsed: Date.now(),
      memoryUsage: modelDef.sizeBytes
    }

    this.loadedModels.set(modelId, loadedModel)
    return loadedModel
  }

  /**
   * Get or create chat context for a model
   */
  async getChatContext(modelId: string, contextSize?: number): Promise<LlamaContext> {
    const loaded = await this.loadModel(modelId)

    if (!loaded.context) {
      loaded.context = await loaded.model.createContext({
        contextSize: contextSize || this.config.maxContextSize
      })
    }

    return loaded.context
  }

  /**
   * Get or create embedding context for a model
   */
  async getEmbeddingContext(modelId: string): Promise<LlamaEmbeddingContext> {
    const loaded = await this.loadModel(modelId)

    if (!loaded.embeddingContext) {
      loaded.embeddingContext = await loaded.model.createEmbeddingContext()
    }

    return loaded.embeddingContext
  }

  /**
   * Generate chat completion with streaming support
   */
  async *generateChatCompletion(
    modelId: string,
    messages: ChatMessage[],
    options?: GenerationOptions
  ): AsyncGenerator<string, ChatCompletionResult> {
    const context = await this.getChatContext(modelId)
    const chat = new LlamaChat({
      contextSequence: context.getSequence()
    })

    // Convert messages to llama.cpp format
    const chatHistory = this.convertToChatHistory(messages)

    let fullResponse = ''

    const response = await chat.generateResponse(chatHistory, {
      maxTokens: options?.maxTokens || 2048,
      temperature: options?.temperature || 0.7,
      onTextChunk: (text: string) => {
        fullResponse += text
      }
    })

    // Yield response chunks for streaming
    for (const chunk of response.response) {
      if (typeof chunk === 'string') {
        yield chunk
      }
    }

    return {
      response: fullResponse,
      tokensUsed: response.metadata?.totalTokens || 0
    }
  }

  /**
   * Unload a specific model
   */
  async unloadModel(modelId: string): Promise<void> {
    const loaded = this.loadedModels.get(modelId)
    if (!loaded) return

    // Dispose contexts first
    if (loaded.embeddingContext) {
      await loaded.embeddingContext.dispose()
    }
    if (loaded.context) {
      await loaded.context.dispose()
    }

    // Dispose model
    await loaded.model.dispose()

    this.loadedModels.delete(modelId)
  }

  /**
   * Unload the least recently used model
   */
  private async unloadLeastRecentlyUsed(): Promise<void> {
    let oldest: LoadedModel | null = null
    let oldestTime = Infinity

    for (const [, model] of this.loadedModels) {
      if (model.lastUsed < oldestTime) {
        oldestTime = model.lastUsed
        oldest = model
      }
    }

    if (oldest) {
      await this.unloadModel(oldest.id)
    }
  }

  /**
   * Cleanup idle models
   */
  private cleanupIdleModels(): void {
    const now = Date.now()
    for (const [id, model] of this.loadedModels) {
      if (now - model.lastUsed > this.IDLE_UNLOAD_TIMEOUT) {
        this.unloadModel(id).catch(console.error)
      }
    }
  }

  /**
   * Calculate optimal GPU layers based on available VRAM
   */
  private calculateOptimalGpuLayers(modelDef: ModelDefinition): number {
    if (!this.hardwareInfo?.gpu.vramBytes) {
      return 0 // CPU only
    }

    const availableVram = this.hardwareInfo.gpu.vramBytes
    const modelSize = modelDef.sizeBytes
    const totalLayers = modelDef.layers

    // Estimate: each layer uses roughly modelSize / totalLayers
    const layerSize = modelSize / totalLayers
    // Use 80% of VRAM as safety margin
    const maxLayersInVram = Math.floor((availableVram * 0.8) / layerSize)

    return Math.min(maxLayersInVram, totalLayers)
  }

  /**
   * Convert messages to llama.cpp chat history format
   */
  private convertToChatHistory(messages: ChatMessage[]): any[] {
    return messages.map((msg) => ({
      role: msg.role,
      text: msg.content
    }))
  }

  // Getters
  getHardwareInfo(): HardwareInfo | null {
    return this.hardwareInfo
  }

  isInitialized(): boolean {
    return this.initialized
  }

  getLoadedModels(): string[] {
    return Array.from(this.loadedModels.keys())
  }

  /**
   * Cleanup on app quit
   */
  async dispose(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }

    // Unload all models
    for (const [id] of this.loadedModels) {
      await this.unloadModel(id)
    }

    this.initialized = false
    this.llama = null
  }
}
```

### 6.2 HardwareDetector

Rileva l'hardware del sistema e classifica in tier per raccomandazioni modelli.

```typescript
// src/main/ai/HardwareDetector.ts

import si from 'systeminformation'

export interface GPUInfo {
  name: string
  vendor: string
  vramBytes: number | null
  hasCuda: boolean
  hasMetal: boolean
  hasVulkan: boolean
  driverVersion: string | null
}

export interface HardwareInfo {
  cpu: {
    brand: string
    cores: number
    physicalCores: number
    speed: number // GHz
  }
  memory: {
    totalBytes: number
    availableBytes: number
  }
  gpu: GPUInfo
  platform: NodeJS.Platform
  tier: 'low' | 'medium' | 'high' | 'ultra'
}

export interface ModelRecommendation {
  modelId: string
  reason: string
  estimatedPerformance: 'slow' | 'moderate' | 'fast' | 'very-fast'
  gpuLayersRecommended: number // -1 = all layers
}

export class HardwareDetector {
  private static cachedInfo: HardwareInfo | null = null

  /**
   * Detect system hardware and classify tier
   */
  static async detect(): Promise<HardwareInfo> {
    if (this.cachedInfo) {
      return this.cachedInfo
    }

    const [cpu, mem, graphics] = await Promise.all([si.cpu(), si.mem(), si.graphics()])

    const primaryGpu = graphics.controllers[0]

    const gpuInfo: GPUInfo = {
      name: primaryGpu?.name || 'Unknown',
      vendor: primaryGpu?.vendor || 'Unknown',
      vramBytes: primaryGpu?.vram ? primaryGpu.vram * 1024 * 1024 : null,
      hasCuda: this.detectCuda(primaryGpu),
      hasMetal: process.platform === 'darwin',
      hasVulkan: this.detectVulkan(primaryGpu),
      driverVersion: primaryGpu?.driverVersion || null
    }

    const tier = this.calculateTier(cpu, mem, gpuInfo)

    this.cachedInfo = {
      cpu: {
        brand: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speed: cpu.speed
      },
      memory: {
        totalBytes: mem.total,
        availableBytes: mem.available
      },
      gpu: gpuInfo,
      platform: process.platform,
      tier
    }

    return this.cachedInfo
  }

  /**
   * Get model recommendations based on hardware tier
   */
  static async getModelRecommendations(): Promise<ModelRecommendation[]> {
    const hardware = await this.detect()
    const recommendations: ModelRecommendation[] = []

    // Add recommendations from highest applicable tier down
    switch (hardware.tier) {
      case 'ultra':
        recommendations.push({
          modelId: 'llama-3.1-70b-q4',
          reason: 'Your high-end GPU can handle large 70B parameter models',
          estimatedPerformance: 'fast',
          gpuLayersRecommended: -1
        })
      // fallthrough
      case 'high':
        recommendations.push({
          modelId: 'llama-3.1-8b-q8',
          reason: 'Best quality 8B model with full precision quantization',
          estimatedPerformance: hardware.tier === 'ultra' ? 'very-fast' : 'fast',
          gpuLayersRecommended: -1
        })
      // fallthrough
      case 'medium':
        recommendations.push({
          modelId: 'llama-3.1-8b-q4',
          reason: 'Great balance of quality and speed for most systems',
          estimatedPerformance: hardware.tier === 'high' ? 'very-fast' : 'moderate',
          gpuLayersRecommended: hardware.tier === 'medium' ? 20 : -1
        })
      // fallthrough
      case 'low':
        recommendations.push({
          modelId: 'phi-3-mini-q4',
          reason: 'Lightweight model optimized for limited hardware',
          estimatedPerformance: 'moderate',
          gpuLayersRecommended: 0
        })
        break
    }

    return recommendations
  }

  /**
   * Calculate hardware tier based on specs
   */
  private static calculateTier(
    cpu: si.Systeminformation.CpuData,
    mem: si.Systeminformation.MemData,
    gpu: GPUInfo
  ): 'low' | 'medium' | 'high' | 'ultra' {
    let score = 0

    // CPU scoring (max 2 points)
    if (cpu.physicalCores >= 8) score += 2
    else if (cpu.physicalCores >= 4) score += 1

    // RAM scoring (max 2 points)
    const ramGB = mem.total / (1024 * 1024 * 1024)
    if (ramGB >= 32) score += 2
    else if (ramGB >= 16) score += 1

    // GPU/VRAM scoring (max 4 points)
    if (gpu.vramBytes) {
      const vramGB = gpu.vramBytes / (1024 * 1024 * 1024)
      if (vramGB >= 16) score += 4
      else if (vramGB >= 8) score += 3
      else if (vramGB >= 4) score += 2
    }

    // Bonus for Apple Silicon (unified memory advantage)
    if (gpu.hasMetal && gpu.name.includes('Apple')) {
      score += 2
    }

    // Classify tier
    if (score >= 8) return 'ultra'
    if (score >= 5) return 'high'
    if (score >= 3) return 'medium'
    return 'low'
  }

  /**
   * Detect CUDA support (NVIDIA GPU)
   */
  private static detectCuda(gpu: si.Systeminformation.GraphicsControllerData | undefined): boolean {
    if (!gpu) return false
    return gpu.vendor?.toLowerCase().includes('nvidia') || false
  }

  /**
   * Detect Vulkan support (AMD/Intel GPU)
   */
  private static detectVulkan(
    gpu: si.Systeminformation.GraphicsControllerData | undefined
  ): boolean {
    if (!gpu) return false
    // Most modern GPUs support Vulkan
    return (
      gpu.vendor?.toLowerCase().includes('amd') ||
      gpu.vendor?.toLowerCase().includes('intel') ||
      false
    )
  }

  /**
   * Clear cached info (useful for testing)
   */
  static clearCache(): void {
    this.cachedInfo = null
  }
}
```

### 6.3 ModelDownloader

Gestisce il download dei modelli con progress reporting e resume support.

```typescript
// src/main/ai/ModelDownloader.ts

import { app } from 'electron'
import { createWriteStream, promises as fs } from 'fs'
import { join } from 'path'
import { EventEmitter } from 'events'
import { ModelRegistry } from './ModelRegistry'

export interface DownloadProgress {
  modelId: string
  filename: string
  bytesDownloaded: number
  totalBytes: number
  percentage: number
  speed: number // bytes per second
  eta: number // seconds remaining
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error'
  error?: string
}

interface DownloadTask {
  modelId: string
  url: string
  filename: string
  abortController: AbortController
  resumePosition: number
}

export class ModelDownloader extends EventEmitter {
  private downloads: Map<string, DownloadTask> = new Map()
  private modelsDir: string
  private tempDir: string

  constructor() {
    super()
    this.modelsDir = join(app.getPath('userData'), 'models')
    this.tempDir = join(app.getPath('userData'), 'models', '.temp')
  }

  /**
   * Initialize directories
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.modelsDir, { recursive: true })
    await fs.mkdir(this.tempDir, { recursive: true })
    await this.cleanupOldTempFiles()
  }

  /**
   * Start downloading a model
   */
  async downloadModel(modelId: string, url: string, filename: string): Promise<void> {
    if (this.downloads.has(modelId)) {
      throw new Error(`Download already in progress for ${modelId}`)
    }

    const task: DownloadTask = {
      modelId,
      url,
      filename,
      abortController: new AbortController(),
      resumePosition: 0
    }

    this.downloads.set(modelId, task)

    try {
      await this.executeDownload(task)
    } finally {
      this.downloads.delete(modelId)
    }
  }

  /**
   * Execute the actual download with resume support
   */
  private async executeDownload(task: DownloadTask): Promise<void> {
    const tempPath = join(this.tempDir, `${task.modelId}.part`)
    const finalPath = join(this.modelsDir, task.filename)

    // Check for partial download to resume
    try {
      const stats = await fs.stat(tempPath)
      task.resumePosition = stats.size
    } catch {
      task.resumePosition = 0
    }

    // Setup request headers for resume
    const headers: Record<string, string> = {}
    if (task.resumePosition > 0) {
      headers['Range'] = `bytes=${task.resumePosition}-`
    }

    const response = await fetch(task.url, {
      headers,
      signal: task.abortController.signal
    })

    if (!response.ok && response.status !== 206) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`)
    }

    const contentLength = parseInt(response.headers.get('content-length') || '0')
    const totalBytes = task.resumePosition + contentLength

    // Create write stream (append mode if resuming)
    const writer = createWriteStream(tempPath, {
      flags: task.resumePosition > 0 ? 'a' : 'w'
    })

    let bytesDownloaded = task.resumePosition
    let lastTime = Date.now()
    let lastBytes = bytesDownloaded

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response body')

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        writer.write(value)
        bytesDownloaded += value.length

        // Calculate and emit progress every 500ms
        const now = Date.now()
        if (now - lastTime >= 500) {
          const speed = ((bytesDownloaded - lastBytes) / (now - lastTime)) * 1000
          const remaining = totalBytes - bytesDownloaded
          const eta = speed > 0 ? remaining / speed : 0

          this.emit('progress', {
            modelId: task.modelId,
            filename: task.filename,
            bytesDownloaded,
            totalBytes,
            percentage: (bytesDownloaded / totalBytes) * 100,
            speed,
            eta,
            status: 'downloading'
          } as DownloadProgress)

          lastTime = now
          lastBytes = bytesDownloaded
        }
      }

      writer.end()

      // Move from temp to final location
      await fs.rename(tempPath, finalPath)

      // Emit completion
      this.emit('progress', {
        modelId: task.modelId,
        filename: task.filename,
        bytesDownloaded: totalBytes,
        totalBytes,
        percentage: 100,
        speed: 0,
        eta: 0,
        status: 'completed'
      } as DownloadProgress)
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        // Download was paused
        this.emit('progress', {
          modelId: task.modelId,
          filename: task.filename,
          bytesDownloaded,
          totalBytes,
          percentage: (bytesDownloaded / totalBytes) * 100,
          speed: 0,
          eta: 0,
          status: 'paused'
        } as DownloadProgress)
      } else {
        // Real error
        this.emit('progress', {
          modelId: task.modelId,
          filename: task.filename,
          bytesDownloaded,
          totalBytes,
          percentage: (bytesDownloaded / totalBytes) * 100,
          speed: 0,
          eta: 0,
          status: 'error',
          error: (error as Error).message
        } as DownloadProgress)
        throw error
      }
    }
  }

  /**
   * Pause a download
   */
  pauseDownload(modelId: string): void {
    const task = this.downloads.get(modelId)
    if (task) {
      task.abortController.abort()
    }
  }

  /**
   * Resume a paused download
   */
  async resumeDownload(modelId: string): Promise<void> {
    const model = ModelRegistry.getModel(modelId)
    if (!model) throw new Error(`Unknown model: ${modelId}`)

    await this.downloadModel(modelId, model.downloadUrl, model.filename)
  }

  /**
   * Cancel a download and remove temp file
   */
  async cancelDownload(modelId: string): Promise<void> {
    const task = this.downloads.get(modelId)
    if (task) {
      task.abortController.abort()
      this.downloads.delete(modelId)
    }

    // Remove temp file
    const tempPath = join(this.tempDir, `${modelId}.part`)
    try {
      await fs.unlink(tempPath)
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Check if a model is downloaded
   */
  async isModelDownloaded(modelId: string): Promise<boolean> {
    const model = ModelRegistry.getModel(modelId)
    if (!model) return false

    const modelPath = join(this.modelsDir, model.filename)
    try {
      await fs.access(modelPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Get list of downloaded models
   */
  async getDownloadedModels(): Promise<string[]> {
    const files = await fs.readdir(this.modelsDir)
    return files
      .filter((f) => f.endsWith('.gguf'))
      .map((f) => ModelRegistry.getModelByFilename(f)?.id)
      .filter((id): id is string => id !== undefined)
  }

  /**
   * Delete a downloaded model
   */
  async deleteModel(modelId: string): Promise<void> {
    const model = ModelRegistry.getModel(modelId)
    if (!model) return

    const modelPath = join(this.modelsDir, model.filename)
    try {
      await fs.unlink(modelPath)
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Cleanup old temp files (older than 7 days)
   */
  private async cleanupOldTempFiles(): Promise<void> {
    try {
      const files = await fs.readdir(this.tempDir)
      const maxAge = 7 * 24 * 60 * 60 * 1000 // 7 days

      for (const file of files) {
        if (file.endsWith('.part')) {
          const filePath = join(this.tempDir, file)
          const stats = await fs.stat(filePath)
          const age = Date.now() - stats.mtimeMs

          if (age > maxAge) {
            await fs.unlink(filePath)
          }
        }
      }
    } catch {
      // Ignore errors during cleanup
    }
  }
}
```

### 6.4 ModelRegistry

Definisce la lista curata di modelli testati per ogni tier hardware.

```typescript
// src/main/ai/ModelRegistry.ts

export interface ModelDefinition {
  id: string
  name: string
  description: string
  filename: string
  downloadUrl: string
  sizeBytes: number
  layers: number
  contextLength: number
  quantization: string
  capabilities: ('chat' | 'embedding' | 'code' | 'reasoning')[]
  hardwareTier: 'low' | 'medium' | 'high' | 'ultra'
  license: string
}

// Curated list of tested models
const CURATED_MODELS: ModelDefinition[] = [
  // ============================================================================
  // LOW TIER - CPU-friendly models (< 4GB)
  // ============================================================================
  {
    id: 'phi-3-mini-q4',
    name: 'Phi-3 Mini (Q4)',
    description: "Microsoft's efficient 3.8B model, great for basic tasks",
    filename: 'Phi-3-mini-4k-instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf/resolve/main/Phi-3-mini-4k-instruct-Q4_K_M.gguf',
    sizeBytes: 2.3 * 1024 * 1024 * 1024,
    layers: 32,
    contextLength: 4096,
    quantization: 'Q4_K_M',
    capabilities: ['chat', 'code'],
    hardwareTier: 'low',
    license: 'MIT'
  },
  {
    id: 'qwen2-1.5b-q8',
    name: 'Qwen2 1.5B (Q8)',
    description: "Alibaba's compact model with good multilingual support",
    filename: 'qwen2-1_5b-instruct-q8_0.gguf',
    downloadUrl:
      'https://huggingface.co/Qwen/Qwen2-1.5B-Instruct-GGUF/resolve/main/qwen2-1_5b-instruct-q8_0.gguf',
    sizeBytes: 1.6 * 1024 * 1024 * 1024,
    layers: 28,
    contextLength: 32768,
    quantization: 'Q8_0',
    capabilities: ['chat', 'code'],
    hardwareTier: 'low',
    license: 'Apache-2.0'
  },

  // ============================================================================
  // MEDIUM TIER - Good balance models (4-8GB)
  // ============================================================================
  {
    id: 'llama-3.1-8b-q4',
    name: 'Llama 3.1 8B (Q4)',
    description: "Meta's flagship 8B model with excellent general capabilities",
    filename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    sizeBytes: 4.9 * 1024 * 1024 * 1024,
    layers: 32,
    contextLength: 131072,
    quantization: 'Q4_K_M',
    capabilities: ['chat', 'code', 'reasoning'],
    hardwareTier: 'medium',
    license: 'Llama 3.1 Community'
  },
  {
    id: 'mistral-7b-q4',
    name: 'Mistral 7B (Q4)',
    description: 'Fast and efficient 7B model with strong performance',
    filename: 'mistral-7b-instruct-v0.3-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Mistral-7B-Instruct-v0.3-GGUF/resolve/main/Mistral-7B-Instruct-v0.3-Q4_K_M.gguf',
    sizeBytes: 4.4 * 1024 * 1024 * 1024,
    layers: 32,
    contextLength: 32768,
    quantization: 'Q4_K_M',
    capabilities: ['chat', 'code'],
    hardwareTier: 'medium',
    license: 'Apache-2.0'
  },

  // ============================================================================
  // HIGH TIER - Quality-focused models (8-16GB)
  // ============================================================================
  {
    id: 'llama-3.1-8b-q8',
    name: 'Llama 3.1 8B (Q8)',
    description: 'Higher quality quantization of Llama 3.1 8B',
    filename: 'Meta-Llama-3.1-8B-Instruct-Q8_0.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-8B-Instruct-Q8_0.gguf',
    sizeBytes: 8.5 * 1024 * 1024 * 1024,
    layers: 32,
    contextLength: 131072,
    quantization: 'Q8_0',
    capabilities: ['chat', 'code', 'reasoning'],
    hardwareTier: 'high',
    license: 'Llama 3.1 Community'
  },
  {
    id: 'deepseek-coder-6.7b-q8',
    name: 'DeepSeek Coder 6.7B (Q8)',
    description: 'Specialized coding model with strong performance',
    filename: 'deepseek-coder-6.7b-instruct-Q8_0.gguf',
    downloadUrl:
      'https://huggingface.co/TheBloke/deepseek-coder-6.7B-instruct-GGUF/resolve/main/deepseek-coder-6.7b-instruct.Q8_0.gguf',
    sizeBytes: 7.2 * 1024 * 1024 * 1024,
    layers: 32,
    contextLength: 16384,
    quantization: 'Q8_0',
    capabilities: ['chat', 'code'],
    hardwareTier: 'high',
    license: 'DeepSeek License'
  },

  // ============================================================================
  // ULTRA TIER - Large models (>16GB)
  // ============================================================================
  {
    id: 'llama-3.1-70b-q4',
    name: 'Llama 3.1 70B (Q4)',
    description: "Meta's most capable open model",
    filename: 'Meta-Llama-3.1-70B-Instruct-Q4_K_M.gguf',
    downloadUrl:
      'https://huggingface.co/bartowski/Meta-Llama-3.1-70B-Instruct-GGUF/resolve/main/Meta-Llama-3.1-70B-Instruct-Q4_K_M.gguf',
    sizeBytes: 42.5 * 1024 * 1024 * 1024,
    layers: 80,
    contextLength: 131072,
    quantization: 'Q4_K_M',
    capabilities: ['chat', 'code', 'reasoning'],
    hardwareTier: 'ultra',
    license: 'Llama 3.1 Community'
  },

  // ============================================================================
  // EMBEDDING MODELS (all tiers)
  // ============================================================================
  {
    id: 'nomic-embed-text-v1.5',
    name: 'Nomic Embed Text v1.5',
    description: 'High-quality text embeddings for RAG',
    filename: 'nomic-embed-text-v1.5.Q8_0.gguf',
    downloadUrl:
      'https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF/resolve/main/nomic-embed-text-v1.5.Q8_0.gguf',
    sizeBytes: 137 * 1024 * 1024,
    layers: 12,
    contextLength: 8192,
    quantization: 'Q8_0',
    capabilities: ['embedding'],
    hardwareTier: 'low', // Works on any tier
    license: 'Apache-2.0'
  },
  {
    id: 'bge-small-en-v1.5',
    name: 'BGE Small EN v1.5',
    description: 'Lightweight English embedding model',
    filename: 'bge-small-en-v1.5-q8_0.gguf',
    downloadUrl:
      'https://huggingface.co/ChristianAzinn/bge-small-en-v1.5-gguf/resolve/main/bge-small-en-v1.5-q8_0.gguf',
    sizeBytes: 66 * 1024 * 1024,
    layers: 12,
    contextLength: 512,
    quantization: 'Q8_0',
    capabilities: ['embedding'],
    hardwareTier: 'low',
    license: 'MIT'
  }
]

export class ModelRegistry {
  private static models: Map<string, ModelDefinition> = new Map(
    CURATED_MODELS.map((m) => [m.id, m])
  )

  /**
   * Get a model by ID
   */
  static getModel(id: string): ModelDefinition | undefined {
    return this.models.get(id)
  }

  /**
   * Get a model by filename
   */
  static getModelByFilename(filename: string): ModelDefinition | undefined {
    for (const model of this.models.values()) {
      if (model.filename === filename) return model
    }
    return undefined
  }

  /**
   * Get all available models
   */
  static getAllModels(): ModelDefinition[] {
    return Array.from(this.models.values())
  }

  /**
   * Get models suitable for a hardware tier
   */
  static getModelsForTier(tier: 'low' | 'medium' | 'high' | 'ultra'): ModelDefinition[] {
    const tierOrder = ['low', 'medium', 'high', 'ultra']
    const tierIndex = tierOrder.indexOf(tier)

    return Array.from(this.models.values()).filter((m) => {
      const modelTierIndex = tierOrder.indexOf(m.hardwareTier)
      return modelTierIndex <= tierIndex
    })
  }

  /**
   * Get chat-capable models
   */
  static getChatModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter((m) => m.capabilities.includes('chat'))
  }

  /**
   * Get embedding models
   */
  static getEmbeddingModels(): ModelDefinition[] {
    return Array.from(this.models.values()).filter((m) => m.capabilities.includes('embedding'))
  }

  /**
   * Format model size for display
   */
  static formatSize(bytes: number): string {
    const gb = bytes / (1024 * 1024 * 1024)
    if (gb >= 1) {
      return `${gb.toFixed(1)} GB`
    }
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(0)} MB`
  }
}
```

### 6.5 VectorDBManager

Gestisce il vector database per-space per RAG.

#### Setup sqlite-vec

Il package `sqlite-vec` npm include binari precompilati per tutte le piattaforme supportate. Non è necessario compilare o scaricare estensioni native manualmente.

**Installazione:**

```bash
pnpm add sqlite-vec
```

**Configurazione electron-vite** (`electron.vite.config.ts`):

```typescript
externalizeDepsPlugin({
  exclude: ['electron-store'],
  include: ['node-llama-cpp', 'better-sqlite3', 'sqlite-vec']
}),
build: {
  rollupOptions: {
    external: ['node-llama-cpp', 'better-sqlite3', 'sqlite-vec']
  }
}
```

**Configurazione electron-builder** (`electron-builder.yml`):

```yaml
asarUnpack:
  - resources/**
  - node_modules/sqlite-vec/**
  - node_modules/better-sqlite3/**
```

#### Implementazione

```typescript
// src/main/ai/VectorDBManager.ts

import Database from 'better-sqlite3'
import * as sqliteVec from 'sqlite-vec'
import { mkdirSync } from 'fs'
import { dirname } from 'path'

export interface VectorDBConfig {
  dbPath: string
  embeddingDimension: number
}

export class VectorDBManager {
  private static instances: Map<string, VectorDBManager> = new Map()
  private db: Database.Database | null = null
  private _config: VectorDBConfig
  private initialized: boolean = false

  private constructor(config: VectorDBConfig) {
    this._config = config
  }

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

  async initialize(): Promise<void> {
    if (this.initialized) return

    // Ensure directory exists
    mkdirSync(dirname(this._config.dbPath), { recursive: true })

    // Create database connection
    this.db = new Database(this._config.dbPath)

    // Load sqlite-vec extension (npm package handles platform detection)
    sqliteVec.load(this.db)

    // Verify extension loaded
    const { version } = this.db.prepare('SELECT vec_version() as version').get() as {
      version: string
    }
    console.log(`sqlite-vec version: ${version}`)

    // Create tables
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS embeddings (
        id TEXT PRIMARY KEY,
        note_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        UNIQUE(note_id, chunk_index)
      );

      CREATE INDEX IF NOT EXISTS idx_embeddings_note_id ON embeddings(note_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS vec_embeddings USING vec0(
        id TEXT PRIMARY KEY,
        embedding float[${this._config.embeddingDimension}]
      );
    `)

    this.initialized = true
  }

  async storeEmbedding(embedding: EmbeddingResult): Promise<void> {
    const id = `${embedding.noteId}_${embedding.chunkIndex}`
    const vecArray = new Float32Array(embedding.embedding)

    this.db!.prepare(
      `
      INSERT OR REPLACE INTO embeddings (id, note_id, chunk_index, content, metadata)
      VALUES (?, ?, ?, ?, ?)
    `
    ).run(id, embedding.noteId, embedding.chunkIndex, embedding.text, '{}')

    this.db!.prepare(
      `
      INSERT OR REPLACE INTO vec_embeddings (id, embedding)
      VALUES (?, ?)
    `
    ).run(id, vecArray)
  }

  async search(queryEmbedding: number[], limit: number = 10): Promise<SearchResult[]> {
    const queryVec = new Float32Array(queryEmbedding)

    return this.db!.prepare(
      `
      SELECT v.id, v.distance, e.note_id, e.content, e.metadata
      FROM vec_embeddings v
      JOIN embeddings e ON v.id = e.id
      WHERE v.embedding MATCH ? AND k = ?
      ORDER BY v.distance
    `
    ).all(queryVec, limit) as SearchResult[]
  }

  async deleteNoteEmbeddings(noteId: string): Promise<void> {
    const ids = this.db!.prepare('SELECT id FROM embeddings WHERE note_id = ?').all(noteId) as {
      id: string
    }[]

    const deleteVec = this.db!.prepare('DELETE FROM vec_embeddings WHERE id = ?')
    for (const { id } of ids) {
      deleteVec.run(id)
    }

    this.db!.prepare('DELETE FROM embeddings WHERE note_id = ?').run(noteId)
  }
}
```

#### Build per Piattaforma

**macOS (arm64/x64):**

```bash
pnpm build:mac
```

**Windows (x64):**

```bash
pnpm build:win
```

**Linux (x64):**

```bash
pnpm build:linux
```

Il package `sqlite-vec` include automaticamente i binari corretti per ogni piattaforma durante il processo di build.

---

_Note: La vecchia documentazione suggeriva di scaricare manualmente i binari nativi, ma il package npm `sqlite-vec` gestisce tutto automaticamente._

### 6.5.1 VectorDBManager Legacy Reference

Per reference, ecco l'approccio legacy con caricamento manuale dell'estensione:

```typescript
// DEPRECATO - Non usare, mantenuto solo per reference
/**
   * Search for similar documents
   */
  async search(
    queryEmbedding: number[],
    limit: number = 10,
    noteIds?: string[]
  ): Promise<SearchResult[]> {
    if (!this.db) throw new Error('Database not initialized')

    let query = `
      SELECT
        v.id,
        d.note_id,
        d.content,
        v.distance,
        d.metadata
      FROM vec_documents v
      JOIN documents d ON v.id = d.id
      WHERE v.embedding MATCH ?
    `

    const params: unknown[] = [JSON.stringify(queryEmbedding)]

    // Optional filter by note IDs
    if (noteIds && noteIds.length > 0) {
      const placeholders = noteIds.map(() => '?').join(',')
      query += ` AND d.note_id IN (${placeholders})`
      params.push(...noteIds)
    }

    query += `
      ORDER BY v.distance
      LIMIT ?
    `
    params.push(limit)

    const results = this.db.prepare(query).all(...params) as Array<{
      id: string
      note_id: string
      content: string
      distance: number
      metadata: string
    }>

    return results.map((r) => ({
      id: r.id,
      noteId: r.note_id,
      content: r.content,
      distance: r.distance,
      metadata: JSON.parse(r.metadata)
    }))
  }

  /**
   * Get count of indexed documents
   */
  async getDocumentCount(): Promise<number> {
    if (!this.db) throw new Error('Database not initialized')
    const result = this.db.prepare('SELECT COUNT(*) as count FROM documents').get() as {
      count: number
    }
    return result.count
  }

  /**
   * Get list of indexed note IDs
   */
  async getIndexedNoteIds(): Promise<string[]> {
    if (!this.db) throw new Error('Database not initialized')
    const results = this.db.prepare('SELECT DISTINCT note_id FROM documents').all() as {
      note_id: string
    }[]
    return results.map((r) => r.note_id)
  }

  /**
   * Close database connection
   */
  close(): void {
    if (this.db) {
      this.db.close()
      this.db = null
    }
  }
}
```

### 6.6 ConversationManager

Gestisce la persistenza delle conversazioni globali.

```typescript
// src/main/ai/ConversationManager.ts

import { app } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'
import { v4 as uuidv4 } from 'uuid'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  noteReferences?: NoteReference[]
  metadata?: Record<string, unknown>
}

export interface NoteReference {
  noteId: string
  spaceId: string
  title: string
  excerpt: string
  relevanceScore?: number
}

export interface Conversation {
  id: string
  title: string
  modelId: string
  systemPrompt?: string
  messages: ChatMessage[]
  noteContext: NoteReference[]
  createdAt: string
  updatedAt: string
  metadata: {
    totalTokens: number
    lastModelResponse?: string
  }
}

export interface ConversationSummary {
  id: string
  title: string
  modelId: string
  messageCount: number
  noteCount: number
  createdAt: string
  updatedAt: string
}

export class ConversationManager {
  private conversationsDir: string
  private conversations: Map<string, Conversation> = new Map()

  constructor() {
    this.conversationsDir = join(app.getPath('userData'), 'conversations')
  }

  /**
   * Initialize and load all conversations
   */
  async initialize(): Promise<void> {
    await fs.mkdir(this.conversationsDir, { recursive: true })
    await this.loadAllConversations()
  }

  /**
   * Load all conversations from disk
   */
  private async loadAllConversations(): Promise<void> {
    try {
      const files = await fs.readdir(this.conversationsDir)
      for (const file of files) {
        if (file.endsWith('.json')) {
          const content = await fs.readFile(join(this.conversationsDir, file), 'utf-8')
          const conversation = JSON.parse(content) as Conversation
          this.conversations.set(conversation.id, conversation)
        }
      }
    } catch (error) {
      console.error('Failed to load conversations:', error)
    }
  }

  /**
   * Create a new conversation
   */
  async createConversation(
    title: string,
    modelId: string,
    systemPrompt?: string
  ): Promise<Conversation> {
    const conversation: Conversation = {
      id: uuidv4(),
      title,
      modelId,
      systemPrompt,
      messages: [],
      noteContext: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      metadata: {
        totalTokens: 0
      }
    }

    // Add system prompt as first message if provided
    if (systemPrompt) {
      conversation.messages.push({
        id: uuidv4(),
        role: 'system',
        content: systemPrompt,
        timestamp: new Date().toISOString()
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
    role: 'user' | 'assistant',
    content: string,
    noteReferences?: NoteReference[]
  ): Promise<ChatMessage> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`)
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

    // Track note references at conversation level
    if (noteReferences) {
      for (const ref of noteReferences) {
        if (!conversation.noteContext.find((n) => n.noteId === ref.noteId)) {
          conversation.noteContext.push(ref)
        }
      }
    }

    await this.saveConversation(conversation)
    return message
  }

  /**
   * Add a note to conversation context
   */
  async addNoteToContext(conversationId: string, noteRef: NoteReference): Promise<void> {
    const conversation = this.conversations.get(conversationId)
    if (!conversation) {
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    // Avoid duplicates
    if (!conversation.noteContext.find((n) => n.noteId === noteRef.noteId)) {
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
      throw new Error(`Conversation not found: ${conversationId}`)
    }

    conversation.noteContext = conversation.noteContext.filter((n) => n.noteId !== noteId)
    conversation.updatedAt = new Date().toISOString()
    await this.saveConversation(conversation)
  }

  /**
   * Get a conversation by ID
   */
  getConversation(id: string): Conversation | undefined {
    return this.conversations.get(id)
  }

  /**
   * List all conversations (summary only)
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
      throw new Error(`Conversation not found: ${id}`)
    }

    conversation.title = title
    conversation.updatedAt = new Date().toISOString()
    await this.saveConversation(conversation)
  }

  /**
   * Delete a conversation
   */
  async deleteConversation(id: string): Promise<void> {
    this.conversations.delete(id)

    const filePath = join(this.conversationsDir, `${id}.json`)
    try {
      await fs.unlink(filePath)
    } catch {
      // Ignore if file doesn't exist
    }
  }

  /**
   * Save conversation to disk
   */
  private async saveConversation(conversation: Conversation): Promise<void> {
    const filePath = join(this.conversationsDir, `${conversation.id}.json`)
    await fs.writeFile(filePath, JSON.stringify(conversation, null, 2), 'utf-8')
  }

  /**
   * Build context prompt from referenced notes
   */
  buildContextPrompt(conversation: Conversation): string {
    if (conversation.noteContext.length === 0) {
      return ''
    }

    let contextPrompt = '\n\n## Referenced Notes Context:\n\n'

    for (const note of conversation.noteContext) {
      contextPrompt += `### ${note.title}\n`
      contextPrompt += `${note.excerpt}\n\n`
    }

    contextPrompt += '---\n\n'
    contextPrompt +=
      "Use the above notes as context when relevant to answer the user's questions.\n"

    return contextPrompt
  }
}
```

### 6.7 EmbeddingService

Gestisce la generazione di embeddings e l'indexing delle note.

```typescript
// src/main/ai/EmbeddingService.ts

import { AIManager } from './AIManager'
import { VectorDBManager } from './VectorDBManager'
import { v4 as uuidv4 } from 'uuid'
import type { SerializedEditorState } from 'lexical'

export interface ChunkingOptions {
  maxChunkSize: number
  overlapSize: number
  splitOnParagraph: boolean
}

export interface Note {
  id: string
  folderId: string
  content: SerializedEditorState
  title: string
  createdAt: string
  updatedAt: string
}

export class EmbeddingService {
  private aiManager: AIManager
  private embeddingModelId: string = 'nomic-embed-text-v1.5'

  constructor(aiManager: AIManager) {
    this.aiManager = aiManager
  }

  /**
   * Set the embedding model to use
   */
  setEmbeddingModel(modelId: string): void {
    this.embeddingModelId = modelId
  }

  /**
   * Generate embedding for a single text
   */
  async embedText(text: string): Promise<number[]> {
    const context = await this.aiManager.getEmbeddingContext(this.embeddingModelId)
    const embedding = await context.getEmbeddingFor(text)
    return embedding.vector
  }

  /**
   * Generate embeddings for multiple texts
   */
  async embedTexts(texts: string[]): Promise<number[][]> {
    const context = await this.aiManager.getEmbeddingContext(this.embeddingModelId)
    const embeddings: number[][] = []

    for (const text of texts) {
      const embedding = await context.getEmbeddingFor(text)
      embeddings.push(embedding.vector)
    }

    return embeddings
  }

  /**
   * Index a note into the vector database
   */
  async indexNote(
    note: Note,
    vectorDB: VectorDBManager,
    options: ChunkingOptions = {
      maxChunkSize: 512,
      overlapSize: 50,
      splitOnParagraph: true
    }
  ): Promise<void> {
    // Delete existing chunks for this note
    await vectorDB.deleteDocumentsForNote(note.id)

    // Extract text from Lexical editor state
    const textContent = this.extractTextFromLexical(note.content)

    if (!textContent.trim()) {
      return // Empty note, nothing to index
    }

    // Chunk the content
    const chunks = this.chunkText(textContent, options)

    // Generate embeddings and store
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]
      const embedding = await this.embedText(chunk)

      await vectorDB.upsertDocument({
        id: uuidv4(),
        noteId: note.id,
        chunkIndex: i,
        content: chunk,
        embedding,
        metadata: {
          noteTitle: note.title,
          folderId: note.folderId,
          totalChunks: chunks.length
        },
        createdAt: new Date().toISOString()
      })
    }
  }

  /**
   * Extract plain text from Lexical serialized state
   */
  private extractTextFromLexical(content: SerializedEditorState): string {
    const extract = (node: unknown): string => {
      if (!node || typeof node !== 'object') return ''

      const n = node as Record<string, unknown>

      // Text node
      if (n.text && typeof n.text === 'string') {
        return n.text
      }

      // Recursive extraction from children
      if (Array.isArray(n.children)) {
        return n.children.map(extract).join('\n')
      }

      return ''
    }

    const root = (content as Record<string, unknown>).root
    return extract(root).trim()
  }

  /**
   * Chunk text with optional paragraph splitting
   */
  private chunkText(text: string, options: ChunkingOptions): string[] {
    const chunks: string[] = []

    if (options.splitOnParagraph) {
      // Split by paragraphs first
      const paragraphs = text.split(/\n\n+/)
      let currentChunk = ''

      for (const para of paragraphs) {
        if (currentChunk.length + para.length <= options.maxChunkSize) {
          currentChunk += (currentChunk ? '\n\n' : '') + para
        } else {
          if (currentChunk) {
            chunks.push(currentChunk)
          }

          // If single paragraph is too long, split it
          if (para.length > options.maxChunkSize) {
            const subChunks = this.splitLongText(para, options)
            chunks.push(...subChunks)
            currentChunk = ''
          } else {
            currentChunk = para
          }
        }
      }

      if (currentChunk) {
        chunks.push(currentChunk)
      }
    } else {
      chunks.push(...this.splitLongText(text, options))
    }

    return chunks
  }

  /**
   * Split long text with overlap
   */
  private splitLongText(text: string, options: ChunkingOptions): string[] {
    const chunks: string[] = []
    let start = 0

    while (start < text.length) {
      const end = Math.min(start + options.maxChunkSize, text.length)
      chunks.push(text.slice(start, end))
      start = end - options.overlapSize
    }

    return chunks
  }
}
```

---

## 7. IPC Handlers

```typescript
// src/main/ipc/aiHandlers.ts

import { ipcMain, IpcMainInvokeEvent, BrowserWindow } from 'electron'
import { AIManager } from '../ai/AIManager'
import { HardwareDetector } from '../ai/HardwareDetector'
import { ModelDownloader, DownloadProgress } from '../ai/ModelDownloader'
import { ModelRegistry } from '../ai/ModelRegistry'
import { ConversationManager } from '../ai/ConversationManager'
import { VectorDBManager } from '../ai/VectorDBManager'
import { EmbeddingService } from '../ai/EmbeddingService'
import type { FileSystemManager } from '../utils/fileSystem'

type GetFsManager = (spaceId: string) => FileSystemManager

// VectorDBManager instances per space
const vectorDBManagers = new Map<string, VectorDBManager>()

function getOrCreateVectorDB(spaceId: string): VectorDBManager {
  if (!vectorDBManagers.has(spaceId)) {
    const manager = new VectorDBManager(spaceId)
    vectorDBManagers.set(spaceId, manager)
  }
  return vectorDBManagers.get(spaceId)!
}

export function registerAIHandlers(getOrCreateFsManager: GetFsManager): void {
  const aiManager = AIManager.getInstance()
  const downloader = new ModelDownloader()
  const conversationManager = new ConversationManager()
  const embeddingService = new EmbeddingService(aiManager)

  // Forward download progress to renderer
  downloader.on('progress', (progress: DownloadProgress) => {
    const windows = BrowserWindow.getAllWindows()
    for (const win of windows) {
      win.webContents.send('ai:download-progress', progress)
    }
  })

  // ============================================================================
  // INITIALIZATION
  // ============================================================================

  ipcMain.handle('ai:initialize', async () => {
    await aiManager.initialize()
    await downloader.initialize()
    await conversationManager.initialize()
    return { success: true }
  })

  ipcMain.handle('ai:isInitialized', () => {
    return aiManager.isInitialized()
  })

  // ============================================================================
  // HARDWARE DETECTION
  // ============================================================================

  ipcMain.handle('ai:getHardwareInfo', async () => {
    return await HardwareDetector.detect()
  })

  ipcMain.handle('ai:getModelRecommendations', async () => {
    return await HardwareDetector.getModelRecommendations()
  })

  // ============================================================================
  // MODEL MANAGEMENT
  // ============================================================================

  ipcMain.handle('ai:listAvailableModels', () => {
    return ModelRegistry.getAllModels()
  })

  ipcMain.handle('ai:listDownloadedModels', async () => {
    return await downloader.getDownloadedModels()
  })

  ipcMain.handle('ai:isModelDownloaded', async (_, modelId: string) => {
    return await downloader.isModelDownloaded(modelId)
  })

  ipcMain.handle('ai:downloadModel', async (_, modelId: string) => {
    const model = ModelRegistry.getModel(modelId)
    if (!model) throw new Error(`Unknown model: ${modelId}`)

    await downloader.downloadModel(modelId, model.downloadUrl, model.filename)
    return { success: true }
  })

  ipcMain.handle('ai:pauseDownload', (_, modelId: string) => {
    downloader.pauseDownload(modelId)
    return { success: true }
  })

  ipcMain.handle('ai:resumeDownload', async (_, modelId: string) => {
    await downloader.resumeDownload(modelId)
    return { success: true }
  })

  ipcMain.handle('ai:cancelDownload', async (_, modelId: string) => {
    await downloader.cancelDownload(modelId)
    return { success: true }
  })

  ipcMain.handle('ai:loadModel', async (_, modelId: string) => {
    await aiManager.loadModel(modelId)
    return { success: true }
  })

  ipcMain.handle('ai:unloadModel', async (_, modelId: string) => {
    await aiManager.unloadModel(modelId)
    return { success: true }
  })

  ipcMain.handle('ai:getLoadedModels', () => {
    return aiManager.getLoadedModels()
  })

  ipcMain.handle('ai:deleteModel', async (_, modelId: string) => {
    await downloader.deleteModel(modelId)
    return { success: true }
  })

  // ============================================================================
  // CHAT / INFERENCE
  // ============================================================================

  ipcMain.handle(
    'ai:generateResponse',
    async (
      event: IpcMainInvokeEvent,
      modelId: string,
      messages: Array<{ role: string; content: string }>,
      options?: { maxTokens?: number; temperature?: number }
    ) => {
      const window = BrowserWindow.fromWebContents(event.sender)

      let fullResponse = ''
      const generator = aiManager.generateChatCompletion(modelId, messages as any, options)

      for await (const chunk of generator) {
        fullResponse += chunk
        // Send streaming chunks to renderer
        window?.webContents.send('ai:response-chunk', {
          chunk,
          fullResponse
        })
      }

      return { response: fullResponse }
    }
  )

  // ============================================================================
  // CONVERSATIONS
  // ============================================================================

  ipcMain.handle(
    'ai:createConversation',
    async (_, title: string, modelId: string, systemPrompt?: string) => {
      return await conversationManager.createConversation(title, modelId, systemPrompt)
    }
  )

  ipcMain.handle('ai:getConversation', (_, conversationId: string) => {
    return conversationManager.getConversation(conversationId)
  })

  ipcMain.handle('ai:listConversations', () => {
    return conversationManager.listConversations()
  })

  ipcMain.handle(
    'ai:addMessage',
    async (
      _,
      conversationId: string,
      role: 'user' | 'assistant',
      content: string,
      noteRefs?: any[]
    ) => {
      return await conversationManager.addMessage(conversationId, role, content, noteRefs)
    }
  )

  ipcMain.handle('ai:updateConversationTitle', async (_, conversationId: string, title: string) => {
    await conversationManager.updateConversationTitle(conversationId, title)
    return { success: true }
  })

  ipcMain.handle('ai:addNoteToConversation', async (_, conversationId: string, noteRef: any) => {
    await conversationManager.addNoteToContext(conversationId, noteRef)
    return { success: true }
  })

  ipcMain.handle(
    'ai:removeNoteFromConversation',
    async (_, conversationId: string, noteId: string) => {
      await conversationManager.removeNoteFromContext(conversationId, noteId)
      return { success: true }
    }
  )

  ipcMain.handle('ai:deleteConversation', async (_, conversationId: string) => {
    await conversationManager.deleteConversation(conversationId)
    return { success: true }
  })

  // ============================================================================
  // VECTOR SEARCH / RAG
  // ============================================================================

  ipcMain.handle('ai:initializeVectorDB', async (_, spaceId: string) => {
    const vectorDB = getOrCreateVectorDB(spaceId)
    await vectorDB.initialize()
    return { success: true }
  })

  ipcMain.handle('ai:indexNote', async (_, spaceId: string, noteId: string, folderId: string) => {
    const fsManager = getOrCreateFsManager(spaceId)
    const note = await fsManager.readNote(folderId, noteId)

    const vectorDB = getOrCreateVectorDB(spaceId)
    await vectorDB.initialize()

    await embeddingService.indexNote(note, vectorDB)
    return { success: true }
  })

  ipcMain.handle('ai:indexAllNotes', async (event: IpcMainInvokeEvent, spaceId: string) => {
    const fsManager = getOrCreateFsManager(spaceId)
    const vectorDB = getOrCreateVectorDB(spaceId)
    await vectorDB.initialize()

    const window = BrowserWindow.fromWebContents(event.sender)

    // Get folder tree to iterate all notes
    const tree = await fsManager.getFolderTree()
    const allNotes: Array<{ folderId: string; noteId: string }> = []

    const collectNotes = (folder: any) => {
      for (const noteId of folder.noteIds || []) {
        allNotes.push({ folderId: folder.id, noteId })
      }
      for (const child of folder.children || []) {
        collectNotes(child)
      }
    }
    collectNotes(tree)

    // Index each note with progress
    let indexed = 0
    for (const { folderId, noteId } of allNotes) {
      try {
        const note = await fsManager.readNote(folderId, noteId)
        await embeddingService.indexNote(note, vectorDB)
        indexed++

        window?.webContents.send('ai:indexing-progress', {
          current: indexed,
          total: allNotes.length,
          noteId,
          noteTitle: note.title
        })
      } catch (error) {
        console.error(`Failed to index note ${noteId}:`, error)
      }
    }

    return { success: true, indexed, total: allNotes.length }
  })

  ipcMain.handle(
    'ai:searchNotes',
    async (_, spaceId: string, query: string, limit?: number, noteIds?: string[]) => {
      const vectorDB = getOrCreateVectorDB(spaceId)
      await vectorDB.initialize()

      const queryEmbedding = await embeddingService.embedText(query)
      return await vectorDB.search(queryEmbedding, limit, noteIds)
    }
  )

  ipcMain.handle('ai:getIndexedNotes', async (_, spaceId: string) => {
    const vectorDB = getOrCreateVectorDB(spaceId)
    await vectorDB.initialize()
    return await vectorDB.getIndexedNoteIds()
  })

  ipcMain.handle('ai:deleteNoteIndex', async (_, spaceId: string, noteId: string) => {
    const vectorDB = getOrCreateVectorDB(spaceId)
    await vectorDB.initialize()
    await vectorDB.deleteDocumentsForNote(noteId)
    return { success: true }
  })
}
```

---

## 8. Preload API

```typescript
// Aggiunte a src/preload/index.ts

const aiAPI = {
  // Initialization
  initialize: () => ipcRenderer.invoke('ai:initialize'),
  isInitialized: () => ipcRenderer.invoke('ai:isInitialized'),

  // Hardware
  getHardwareInfo: () => ipcRenderer.invoke('ai:getHardwareInfo'),
  getModelRecommendations: () => ipcRenderer.invoke('ai:getModelRecommendations'),

  // Models
  listAvailableModels: () => ipcRenderer.invoke('ai:listAvailableModels'),
  listDownloadedModels: () => ipcRenderer.invoke('ai:listDownloadedModels'),
  isModelDownloaded: (modelId: string) => ipcRenderer.invoke('ai:isModelDownloaded', modelId),
  downloadModel: (modelId: string) => ipcRenderer.invoke('ai:downloadModel', modelId),
  pauseDownload: (modelId: string) => ipcRenderer.invoke('ai:pauseDownload', modelId),
  resumeDownload: (modelId: string) => ipcRenderer.invoke('ai:resumeDownload', modelId),
  cancelDownload: (modelId: string) => ipcRenderer.invoke('ai:cancelDownload', modelId),
  loadModel: (modelId: string) => ipcRenderer.invoke('ai:loadModel', modelId),
  unloadModel: (modelId: string) => ipcRenderer.invoke('ai:unloadModel', modelId),
  getLoadedModels: () => ipcRenderer.invoke('ai:getLoadedModels'),
  deleteModel: (modelId: string) => ipcRenderer.invoke('ai:deleteModel', modelId),

  // Download progress listener
  onDownloadProgress: (callback: (progress: DownloadProgress) => void) => {
    const handler = (_: any, progress: DownloadProgress) => callback(progress)
    ipcRenderer.on('ai:download-progress', handler)
    return () => ipcRenderer.removeListener('ai:download-progress', handler)
  },

  // Chat
  generateResponse: (
    modelId: string,
    messages: Array<{ role: string; content: string }>,
    options?: { maxTokens?: number; temperature?: number }
  ) => ipcRenderer.invoke('ai:generateResponse', modelId, messages, options),

  onResponseChunk: (callback: (data: { chunk: string; fullResponse: string }) => void) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('ai:response-chunk', handler)
    return () => ipcRenderer.removeListener('ai:response-chunk', handler)
  },

  // Conversations
  createConversation: (title: string, modelId: string, systemPrompt?: string) =>
    ipcRenderer.invoke('ai:createConversation', title, modelId, systemPrompt),
  getConversation: (id: string) => ipcRenderer.invoke('ai:getConversation', id),
  listConversations: () => ipcRenderer.invoke('ai:listConversations'),
  addMessage: (
    conversationId: string,
    role: 'user' | 'assistant',
    content: string,
    noteRefs?: NoteReference[]
  ) => ipcRenderer.invoke('ai:addMessage', conversationId, role, content, noteRefs),
  updateConversationTitle: (conversationId: string, title: string) =>
    ipcRenderer.invoke('ai:updateConversationTitle', conversationId, title),
  addNoteToConversation: (conversationId: string, noteRef: NoteReference) =>
    ipcRenderer.invoke('ai:addNoteToConversation', conversationId, noteRef),
  removeNoteFromConversation: (conversationId: string, noteId: string) =>
    ipcRenderer.invoke('ai:removeNoteFromConversation', conversationId, noteId),
  deleteConversation: (id: string) => ipcRenderer.invoke('ai:deleteConversation', id),

  // Vector Search / RAG
  initializeVectorDB: (spaceId: string) => ipcRenderer.invoke('ai:initializeVectorDB', spaceId),
  indexNote: (spaceId: string, noteId: string, folderId: string) =>
    ipcRenderer.invoke('ai:indexNote', spaceId, noteId, folderId),
  indexAllNotes: (spaceId: string) => ipcRenderer.invoke('ai:indexAllNotes', spaceId),
  searchNotes: (spaceId: string, query: string, limit?: number, noteIds?: string[]) =>
    ipcRenderer.invoke('ai:searchNotes', spaceId, query, limit, noteIds),
  getIndexedNotes: (spaceId: string) => ipcRenderer.invoke('ai:getIndexedNotes', spaceId),
  deleteNoteIndex: (spaceId: string, noteId: string) =>
    ipcRenderer.invoke('ai:deleteNoteIndex', spaceId, noteId),

  // Indexing progress listener
  onIndexingProgress: (
    callback: (data: { current: number; total: number; noteId: string; noteTitle: string }) => void
  ) => {
    const handler = (_: any, data: any) => callback(data)
    ipcRenderer.on('ai:indexing-progress', handler)
    return () => ipcRenderer.removeListener('ai:indexing-progress', handler)
  }
}

// Add to contextBridge
contextBridge.exposeInMainWorld('ai', aiAPI)
```

---

## 9. React Hooks

```typescript
// src/renderer/src/hooks/useAI.ts

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState, useCallback } from 'react'

// ============================================================================
// HARDWARE & MODELS
// ============================================================================

export const useHardwareInfo = () => {
  return useQuery({
    queryKey: ['ai', 'hardware'],
    queryFn: () => window.ai.getHardwareInfo(),
    staleTime: Infinity // Hardware doesn't change
  })
}

export const useModelRecommendations = () => {
  return useQuery({
    queryKey: ['ai', 'recommendations'],
    queryFn: () => window.ai.getModelRecommendations(),
    staleTime: Infinity
  })
}

export const useAvailableModels = () => {
  return useQuery({
    queryKey: ['ai', 'models', 'available'],
    queryFn: () => window.ai.listAvailableModels(),
    staleTime: Infinity
  })
}

export const useDownloadedModels = () => {
  return useQuery({
    queryKey: ['ai', 'models', 'downloaded'],
    queryFn: () => window.ai.listDownloadedModels()
  })
}

export const useLoadedModels = () => {
  return useQuery({
    queryKey: ['ai', 'models', 'loaded'],
    queryFn: () => window.ai.getLoadedModels(),
    refetchInterval: 5000 // Poll for changes
  })
}

// ============================================================================
// MODEL DOWNLOAD WITH PROGRESS
// ============================================================================

export const useModelDownload = () => {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<Record<string, DownloadProgress>>({})

  useEffect(() => {
    const unsubscribe = window.ai.onDownloadProgress((p) => {
      setProgress((prev) => ({ ...prev, [p.modelId]: p }))

      if (p.status === 'completed') {
        queryClient.invalidateQueries({ queryKey: ['ai', 'models', 'downloaded'] })
      }
    })

    return unsubscribe
  }, [queryClient])

  const downloadMutation = useMutation({
    mutationFn: (modelId: string) => window.ai.downloadModel(modelId)
  })

  const pauseMutation = useMutation({
    mutationFn: (modelId: string) => window.ai.pauseDownload(modelId)
  })

  const resumeMutation = useMutation({
    mutationFn: (modelId: string) => window.ai.resumeDownload(modelId)
  })

  const cancelMutation = useMutation({
    mutationFn: (modelId: string) => window.ai.cancelDownload(modelId)
  })

  return {
    progress,
    download: downloadMutation.mutate,
    pause: pauseMutation.mutate,
    resume: resumeMutation.mutate,
    cancel: cancelMutation.mutate,
    isDownloading: downloadMutation.isPending
  }
}

// ============================================================================
// CHAT WITH STREAMING
// ============================================================================

export const useAIChat = (modelId: string) => {
  const [isGenerating, setIsGenerating] = useState(false)
  const [currentResponse, setCurrentResponse] = useState('')

  useEffect(() => {
    const unsubscribe = window.ai.onResponseChunk(({ fullResponse }) => {
      setCurrentResponse(fullResponse)
    })

    return unsubscribe
  }, [])

  const sendMessage = useCallback(
    async (
      messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>,
      options?: { maxTokens?: number; temperature?: number }
    ): Promise<string> => {
      setIsGenerating(true)
      setCurrentResponse('')

      try {
        const result = await window.ai.generateResponse(modelId, messages, options)
        return result.response
      } finally {
        setIsGenerating(false)
      }
    },
    [modelId]
  )

  return {
    sendMessage,
    isGenerating,
    currentResponse
  }
}

// ============================================================================
// CONVERSATIONS
// ============================================================================

export const useConversations = () => {
  return useQuery({
    queryKey: ['ai', 'conversations'],
    queryFn: () => window.ai.listConversations()
  })
}

export const useConversation = (id: string) => {
  return useQuery({
    queryKey: ['ai', 'conversation', id],
    queryFn: () => window.ai.getConversation(id),
    enabled: !!id
  })
}

export const useCreateConversation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      title,
      modelId,
      systemPrompt
    }: {
      title: string
      modelId: string
      systemPrompt?: string
    }) => window.ai.createConversation(title, modelId, systemPrompt),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
    }
  })
}

export const useAddMessage = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      conversationId,
      role,
      content,
      noteRefs
    }: {
      conversationId: string
      role: 'user' | 'assistant'
      content: string
      noteRefs?: NoteReference[]
    }) => window.ai.addMessage(conversationId, role, content, noteRefs),
    onSuccess: (_, { conversationId }) => {
      queryClient.invalidateQueries({
        queryKey: ['ai', 'conversation', conversationId]
      })
    }
  })
}

export const useDeleteConversation = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (conversationId: string) => window.ai.deleteConversation(conversationId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'conversations'] })
    }
  })
}

// ============================================================================
// VECTOR SEARCH / RAG
// ============================================================================

export const useVectorSearch = (spaceId: string) => {
  return useMutation({
    mutationFn: ({
      query,
      limit,
      noteIds
    }: {
      query: string
      limit?: number
      noteIds?: string[]
    }) => window.ai.searchNotes(spaceId, query, limit, noteIds)
  })
}

export const useIndexNote = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      spaceId,
      noteId,
      folderId
    }: {
      spaceId: string
      noteId: string
      folderId: string
    }) => window.ai.indexNote(spaceId, noteId, folderId),
    onSuccess: (_, { spaceId }) => {
      queryClient.invalidateQueries({
        queryKey: ['ai', 'indexed', spaceId]
      })
    }
  })
}

export const useIndexAllNotes = (spaceId: string) => {
  const queryClient = useQueryClient()
  const [progress, setProgress] = useState<{
    current: number
    total: number
    noteTitle: string
  } | null>(null)

  useEffect(() => {
    const unsubscribe = window.ai.onIndexingProgress((data) => {
      setProgress({
        current: data.current,
        total: data.total,
        noteTitle: data.noteTitle
      })
    })

    return unsubscribe
  }, [])

  const mutation = useMutation({
    mutationFn: () => window.ai.indexAllNotes(spaceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ai', 'indexed', spaceId] })
      setProgress(null)
    }
  })

  return {
    indexAll: mutation.mutate,
    isIndexing: mutation.isPending,
    progress
  }
}

export const useIndexedNotes = (spaceId: string) => {
  return useQuery({
    queryKey: ['ai', 'indexed', spaceId],
    queryFn: () => window.ai.getIndexedNotes(spaceId),
    enabled: !!spaceId
  })
}
```

---

## 10. Configurazione

### 10.1 Schema AppConfig

```typescript
// Aggiunte a src/main/utils/configStore.ts

export interface AIConfig {
  // Selected models
  defaultChatModelId: string | null
  defaultEmbeddingModelId: string | null

  // Inference settings
  maxContextSize: number
  defaultTemperature: number
  defaultMaxTokens: number

  // Memory management
  autoUnloadIdleModels: boolean
  idleUnloadTimeoutMs: number
  maxLoadedModels: number

  // RAG settings
  chunkSize: number
  chunkOverlap: number
  searchResultsLimit: number
  autoIndexNotes: boolean

  // UI preferences
  showHardwareWarnings: boolean
  streamResponses: boolean

  // Onboarding
  onboardingCompleted: boolean
  hardwareTier: 'low' | 'medium' | 'high' | 'ultra' | null
}

// Default values
const aiConfigDefaults: AIConfig = {
  defaultChatModelId: null,
  defaultEmbeddingModelId: 'nomic-embed-text-v1.5',
  maxContextSize: 4096,
  defaultTemperature: 0.7,
  defaultMaxTokens: 2048,
  autoUnloadIdleModels: true,
  idleUnloadTimeoutMs: 300000, // 5 minutes
  maxLoadedModels: 2,
  chunkSize: 512,
  chunkOverlap: 50,
  searchResultsLimit: 10,
  autoIndexNotes: true,
  showHardwareWarnings: true,
  streamResponses: true,
  onboardingCompleted: false,
  hardwareTier: null
}
```

### 10.2 Electron Vite Configuration

```typescript
// electron.vite.config.ts - Modifiche necessarie

import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: ['electron-store'],
        // CRITICAL: These native modules must be externalized
        include: ['node-llama-cpp', 'better-sqlite3']
      })
    ],
    build: {
      rollupOptions: {
        // Explicitly mark as external
        external: ['node-llama-cpp', 'better-sqlite3']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@preload': resolve('src/preload')
      }
    },
    plugins: [
      TanStackRouterVite({
        autoCodeSplitting: true,
        routeToken: 'layout'
      }),
      tailwindcss(),
      react()
    ]
  }
})
```

---

## 11. Flussi di Dati

### 11.1 Chat Flow con Streaming

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                USER ACTION                                   │
│                          "Send message in chat"                              │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              REACT COMPONENT                                 │
│  const { sendMessage, isGenerating, currentResponse } = useAIChat(modelId)  │
│  await sendMessage(messages)                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                               PRELOAD BRIDGE                                 │
│  window.ai.generateResponse(modelId, messages, options)                     │
│  ipcRenderer.invoke('ai:generateResponse', ...)                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              MAIN PROCESS                                    │
│  ipcMain.handle('ai:generateResponse', async (event, ...) => {              │
│    for await (const chunk of aiManager.generateChatCompletion(...)) {       │
│      event.sender.send('ai:response-chunk', { chunk, fullResponse })        │
│    }                                                                         │
│  })                                                                          │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                    ┌────────────────┴────────────────┐
                    ▼                                 ▼
┌──────────────────────────────┐    ┌──────────────────────────────────────────┐
│    STREAMING UPDATES         │    │           FINAL RESPONSE                 │
│  ipcRenderer.on(             │    │  Return { response: fullResponse }       │
│    'ai:response-chunk',      │    │                                          │
│    (_, { chunk }) => {       │    │                                          │
│      setCurrentResponse()    │    │                                          │
│    }                         │    │                                          │
│  )                           │    │                                          │
└──────────────────────────────┘    └──────────────────────────────────────────┘
```

### 11.2 RAG Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              NOTE SAVED                                      │
│                      (useUpdateNote mutation success)                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        AUTO-INDEX (if enabled)                               │
│  window.ai.indexNote(spaceId, noteId, folderId)                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           EMBEDDING SERVICE                                  │
│  1. Extract text from Lexical state                                         │
│  2. Chunk text (512 tokens, 50 overlap)                                     │
│  3. Generate embeddings for each chunk                                      │
│  4. Store in VectorDBManager                                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SQLITE-VEC                                      │
│  INSERT INTO vec_documents (id, embedding) VALUES (?, ?)                    │
└─────────────────────────────────────────────────────────────────────────────┘

                            ... later, during chat ...

┌─────────────────────────────────────────────────────────────────────────────┐
│                           USER ASKS QUESTION                                 │
│                   "What did I write about X?"                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            SEMANTIC SEARCH                                   │
│  const results = await window.ai.searchNotes(spaceId, query, 5)             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       BUILD CONTEXT PROMPT                                   │
│  const context = results.map(r => r.content).join('\n\n')                   │
│  const enhancedPrompt = `Context:\n${context}\n\nQuestion: ${query}`        │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GENERATE RESPONSE                                   │
│  await sendMessage([{ role: 'user', content: enhancedPrompt }])             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 12. Gestione Errori

### 12.1 Classi Errore Custom

```typescript
// src/main/ai/errors.ts

export class AIError extends Error {
  constructor(
    message: string,
    public code: string,
    public recoverable: boolean = true
  ) {
    super(message)
    this.name = 'AIError'
  }
}

export class ModelNotFoundError extends AIError {
  constructor(modelId: string) {
    super(`Model not found: ${modelId}`, 'MODEL_NOT_FOUND')
  }
}

export class ModelNotDownloadedError extends AIError {
  constructor(modelId: string) {
    super(`Model not downloaded: ${modelId}. Please download it first.`, 'MODEL_NOT_DOWNLOADED')
  }
}

export class InsufficientMemoryError extends AIError {
  constructor(required: number, available: number) {
    super(
      `Insufficient memory: need ${formatBytes(required)}, have ${formatBytes(available)}`,
      'INSUFFICIENT_MEMORY'
    )
  }
}

export class GPUNotAvailableError extends AIError {
  constructor() {
    super('No compatible GPU found. The model will run on CPU (slower).', 'GPU_NOT_AVAILABLE')
  }
}

export class ContextSizeExceededError extends AIError {
  constructor(requested: number, max: number) {
    super(`Context size ${requested} exceeds maximum ${max}`, 'CONTEXT_SIZE_EXCEEDED')
  }
}

export class DownloadFailedError extends AIError {
  constructor(modelId: string, reason: string) {
    super(`Failed to download model ${modelId}: ${reason}`, 'DOWNLOAD_FAILED')
  }
}

export class EmbeddingFailedError extends AIError {
  constructor(noteId: string, reason: string) {
    super(`Failed to generate embeddings for note ${noteId}: ${reason}`, 'EMBEDDING_FAILED')
  }
}

function formatBytes(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024)
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  const mb = bytes / (1024 * 1024)
  return `${mb.toFixed(0)} MB`
}
```

### 12.2 Error Handling Patterns

```typescript
// Nel IPC handler
ipcMain.handle('ai:loadModel', async (_, modelId: string) => {
  try {
    await aiManager.loadModel(modelId)
    return { success: true }
  } catch (error) {
    if (error instanceof ModelNotDownloadedError) {
      return {
        success: false,
        error: error.code,
        message: error.message,
        recoverable: true
      }
    }
    throw error // Re-throw unexpected errors
  }
})

// Nel React hook
const { mutate: loadModel } = useMutation({
  mutationFn: (modelId: string) => window.ai.loadModel(modelId),
  onError: (error) => {
    if (error.code === 'MODEL_NOT_DOWNLOADED') {
      toast.error('Please download the model first')
      // Trigger download flow
    } else {
      toast.error('Failed to load model')
    }
  }
})
```

---

## 13. Fasi di Implementazione

### Fase 1: Foundation (Infrastruttura Base)

**Obiettivo**: Setup infrastruttura e hardware detection

**Tasks**:

1. Installare dipendenze (`node-llama-cpp`, `systeminformation`, `better-sqlite3`)
2. Configurare `electron.vite.config.ts` per esternalizzare moduli nativi
3. Creare struttura directory `src/main/ai/`
4. Implementare `HardwareDetector.ts`
5. Implementare `ModelRegistry.ts` con lista curata
6. Creare IPC handlers base per hardware detection
7. Creare hooks React per hardware info

**Deliverable**: App può rilevare hardware e mostrare tier/raccomandazioni

### Fase 2: Model Management

**Obiettivo**: Download e gestione modelli

**Tasks**:

1. Implementare `ModelDownloader.ts` con progress/pause/resume
2. Implementare `AIManager.ts` (versione base senza chat)
3. Creare IPC handlers per model management
4. Creare hooks React per download/gestione modelli
5. Creare UI per model selection e download

**Deliverable**: Utente può scaricare e gestire modelli

### Fase 3: Chat / Inference

**Obiettivo**: Chat funzionante con streaming

**Tasks**:

1. Completare `AIManager.ts` con chat completion
2. Implementare streaming via IPC events
3. Creare hooks React per chat con streaming
4. Creare UI chat interface
5. Implementare memory management (auto-unload)

**Deliverable**: Chat funzionante con risposta streaming

### Fase 4: RAG System

**Obiettivo**: Ricerca semantica nelle note

**Tasks**:

1. Setup sqlite-vec (bundling extension nativa)
2. Implementare `VectorDBManager.ts`
3. Implementare `EmbeddingService.ts`
4. Creare IPC handlers per indexing e search
5. Creare hooks React per RAG
6. Auto-indexing note al salvataggio

**Deliverable**: Ricerca semantica funzionante

### Fase 5: Conversations

**Obiettivo**: Persistenza conversazioni con context

**Tasks**:

1. Implementare `ConversationManager.ts`
2. Creare IPC handlers per conversations
3. Creare hooks React per conversations
4. Integrare note context in conversazioni
5. Creare UI lista conversazioni

**Deliverable**: Conversazioni persistenti con note context

### Fase 6: Onboarding & Polish

**Obiettivo**: UX completa per primo utilizzo

**Tasks**:

1. Creare wizard onboarding (hardware → model selection → download)
2. Creare settings panel per AI
3. Error handling e fallback UX
4. Performance optimization
5. Testing e bug fixing

**Deliverable**: Esperienza utente completa e polished

---

## 14. Risorse e Riferimenti

### Documentazione Ufficiale

- [node-llama-cpp Documentation](https://node-llama-cpp.withcat.ai/)
- [node-llama-cpp Electron Guide](https://node-llama-cpp.withcat.ai/guide/electron)
- [sqlite-vec GitHub](https://github.com/asg017/sqlite-vec)
- [systeminformation Docs](https://systeminformation.io/)
- [HuggingFace GGUF Models](https://huggingface.co/models?library=gguf)

### Progetti di Riferimento

- [local-llama-electron](https://github.com/SurfaceData/local-llama-electron) - Demo Electron + node-llama-cpp
- [@electron/llm](https://github.com/electron/llm) - Pacchetto ufficiale Electron (sperimentale)

### Modelli Consigliati

| Modello          | Size  | Use Case             | HuggingFace                                                                                                   |
| ---------------- | ----- | -------------------- | ------------------------------------------------------------------------------------------------------------- |
| Phi-3 Mini Q4    | 2.3GB | Low tier, tasks base | [microsoft/Phi-3-mini-4k-instruct-gguf](https://huggingface.co/microsoft/Phi-3-mini-4k-instruct-gguf)         |
| Llama 3.1 8B Q4  | 4.9GB | Medium tier, general | [bartowski/Meta-Llama-3.1-8B-Instruct-GGUF](https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF) |
| Llama 3.1 8B Q8  | 8.5GB | High tier, qualità   | [bartowski/Meta-Llama-3.1-8B-Instruct-GGUF](https://huggingface.co/bartowski/Meta-Llama-3.1-8B-Instruct-GGUF) |
| Nomic Embed v1.5 | 137MB | Embeddings RAG       | [nomic-ai/nomic-embed-text-v1.5-GGUF](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5-GGUF)             |

---

## Appendice A: Type Definitions

```typescript
// src/main/ai/types.ts

export interface HardwareInfo {
  cpu: {
    brand: string
    cores: number
    physicalCores: number
    speed: number
  }
  memory: {
    totalBytes: number
    availableBytes: number
  }
  gpu: {
    name: string
    vendor: string
    vramBytes: number | null
    hasCuda: boolean
    hasMetal: boolean
    hasVulkan: boolean
    driverVersion: string | null
  }
  platform: NodeJS.Platform
  tier: 'low' | 'medium' | 'high' | 'ultra'
}

export interface ModelDefinition {
  id: string
  name: string
  description: string
  filename: string
  downloadUrl: string
  sizeBytes: number
  layers: number
  contextLength: number
  quantization: string
  capabilities: ('chat' | 'embedding' | 'code' | 'reasoning')[]
  hardwareTier: 'low' | 'medium' | 'high' | 'ultra'
  license: string
}

export interface DownloadProgress {
  modelId: string
  filename: string
  bytesDownloaded: number
  totalBytes: number
  percentage: number
  speed: number
  eta: number
  status: 'pending' | 'downloading' | 'paused' | 'completed' | 'error'
  error?: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: string
  noteReferences?: NoteReference[]
  metadata?: Record<string, unknown>
}

export interface NoteReference {
  noteId: string
  spaceId: string
  title: string
  excerpt: string
  relevanceScore?: number
}

export interface Conversation {
  id: string
  title: string
  modelId: string
  systemPrompt?: string
  messages: ChatMessage[]
  noteContext: NoteReference[]
  createdAt: string
  updatedAt: string
  metadata: {
    totalTokens: number
    lastModelResponse?: string
  }
}

export interface ConversationSummary {
  id: string
  title: string
  modelId: string
  messageCount: number
  noteCount: number
  createdAt: string
  updatedAt: string
}

export interface SearchResult {
  id: string
  noteId: string
  content: string
  distance: number
  metadata: Record<string, unknown>
}

export interface GenerationOptions {
  maxTokens?: number
  temperature?: number
  topP?: number
  stopSequences?: string[]
}
```

---

_Documento creato per TaacNotes - AI Architecture Specification v1.0_
