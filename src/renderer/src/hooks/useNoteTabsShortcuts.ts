import { useEffect } from 'react'
import { useNoteTabs } from '@renderer/hooks/useNoteTabs'

/**
 * Scorciatoie da tastiera per le schede note:
 * - ⌘/Ctrl + W        chiude la scheda attiva
 * - ⌘/Ctrl + 1..9     va alla scheda N (9 = ultima)
 * - ⌘/Ctrl + ⇧ + [    scheda precedente
 * - ⌘/Ctrl + ⇧ + ]    scheda successiva
 */
export function useNoteTabsShortcuts(): void {
  const { openTabs, focusIndex, focusNext, focusPrev, closeActive } = useNoteTabs()

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent): void => {
      const mod = e.metaKey || e.ctrlKey
      if (!mod) return
      if (openTabs.length === 0) return

      // ⌘⇧[ / ⌘⇧] — scheda precedente/successiva (usa e.code per ignorare il layout)
      if (e.shiftKey && (e.code === 'BracketLeft' || e.code === 'BracketRight')) {
        e.preventDefault()
        if (e.code === 'BracketLeft') focusPrev()
        else focusNext()
        return
      }

      if (e.shiftKey) return

      // ⌘1..9 — vai alla scheda N (9 = ultima)
      if (e.code.startsWith('Digit')) {
        const digit = Number(e.code.slice(5))
        if (digit >= 1 && digit <= 9) {
          e.preventDefault()
          focusIndex(digit === 9 ? Number.MAX_SAFE_INTEGER : digit - 1)
        }
        return
      }

      // ⌘W — chiudi la scheda attiva
      if (e.key.toLowerCase() === 'w') {
        e.preventDefault()
        closeActive()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openTabs.length, focusIndex, focusNext, focusPrev, closeActive])
}
