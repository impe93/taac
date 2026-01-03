import { ReactQueryDevtools as ReactQueryDevtoolsBase } from '@tanstack/react-query-devtools'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster } from './ui/sonner'
import React, { useEffect } from 'react'
import { SidebarProvider } from './ui/sidebar'
import { Provider as ReduxProvider } from 'react-redux'
import { store } from '@renderer/store'
import { useAppDispatch } from '@renderer/store/hooks'
import { hydrateUIState, hydrateFromCache, loadTree } from '@renderer/store/slices/notesTreeSlice'
import type { Note, FolderMetadata } from '@preload/types'
// https://tanstack.com/router/v1/docs/framework/react/devtools
const TanStackRouterDevtools = import.meta.env.PROD
  ? () => null
  : React.lazy(() =>
      import('@tanstack/router-devtools').then((res) => ({
        default: res.TanStackRouterDevtools
      }))
    )

const ReactQueryDevtools = import.meta.env.PROD ? () => null : ReactQueryDevtoolsBase

const queryClient = new QueryClient()

// Componente per inizializzare Redux all'avvio con hydration multi-stage
function ReduxInitializer({ children }: { children: React.ReactNode }): React.ReactElement {
  const dispatch = useAppDispatch()

  useEffect(() => {
    const initializeRedux = async (): Promise<void> => {
      try {
        // Stage 1: Fetch parallelo di cache e UI state
        const [cacheData, uiState] = await Promise.all([
          window.config.get('reduxTreeCache'),
          window.config.get('reduxUIState')
        ])

        // Validazione base del cache
        if (
          cacheData &&
          typeof cacheData === 'object' &&
          'folders' in cacheData &&
          'notes' in cacheData &&
          cacheData.folders &&
          cacheData.notes
        ) {
          // Dispatch hydration sincrona del cache
          dispatch(
            hydrateFromCache({
              folders: cacheData.folders as Record<string, FolderMetadata>,
              notes: cacheData.notes as Record<string, Note>,
              uiState: uiState || {
                expandedFolders: ['root'],
                selectedNoteId: null,
                selectedNoteFolderId: null
              }
            })
          )
        } else if (uiState) {
          // Cache non valido, ma UI state esiste → hydrate solo UI state
          dispatch(hydrateUIState(uiState))
        }

        // Stage 2: Background reconciliation con filesystem
        // loadTree.fulfilled gestirà il merge e la validazione
        dispatch(loadTree())
      } catch (error) {
        console.error('Redux initialization error:', error)
        // Fallback: esegui solo loadTree
        dispatch(loadTree())
      }
    }

    initializeRedux()
  }, [dispatch])

  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ReduxProvider store={store}>
      <ReduxInitializer>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <SidebarProvider>{children}</SidebarProvider>
            <Toaster
              toastOptions={{
                classNames: {
                  // !important to override: https://github.com/shadcn-ui/ui/issues/3579
                  error: '!border-none !bg-toast-error !text-foreground',
                  info: '!border-none !bg-toast-info !text-foreground',
                  loading: '!border-none !bg-toast-loading !text-foreground',
                  success: '!border-none !bg-toast-success !text-foreground',
                  warning: '!border-none !bg-toast-warning !text-foreground'
                }
              }}
            />
            <React.Suspense>
              <TanStackRouterDevtools position="top-right" />
              <ReactQueryDevtools buttonPosition="bottom-right" />
            </React.Suspense>
          </ThemeProvider>
        </QueryClientProvider>
      </ReduxInitializer>
    </ReduxProvider>
  )
}
