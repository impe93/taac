import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Note, FolderMetadata } from '@preload/types'
import type { SerializedEditorState } from 'lexical'

// Note hooks
export const useNotes = (folderId: string) => {
  return useQuery({
    queryKey: ['notes', folderId],
    queryFn: () => window.fileSystem.listNotes(folderId),
    staleTime: 1000 * 60 * 5 // 5 minutes
  })
}

export const useNote = (folderId: string, noteId: string) => {
  return useQuery({
    queryKey: ['note', folderId, noteId],
    queryFn: () => window.fileSystem.readNote(folderId, noteId),
    staleTime: 1000 * 60 * 5
  })
}

export const useCreateNote = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      folderId,
      content,
      title
    }: {
      folderId: string
      content: SerializedEditorState
      title: string
    }) => window.fileSystem.createNote(folderId, content, title),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ['notes', note.folderId] })
      queryClient.setQueryData(['note', note.folderId, note.id], note)
    }
  })
}

export const useUpdateNote = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({
      folderId,
      noteId,
      updates
    }: {
      folderId: string
      noteId: string
      updates: Partial<Note>
    }) => window.fileSystem.updateNote(folderId, noteId, updates),
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ['notes', note.folderId] })
      queryClient.setQueryData(['note', note.folderId, note.id], note)
    }
  })
}

export const useDeleteNote = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ folderId, noteId }: { folderId: string; noteId: string }) =>
      window.fileSystem.deleteNote(folderId, noteId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['notes', variables.folderId] })
      queryClient.removeQueries({ queryKey: ['note', variables.folderId, variables.noteId] })
    }
  })
}

// Folder hooks
export const useFolderTree = () => {
  return useQuery({
    queryKey: ['folderTree'],
    queryFn: () => window.fileSystem.getFolderTree(),
    staleTime: 1000 * 60 * 10 // 10 minutes
  })
}

export const useFolderMetadata = (folderId: string) => {
  return useQuery({
    queryKey: ['folder', folderId],
    queryFn: () => window.fileSystem.readFolderMetadata(folderId),
    staleTime: 1000 * 60 * 5
  })
}

export const useCreateFolder = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) =>
      window.fileSystem.createFolder(name, parentId),
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ['folderTree'] })
      queryClient.invalidateQueries({ queryKey: ['folder', folder.parentId] })
    }
  })
}

export const useUpdateFolderMetadata = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ folderId, updates }: { folderId: string; updates: Partial<FolderMetadata> }) =>
      window.fileSystem.updateFolderMetadata(folderId, updates),
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ['folderTree'] })
      queryClient.setQueryData(['folder', folder.id], folder)
    }
  })
}

export const useDeleteFolder = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (folderId: string) => window.fileSystem.deleteFolder(folderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folderTree'] })
    }
  })
}

// Asset hooks
export const useSaveAsset = () => {
  return useMutation({
    mutationFn: ({
      originalName,
      buffer,
      type
    }: {
      originalName: string
      buffer: Uint8Array
      type: 'image' | 'pdf' | 'attachment'
    }) => window.fileSystem.saveAsset(originalName, buffer, type)
  })
}

export const useReadAsset = (assetId: string, type: 'image' | 'pdf' | 'attachment') => {
  return useQuery({
    queryKey: ['asset', assetId, type],
    queryFn: () => window.fileSystem.readAsset(assetId, type),
    staleTime: Infinity, // Assets don't change
    enabled: !!assetId // Only fetch if assetId is provided
  })
}

export const useDeleteAsset = () => {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ assetId, type }: { assetId: string; type: 'image' | 'pdf' | 'attachment' }) =>
      window.fileSystem.deleteAsset(assetId, type),
    onSuccess: (_, variables) => {
      queryClient.removeQueries({ queryKey: ['asset', variables.assetId, variables.type] })
    }
  })
}

// Database path hook
export const useDatabasePath = () => {
  return useQuery({
    queryKey: ['databasePath'],
    queryFn: () => window.fileSystem.getDatabasePath(),
    staleTime: Infinity // Database path doesn't change
  })
}
