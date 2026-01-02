import { configureStore } from '@reduxjs/toolkit'
import notesTreeReducer from './slices/notesTreeSlice'
import { persistenceMiddleware } from './middleware/persistenceMiddleware'

export const store = configureStore({
  reducer: {
    notesTree: notesTreeReducer
  },
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      serializableCheck: {
        // Ignora check di serializzabilità per Date objects e SerializedEditorState
        ignoredActions: ['notesTree/loadTree/fulfilled', 'notesTree/createNote/fulfilled'],
        ignoredPaths: ['notesTree.notes', 'notesTree.folders']
      }
    }).concat(persistenceMiddleware)
})

// Infer types dal store
export type RootState = ReturnType<typeof store.getState>
export type AppDispatch = typeof store.dispatch
