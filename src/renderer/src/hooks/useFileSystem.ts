import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Note, FolderMetadata } from '@preload/types'
import type { SerializedEditorState } from 'lexical'
import { useActiveSpace } from './useSpaces'

// Note hooks
export const useNotes = (folderId: string) => {
  const activeSpace = useActiveSpace()

  return useQuery({
    queryKey: ['notes', activeSpace?.id, folderId],
    queryFn: () => window.fileSystem.listNotes(activeSpace!.id, folderId),
    enabled: !!activeSpace,
    staleTime: 1000 * 60 * 5 // 5 minutes
  })
}

export const useNote = (folderId: string, noteId: string) => {
  const activeSpace = useActiveSpace()

  return useQuery({
    queryKey: ['note', activeSpace?.id, folderId, noteId],
    queryFn: () => window.fileSystem.readNote(activeSpace!.id, folderId, noteId),
    enabled: !!activeSpace && !!noteId,
    staleTime: 1000 * 60 * 5
  })
}

export const useCreateNote = () => {
  const queryClient = useQueryClient()
  const activeSpace = useActiveSpace()

  return useMutation({
    mutationFn: ({
      folderId,
      content,
      title
    }: {
      folderId: string
      content: SerializedEditorState
      title: string
    }) => {
      if (!activeSpace) throw new Error('No active space')
      return window.fileSystem.createNote(activeSpace.id, folderId, content, title)
    },
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ['notes', activeSpace?.id, note.folderId] })
      queryClient.setQueryData(['note', activeSpace?.id, note.folderId, note.id], note)
    }
  })
}

export const useUpdateNote = () => {
  const queryClient = useQueryClient()
  const activeSpace = useActiveSpace()

  return useMutation({
    mutationFn: ({
      folderId,
      noteId,
      updates
    }: {
      folderId: string
      noteId: string
      updates: Partial<Note>
    }) => {
      if (!activeSpace) throw new Error('No active space')
      return window.fileSystem.updateNote(activeSpace.id, folderId, noteId, updates)
    },
    onSuccess: (note) => {
      queryClient.invalidateQueries({ queryKey: ['notes', activeSpace?.id, note.folderId] })
      queryClient.setQueryData(['note', activeSpace?.id, note.folderId, note.id], note)
    }
  })
}

export const useDeleteNote = () => {
  const queryClient = useQueryClient()
  const activeSpace = useActiveSpace()

  return useMutation({
    mutationFn: ({ folderId, noteId }: { folderId: string; noteId: string }) => {
      if (!activeSpace) throw new Error('No active space')
      return window.fileSystem.deleteNote(activeSpace.id, folderId, noteId)
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['notes', activeSpace?.id, variables.folderId] })
      queryClient.removeQueries({
        queryKey: ['note', activeSpace?.id, variables.folderId, variables.noteId]
      })
    }
  })
}

// Folder hooks
export const useFolderTree = () => {
  const activeSpace = useActiveSpace()

  return useQuery({
    queryKey: ['folderTree', activeSpace?.id],
    queryFn: () => window.fileSystem.getFolderTree(activeSpace!.id),
    enabled: !!activeSpace,
    staleTime: 1000 * 60 * 10 // 10 minutes
  })
}

export const useFolderMetadata = (folderId: string) => {
  const activeSpace = useActiveSpace()

  return useQuery({
    queryKey: ['folder', activeSpace?.id, folderId],
    queryFn: () => window.fileSystem.readFolderMetadata(activeSpace!.id, folderId),
    enabled: !!activeSpace && !!folderId,
    staleTime: 1000 * 60 * 5
  })
}

export const useCreateFolder = () => {
  const queryClient = useQueryClient()
  const activeSpace = useActiveSpace()

  return useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string }) => {
      if (!activeSpace) throw new Error('No active space')
      return window.fileSystem.createFolder(activeSpace.id, name, parentId)
    },
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ['folderTree', activeSpace?.id] })
      queryClient.invalidateQueries({ queryKey: ['folder', activeSpace?.id, folder.parentId] })
    }
  })
}

export const useUpdateFolderMetadata = () => {
  const queryClient = useQueryClient()
  const activeSpace = useActiveSpace()

  return useMutation({
    mutationFn: ({ folderId, updates }: { folderId: string; updates: Partial<FolderMetadata> }) => {
      if (!activeSpace) throw new Error('No active space')
      return window.fileSystem.updateFolderMetadata(activeSpace.id, folderId, updates)
    },
    onSuccess: (folder) => {
      queryClient.invalidateQueries({ queryKey: ['folderTree', activeSpace?.id] })
      queryClient.setQueryData(['folder', activeSpace?.id, folder.id], folder)
    }
  })
}

export const useDeleteFolder = () => {
  const queryClient = useQueryClient()
  const activeSpace = useActiveSpace()

  return useMutation({
    mutationFn: (folderId: string) => {
      if (!activeSpace) throw new Error('No active space')
      return window.fileSystem.deleteFolder(activeSpace.id, folderId)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['folderTree', activeSpace?.id] })
    }
  })
}

// Asset hooks
export const useSaveAsset = () => {
  const activeSpace = useActiveSpace()

  return useMutation({
    mutationFn: ({
      originalName,
      buffer,
      type
    }: {
      originalName: string
      buffer: Uint8Array
      type: 'image' | 'pdf' | 'attachment'
    }) => {
      if (!activeSpace) throw new Error('No active space')
      return window.fileSystem.saveAsset(activeSpace.id, originalName, buffer, type)
    }
  })
}

export const useReadAsset = (assetId: string, type: 'image' | 'pdf' | 'attachment') => {
  const activeSpace = useActiveSpace()

  return useQuery({
    queryKey: ['asset', activeSpace?.id, assetId, type],
    queryFn: () => window.fileSystem.readAsset(activeSpace!.id, assetId, type),
    enabled: !!activeSpace && !!assetId,
    staleTime: Infinity // Assets don't change
  })
}

export const useDeleteAsset = () => {
  const queryClient = useQueryClient()
  const activeSpace = useActiveSpace()

  return useMutation({
    mutationFn: ({ assetId, type }: { assetId: string; type: 'image' | 'pdf' | 'attachment' }) => {
      if (!activeSpace) throw new Error('No active space')
      return window.fileSystem.deleteAsset(activeSpace.id, assetId, type)
    },
    onSuccess: (_, variables) => {
      queryClient.removeQueries({
        queryKey: ['asset', activeSpace?.id, variables.assetId, variables.type]
      })
    }
  })
}

// Database path hook
export const useDatabasePath = () => {
  const activeSpace = useActiveSpace()

  return useQuery({
    queryKey: ['databasePath', activeSpace?.id],
    queryFn: () => window.fileSystem.getDatabasePath(activeSpace!.id),
    enabled: !!activeSpace,
    staleTime: Infinity // Database path doesn't change
  })
}
