import { type FC, type ReactNode, useState } from 'react'
import { AlertCircle, ArrowLeft, FolderOpen, Loader2, Settings } from 'lucide-react'
import { toast } from 'sonner'
import type { ImportOptions } from '@preload/types'
import { Alert, AlertDescription, AlertTitle } from '@renderer/components/ui/alert'
import { Button } from '@renderer/components/ui/button'
import {
  useCheckAppleNotesAccess,
  useSelectImportFolder,
  useScanImport,
  useStartImport
} from '@renderer/hooks/useImport'
import type { OnboardingAction, OnboardingState } from './OnboardingWizard'
import { ImportPreview } from './ImportPreview'
import { ImportProgress } from './ImportProgress'
import { ImportSourceSelector } from './ImportSourceSelector'
import { ImportTargetSelector } from './ImportTargetSelector'

// =============================================================================
// Types
// =============================================================================

type ImportSubStep = 'source' | 'access-check' | 'folder-select' | 'target' | 'preview' | 'progress'

interface ImportStepProps {
  state: OnboardingState
  dispatch: React.Dispatch<OnboardingAction>
}

// =============================================================================
// Component
// =============================================================================

export const ImportStep: FC<ImportStepProps> = ({ state, dispatch }) => {
  const [subStep, setSubStep] = useState<ImportSubStep>('source')
  const [accessError, setAccessError] = useState<string | null>(null)

  // Hooks (must be at top level per rules of hooks)
  const checkAccess = useCheckAppleNotesAccess()
  const selectFolder = useSelectImportFolder()
  const scanImport = useScanImport()
  const { mutateAsync: startImport, progress, isPending: isImportPending } = useStartImport()

  const isChecking = checkAccess.isPending || scanImport.isPending
  const isSelectingFolder = selectFolder.isPending || scanImport.isPending

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  const handleSourceSelected = async (source: 'apple-notes' | 'obsidian'): Promise<void> => {
    dispatch({ type: 'SET_IMPORT_SOURCE', source })

    if (source === 'apple-notes') {
      setSubStep('access-check')
      setAccessError(null)

      try {
        const result = await checkAccess.mutateAsync()

        if (result.accessible && result.dbPath) {
          const scanResult = await scanImport.mutateAsync({
            sourcePath: result.dbPath,
            source: 'apple-notes'
          })
          dispatch({ type: 'SET_IMPORT_PATH', path: result.dbPath })
          dispatch({ type: 'SET_SCAN_RESULT', result: scanResult })
          setSubStep('target')
        } else {
          setAccessError(result.error ?? 'Full Disk Access is required to read Apple Notes.')
        }
      } catch (err) {
        setAccessError((err as Error).message)
      }
    } else {
      handleFolderSelect(source)
    }
  }

  const handleFolderSelect = async (source: 'apple-notes' | 'obsidian'): Promise<void> => {
    setSubStep('folder-select')

    try {
      const folderPath = await selectFolder.mutateAsync()

      if (!folderPath) {
        setSubStep('source')
        return
      }

      const scanResult = await scanImport.mutateAsync({ sourcePath: folderPath, source })
      dispatch({ type: 'SET_IMPORT_PATH', path: folderPath })
      dispatch({ type: 'SET_SCAN_RESULT', result: scanResult })
      setSubStep('target')
    } catch (err) {
      toast.error(`Failed to scan folder: ${(err as Error).message}`)
      setSubStep('source')
    }
  }

  const handleRetryAccessCheck = async (): Promise<void> => {
    setAccessError(null)

    try {
      const result = await checkAccess.mutateAsync()

      if (result.accessible && result.dbPath) {
        const scanResult = await scanImport.mutateAsync({
          sourcePath: result.dbPath,
          source: 'apple-notes'
        })
        dispatch({ type: 'SET_IMPORT_PATH', path: result.dbPath })
        dispatch({ type: 'SET_SCAN_RESULT', result: scanResult })
        setSubStep('target')
      } else {
        setAccessError(result.error ?? 'Full Disk Access is required to read Apple Notes.')
      }
    } catch (err) {
      setAccessError((err as Error).message)
    }
  }

  const handleFallbackToFolder = (): void => {
    handleFolderSelect(state.import.source ?? 'apple-notes')
  }

  const handleSkipImport = (): void => {
    dispatch({ type: 'SKIP_IMPORT' })
  }

  const handleTargetContinue = (): void => {
    setSubStep('preview')
  }

  const handleTargetBack = (): void => {
    dispatch({ type: 'GO_BACK_IMPORT' })
    setSubStep('source')
  }

  const handlePreviewBack = (): void => {
    setSubStep('target')
  }

  const handleStartImport = async (): Promise<void> => {
    const importState = state.import
    const options: ImportOptions = {
      source: importState.source!,
      sourcePath: importState.sourcePath!,
      targetMode: importState.targetMode!,
      targetSpaceId:
        importState.targetMode === 'existing-space' ? importState.targetSpaceId! : undefined,
      newSpaceName: importState.targetMode === 'new-space' ? importState.newSpaceName : undefined,
      newSpaceIcon:
        importState.targetMode === 'new-space' ? importState.newSpaceIcon || undefined : undefined
    }

    dispatch({ type: 'SET_IMPORTING', value: true })
    setSubStep('progress')

    try {
      const result = await startImport(options)
      dispatch({ type: 'SET_IMPORT_RESULT', result })
    } catch (err) {
      toast.error(`Import failed: ${(err as Error).message}`)
    } finally {
      dispatch({ type: 'SET_IMPORTING', value: false })
    }
  }

  const handleImportComplete = (): void => {
    dispatch({ type: 'NEXT_STEP' })
  }

  const handleBackToSource = (): void => {
    dispatch({ type: 'GO_BACK_IMPORT' })
    setSubStep('source')
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const renderSubStep = (): ReactNode => {
    switch (subStep) {
      case 'source':
        return (
          <ImportSourceSelector onSourceSelected={handleSourceSelected} onSkip={handleSkipImport} />
        )

      case 'access-check':
        return (
          <div className="flex flex-col items-center space-y-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
              {isChecking ? (
                <Loader2 className="size-8 animate-spin text-primary" />
              ) : (
                <AlertCircle className="size-8 text-destructive" />
              )}
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">
                {isChecking ? 'Checking Access' : 'Permission Required'}
              </h1>
              <p className="text-lg text-muted-foreground">
                {isChecking
                  ? 'Checking Apple Notes access...'
                  : 'TaacNotes needs permission to read your Apple Notes.'}
              </p>
            </div>

            {accessError && (
              <>
                <Alert variant="destructive" className="text-left">
                  <AlertCircle className="size-4" />
                  <AlertTitle>Full Disk Access Required</AlertTitle>
                  <AlertDescription>{accessError}</AlertDescription>
                </Alert>

                <div className="flex flex-wrap items-center justify-center gap-3">
                  <Button variant="ghost" onClick={handleBackToSource}>
                    <ArrowLeft className="size-4" />
                    Back
                  </Button>
                  <Button onClick={() => window.import.openSystemSettings()}>
                    <Settings className="size-4" />
                    Open System Settings
                  </Button>
                  <Button variant="outline" onClick={handleRetryAccessCheck}>
                    Retry
                  </Button>
                  <Button variant="ghost" onClick={handleFallbackToFolder}>
                    <FolderOpen className="size-4" />
                    Select folder manually
                  </Button>
                </div>
              </>
            )}
          </div>
        )

      case 'folder-select':
        return (
          <div className="flex flex-col items-center space-y-6 text-center">
            <div className="flex size-16 items-center justify-center rounded-2xl bg-primary/10">
              <Loader2 className="size-8 animate-spin text-primary" />
            </div>

            <div className="space-y-2">
              <h1 className="text-3xl font-bold tracking-tight">Select Folder</h1>
              <p className="text-lg text-muted-foreground">
                {isSelectingFolder && scanImport.isPending
                  ? 'Scanning files...'
                  : 'Select your vault folder...'}
              </p>
            </div>
          </div>
        )

      case 'target':
        return (
          <ImportTargetSelector
            state={state}
            dispatch={dispatch}
            onContinue={handleTargetContinue}
            onBack={handleTargetBack}
          />
        )

      case 'preview':
        return (
          <ImportPreview
            scanResult={state.import.scanResult!}
            state={state}
            onStartImport={handleStartImport}
            onBack={handlePreviewBack}
            isStarting={isImportPending && !progress}
          />
        )

      case 'progress':
        return (
          <ImportProgress
            progress={progress}
            importResult={state.import.importResult}
            onComplete={handleImportComplete}
          />
        )

      default:
        return null
    }
  }

  return renderSubStep()
}
