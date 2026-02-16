import { type FC, type ReactNode, useReducer } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { ImportScanResult, ImportResult } from '@preload/types'
import { Badge } from '@renderer/components/ui/badge'
import { Button } from '@renderer/components/ui/button'
import { ImportSourceSelector } from './ImportSourceSelector'
import { ImportTargetSelector } from './ImportTargetSelector'
import { OnboardingComplete } from './OnboardingComplete'
import { TutorialStep } from './TutorialStep'
import { WelcomeStep } from './WelcomeStep'

// =============================================================================
// Types (exported for child step components)
// =============================================================================

export type OnboardingStep = 'welcome' | 'import' | 'models' | 'tutorial' | 'complete'

export interface OnboardingState {
  currentStep: OnboardingStep

  import: {
    subStep: 'source' | 'target'
    source: 'apple-notes' | 'obsidian' | null
    sourcePath: string | null
    targetMode: 'new-space' | 'existing-space' | null
    targetSpaceId: string | null
    newSpaceName: string
    newSpaceIcon: string
    scanResult: ImportScanResult | null
    importResult: ImportResult | null
    isImporting: boolean
    skipped: boolean
  }

  models: {
    chatModelDownloaded: boolean
    embeddingModelDownloaded: boolean
    skipped: boolean
  }
}

export type OnboardingAction =
  | { type: 'NEXT_STEP' }
  | { type: 'GO_TO_STEP'; step: OnboardingStep }
  | { type: 'SET_IMPORT_SOURCE'; source: 'apple-notes' | 'obsidian' }
  | { type: 'SET_IMPORT_PATH'; path: string }
  | { type: 'SET_IMPORT_TARGET'; mode: 'new-space' | 'existing-space'; spaceId?: string }
  | { type: 'SET_NEW_SPACE_NAME'; name: string }
  | { type: 'GO_BACK_IMPORT' }
  | { type: 'SET_SCAN_RESULT'; result: ImportScanResult }
  | { type: 'SET_IMPORT_RESULT'; result: ImportResult }
  | { type: 'SET_IMPORTING'; value: boolean }
  | { type: 'SKIP_IMPORT' }
  | { type: 'SET_MODEL_STATUS'; chat: boolean; embedding: boolean }
  | { type: 'SKIP_MODELS' }
  | { type: 'COMPLETE' }

// =============================================================================
// Reducer
// =============================================================================

const STEP_ORDER: OnboardingStep[] = ['welcome', 'import', 'models', 'tutorial', 'complete']

const initialState: OnboardingState = {
  currentStep: 'welcome',
  import: {
    subStep: 'source',
    source: null,
    sourcePath: null,
    targetMode: null,
    targetSpaceId: null,
    newSpaceName: '',
    newSpaceIcon: '',
    scanResult: null,
    importResult: null,
    isImporting: false,
    skipped: false
  },
  models: {
    chatModelDownloaded: false,
    embeddingModelDownloaded: false,
    skipped: false
  }
}

function onboardingReducer(state: OnboardingState, action: OnboardingAction): OnboardingState {
  switch (action.type) {
    case 'NEXT_STEP': {
      const currentIndex = STEP_ORDER.indexOf(state.currentStep)
      const nextStep = STEP_ORDER[currentIndex + 1]
      if (!nextStep) return state
      return { ...state, currentStep: nextStep }
    }
    case 'GO_TO_STEP':
      return { ...state, currentStep: action.step }
    case 'SET_IMPORT_SOURCE':
      return {
        ...state,
        import: {
          ...state.import,
          source: action.source,
          subStep: 'target',
          newSpaceName: action.source === 'apple-notes' ? 'Apple Notes' : 'Obsidian'
        }
      }
    case 'SET_IMPORT_PATH':
      return { ...state, import: { ...state.import, sourcePath: action.path } }
    case 'SET_IMPORT_TARGET':
      return {
        ...state,
        import: {
          ...state.import,
          targetMode: action.mode,
          targetSpaceId: action.spaceId ?? null
        }
      }
    case 'SET_NEW_SPACE_NAME':
      return { ...state, import: { ...state.import, newSpaceName: action.name } }
    case 'GO_BACK_IMPORT': {
      if (state.import.subStep === 'target') {
        return {
          ...state,
          import: {
            ...state.import,
            subStep: 'source',
            source: null,
            targetMode: null,
            targetSpaceId: null,
            newSpaceName: ''
          }
        }
      }
      return state
    }
    case 'SET_SCAN_RESULT':
      return { ...state, import: { ...state.import, scanResult: action.result } }
    case 'SET_IMPORT_RESULT':
      return { ...state, import: { ...state.import, importResult: action.result } }
    case 'SET_IMPORTING':
      return { ...state, import: { ...state.import, isImporting: action.value } }
    case 'SKIP_IMPORT': {
      const currentIndex = STEP_ORDER.indexOf(state.currentStep)
      const nextStep = STEP_ORDER[currentIndex + 1]
      return {
        ...state,
        currentStep: nextStep ?? state.currentStep,
        import: { ...state.import, skipped: true }
      }
    }
    case 'SET_MODEL_STATUS':
      return {
        ...state,
        models: {
          ...state.models,
          chatModelDownloaded: action.chat,
          embeddingModelDownloaded: action.embedding
        }
      }
    case 'SKIP_MODELS': {
      const currentIndex = STEP_ORDER.indexOf(state.currentStep)
      const nextStep = STEP_ORDER[currentIndex + 1]
      return {
        ...state,
        currentStep: nextStep ?? state.currentStep,
        models: { ...state.models, skipped: true }
      }
    }
    case 'COMPLETE':
      return { ...state, currentStep: 'complete' }
    default:
      return state
  }
}

// =============================================================================
// Step indicator config
// =============================================================================

const STEP_CONFIG: { step: OnboardingStep; label: string }[] = [
  { step: 'welcome', label: 'Welcome' },
  { step: 'import', label: 'Import' },
  { step: 'models', label: 'AI Models' },
  { step: 'tutorial', label: 'Tutorial' },
  { step: 'complete', label: 'Complete' }
]

function getStepVariant(
  step: OnboardingStep,
  currentStep: OnboardingStep
): 'default' | 'secondary' | 'outline' {
  if (step === currentStep) return 'default'
  const stepIndex = STEP_ORDER.indexOf(step)
  const currentIndex = STEP_ORDER.indexOf(currentStep)
  if (stepIndex < currentIndex) return 'secondary'
  return 'outline'
}

// =============================================================================
// Component
// =============================================================================

export const OnboardingWizard: FC = () => {
  const [state, dispatch] = useReducer(onboardingReducer, initialState)
  const navigate = useNavigate()

  const handleSkipSetup = async (): Promise<void> => {
    await window.config.set('onboardingCompleted', true)
    const spaces = await window.space.list()
    if (spaces.length === 0) {
      await window.space.create('Personal', 'Home')
    }
    navigate({ to: '/' })
  }

  const renderStep = (): ReactNode => {
    switch (state.currentStep) {
      case 'welcome':
        return <WelcomeStep dispatch={dispatch} />
      case 'import':
        switch (state.import.subStep) {
          case 'source':
            return <ImportSourceSelector dispatch={dispatch} />
          case 'target':
            return <ImportTargetSelector state={state} dispatch={dispatch} />
          default:
            return null
        }
      case 'models':
        return <div className="text-center text-muted-foreground">Models step placeholder</div>
      case 'tutorial':
        return <TutorialStep dispatch={dispatch} />
      case 'complete':
        return <OnboardingComplete state={state} dispatch={dispatch} />
      default:
        return null
    }
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="w-full max-w-2xl space-y-8">
        <div className="flex items-center justify-center gap-2">
          {STEP_CONFIG.map(({ step, label }) => (
            <Badge key={step} variant={getStepVariant(step, state.currentStep)}>
              {label}
            </Badge>
          ))}
        </div>

        {renderStep()}

        <div className="flex justify-center">
          <Button variant="ghost" size="sm" onClick={handleSkipSetup}>
            Skip setup
          </Button>
        </div>
      </div>
    </div>
  )
}
