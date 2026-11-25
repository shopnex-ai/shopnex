// The announcement bar of a store (Shopify's Dawn and the themes built on it): its messages, their links, and whether it
// rotates by itself. Read from the home page's markup, the only place a store publishes them.
import { decode } from './woo'

export type Announcement = { text: string; link: string | null }
export type Announcements = { messages: Announcement[]; autoRotate: boolean; seconds: number | null }

/** As many as the theme's announcement bar holds */
const MAX_MESSAGES = 12

const text = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()

// A link back to the shop's own home, catalog or search keeps working in the new shop; its other pages may not exist there
const SHOP_PATHS = new Set(['/', '/collections', '/collections/all', '/search'])

function linkOf(href: string, origin: string): string | null {
  let url: URL
  try {
    url = new URL(href.replace(/&amp;/g, '&'), origin + '/')
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
  if (url.origin !== new URL(origin).origin) return url.href
  const path = url.pathname.replace(/\/+$/, '') || '/'
  return SHOP_PATHS.has(path) ? path : null
}

export function readAnnouncements(html: string, origin: string): Announcements {
  const messages: Announcement[] = []
  let from = 0
  for (const m of html.matchAll(/<p\b[^>]*announcement-bar__message[^>]*>([\s\S]*?)<\/p>/gi)) {
    if (messages.length >= MAX_MESSAGES) break
    const message = text(m[1]!).slice(0, 200)
    // The link wraps the message: it opens just before it, after the previous message
    const before = html.slice(from, m.index)
    const anchor = [...before.matchAll(/<a\b([^>]*announcement-bar__link[^>]*)>/gi)].at(-1)
    from = m.index! + m[0].length
    if (!message) continue
    const href = anchor?.[1]?.match(/\shref=["']([^"']*)["']/i)?.[1]
    messages.push({ text: message, link: href ? linkOf(href, origin) : null })
  }

  // The slider element carries the settings: data-autoplay="true" data-speed="4"
  const slider = html.match(/<[^>]*\bid="Slider-[^"]*announcement[^"]*"[^>]*>/i)?.[0] ?? ''
  const speed = Number(slider.match(/data-speed="(\d+)"/)?.[1])
  return {
    messages,
    autoRotate: /data-autoplay="true"/.test(slider),
    seconds: Number.isFinite(speed) && speed > 0 ? Math.min(10, Math.max(3, speed)) : null,
  }
}
