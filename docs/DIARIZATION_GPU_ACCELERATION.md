# Phase 3: GPU Acceleration per Diarizzazione

> **Prerequisiti**: Phase 1 (Process Isolation) e Phase 2 (Ottimizzazione Performance) devono essere completate e validate prima di procedere.

## Premessa

La ricerca ha evidenziato che la GPU acceleration ha **benefici limitati per la diarizzazione** rispetto all'ASR:
- I modelli di segmentation/embedding sono piccoli (5-10MB) e gia' veloci su CPU
- Il clustering (spectral/agglomerative) e' sempre CPU-bound
- Miglioramento atteso: **20-40%** (vs 10-50x per trascrizione con whisper.cpp)
- Anche su RTX 3090, il maintainer di sherpa-onnx conferma miglioramenti minimi

Questa phase va implementata solo se, dopo Phase 1+2, la diarizzazione resta un collo di bottiglia significativo per recording lunghi (>30 min).

## Approccio: onnxruntime-node con CoreML/CUDA

### Perche' questo approccio

| Approccio | Pro | Contro |
|-----------|-----|--------|
| **onnxruntime-node (scelto)** | npm package standard, CoreML macOS prebuilt, CUDA Linux prebuilt | CoreML ha limiti su forme dinamiche; richiede reimplementazione pipeline |
| Python subprocess (pyannote + PyTorch) | GPU pieno (MPS/CUDA), miglior supporto | +100-500MB bundle, complessita' gestione runtime Python |
| pyannote-rs (Rust) via NAPI-RS | CoreML + DirectML, performante | Nessun binding Node.js, enorme effort di sviluppo |
| sherpa-onnx-node con CUDA manuale | Cambio minimo | Solo Linux, richiede binary replacement manuale |

### Architettura

Creare un `DiarizationGpuService` che usa `onnxruntime-node` direttamente con execution providers GPU. La pipeline di diarizzazione va reimplementata in TypeScript perche' `sherpa-onnx` espone solo la chiamata monolitica `OfflineSpeakerDiarization.process()` senza step intermedi.

```
Audio WAV
    |
    v
[1. Segmentation Model]  <-- onnxruntime-node + CoreML/CUDA
    |
    v
Speaker Change Points + VAD
    |
    v
[2. Extract Speech Segments]  <-- TypeScript (CPU)
    |
    v
[3. Embedding Model]  <-- onnxruntime-node + CoreML/CUDA
    |  (per ogni segmento)
    v
Speaker Vectors (embeddings)
    |
    v
[4. Spectral Clustering]  <-- TypeScript (CPU, sempre)
    |
    v
DiarizationResult { segments, numSpeakers }
```

## Implementazione

### Step 1: Aggiungere dipendenza

```bash
pnpm add onnxruntime-node
```

### Step 2: Configurazione build

**`electron.vite.config.ts`** -- aggiungere agli externals:

```typescript
externalizeDepsPlugin({
  include: [
    // ... esistenti ...
    'onnxruntime-node'
  ]
})

// E in rollupOptions.external:
external: [
  // ... esistenti ...
  'onnxruntime-node'
]
```

**`electron-builder.yml`** -- aggiungere a asarUnpack:

```yaml
asarUnpack:
  # ... esistenti ...
  - node_modules/onnxruntime-node/**
```

### Step 3: Creare `src/main/audio/DiarizationGpuService.ts`

```typescript
/**
 * DiarizationGpuService -- GPU-accelerated speaker diarization via onnxruntime-node
 *
 * Reimplements the sherpa-onnx diarization pipeline using onnxruntime-node
 * with CoreML (macOS) or CUDA (Linux) execution providers for GPU acceleration.
 *
 * Pipeline:
 *   1. Run pyannote segmentation model -> speaker change points
 *   2. Extract speech segments from segmentation output
 *   3. Run embedding model on each segment -> speaker vectors
 *   4. Cluster embeddings via spectral/agglomerative clustering -> speaker labels
 *
 * Falls back to CPU DiarizationService if GPU initialization fails.
 *
 * §3.3  initialize() is idempotent
 * §3.4  dispose() tears down sessions and resets state
 * §3.5  type-only imports; runtime dynamic import()
 * §3.7  log prefix [DiarizationGpuService]
 */

import fs from 'node:fs/promises'
import type { DiarizationResult, DiarizationSegment } from './types'

// §3.5 -- type-only import
type OrtModule = typeof import('onnxruntime-node')

export class DiarizationGpuService {
  private segmentationSession: any | null = null
  private embeddingSession: any | null = null
  private ort: OrtModule | null = null
  private initialized = false

  /**
   * Initialize ONNX sessions with GPU execution provider.
   *
   * @param segmentationModelPath  Path to pyannote segmentation ONNX model
   * @param embeddingModelPath     Path to speaker embedding ONNX model
   * @param gpuBackend             'coreml' (macOS) or 'cuda' (Linux/Windows)
   */
  async initialize(
    segmentationModelPath: string,
    embeddingModelPath: string,
    gpuBackend: 'coreml' | 'cuda'
  ): Promise<void> {
    if (this.initialized) return

    console.log(
      `[DiarizationGpuService] Initializing with ${gpuBackend} backend`
    )

    // Verify model files exist
    for (const p of [segmentationModelPath, embeddingModelPath]) {
      try { await fs.access(p) }
      catch { throw new Error(`Model not found: ${p}`) }
    }

    // Dynamic import (§3.5)
    const ort = await import('onnxruntime-node')
    this.ort = ort

    // Configure execution provider
    const executionProviders: any[] = []
    if (gpuBackend === 'coreml') {
      executionProviders.push({
        name: 'CoreMLExecutionProvider',
        coreMlFlags: 0  // COREML_FLAG_USE_CPU_AND_GPU
      })
    } else if (gpuBackend === 'cuda') {
      executionProviders.push({ name: 'CUDAExecutionProvider' })
    }
    // Always add CPU as fallback
    executionProviders.push({ name: 'CPUExecutionProvider' })

    const sessionOptions = { executionProviders }

    try {
      this.segmentationSession = await ort.InferenceSession.create(
        segmentationModelPath,
        sessionOptions
      )
      console.log('[DiarizationGpuService] Segmentation session created')

      this.embeddingSession = await ort.InferenceSession.create(
        embeddingModelPath,
        sessionOptions
      )
      console.log('[DiarizationGpuService] Embedding session created')

      this.initialized = true
      console.log('[DiarizationGpuService] Initialized successfully')
    } catch (err) {
      // Clean up partial init
      this.segmentationSession = null
      this.embeddingSession = null
      throw err  // Let caller fall back to CPU DiarizationService
    }
  }

  /**
   * Run the full diarization pipeline on a 16kHz mono WAV file.
   */
  async diarize(wavPath: string): Promise<DiarizationResult> {
    if (!this.initialized || !this.ort) {
      throw new Error('[DiarizationGpuService] Not initialized')
    }

    console.log(`[DiarizationGpuService] Diarizing: ${wavPath}`)

    // 1. Load audio samples (16kHz mono float32)
    const samples = await this.loadWavSamples(wavPath)

    // 2. Run segmentation model
    //    Input: audio waveform
    //    Output: frame-level speaker probabilities
    const segmentationOutput = await this.runSegmentation(samples)

    // 3. Extract speech segments from segmentation output
    //    Convert frame probabilities to time-stamped segments
    const speechSegments = this.extractSpeechSegments(segmentationOutput, samples.length)

    // 4. Run embedding model on each speech segment
    //    Extract speaker embeddings (vectors) for clustering
    const embeddings = await this.extractEmbeddings(samples, speechSegments)

    // 5. Cluster embeddings to identify speakers
    //    Returns speaker label for each segment
    const speakerLabels = this.clusterSpeakers(embeddings)

    // 6. Build DiarizationResult
    const segments: DiarizationSegment[] = speechSegments.map((seg, i) => ({
      speaker: speakerLabels[i],
      startTime: seg.start,
      endTime: seg.end
    }))

    const numSpeakers = new Set(speakerLabels).size
    console.log(
      `[DiarizationGpuService] Done -- ${segments.length} segments, ${numSpeakers} speakers`
    )

    return { segments, numSpeakers }
  }

  /**
   * Release ONNX sessions. (§3.4)
   */
  dispose(): void {
    this.segmentationSession?.release()
    this.embeddingSession?.release()
    this.segmentationSession = null
    this.embeddingSession = null
    this.ort = null
    this.initialized = false
    console.log('[DiarizationGpuService] Disposed')
  }

  // -----------------------------------------------------------------------
  // Private pipeline steps -- DA IMPLEMENTARE
  // -----------------------------------------------------------------------

  /**
   * Load 16kHz mono WAV file into Float32Array.
   *
   * Implementazione: leggere il file WAV, parsare l'header RIFF/WAV,
   * estrarre i campioni PCM 16-bit e convertirli in float32 [-1, 1].
   * Oppure riutilizzare sherpa-onnx readWave() se disponibile.
   */
  private async loadWavSamples(wavPath: string): Promise<Float32Array> {
    // TODO: Implementare WAV parser o riutilizzare sherpa-onnx readWave
    throw new Error('Not implemented')
  }

  /**
   * Run the pyannote segmentation model.
   *
   * Il modello pyannote segmentation-3.0 accetta:
   *   Input: "waveform" tensor [batch=1, channels=1, samples=N]
   *   Output: "output" tensor [batch=1, frames=T, speakers=S]
   *
   * Ogni frame copre ~16ms (step size). Il valore output[0][t][s] indica
   * la probabilita' che lo speaker s stia parlando al frame t.
   *
   * Nota: il modello ha una finestra fissa di ~10s (160000 samples a 16kHz).
   * Per audio piu' lungo, bisogna fare windowing con overlap e poi fondere
   * i risultati (sliding window approach).
   */
  private async runSegmentation(samples: Float32Array): Promise<Float32Array[]> {
    // TODO: Implementare sliding window + inference
    // 1. Dividere l'audio in finestre di 10s con 5s di overlap
    // 2. Per ogni finestra: creare tensor input, run session
    // 3. Fondere le finestre sovrapposte (media delle probabilita')
    // 4. Restituire probabilita' per-frame per ogni speaker slot
    throw new Error('Not implemented')
  }

  /**
   * Convert frame-level speaker probabilities to time-stamped segments.
   *
   * Applica una soglia (es. 0.5) alle probabilita' per-frame per determinare
   * se uno speaker sta parlando. Unisce frame consecutivi in segmenti continui
   * e filtra segmenti troppo corti (< 0.1s).
   */
  private extractSpeechSegments(
    _segOutput: Float32Array[],
    _totalSamples: number
  ): Array<{ start: number; end: number; speakerSlot: number }> {
    // TODO: Implementare threshold + segment merging
    throw new Error('Not implemented')
  }

  /**
   * Extract speaker embeddings for each speech segment.
   *
   * Per ogni segmento:
   *   1. Estrarre i campioni audio corrispondenti
   *   2. Creare tensor input [1, 1, samples]
   *   3. Eseguire il modello di embedding -> vettore 192/256/512-dim
   *
   * I vettori risultanti vengono usati per il clustering.
   */
  private async extractEmbeddings(
    _samples: Float32Array,
    _segments: Array<{ start: number; end: number; speakerSlot: number }>
  ): Promise<Float32Array[]> {
    // TODO: Implementare batch embedding extraction
    // Considerare batching per efficienza GPU (es. batch di 32 segmenti)
    throw new Error('Not implemented')
  }

  /**
   * Cluster speaker embeddings to assign speaker labels.
   *
   * Implementare agglomerative clustering con cosine distance:
   *   1. Calcolare matrice di distanza coseno tra tutti gli embedding
   *   2. Agglomerative clustering con threshold (es. 0.9)
   *   3. Il numero di speaker viene determinato automaticamente dal threshold
   *
   * Alternativa: spectral clustering se il numero di speaker e' noto.
   *
   * Librerie JS utilizzabili:
   *   - ml-hclust (agglomerative clustering)
   *   - Implementazione custom (poche decine di righe per agglomerative base)
   */
  private clusterSpeakers(_embeddings: Float32Array[]): number[] {
    // TODO: Implementare agglomerative clustering
    // Questo step e' sempre CPU -- non beneficia della GPU
    throw new Error('Not implemented')
  }
}
```

### Step 4: Integrare nel worker

**`src/main/audio/processingWorker.ts`** -- Aggiungere supporto GPU diarization:

```typescript
// Nel WorkerInitConfig, aggiungere:
export interface WorkerInitConfig {
  // ... campi esistenti ...
  diarizationMode: 'gpu' | 'cpu'           // nuovo
  diarizationGpuBackend?: 'coreml' | 'cuda' // nuovo
}

// In handleInit(), dopo il blocco transcription:
if (config.diarizationMode === 'gpu' && config.diarizationGpuBackend) {
  try {
    const { DiarizationGpuService } = await import('./DiarizationGpuService')
    const gpuDiarSvc = new DiarizationGpuService()
    await gpuDiarSvc.initialize(
      config.segmentationModelPath,
      config.embeddingModelPath,
      config.diarizationGpuBackend
    )
    diarizationService = gpuDiarSvc
    console.log(`[Worker] Diarization: GPU (${config.diarizationGpuBackend})`)
  } catch (err) {
    console.warn('[Worker] GPU diarization init failed, falling back to CPU:', err)
    // Fall through to CPU init below
  }
}

// CPU fallback (codice esistente)
if (!diarizationService) {
  const { DiarizationService } = await import('./DiarizationService')
  const diarSvc = new DiarizationService()
  await diarSvc.initialize(config.segmentationModelPath, config.embeddingModelPath)
  diarizationService = diarSvc
  console.log('[Worker] Diarization: CPU (sherpa-onnx)')
}
```

### Step 5: Integrare in AudioManager

**`src/main/audio/AudioManager.ts`** -- Rilevare GPU e configurare:

```typescript
// Dopo il blocco di hardware detection, aggiungere:
const gpuBackend = hardware.gpu.hasMetal ? 'coreml' : hardware.gpu.hasCuda ? 'cuda' : null
const diarizationMode = gpuBackend ? 'gpu' : 'cpu'

// Nel workerConfig:
const workerConfig: WorkerInitConfig = {
  // ... campi esistenti ...
  diarizationMode,
  diarizationGpuBackend: gpuBackend ?? undefined
}
```

## Rischi e mitigazioni

| Rischio | Probabilita' | Impatto | Mitigazione |
|---------|-------------|---------|-------------|
| CoreML non supporta operatori ONNX con forme dinamiche | Alta | Medio | Test immediato al primo step; se `InferenceSession.create()` fallisce, il fallback CPU e' automatico |
| Reimplementazione pipeline introduce regressioni di accuratezza | Media | Alto | Validare output vs. sherpa-onnx su set di registrazioni di test note |
| onnxruntime-node aggiunge ~15-20MB al bundle | Bassa | Basso | Accettabile -- l'app gia' include moduli nativi pesanti |
| Sliding window del modello segmentation non funziona correttamente | Media | Alto | Testare con registrazioni di durata variabile; confrontare con output sherpa-onnx |
| Clustering custom meno accurato di sherpa-onnx | Media | Medio | Usare stesso threshold (0.9) e confrontare risultati |

## Stima di effort

- **Implementazione completa**: ~300-500 righe di codice pipeline + ~100 righe integrazione
- **Testing e tuning**: significativo -- richiede confronto accuratezza con sherpa-onnx su registrazioni reali
- **Effort totale stimato**: medio-alto

## Risorse utili

- [onnxruntime-node README](https://github.com/microsoft/onnxruntime/blob/main/js/node/README.md)
- [CoreML Execution Provider docs](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html)
- [pyannote segmentation 3.0 ONNX](https://huggingface.co/onnx-community/pyannote-segmentation-3.0)
- [sherpa-onnx diarization examples](https://github.com/k2-fsa/sherpa-onnx/tree/master/nodejs-examples)
- [pyannote-onnx-extended (Python reference)](https://github.com/samson6460/pyannote-onnx-extended) -- utile come reference per la reimplementazione della pipeline
