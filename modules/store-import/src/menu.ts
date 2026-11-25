// The store's main menu, read from the links in its header (a store has no public menu file), and turned into this shop's
// main menu: links to a collection or page that was imported keep pointing at it; links to anything that was not imported
// (a blog, a policy page, a collection the import did not make) are left out rather than sent to a 404.
import { randomUUID } from 'node:crypto'
import type { StoredMenuItem } from '@shopnex/content'
import { decode } from './woo'

export type NavItem = { title: string; href: string | null; items: NavItem[] }

export const text = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

/** The nested lists of the header's navigation: <li> with a link, or a <summary> label and a nested <ul> */
export function readHeaderMenu(html: string): NavItem[] {
  const header = html.match(/<header[\s\S]*?<\/header>/i)?.[0] ?? ''
  const navs = [...header.matchAll(/<nav\b([^>]*)>([\s\S]*?)<\/nav>/gi)]
  const nav = (navs.find((n) => /inline-menu|main-menu|primary/i.test(n[1]!)) ?? navs[0])?.[2]
  if (!nav) return []

  const root: NavItem = { title: '', href: null, items: [] }
  const lists: NavItem[] = [root]
  const open: NavItem[] = []
  const tags = [...nav.matchAll(/<(\/?)(ul|li|a|summary)\b([^>]*)>/gi)]
  for (const [i, m] of tags.entries()) {
    const closing = m[1] === '/'
    const name = m[2]!.toLowerCase()
    if (name === 'ul') {
      // Every <ul> pushes (a top-level one adds to the current list), so each </ul> pops its own; the root never pops
      if (closing) {
        if (lists.length > 1) lists.pop()
      } else lists.push(open.length ? open[open.length - 1]! : lists[lists.length - 1]!)
    } else if (name === 'li') {
      if (closing) open.pop()
      else {
        const item: NavItem = { title: '', href: null, items: [] }
        lists[lists.length - 1]!.items.push(item)
        open.push(item)
      }
    } else if (!closing && open.length) {
      const item = open[open.length - 1]!
      const end = tags.slice(i + 1).find((t) => t[1] === '/' && t[2]!.toLowerCase() === name)
      const label = text(nav.slice(m.index! + m[0].length, end?.index ?? m.index! + m[0].length))
      if (name === 'a' && item.href === null) {
        item.href = m[3]!.match(/\shref=["']([^"']*)["']/i)?.[1]?.replace(/&amp;/g, '&') ?? null
        item.title ||= label
      } else if (name === 'summary') item.title ||= label
    }
  }
  return root.items
}

export type MenuTargets = {
  collections: { id: string; title: string; slug: string }[]
  pages: { id: string; handle: string }[]
}

const TOP_MAX = 8
const CHILDREN_MAX = 12
const DEPTH_MAX = 3

/** The shop's menu items for what the store's header showed; empty when none of it can be kept */
export function toMenuItems(nav: NavItem[], origin: string, targets: MenuTargets, depth = 1): StoredMenuItem[] {
  const items: StoredMenuItem[] = []
  for (const entry of nav.slice(0, depth === 1 ? TOP_MAX : CHILDREN_MAX)) {
    const title = entry.title.slice(0, 255)
    if (!title) continue
    const children = depth < DEPTH_MAX ? toMenuItems(entry.items, origin, targets, depth + 1) : []
    const link = resolve(entry.href, title, origin, targets)
    // A label with no link of its own (a dropdown heading) opens the catalog
    const target = link ?? (children.length ? { type: 'catalog' as const } : null)
    if (!target) continue
    items.push({ id: randomUUID(), title, ...target, items: children })
  }
  return items
}

function resolve(
  href: string | null,
  title: string,
  origin: string,
  targets: MenuTargets,
): Pick<StoredMenuItem, 'type' | 'resourceId' | 'url'> | null {
  if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return null
  let url: URL
  try {
    url = new URL(href, origin + '/')
  } catch {
    return null
  }
  if (/^(mailto|tel):/i.test(href)) return { type: 'http', url: href }
  if (!/^https?:$/.test(url.protocol)) return null
  if (url.origin !== new URL(origin).origin) return { type: 'http', url: url.href }

  const path = url.pathname.replace(/\/+$/, '')
  if (path === '') return { type: 'frontpage' }
  if (path === '/search') return { type: 'search' }
  if (path === '/collections' || path === '/collections/all') return { type: 'catalog' }
  const collection = path.match(/^\/collections\/([^/]+)/)?.[1]
  if (collection) {
    const found =
      targets.collections.find((c) => c.slug === collection) ??
      targets.collections.find((c) => c.title.toLowerCase() === title.toLowerCase())
    return found ? { type: 'collection', resourceId: found.id } : null
  }
  const page = path.match(/^\/pages\/([^/]+)/)?.[1]
  const found = page && targets.pages.find((p) => p.handle === page)
  return found ? { type: 'page', resourceId: found.id } : null
}
