import { createFileRoute } from '@tanstack/react-router'
import { useAppSelector } from '@renderer/store/hooks'
import { selectNoteById } from '@renderer/store/slices/notesTreeSlice'

export const Route = createFileRoute('/note/$noteId')({
  component: NoteView
})

function NoteView() {
  const { noteId } = Route.useParams()
  const note = useAppSelector(selectNoteById(noteId))

  if (!note) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-muted-foreground">Note not found</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full p-6">
      <h1 className="text-2xl font-semibold mb-4">{note.title || 'Untitled'}</h1>
      <div className="flex-1 border rounded-md p-4 bg-card">
        {/* TODO: Integrate Lexical editor later */}
        <p className="text-sm text-muted-foreground mb-2">Lexical editor content:</p>
        <pre className="text-xs overflow-auto">{JSON.stringify(note.content, null, 2)}</pre>
      </div>
      <div className="mt-4 text-xs text-muted-foreground">
        <p>Created: {new Date(note.createdAt).toLocaleString()}</p>
        <p>Updated: {new Date(note.updatedAt).toLocaleString()}</p>
      </div>
    </div>
  )
}
