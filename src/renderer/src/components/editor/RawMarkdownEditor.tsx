import { type FC, useRef, useEffect } from 'react'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter
} from '@codemirror/view'
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language'
import { tags } from '@lezer/highlight'
import { useTheme } from 'next-themes'
import { cn } from '@renderer/lib/utils'

interface RawMarkdownEditorProps {
  markdown: string
  onChange: (markdown: string) => void
  className?: string
}

const lightHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: 'bold', fontSize: '1.5em' },
  { tag: tags.heading2, fontWeight: 'bold', fontSize: '1.3em' },
  { tag: tags.heading3, fontWeight: 'bold', fontSize: '1.15em' },
  { tag: tags.heading, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.keyword, color: '#8839ef' },
  { tag: tags.operator, color: '#179299' },
  { tag: tags.number, color: '#fe640b' },
  { tag: tags.string, color: '#40a02b' },
  { tag: tags.comment, color: '#9ca0b0', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#d20f39' },
  { tag: tags.definition(tags.variableName), color: '#1e66f5' },
  { tag: tags.function(tags.variableName), color: '#1e66f5' },
  { tag: tags.typeName, color: '#df8e1d' },
  { tag: tags.className, color: '#df8e1d' },
  { tag: tags.propertyName, color: '#d20f39' },
  { tag: tags.punctuation, color: '#4c4f69' },
  { tag: tags.meta, color: '#8839ef' },
  { tag: tags.bool, color: '#fe640b' },
  { tag: tags.null, color: '#fe640b' },
  { tag: tags.atom, color: '#fe640b' },
  { tag: tags.url, color: '#1e66f5', textDecoration: 'underline' },
  { tag: tags.link, color: '#1e66f5' },
  { tag: tags.processingInstruction, color: '#8839ef' },
  { tag: tags.contentSeparator, color: '#9ca0b0' },
  {
    tag: tags.monospace,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
  },
  { tag: tags.quote, color: '#6c6f85', fontStyle: 'italic' }
])

const darkHighlightStyle = HighlightStyle.define([
  { tag: tags.heading1, fontWeight: 'bold', fontSize: '1.5em' },
  { tag: tags.heading2, fontWeight: 'bold', fontSize: '1.3em' },
  { tag: tags.heading3, fontWeight: 'bold', fontSize: '1.15em' },
  { tag: tags.heading, fontWeight: 'bold' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strong, fontWeight: 'bold' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: tags.keyword, color: '#c678dd' },
  { tag: tags.operator, color: '#56b6c2' },
  { tag: tags.number, color: '#d19a66' },
  { tag: tags.string, color: '#98c379' },
  { tag: tags.comment, color: '#5c6370', fontStyle: 'italic' },
  { tag: tags.variableName, color: '#e06c75' },
  { tag: tags.definition(tags.variableName), color: '#61afef' },
  { tag: tags.function(tags.variableName), color: '#61afef' },
  { tag: tags.typeName, color: '#e5c07b' },
  { tag: tags.className, color: '#e5c07b' },
  { tag: tags.propertyName, color: '#e06c75' },
  { tag: tags.punctuation, color: '#abb2bf' },
  { tag: tags.meta, color: '#abb2bf' },
  { tag: tags.bool, color: '#d19a66' },
  { tag: tags.null, color: '#d19a66' },
  { tag: tags.atom, color: '#d19a66' },
  { tag: tags.url, color: '#61afef', textDecoration: 'underline' },
  { tag: tags.link, color: '#61afef' },
  { tag: tags.processingInstruction, color: '#c678dd' },
  { tag: tags.contentSeparator, color: '#5c6370' },
  {
    tag: tags.monospace,
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace'
  },
  { tag: tags.quote, color: '#7f848e', fontStyle: 'italic' }
])

const lightTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--background)',
    color: 'var(--foreground)'
  },
  '.cm-content': {
    caretColor: 'var(--foreground)',
    minHeight: '300px',
    padding: '8px 0',
    fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
    fontSize: '0.875rem',
    lineHeight: '1.6'
  },
  '.cm-cursor': {
    borderLeftColor: 'var(--foreground)'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--background)',
    borderRight: '1px solid var(--border)',
    color: 'var(--muted-foreground)'
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'var(--accent)'
  },
  '.cm-activeLine': {
    backgroundColor: 'var(--accent)'
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'oklch(from var(--primary) l c h / 0.2) !important'
  },
  '.cm-matchingBracket': {
    backgroundColor: 'oklch(from var(--primary) l c h / 0.2)',
    outline: '1px solid var(--primary)'
  },
  '.cm-scroller': {
    overflow: 'auto'
  }
})

const darkTheme = EditorView.theme(
  {
    '&': {
      backgroundColor: 'var(--background)',
      color: 'var(--foreground)'
    },
    '.cm-content': {
      caretColor: 'var(--foreground)',
      minHeight: '300px',
      padding: '8px 0',
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: '0.875rem',
      lineHeight: '1.6'
    },
    '.cm-cursor': {
      borderLeftColor: 'var(--foreground)'
    },
    '.cm-gutters': {
      backgroundColor: 'var(--background)',
      borderRight: '1px solid var(--border)',
      color: 'var(--muted-foreground)'
    },
    '.cm-activeLineGutter': {
      backgroundColor: 'var(--accent)'
    },
    '.cm-activeLine': {
      backgroundColor: 'var(--accent)'
    },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
      backgroundColor: 'oklch(from var(--primary) l c h / 0.2) !important'
    },
    '.cm-matchingBracket': {
      backgroundColor: 'oklch(from var(--primary) l c h / 0.2)',
      outline: '1px solid var(--primary)'
    },
    '.cm-scroller': {
      overflow: 'auto'
    }
  },
  { dark: true }
)

function getThemeExtensions(isDark: boolean): Extension[] {
  return isDark
    ? [darkTheme, syntaxHighlighting(darkHighlightStyle)]
    : [lightTheme, syntaxHighlighting(lightHighlightStyle)]
}

export const RawMarkdownEditor: FC<RawMarkdownEditorProps> = ({
  markdown: markdownContent,
  onChange,
  className
}) => {
  const containerRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const themeCompartment = useRef(new Compartment())
  const onChangeRef = useRef(onChange)
  const { resolvedTheme } = useTheme()

  // Keep onChange ref current
  onChangeRef.current = onChange

  // Create editor on mount
  useEffect(() => {
    if (!containerRef.current) return

    const isDark = resolvedTheme === 'dark'
    const [theme, highlighting] = getThemeExtensions(isDark)

    const state = EditorState.create({
      doc: markdownContent,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        bracketMatching(),
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        EditorView.lineWrapping,
        keymap.of([...defaultKeymap, ...historyKeymap]),
        themeCompartment.current.of([theme, highlighting]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            onChangeRef.current(update.state.doc.toString())
          }
        })
      ]
    })

    const view = new EditorView({
      state,
      parent: containerRef.current
    })

    viewRef.current = view

    return (): void => {
      view.destroy()
      viewRef.current = null
    }
    // Only create/destroy on mount/unmount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync external markdown changes (note navigation)
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const currentDoc = view.state.doc.toString()
    if (currentDoc !== markdownContent) {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: markdownContent }
      })
    }
  }, [markdownContent])

  // React to theme changes
  useEffect(() => {
    const view = viewRef.current
    if (!view) return

    const isDark = resolvedTheme === 'dark'
    const [theme, highlighting] = getThemeExtensions(isDark)

    view.dispatch({
      effects: themeCompartment.current.reconfigure([theme, highlighting])
    })
  }, [resolvedTheme])

  return <div ref={containerRef} className={cn('raw-markdown-editor', className)} />
}
