// Reads a store's home page for how it looks (name, logo, favicon, color, social links) and sets that on a shop. Only reads
// what the store itself publishes; every request goes through the guarded fetcher.
import { shops } from '@shopnex/core/schema'
import type { Conn } from '@shopnex/db'
import { themeService } from '@shopnex/theme'
import { eq } from 'drizzle-orm'
import type { Fetcher } from './fetcher'
import { decode } from './woo'

export type Brand = {
  name: string
  logo?: string
  /** Where the logo came from: a real logo image, or the store's favicon standing in for one */
  logoFrom: 'logo' | 'favicon' | null
  favicon?: string
  color?: string
  background?: string
  socials: Partial<Record<'instagram' | 'facebook' | 'tiktok' | 'youtube' | 'x' | 'pinterest', string>>
}

export async function readBrand(origin: string, fetcher: Fetcher): Promise<Brand> {
  // A missing file or a failing stylesheet is not an error here: the brand is best effort
  const get = async (url: string) => {
    try {
      return await fetcher.text(url)
    } catch {
      return ''
    }
  }
  const abs = (base: string, href: string) => new URL(href.replace(/&amp;/g, '&').replace(/\\u0026/g, '&'), base).href
  const html = await get(origin + '/')
  const attr = (re: RegExp) => html.match(re)?.[1]?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim()

  // ── name
  // Shopify: /meta.json. WordPress / WooCommerce: the site name at /wp-json. Else the page's og:site_name, else the host.
  const jsonOf = async (path: string) => {
    try {
      return JSON.parse((await get(origin + path)) || 'null')
    } catch {
      return null
    }
  }
  const meta = await jsonOf('/meta.json')
  const wp = meta?.name ? null : await jsonOf('/wp-json')
  const name: string = decode(
    String(
      meta?.name ??
        (wp?.name || undefined) ??
        attr(/property=["']og:site_name["'][^>]+content=["']([^"']+)/i) ??
        new URL(origin).hostname,
    ),
  ).slice(0, 100)

  // ── logo: JSON-LD, then an <img> that says logo, then touch icon
  let logo: string | undefined
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
  for (const m of ld) {
    const found = m[1]!.match(/"logo"\s*:\s*(?:"([^"]+)"|\{[^}]*?"(?:url|contentUrl)"\s*:\s*"([^"]+)")/)
    if (found) logo = found[1] ?? found[2]
    if (logo) break
  }
  // An <img> in the header that says logo or carries the shop's name (not any "logo" on the page: badges and partner logos match too)
  const header = html.match(/<header[\s\S]*?<\/header>/i)?.[0] ?? ''
  const word = name.toLowerCase().split(/\W+/)[0] ?? ''
  if (!logo) {
    for (const m of header.matchAll(/<img[^>]*>/gi)) {
      const tag = m[0]
      const src = tag.match(/\ssrc=["']([^"']+)/i)?.[1] ?? tag.match(/data-src=["']([^"']+)/i)?.[1]
      // 'logo' anywhere in the tag, or the shop's name in the file name (not in the alt text: product photos say the brand too)
      if (!/logo/i.test(tag) && !new RegExp(word, 'i').test((src ?? '').split('?')[0]!.split('/').pop() ?? '')) continue
      if (src) {
        logo = src
        break
      }
    }
  }
  let logoFrom = logo ? 'logo found in page' : ''
  if (!logo) {
    logo =
      attr(/rel=["']apple-touch-icon["'][^>]+href=["']([^"']+)/i) ??
      attr(/rel=["'](?:shortcut )?icon["'][^>]+href=["']([^"']+)/i)
    if (logo) logoFrom = 'favicon (no logo image in the page)'
  }
  if (logo) logo = abs(origin, logo)

  // The store's own browser-tab icon, for the themes' `favicon` setting (separate from the logo: a store may have both)
  let favicon =
    attr(/<link[^>]+rel=["'](?:shortcut )?icon["'][^>]*href=["']([^"']+)/i) ??
    attr(/<link[^>]+href=["']([^"']+)["'][^>]*rel=["'](?:shortcut )?icon["']/i)
  if (favicon && !/^data:/i.test(favicon)) favicon = abs(origin, favicon)
  else favicon = undefined

  // ── color
  const hexes = new Map<string, number>()
  const note = (hex: string) => {
    hex = hex.toLowerCase()
    if (hex.length === 4) hex = '#' + [...hex.slice(1)].map((c) => c + c).join('')
    hexes.set(hex, (hexes.get(hex) ?? 0) + 1)
  }
  const css = [html]
  for (const m of [...html.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi)].slice(0, 3)) {
    const href = m[0].match(/href=["']([^"']+)/)?.[1]
    if (href) css.push(await get(abs(origin, href)))
  }
  for (const text of css) for (const m of text.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) note(m[0])

  // Background: the page's own body rule, or a variable named like one. Only a plain hex color; white is the themes' default.
  const longHex = (hex: string) =>
    (hex.length === 4 ? '#' + [...hex.slice(1)].map((c) => c + c).join('') : hex).toLowerCase()
  let background: string | undefined
  for (const text of css) {
    const found =
      text.match(
        /(?:^|[}\s,;>])(?:html\s*,\s*)?body\s*\{[^}]*?background(?:-color)?\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b/i,
      )?.[1] ??
      text.match(
        /--(?:color-)?(?:body-bg|background|page-bg|bg|body-background)\s*:\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{3})\b/i,
      )?.[1]
    if (found && longHex(found) !== '#ffffff') {
      background = longHex(found)
      break
    }
  }
  const hsl = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number]
    const max = Math.max(r, g, b),
      min = Math.min(r, g, b),
      l = (max + min) / 2
    const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
    return { s, l }
  }
  const brandish = (hex: string) => {
    const { s, l } = hsl(hex)
    return s > 0.35 && l > 0.15 && l < 0.7
  }
  const themeColor = attr(/<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-fA-F]{6})["']/i)
  let color: string | undefined

  function pick(value: string) {
    color = value
  }
  if (themeColor && brandish(themeColor)) pick(themeColor)
  else {
    const top = [...hexes.entries()].filter(([hex]) => brandish(hex)).sort((a, b) => b[1] - a[1])[0]
    if (top && top[1] >= 10) pick(top[0])
    else if (themeColor && hsl(themeColor).l < 0.3) pick(themeColor)
  }

  // Social links: the first profile link per network, from the footer (else the whole page). Share buttons are skipped.
  const NETWORKS = ['instagram', 'facebook', 'tiktok', 'youtube', 'x', 'twitter', 'pinterest'] as const
  const footerHtml = html.match(/<footer[\s\S]*?<\/footer>/i)?.[0] ?? html
  const socials: Partial<Record<(typeof NETWORKS)[number], string>> = {}
  for (const m of footerHtml.matchAll(
    /href=["'](https?:\/\/(?:www\.)?(instagram|facebook|tiktok|youtube|x|twitter|pinterest)\.com\/[^"'#?\s]+)/gi,
  )) {
    const network = m[2]!.toLowerCase() as (typeof NETWORKS)[number]
    if (/sharer|share|intent|\/tr\b|plugins|dialog/i.test(m[1]!)) continue
    socials[network] ??= m[1]!.replace(/&amp;/g, '&')
  }
  if (socials.twitter) socials.x ??= socials.twitter
  delete socials.twitter

  return {
    name,
    logo,
    logoFrom: logo ? (logoFrom.startsWith('favicon') ? 'favicon' : 'logo') : null,
    favicon,
    color,
    background,
    socials: socials as Brand['socials'],
  }
}

// The setting ids of the Storeplate theme (the one a new imported shop gets). A test checks them against its theme.json.
export const STOREPLATE_SETTINGS = {
  logo: 'logo',
  logoWidth: 'logo_width',
  favicon: 'favicon',
  announcement: 'announcement_text',
  accent: 'color_primary',
  background: 'color_body',
} as const

/** Puts the store's look on a shop: its name and logo, and a published Storeplate copy with the colors, favicon and links */
export async function applyBrand(shopId: string, brand: Brand, conn: Conn) {
  const ids = STOREPLATE_SETTINGS
  const settings: Record<string, string | number> = {
    [ids.announcement]: `Welcome to ${brand.name}`,
  }
  if (brand.logo) settings[ids.logo] = brand.logo
  // A small square mark, not a wide logo
  if (brand.logo && brand.logoFrom === 'favicon') settings[ids.logoWidth] = 60
  if (brand.favicon) settings[ids.favicon] = brand.favicon
  if (brand.color) settings[ids.accent] = brand.color
  if (brand.background) settings[ids.background] = brand.background
  for (const [network, url] of Object.entries(brand.socials)) if (url) settings[`${network}_url`] = url

  await conn
    .update(shops)
    .set({ name: brand.name, logo: brand.logo ?? null })
    .where(eq(shops.id, shopId))
  const copy = await themeService.create(
    shopId,
    { themeId: 'storeplate', name: `${brand.name} (imported)`, draft: { settings, pages: {} } },
    conn,
  )
  await themeService.publish(shopId, copy.id, conn)
}
