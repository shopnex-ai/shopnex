// Menu item tree edits for the editor. A path is the item's index at each level, e.g. [2, 0] = the first
// sub-item of the third top-level item. Every function returns a new tree.
import { MENU_MAX_DEPTH, type StoredMenuItem } from '@shopnex/api/schemas'

type Item = StoredMenuItem
export type Path = number[]

export const newItemId = () => `i${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`

/** Levels in the item's subtree, itself included */
export const depthOf = (item: Item): number => 1 + Math.max(0, ...item.items.map(depthOf))

export function getItem(items: Item[], path: Path): Item | undefined {
  const [i, ...rest] = path
  const item = items[i!]
  return rest.length ? item && getItem(item.items, rest) : item
}

function withSiblings(items: Item[], parent: Path, fn: (siblings: Item[]) => Item[]): Item[] {
  if (!parent.length) return fn(items)
  const [i, ...rest] = parent
  return items.map((item, j) => (j === i ? { ...item, items: withSiblings(item.items, rest, fn) } : item))
}

const parentOf = (path: Path) => path.slice(0, -1)
const indexOf = (path: Path) => path[path.length - 1]!

export const replaceItem = (items: Item[], path: Path, next: Item) =>
  withSiblings(items, parentOf(path), (s) => s.map((item, i) => (i === indexOf(path) ? next : item)))

export const removeItem = (items: Item[], path: Path) =>
  withSiblings(items, parentOf(path), (s) => s.filter((_, i) => i !== indexOf(path)))

/** Appends to the top level (parent []) or to an item's sub-items */
export const addItem = (items: Item[], parent: Path, item: Item) =>
  parent.length
    ? replaceItem(items, parent, { ...getItem(items, parent)!, items: [...getItem(items, parent)!.items, item] })
    : [...items, item]

export function moveItem(items: Item[], path: Path, delta: -1 | 1) {
  return withSiblings(items, parentOf(path), (s) => {
    const i = indexOf(path)
    const j = i + delta
    if (j < 0 || j >= s.length) return s
    const next = [...s]
    ;[next[i], next[j]] = [next[j]!, next[i]!]
    return next
  })
}

/** Sub-items can be added while the new item stays within MENU_MAX_DEPTH levels */
export const canAddChild = (path: Path) => path.length < MENU_MAX_DEPTH

/** Becomes the last sub-item of the item above it, if its subtree still fits */
export const canIndent = (items: Item[], path: Path) =>
  indexOf(path) > 0 && path.length + depthOf(getItem(items, path)!) <= MENU_MAX_DEPTH

export function indent(items: Item[], path: Path) {
  const item = getItem(items, path)!
  const above = [...parentOf(path), indexOf(path) - 1]
  return addItem(removeItem(items, path), above, item)
}

export const canOutdent = (path: Path) => path.length > 1

/** Moves out of its parent, right after it */
export function outdent(items: Item[], path: Path) {
  const item = getItem(items, path)!
  const parent = parentOf(path)
  const without = removeItem(items, path)
  return withSiblings(without, parentOf(parent), (s) => [
    ...s.slice(0, indexOf(parent) + 1),
    item,
    ...s.slice(indexOf(parent) + 1),
  ])
}
