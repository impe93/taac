import type { FolderMetadata, OrderedItem } from '@preload/types'

/**
 * Derive the canonical interleaved order (notes + subfolders) for a folder.
 *
 * Mirror of the main-process `reconcileItems` in
 * `src/main/utils/fileSystem.ts`: keeps the existing `items` order for ids still
 * present, drops stale ids, and appends new ids (notes first in `noteIds` order,
 * then folders in `children` order). When `items` is missing/empty the result is
 * the legacy "notes then folders" order, so cached/legacy data renders correctly
 * without an explicit migration.
 */
export function reconcileItems(
  folder: Pick<FolderMetadata, 'noteIds' | 'children'> & { items?: OrderedItem[] }
): OrderedItem[] {
  const noteSet = new Set(folder.noteIds)
  const childSet = new Set(folder.children)
  const seen = new Set<string>()
  const result: OrderedItem[] = []

  for (const item of folder.items ?? []) {
    const present =
      (item.type === 'note' && noteSet.has(item.id)) ||
      (item.type === 'folder' && childSet.has(item.id))
    if (present && !seen.has(item.id)) {
      result.push({ type: item.type, id: item.id })
      seen.add(item.id)
    }
  }

  for (const id of folder.noteIds) {
    if (!seen.has(id)) {
      result.push({ type: 'note', id })
      seen.add(id)
    }
  }

  for (const id of folder.children) {
    if (!seen.has(id)) {
      result.push({ type: 'folder', id })
      seen.add(id)
    }
  }

  return result
}

/** Stable drag-and-drop id for an ordered item, e.g. `note-<id>` / `folder-<id>`. */
export function orderedItemDndId(item: OrderedItem): string {
  return `${item.type}-${item.id}`
}
