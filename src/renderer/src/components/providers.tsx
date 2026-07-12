// import { ReactQueryDevtools as ReactQueryDevtoolsBase } from '@tanstack/react-query-devtools'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster } from './ui/sonner'
import React, { useEffect } from 'react'
import { SidebarProvider } from './ui/sidebar'
import { useSidebarWidth } from '@renderer/hooks/useSidebarWidth'
import { Provider as ReduxProvider } from 'react-redux'
import { store } from '@renderer/store'
import { useAppDispatch } from '@renderer/store/hooks'
import {
  hydrateAllSpacesFromCache,
  switchActiveSpace,
  loadTree
} from '@renderer/store/slices/notesTreeSlice'
import type { FolderMetadata, Note } from '@preload/types'
import { useNavigate } from '@tanstack/react-router'
import { MeetingLifecycleProvider } from '@renderer/components/meeting/MeetingLifecycleProvider'
import { DownloadProvider } from '@renderer/components/models/DownloadProvider'

// Type alias per la struttura della cache multi-spazio
type SpacesCacheStructure = Record<
  string,
  {
    tree: {
      folders: Record<string, FolderMetadata>
      notes: Record<string, Note>
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

// https://tanstack.com/router/v1/docs/framework/react/devtools
// const TanStackRouterDevtools = import.meta.env.PROD
//   ? () => null
//   : React.lazy(() =>
//       import('@tanstack/router-devtools').then((res) => ({
//         default: res.TanStackRouterDevtools
//       }))
//     )

// const ReactQueryDevtools = import.meta.env.PROD ? () => null : ReactQueryDevtoolsBase

const queryClient = new QueryClient()

/**
 * Migra cache legacy (reduxTreeCache + reduxUIState) alla nuova struttura multi-spazio
 */
async function migrateFromLegacy(activeSpaceId: string): Promise<SpacesCacheStructure | undefined> {
  try {
    const [legacyTree, legacyUI] = await Promise.all([
      window.config.get('reduxTreeCache'),
      window.config.get('reduxUIState')
    ])

    if (!legacyTree && !legacyUI) return undefined

    console.log('Migrating legacy Redux cache to multi-space structure...')

    // Crea nuova struttura con legacy data sotto l'activeSpaceId
    const newCache: SpacesCacheStructure = {
      [activeSpaceId]: {
        tree: {
          folders:
            legacyTree && typeof legacyTree === 'object' && 'folders' in legacyTree
              ? (legacyTree.folders as Record<string, FolderMetadata>)
              : {},
          notes:
            legacyTree && typeof legacyTree === 'object' && 'notes' in legacyTree
              ? (legacyTree.notes as Record<string, Note>)
              : {}
        },
        ui: {
          expandedFolders:
            legacyUI && typeof legacyUI === 'object' && 'expandedFolders' in legacyUI
              ? (legacyUI.expandedFolders as string[])
              : ['root'],
          selectedNoteId:
            legacyUI && typeof legacyUI === 'object' && 'selectedNoteId' in legacyUI
              ? (legacyUI.selectedNoteId as string | null)
              : null,
          selectedNoteFolderId:
            legacyUI && typeof legacyUI === 'object' && 'selectedNoteFolderId' in legacyUI
              ? (legacyUI.selectedNoteFolderId as string | null)
              : null
        },
        metadata: {
          lastSaved: new Date().toISOString(),
          version: 1
        }
      }
    }

    // Salva nuova struttura
    await window.config.set('reduxSpacesCaches', newCache)

    // Elimina chiavi legacy
    await Promise.all([
      window.config.set('reduxTreeCache', undefined),
      window.config.set('reduxUIState', undefined)
    ])

    console.log('Migration complete!')
    return newCache
  } catch (error) {
    console.error('Migration failed:', error)
    return undefined
  }
}

// Componente per inizializzare Redux all'avvio con hydration multi-stage
function ReduxInitializer({ children }: { children: React.ReactNode }): React.ReactElement {
  const dispatch = useAppDispatch()
  const navigate = useNavigate()

  useEffect(() => {
    const initializeRedux = async (): Promise<void> => {
      try {
        // Get active space ID and onboarding status in parallel
        const [activeSpaceId, onboardingCompleted] = await Promise.all([
          window.config.get('activeSpaceId'),
          window.config.get('onboardingCompleted')
        ])

        if (!activeSpaceId) {
          console.warn('No active space ID found')
          return
        }

        // Stage 1: Carica cache (prova nuova struttura, poi migrazione)
        let spacesCache = await window.config.get('reduxSpacesCaches')

        if (!spacesCache || typeof spacesCache !== 'object') {
          // Tenta migrazione da legacy
          spacesCache = await migrateFromLegacy(activeSpaceId)
        }

        let lastNoteId: string | null = null

        if (spacesCache && typeof spacesCache === 'object') {
          // Dispatch hydration di TUTTI gli spazi
          dispatch(
            hydrateAllSpacesFromCache({
              spacesCache: spacesCache as SpacesCacheStructure,
              activeSpaceId
            })
          )

          // Recupera l'ultima nota aperta dall'active space cache
          const activeSpaceCache = (spacesCache as SpacesCacheStructure)[activeSpaceId]
          lastNoteId = activeSpaceCache?.ui?.selectedNoteId ?? null
        } else {
          // Nessuna cache trovata, imposta solo activeSpaceId
          dispatch(switchActiveSpace(activeSpaceId))
        }

        // Naviga all'ultima nota aperta se l'onboarding è completato e la nota esiste in cache
        if (onboardingCompleted && lastNoteId) {
          const activeSpaceCache = (spacesCache as SpacesCacheStructure)?.[activeSpaceId]
          const noteExistsInCache = !!activeSpaceCache?.tree?.notes?.[lastNoteId]

          if (noteExistsInCache) {
            navigate({ to: '/note/$noteId', params: { noteId: lastNoteId } })
          }
        }

        // Stage 2: Riconcilia solo spazio attivo con filesystem
        dispatch(loadTree({ spaceId: activeSpaceId }))
      } catch (error) {
        console.error('Redux initialization error:', error)
        // Fallback: carica da filesystem se esiste activeSpaceId
        window.config
          .get('activeSpaceId')
          .then((activeSpaceId) => {
            if (activeSpaceId) {
              dispatch(switchActiveSpace(activeSpaceId))
              dispatch(loadTree({ spaceId: activeSpaceId }))
            }
          })
          .catch(console.error)
      }
    }

    initializeRedux()
  }, [dispatch, navigate])

  return <>{children}</>
}

// Wraps the Shadcn SidebarProvider with width persisted to electron-store.
// Must live inside QueryClientProvider because useSidebarWidth uses TanStack Query.
function PersistentSidebarProvider({
  children
}: {
  children: React.ReactNode
}): React.ReactElement {
  const { width, setWidth } = useSidebarWidth()

  return (
    <SidebarProvider defaultWidth={width} onWidthChange={setWidth}>
      {children}
    </SidebarProvider>
  )
}

export function Providers({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <ReduxProvider store={store}>
      <ReduxInitializer>
        <QueryClientProvider client={queryClient}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <DownloadProvider>
              <PersistentSidebarProvider>
                <MeetingLifecycleProvider>{children}</MeetingLifecycleProvider>
              </PersistentSidebarProvider>
            </DownloadProvider>
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
            {/* <React.Suspense>
              <TanStackRouterDevtools position="top-right" />
              <ReactQueryDevtools buttonPosition="bottom-right" />
            </React.Suspense> */}
          </ThemeProvider>
        </QueryClientProvider>
      </ReduxInitializer>
    </ReduxProvider>
  )
}
