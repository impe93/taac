import Store from 'electron-store'

export interface AppConfig {
  theme: 'light' | 'dark' | 'system'
  editorFontSize: number
  autoSave: boolean
  autoSaveInterval: number
  lastOpenedFolderId: string | null
  windowBounds: {
    width: number
    height: number
    x?: number
    y?: number
  }
  recentNotes: string[]
  activeSpaceId: string | null
  spacesInitialized: boolean
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
  }
} as const

export const configStore = new Store<AppConfig>({
  schema,
  name: 'config',
  clearInvalidConfig: true
})
