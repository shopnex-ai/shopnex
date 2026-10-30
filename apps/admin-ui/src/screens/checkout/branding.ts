// Hosted checkout isn't rendered by the theme, so it picks up the live theme's look instead: the theme's
// definition says which settings are its colors, fonts and logo (`checkout`), and the merchant's published
// values (or the theme's defaults) for them become CSS variables on the checkout page.
import {
  THEME_DEFINITION_PATH,
  parseThemeManifest,
  resolveSettings,
  type ThemeDefinition,
} from '@shopnex/storefront-sdk/theme'
import { themeService } from '@shopnex/theme'

export type CheckoutBranding = {
  style: Record<string, string>
  fontsHref: string | null
  headingFont: string | null
  logoUrl: string | null
}

const DEFINITIONS_TTL_MS = 60_000
const definitions = new Map<string, { at: number; themes: ThemeDefinition[] }>()

// The storefront serves its themes; checkout is hit by every buyer, so don't ask it each time
async function storefrontThemes(storefrontUrl: string) {
  const cached = definitions.get(storefrontUrl)
  if (cached && Date.now() - cached.at < DEFINITIONS_TTL_MS) return cached.themes
  const res = await fetch(new URL(THEME_DEFINITION_PATH, storefrontUrl), { signal: AbortSignal.timeout(3000) })
  if (!res.ok) return []
  const parsed = parseThemeManifest(await res.json())
  const themes = parsed.success ? parsed.themes : []
  definitions.set(storefrontUrl, { at: Date.now(), themes })
  return themes
}

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
const linear = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map(linear) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
// Text on top of a color: white or black, whichever reads better
const onColor = (hex: string) => (luminance(hex) > 0.4 ? '#000000' : '#ffffff')
const mix = (a: string, b: string, aPercent: number) => `color-mix(in srgb, ${a} ${aPercent}%, ${b})`

const SYSTEM_FONTS = new Set(['system', 'System'])
// Font names come from a select's options, but they end up in a URL and a style: keep to plain family names
const fontName = (value: unknown) =>
  typeof value === 'string' && /^[A-Za-z0-9 ]{1,60}$/.test(value) && !SYSTEM_FONTS.has(value) ? value : null
const httpUrl = (value: unknown) => {
  if (typeof value !== 'string' || !value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null
  } catch {
    return null
  }
}

/** The live theme's checkout look, or null (no storefront, no theme, a theme without `checkout`, or unreachable) */
export async function checkoutBranding(shopId: string, storefrontUrl: string | null): Promise<CheckoutBranding | null> {
  if (!storefrontUrl) return null
  try {
    const live = await themeService.getLive(shopId)
    if (!live) return null
    const definition = (await storefrontThemes(storefrontUrl)).find((theme) => theme.id === live.themeId)
    const map = definition?.checkout
    if (!definition || !map) return null

    const values = resolveSettings(definition.settings, live.published?.settings)
    const color = (id?: string) => {
      const value = id ? values[id] : undefined
      return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : null
    }
    const background = color(map.background)
    const text = color(map.text)
    const accent = color(map.accent)

    const style: Record<string, string> = {}
    if (background) {
      style['--background'] = background
      style['--card'] = background
      style['--popover'] = background
    }
    if (text) {
      style['--foreground'] = text
      style['--card-foreground'] = text
      style['--popover-foreground'] = text
    }
    if (background && text) {
      style['--muted'] = mix(text, background, 5)
      style['--secondary'] = mix(text, background, 5)
      style['--accent'] = mix(text, background, 8)
      style['--accent-foreground'] = text
      style['--muted-foreground'] = mix(text, background, 65)
      style['--border'] = mix(text, background, 15)
      style['--input'] = mix(text, background, 20)
    }
    if (accent) {
      style['--primary'] = accent
      style['--primary-foreground'] = onColor(accent)
      style['--ring'] = accent
    }

    const heading = fontName(map.headingFont && values[map.headingFont])
    const body = fontName(map.bodyFont && values[map.bodyFont])
    const families = [...new Set([heading, body].filter((f): f is string => !!f))]
    if (body) style['fontFamily'] = `'${body}', system-ui, sans-serif`

    const logoUrl = httpUrl(map.logo && values[map.logo])
    if (!Object.keys(style).length && !families.length && !logoUrl) return null
    return {
      style,
      fontsHref: families.length
        ? `https://fonts.googleapis.com/css2?${families.map((f) => `family=${f.replaceAll(' ', '+')}`).join('&')}&display=swap`
        : null,
      headingFont: heading,
      logoUrl,
    }
  } catch {
    return null
  }
}
