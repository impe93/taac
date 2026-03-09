import { useConfig, useSetConfig } from './useConfig'
import { useCallback } from 'react'

interface UseEditorModeReturn {
  isSourceMode: boolean
  toggle: () => void
  isLoading: boolean
}

export function useEditorMode(): UseEditorModeReturn {
  const { data: mode, isLoading } = useConfig('editorMode')
  const setConfig = useSetConfig()

  const toggle = useCallback((): void => {
    const newMode = mode === 'source' ? 'wysiwyg' : 'source'
    setConfig.mutate({ key: 'editorMode', value: newMode })
  }, [mode, setConfig])

  return { isSourceMode: mode === 'source', toggle, isLoading }
}
