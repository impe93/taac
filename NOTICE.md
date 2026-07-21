# NOTICE

Taac is licensed under the **GNU Affero General Public License v3.0 or later**
(see [`LICENSE`](./LICENSE)). This NOTICE documents third-party components that are
**not** covered by that license: the AI models the application downloads at runtime,
and the major open-source libraries it builds upon. Each is distributed under its own
terms, reproduced or referenced below.

Taac does **not** bundle these model weights in its source repository. They are
fetched on demand from Hugging Face into the user's local data directory. The list
below reflects the curated models declared in
[`src/main/ai/ModelRegistry.ts`](./src/main/ai/ModelRegistry.ts).

---

## AI Models

| Model | Role | Source (Hugging Face) | License |
| --- | --- | --- | --- |
| Qwen3.5 4B (Q4_K_M, GGUF) | Chat / summarization | `unsloth/Qwen3.5-4B-GGUF` | Apache-2.0 |
| Qwen3.5 4B (MLX 4-bit) | Chat / summarization (Apple Silicon) | `mlx-community/Qwen3.5-4B-MLX-4bit` | Apache-2.0 |
| EmbeddingGemma 300M (Q8_0, GGUF) | Text embeddings (RAG) | `ggml-org/embeddinggemma-300m-GGUF` | **Gemma Terms of Use** |
| Qwen3 Reranker 0.6B (Q8_0, GGUF) | Retrieval reranking | `ggml-org/Qwen3-Reranker-0.6B-Q8_0-GGUF` | Apache-2.0 |
| Whisper Base / Small / Large-v3-turbo (GGML) | Speech-to-text | `ggerganov/whisper.cpp` | MIT |
| Qwen3-ASR 1.7B / 0.6B (MLX 8-bit) | Real-time speech-to-text (Apple Silicon) | `mlx-community/Qwen3-ASR-1.7B-8bit`, `…-0.6B-8bit` | Apache-2.0 |
| Silero VAD | Voice activity detection | `csukuangfj/vad` | MIT |
| Speaker Segmentation (pyannote) | Diarization | `csukuangfj/sherpa-onnx-pyannote-segmentation-3-0` | MIT |
| Speaker Embedding (NeMo TitaNet Small) | Diarization | `csukuangfj/speaker-embedding-models` | Apache-2.0 |

### Important: Gemma Terms of Use

**EmbeddingGemma** is provided by Google under the [Gemma Terms of Use](https://ai.google.dev/gemma/terms)
and the [Gemma Prohibited Use Policy](https://ai.google.dev/gemma/prohibited_use_policy),
**not** under a standard open-source license. Redistribution and use of the model and
its derivatives must comply with those terms, including the prohibited-use restrictions.
If you fork or redistribute Taac, review these terms and the model card before
shipping. To avoid the Gemma terms, you may substitute an alternative embedding model
in `ModelRegistry.ts`.

> The license identifiers above are curated for convenience. They are not legal advice.
> Always consult the upstream model card and license file for the authoritative terms
> that apply to your use.

---

## Major Third-Party Software

Taac builds on the following notable open-source projects (non-exhaustive; the
complete dependency tree and its licenses are recorded in
[`pnpm-lock.yaml`](./pnpm-lock.yaml)):

| Project | Purpose | License |
| --- | --- | --- |
| Electron | Desktop application runtime | MIT |
| React | UI framework | MIT |
| TanStack Router / Query | Routing & data fetching | MIT |
| Redux Toolkit | State management | MIT |
| TailwindCSS | Styling | MIT |
| shadcn/ui + Radix UI | UI components | MIT |
| MDXEditor | Rich-text editor | MIT |
| node-llama-cpp | LLM / embedding inference (GGUF) | MIT |
| whisper.cpp | Speech-to-text inference | MIT |
| sherpa-onnx | VAD & speaker diarization | Apache-2.0 |
| Apple MLX / mlx-lm / mlx-qwen3-asr | Apple Silicon inference | MIT / Apache-2.0 |
| better-sqlite3 | Embedded database | MIT |
| sqlite-vec | Vector search extension | Apache-2.0 / MIT |
| electron-builder / electron-updater | Packaging & auto-update | MIT |

---

## Trademarks

Product and model names (Qwen, Gemma, Whisper, Silero, pyannote, NeMo, Electron, and
others) are trademarks or product names of their respective owners. Their use here is
descriptive and does not imply endorsement.
