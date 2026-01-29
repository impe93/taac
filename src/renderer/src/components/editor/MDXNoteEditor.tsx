import { type FC, useCallback, useRef, useEffect } from 'react'
import {
  MDXEditor,
  type MDXEditorMethods,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  imagePlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  CodeToggle,
  ListsToggle,
  BlockTypeSelect,
  CreateLink,
  InsertImage,
  InsertTable,
  InsertThematicBreak,
  InsertCodeBlock,
  ChangeCodeMirrorLanguage,
  ConditionalContents,
  Separator
} from '@mdxeditor/editor'
import '@mdxeditor/editor/style.css'
import { useTheme } from 'next-themes'
import { cn } from '@renderer/lib/utils'

interface MDXNoteEditorProps {
  markdown: string
  onChange: (markdown: string) => void
  spaceId: string | null
  className?: string
  readOnly?: boolean
}

/**
 * Normalize URL by adding https:// protocol if missing
 */
function normalizeUrl(url: string): string {
  const trimmedUrl = url.trim()

  // Already has a protocol
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmedUrl)) {
    return trimmedUrl
  }

  // Email address (mailto:)
  if (trimmedUrl.includes('@') && !trimmedUrl.includes('/')) {
    return `mailto:${trimmedUrl}`
  }

  // Add https:// for regular URLs
  return `https://${trimmedUrl}`
}

export const MDXNoteEditor: FC<MDXNoteEditorProps> = ({
  markdown,
  onChange,
  spaceId,
  className,
  readOnly = false
}) => {
  const { resolvedTheme } = useTheme()
  const editorRef = useRef<MDXEditorMethods>(null)
  const isDark = resolvedTheme === 'dark'

  // Update editor content when markdown prop changes externally
  useEffect(() => {
    if (editorRef.current) {
      const currentMarkdown = editorRef.current.getMarkdown()
      if (currentMarkdown !== markdown) {
        editorRef.current.setMarkdown(markdown)
      }
    }
  }, [markdown])

  const handleChange = useCallback(
    (newMarkdown: string): void => {
      onChange(newMarkdown)
    },
    [onChange]
  )

  // Image upload handler - saves to local file system
  const imageUploadHandler = useCallback(
    async (file: File): Promise<string> => {
      if (!spaceId) {
        console.error('Cannot upload image: no active space')
        throw new Error('No active space')
      }

      try {
        // Convert File to Uint8Array
        const arrayBuffer = await file.arrayBuffer()
        const uint8Array = new Uint8Array(arrayBuffer)

        // Save asset to file system
        const asset = await window.fileSystem.saveAsset(spaceId, file.name, uint8Array, 'image')

        // Extract filename from the full path
        const filename = asset.path.split('/').pop() || asset.id

        // Return custom protocol URL for Electron
        // Format: taac-asset://spaceId/images/filename
        return `taac-asset://${spaceId}/images/${filename}`
      } catch (error) {
        console.error('Failed to upload image:', error)
        throw error
      }
    },
    [spaceId]
  )

  // Handle link clicks - normalize URLs and open in external browser
  const handleLinkClick = useCallback((url: string): void => {
    const normalizedUrl = normalizeUrl(url)
    // Open in external browser using shell.openExternal via IPC
    window.electron.ipcRenderer.invoke('shell:openExternal', normalizedUrl)
  }, [])

  // Build plugins array
  const plugins = [
    headingsPlugin(),
    listsPlugin(),
    quotePlugin(),
    thematicBreakPlugin(),
    linkPlugin(),
    linkDialogPlugin({
      linkAutocompleteSuggestions: [
        'https://github.com',
        'https://google.com',
        'https://stackoverflow.com'
      ],
      onClickLinkCallback: handleLinkClick
    }),
    tablePlugin(),
    imagePlugin({
      imageUploadHandler,
      disableImageResize: false
    }),
    codeBlockPlugin({ defaultCodeBlockLanguage: 'javascript' }),
    codeMirrorPlugin({
      codeBlockLanguages: {
        js: 'JavaScript',
        javascript: 'JavaScript',
        ts: 'TypeScript',
        typescript: 'TypeScript',
        tsx: 'TypeScript (React)',
        jsx: 'JavaScript (React)',
        css: 'CSS',
        html: 'HTML',
        python: 'Python',
        py: 'Python',
        json: 'JSON',
        bash: 'Bash',
        sh: 'Shell',
        markdown: 'Markdown',
        md: 'Markdown',
        sql: 'SQL',
        yaml: 'YAML',
        yml: 'YAML',
        xml: 'XML',
        rust: 'Rust',
        go: 'Go',
        java: 'Java',
        c: 'C',
        cpp: 'C++',
        csharp: 'C#',
        php: 'PHP',
        ruby: 'Ruby',
        swift: 'Swift',
        kotlin: 'Kotlin',
        '': 'Plain Text'
      }
    }),
    markdownShortcutPlugin()
  ]

  // Add toolbar only if not read-only
  if (!readOnly) {
    plugins.push(
      toolbarPlugin({
        toolbarContents: () => (
          <ConditionalContents
            options={[
              {
                when: (editor) => editor?.editorType === 'codeblock',
                contents: () => <ChangeCodeMirrorLanguage />
              },
              {
                fallback: () => (
                  <>
                    <UndoRedo />
                    <Separator />
                    <BoldItalicUnderlineToggles />
                    <CodeToggle />
                    <Separator />
                    <ListsToggle />
                    <Separator />
                    <BlockTypeSelect />
                    <Separator />
                    <CreateLink />
                    <InsertImage />
                    <InsertTable />
                    <InsertCodeBlock />
                    <InsertThematicBreak />
                  </>
                )
              }
            ]}
          />
        )
      })
    )
  }

  return (
    <MDXEditor
      ref={editorRef}
      markdown={markdown}
      onChange={handleChange}
      readOnly={readOnly}
      className={cn('mdx-note-editor', isDark && 'dark-theme dark-editor', className)}
      contentEditableClassName={cn(
        'prose prose-sm max-w-none',
        'dark:prose-invert',
        'focus:outline-none',
        'min-h-[300px]'
      )}
      plugins={plugins}
    />
  )
}
