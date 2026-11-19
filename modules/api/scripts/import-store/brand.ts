// Reads a store's homepage and sets the default shop's name, logo and primary color (a published theme copy: Storeplate, `--theme <id>`, or `--theme auto` for the one that can show the most, logo and color first).
//   DATABASE_URL=postgres://…/shopnex_main pnpm --filter @shopnex/api exec tsx scripts/import-store/brand.ts <url> [--dry]
// --dry prints what it found and changes nothing. Experiment: see README.md.
import { readFileSync } from 'node:fs'
import { db } from '@shopnex/db'
import { shops } from '@shopnex/core/schema'
import { DEFAULT_SHOP_ID } from '@shopnex/tenancy'
import { themeService } from '@shopnex/theme'
import { eq } from 'drizzle-orm'
import { UA, assertScratchDb } from './lib'
import { decode } from './woo'

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
)

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

// Cookie banner: the store loads a known consent tool. We cannot copy its banner, only turn on ours.
const CONSENT_TOOLS =
  /cookieconsent|cookie-consent|cookiebot|onetrust|osano|termly|iubenda|complianz|cookieyes|usercentrics|trustarc|consentmanager|customerPrivacy|shopify-pc__banner|cookie-banner|cookie_banner/i
const cookieBanner = CONSENT_TOOLS.test(html)

console.log({
  name,
  background: background ?? null,
  cookieBanner,
  socials,
  logo: logo ?? null,
  logoFrom,
  color: color ?? null,
  colorFrom,
  themeColor: themeColor ?? null,
})

const THEMES_DIR = new URL('../../../../templates/storefront/themes/', import.meta.url)

type ThemeValues = Record<string, string | number | boolean | null>
type ThemeSetting = { id: string; default?: unknown }
type ThemeJson = {
  settings: { id: string }[]
  checkout?: { accent?: string; background?: string; logo?: string }
  sections?: Record<string, { settings?: ThemeSetting[]; blocks?: unknown }>
  pages?: Record<string, { sections: { id: string; type: string; settings: ThemeValues }[] }>
}
function readTheme(id: string): ThemeJson {
  try {
    return JSON.parse(readFileSync(new URL(`${id}/theme.json`, THEMES_DIR), 'utf8'))
  } catch {
    throw new Error(`Unknown theme "${id}" (no templates/storefront/themes/${id}/theme.json)`)
  }
}

// What a theme can show comes from its own theme.json: its settings, and the `checkout` block that says which
// setting plays which role (accent, background, logo...). Nothing about a theme is hardcoded here.
function plan(id: string) {
  const theme = readTheme(id)
  const known = new Set(theme.settings.map((setting) => setting.id))
  const roles = theme.checkout ?? {}
  const settings: Record<string, string | number | boolean | null> = {}
  const cannotShow: string[] = []
  // weight: how much it matters for the shop to look like theirs (a logo more than a TikTok link)
  let score = 0
  const put = (what: string, key: string | undefined, value: string | number | undefined, weight = 0) => {
    if (value === undefined) return
    if (key && known.has(key)) {
      settings[key] = value
      score += weight
    } else cannotShow.push(what)
  }
  put('announcement', 'announcement_text', `Welcome to ${name}`, 1)
  put('logo', roles.logo, logo, 4)
  if (logo && logoFrom.startsWith('favicon')) put('logo width', 'logo_width', 60) // a small square mark, not a wide logo
  put('brand color', roles.accent, color, 3)
  put('background', roles.background, background, 2)
  for (const [network, url] of Object.entries(socials)) put(`${network} link`, `${network}_url`, url, 0.5)
  // Sections that ship made-up customer quotes or reviews would show them as real ones: switch them off on every page
  const sampleTypes = new Set(
    Object.entries(theme.sections ?? {})
      .filter(([, section]) =>
        (section.settings ?? []).some((x) => /^(quote|testimonial|review)/i.test(x.id) && x.default),
      )
      .map(([type]) => type),
  )
  const pages: Record<string, { sections: { id: string; type: string; disabled?: boolean; settings: ThemeValues }[] }> =
    {}
  const disabledSections: string[] = []
  for (const [pageId, page] of Object.entries(theme.pages ?? {})) {
    if (!page.sections.some((section) => sampleTypes.has(section.type))) continue
    pages[pageId] = {
      sections: page.sections.map((section) => {
        if (!sampleTypes.has(section.type)) return section
        disabledSections.push(`${pageId}:${section.id}`)
        return { ...section, disabled: true }
      }),
    }
  }
  return { id, settings, cannotShow, score, pages, disabledSections }
}

// --theme <id>, or --theme auto: the bundled theme that can show the most of what was found, weighted (ties go to the
// first in index.json). That is coverage of the data, not a judgement of looks.
const themeArg = process.argv[process.argv.indexOf('--theme') + 1]
const all: { themes: string[] } = JSON.parse(readFileSync(new URL('index.json', THEMES_DIR), 'utf8'))
let chosen = plan(themeArg && themeArg !== 'auto' ? themeArg : 'storeplate')
if (themeArg === 'auto') {
  const plans = all.themes.map(plan)
  for (const p of plans)
    console.log(`  ${p.id.padEnd(12)} score ${p.score}   cannot show: ${p.cannotShow.join(', ') || '-'}`)
  chosen = plans.reduce((best, p) => (p.score > best.score ? p : best))
  console.log(`auto: ${chosen.id}`)
}
const { id: themeId, settings, cannotShow, pages, disabledSections } = chosen
if (cannotShow.length) console.log(`The ${themeId} theme has no setting for: ${cannotShow.join(', ')}`)
if (disabledSections.length) console.log(`Switched off (sample content in the theme): ${disabledSections.join(', ')}`)
if (process.argv.includes('--dry')) {
  await db.$client.end()
  process.exit(0)
}
// ── apply to the scratch shop
await db
  .update(shops)
  .set({ name, logo: logo ?? null })
  .where(eq(shops.id, DEFAULT_SHOP_ID))
const copy = await themeService.create(
  DEFAULT_SHOP_ID,
  { themeId, name: `${name} (imported)`, draft: { settings, pages } },
  db,
)
await themeService.publish(DEFAULT_SHOP_ID, copy.id, db)
console.log('theme copy published:', copy.id)
await db.$client.end()
