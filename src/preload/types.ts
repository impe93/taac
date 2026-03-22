// Type definitions for file system entities
export interface Note {
  id: string
  folderId: string
  content: string // Markdown content
  createdAt: string
  updatedAt: string
  title: string
  type: 'note' | 'meeting'
  meetingMetadata?: MeetingMetadata
}

export interface MeetingMetadata {
  recordingMode: 'remote' | 'in-person'
  duration: number // Recording duration in seconds
  language: string // ISO 639-1 code (auto-detected)
  recordingDate: string // ISO 8601 timestamp
  speakers: Speaker[]
  transcription: TranscriptionSegment[]
  actionItems: ActionItem[]
  audioFileId?: string // Present if user chose to keep audio
}

export interface Speaker {
  id: string // e.g. 'speaker-0', 'speaker-1'
  label: string // e.g. 'You', 'Speaker 1', or user-assigned name
  totalSpeakingTime: number // Seconds
}

export interface TranscriptionSegment {
  speakerId: string
  startTime: number // Seconds from recording start
  endTime: number
  text: string
}

export interface ActionItem {
  id: string
  text: string
  assignee?: string // Speaker label, if identifiable from context
  completed: boolean
}

export interface FolderMetadata {
  id: string
  name: string
  parentId: string | null
  children: string[]
  createdAt: string
  updatedAt: string
  noteIds: string[]
}

export interface Asset {
  id: string
  originalName: string
  type: 'image' | 'pdf' | 'attachment'
  path: string
  size: number
  createdAt: string
}

// Cross-space move result types
export interface MoveFolderToSpaceResult {
  folders: Record<string, FolderMetadata>
  notes: Record<string, Note>
  topFolderId: string
}

// Space type
export interface Space {
  id: string
  name: string
  icon: string
  createdAt: string
  updatedAt: string
  order: number
}

// Import types re-exported for renderer consumption
export type {
  ImportSource,
  ImportOptions,
  ImportScanResult,
  ImportResult,
  ImportProgressEvent
} from '../main/import/types'

// App configuration type
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
  // Meeting Notes settings
  meeting: {
    keepAudioAfterTranscription: boolean
    defaultRecordingMode: 'remote' | 'in-person'
    whisperModelId: string
  }
}
