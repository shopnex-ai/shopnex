// Reads a store's homepage and sets the default shop's name, logo and primary color (a Storeplate theme copy, published).
//   DATABASE_URL=postgres://…/shopnex_main pnpm --filter @shopnex/api exec tsx scripts/import-store/brand.ts <url> [--dry]
// --dry prints what it found and changes nothing. Experiment: see README.md.
import { db } from '@shopnex/db'
import { shops } from '@shopnex/core/schema'
import { DEFAULT_SHOP_ID } from '@shopnex/tenancy'
import { themeService } from '@shopnex/theme'
import { eq } from 'drizzle-orm'
import { UA, assertScratchDb } from './lib'

if (!process.argv.includes('--dry')) assertScratchDb()
const get = async (url: string) => {
  const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) })
  return res.ok ? await res.text() : ''
}
const abs = (base: string, href: string) => new URL(href.replace(/&amp;/g, '&').replace(/\\u0026/g, '&'), base).href

const arg = process.argv[2]!
const origin = new URL(/^https?:\/\//.test(arg) ? arg : `https://${arg}`).origin
const html = await get(origin + '/')
const attr = (re: RegExp) => html.match(re)?.[1]?.replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim()

// ── name
const meta = JSON.parse((await get(origin + '/meta.json').catch(() => '')) || 'null')
const name: string =
  meta?.name ?? attr(/property=["']og:site_name["'][^>]+content=["']([^"']+)/i) ?? new URL(origin).hostname

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
let colorFrom = ''
// The dominant saturated color of the logo or favicon: biggest hue bucket, averaged
async function imageColor(url: string) {
  try {
    const bytes = Buffer.from(
      await (await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20000) })).arrayBuffer(),
    )
    // sharp is not a dependency of this package yet: without it the color falls back to the page's own colors
    const sharpModule = 'sharp'
    const sharp = (await import(sharpModule)).default
    const { data, info } = await sharp(bytes)
      .resize(48, 48, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const buckets = new Map<number, { n: number; r: number; g: number; b: number }>()
    for (let i = 0; i < data.length; i += info.channels) {
      if (data[i + 3]! < 200) continue
      const r = data[i]!,
        g = data[i + 1]!,
        b = data[i + 2]!
      const hex = '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
      if (!brandish(hex)) continue
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b)
      const h =
        max === r ? ((g - b) / (max - min) + 6) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
      const key = Math.floor((h * 60) / 20)
      const x = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 }
      buckets.set(key, { n: x.n + 1, r: x.r + r, g: x.g + g, b: x.b + b })
    }
    const top = [...buckets.values()].sort((p, q) => q.n - p.n)[0]
    if (!top || top.n < 12) return undefined
    return (
      '#' +
      [top.r, top.g, top.b]
        .map((v) =>
          Math.round(v / top.n)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('')
    )
  } catch {
    return undefined
  }
}
function pick(value: string, from: string) {
  color = value
  colorFrom = from
}
const fromImage = themeColor && brandish(themeColor) ? undefined : logo ? await imageColor(logo) : undefined
if (themeColor && brandish(themeColor)) pick(themeColor, 'theme-color')
else if (fromImage) pick(fromImage, 'dominant color of the logo/favicon')
else {
  const top = [...hexes.entries()].filter(([hex]) => brandish(hex)).sort((a, b) => b[1] - a[1])[0]
  if (top && top[1] >= 10) pick(top[0], `most used saturated color (${top[1]}x)`)
  else if (themeColor && hsl(themeColor).l < 0.3) pick(themeColor, 'theme-color (dark)')
}

console.log({ name, logo: logo ?? null, logoFrom, color: color ?? null, colorFrom, themeColor: themeColor ?? null })

if (process.argv.includes('--dry')) {
  await db.$client.end()
  process.exit(0)
}
// ── apply to the scratch shop
await db
  .update(shops)
  .set({ name, logo: logo ?? null })
  .where(eq(shops.id, DEFAULT_SHOP_ID))
const settings: Record<string, string | number | boolean | null> = { announcement_text: `Welcome to ${name}` }
if (logo) settings.logo = logo
if (logo && logoFrom.startsWith('favicon')) settings.logo_width = 60 // a small square mark, not a wide logo
if (color) settings.color_primary = color
const copy = await themeService.create(
  DEFAULT_SHOP_ID,
  { themeId: 'storeplate', name: `${name} (imported)`, draft: { settings, pages: {} } },
  db,
)
await themeService.publish(DEFAULT_SHOP_ID, copy.id, db)
console.log('theme copy published:', copy.id)
await db.$client.end()
