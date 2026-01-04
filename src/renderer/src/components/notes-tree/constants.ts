import type { SerializedEditorState } from 'lexical'

/**
 * Default empty editor state for new notes
 * This represents a minimal valid Lexical editor state with an empty root node
 */
export const EMPTY_EDITOR_STATE: SerializedEditorState = {
  root: {
    children: [],
    direction: null,
    format: '',
    indent: 0,
    type: 'root',
    version: 1
  }
}
