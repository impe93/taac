import { type ReactElement, useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useAppSelector, useAppDispatch, useAppStore } from '@renderer/store/hooks'
import {
  selectNoteById,
  selectOpenTabs,
  selectActiveSpaceState,
  openTab
} from '@renderer/store/slices/notesTreeSlice'
import { NotePane } from '@renderer/components/editor/NotePane'
import { cn } from '@renderer/lib/utils'

export const Route = createFileRoute('/note/$noteId')({
  component: NoteView
})

/**
 * Contenitore delle schede note. TanStack Router NON rimonta questo componente al
 * cambio del solo path-param `$noteId`, quindi ospita il pool di editor persistenti:
 * ogni scheda aperta viene montata alla PRIMA attivazione (lazy-mount) e poi tenuta
 * viva (keep-alive), nascondendo i pane non attivi. Così il cambio scheda non rimonta
 * gli editor (scroll/cursore preservati) e all'avvio si monta solo la scheda con focus.
 */
function NoteView(): ReactElement {
  const { noteId } = Route.useParams()
  const dispatch = useAppDispatch()
  const store = useAppStore()
  const openTabs = useAppSelector(selectOpenTabs)
  const note = useAppSelector(selectNoteById(noteId))

  // Riconciliazione: qualsiasi ingresso alla rotta (deep-link, ⌘K, ripristino)
  // garantisce che la nota corrente sia aperta in scheda e abbia il focus.
  // Dipende SOLO dal param di rotta (via `noteId`/`note`), NON da openTabs/selectedNoteId:
  // durante la chiusura di una scheda quei valori cambiano prima che la navigazione
  // asincrona aggiorni il param, e reagire ad essi ri-aprirebbe la scheda appena chiusa.
  useEffect(() => {
    if (!note) return
    const space = selectActiveSpaceState(store.getState())
    const isOpen = space?.openTabs.includes(noteId) ?? false
    const isFocused = space?.selectedNoteId === noteId
    if (!isOpen || !isFocused) {
      dispatch(openTab({ noteId, folderId: note.folderId }))
    }
  }, [dispatch, store, noteId, note])

  // Lazy-mount: traccia gli ID già attivati almeno una volta in questa sessione di rotta.
  const [activatedIds, setActivatedIds] = useState<string[]>(() => [noteId])
  useEffect(() => {
    setActivatedIds((prev) => (prev.includes(noteId) ? prev : [...prev, noteId]))
  }, [noteId])

  // Renderizza solo le schede ancora aperte e già attivate (keep-alive).
  const panesToRender = activatedIds.filter((id) => openTabs.includes(id))
  const activeIsRendered = panesToRender.includes(noteId)

  return (
    <>
      {panesToRender.map((id) => (
        <div key={id} className={cn('h-full w-full', id === noteId ? '' : 'hidden')}>
          <NotePane noteId={id} />
        </div>
      ))}
      {/* La nota di rotta non esiste (o non è ancora idratata): mostra il fallback */}
      {!activeIsRendered && (
        <div className="flex items-center justify-center h-full">
          <p className="text-muted-foreground">Note not found</p>
        </div>
      )}
    </>
  )
}
