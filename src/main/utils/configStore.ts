import Store from 'electron-store'

export interface AppConfig {
  theme: 'light' | 'dark' | 'system'
  editorFontSize: number
  autoSave: boolean
  autoSaveInterval: number
  autoIndexNotes: boolean
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
}

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
  }
} as const

export const configStore = new Store<AppConfig>({
  schema,
  name: 'config',
  clearInvalidConfig: true
})
