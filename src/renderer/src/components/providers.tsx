import { ReactQueryDevtools as ReactQueryDevtoolsBase } from '@tanstack/react-query-devtools'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ThemeProvider } from 'next-themes'
import { Toaster } from './ui/sonner'
import React, { useEffect } from 'react'
import { SidebarProvider } from './ui/sidebar'
import { Provider as ReduxProvider } from 'react-redux'
import { store } from '@renderer/store'
import { useAppDispatch } from '@renderer/store/hooks'
import { hydrateUIState, loadTree } from '@renderer/store/slices/notesTreeSlice'
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

// Componente per inizializzare Redux all'avvio
function ReduxInitializer({ children }: { children: React.ReactNode }): React.ReactElement {
  const dispatch = useAppDispatch()

  useEffect(() => {
    // 1. Hydrate UI state da electron-store
    window.config
      .get('reduxUIState')
      .then((uiState) => {
        if (uiState) {
          dispatch(hydrateUIState(uiState))
        }
      })
      .catch(console.error)

    // 2. Carica tree completo (eager loading)
    dispatch(loadTree())
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
