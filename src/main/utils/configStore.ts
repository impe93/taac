import Store from 'electron-store'

export interface AppConfig {
  theme: 'light' | 'dark' | 'system'
  editorFontSize: number
  autoSave: boolean
  autoSaveInterval: number
  autoIndexNotes: boolean
  /** Opt-in: enrich each chunk with LLM-generated context at index time (Anthropic-style). */
  contextualRetrievalEnabled: boolean
  /** When true, the chat assistant may run several note searches per message; when false, at most one. */
  ragMultiSearch: boolean
  lastOpenedFolderId: string | null
  windowBounds: {
    width: number
    height: number
    x?: number
    y?: number
  }
  isMaximized: boolean
  recentNotes: string[]
  activeSpaceId: string | null
  spacesInitialized: boolean
  onboardingCompleted: boolean
  // AI Chat Panel state
  aiChatPanelOpen: boolean
  aiChatPanelSize: number
  // Sidebar (folder structure) width in pixels
  sidebarWidth: number
  // Editor mode preference
  editorMode: 'wysiwyg' | 'source'
  // Redux persistence (new multi-space structure)
  reduxSpacesCaches?: Record<
    string,
    {
      tree: {
        folders: Record<string, unknown>
        notes: Record<string, unknown>
      }
      ui: {
        expandedFolders: string[]
        selectedNoteId: string | null
        selectedNoteFolderId: string | null
      }
      metadata: {
        lastSaved: string
        version: number
      }
    }
  >
  // LEGACY Redux persistence (mantenute per migrazione)
  reduxUIState?: {
    expandedFolders: string[]
    selectedNoteId: string | null
    selectedNoteFolderId: string | null
  }
  reduxTreeCache?: {
    folders: Record<string, unknown>
    notes: Record<string, unknown>
  }
  // Meeting Notes settings
  meeting: {
    keepAudioAfterTranscription: boolean
    defaultRecordingMode: 'remote' | 'in-person'
    whisperModelId: string
    /** Preferred spoken language: 'auto' (detect) or an ISO 639-1 code (e.g. 'it') */
    defaultLanguage: string
    /** 'auto' = transcribe live during recording when available, 'off' = always post-process */
    realtimeTranscription: 'auto' | 'off'
    /** MLX ASR model for the realtime sidecar (macOS Apple Silicon only) */
    asrModelId: string
    /**
     * Summary generation budget profile. Trades summary completeness/detail against
     * memory and speed on the mid-end (16GB) target. Drives the LLM context size and
     * output-token budget used when summarizing meeting transcripts.
     */
    summaryDepth: 'conservative' | 'balanced' | 'aggressive'
  }
}

/** Factory defaults for meeting transcription models (lowest common denominator). */
export const FACTORY_MEETING_WHISPER_ID = 'whisper-base-ggml'
export const FACTORY_MEETING_ASR_ID = 'qwen3-asr-0.6b-mlx-8bit'

/** Legacy factory defaults from before tier-aware selection. */
export const LEGACY_FACTORY_MEETING_WHISPER_ID = 'whisper-large-v3-turbo-ggml'
export const LEGACY_FACTORY_MEETING_ASR_ID = 'qwen3-asr-1.7b-mlx-8bit'

const schema = {
  theme: {
    type: 'string',
    enum: ['light', 'dark', 'system'],
    default: 'system'
  },
  editorFontSize: {
    type: 'number',
    minimum: 10,
    maximum: 24,
    default: 14
  },
  autoSave: {
    type: 'boolean',
    default: true
  },
  autoSaveInterval: {
    type: 'number',
    minimum: 1000,
    maximum: 60000,
    default: 5000
  },
  autoIndexNotes: {
    type: 'boolean',
    default: true
  },
  contextualRetrievalEnabled: {
    type: 'boolean',
    default: false
  },
  ragMultiSearch: {
    type: 'boolean',
    default: true
  },
  lastOpenedFolderId: {
    type: ['string', 'null'],
    default: null
  },
  windowBounds: {
    type: 'object',
    properties: {
      width: { type: 'number', default: 900 },
      height: { type: 'number', default: 670 },
      x: { type: 'number' },
      y: { type: 'number' }
    },
    default: { width: 900, height: 670 }
  },
  isMaximized: {
    type: 'boolean',
    default: true
  },
  recentNotes: {
    type: 'array',
    items: { type: 'string' },
    default: []
  },
  activeSpaceId: {
    type: ['string', 'null'],
    default: null
  },
  spacesInitialized: {
    type: 'boolean',
    default: false
  },
  onboardingCompleted: {
    type: 'boolean',
    default: false
  },
  aiChatPanelOpen: {
    type: 'boolean',
    default: false
  },
  aiChatPanelSize: {
    type: 'number',
    minimum: 20,
    maximum: 50,
    default: 35
  },
  sidebarWidth: {
    type: 'number',
    minimum: 220,
    maximum: 400,
    default: 256
  },
  editorMode: {
    type: 'string',
    enum: ['wysiwyg', 'source'],
    default: 'wysiwyg'
  },
  reduxSpacesCaches: {
    type: 'object',
    default: {}
  },
  // LEGACY: mantenute per migrazione
  reduxUIState: {
    type: 'object',
    properties: {
      expandedFolders: { type: 'array', items: { type: 'string' } },
      selectedNoteId: { type: ['string', 'null'] },
      selectedNoteFolderId: { type: ['string', 'null'] }
    },
    default: {
      expandedFolders: ['root'],
      selectedNoteId: null,
      selectedNoteFolderId: null
    }
  },
  reduxTreeCache: {
    type: 'object',
    properties: {
      folders: { type: 'object' },
      notes: { type: 'object' }
    },
    default: {
      folders: {},
      notes: {}
    }
  },
  meeting: {
    type: 'object',
    properties: {
      keepAudioAfterTranscription: { type: 'boolean', default: true },
      defaultRecordingMode: { type: 'string', enum: ['remote', 'in-person'], default: 'remote' },
      whisperModelId: { type: 'string', default: FACTORY_MEETING_WHISPER_ID },
      defaultLanguage: { type: 'string', default: 'auto' },
      realtimeTranscription: { type: 'string', enum: ['auto', 'off'], default: 'auto' },
      asrModelId: { type: 'string', default: FACTORY_MEETING_ASR_ID },
      summaryDepth: {
        type: 'string',
        enum: ['conservative', 'balanced', 'aggressive'],
        default: 'balanced'
      }
    },
    default: {
      keepAudioAfterTranscription: true,
      defaultRecordingMode: 'remote',
      whisperModelId: FACTORY_MEETING_WHISPER_ID,
      defaultLanguage: 'auto',
      realtimeTranscription: 'auto',
      asrModelId: FACTORY_MEETING_ASR_ID,
      summaryDepth: 'balanced'
    }
  }
} as const

export const configStore = new Store<AppConfig>({
  schema,
  name: 'config',
  clearInvalidConfig: true
})
