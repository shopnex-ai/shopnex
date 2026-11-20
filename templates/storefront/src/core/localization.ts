// The country a visitor picked (a theme's country selector). The countries come from the shop (Settings → General → Ship-to
// countries); the choice lives in a cookie and is what `localization.country` answers in templates. Prices stay in the shop's
// one currency: this picks where the order ships to, not what it costs.
import type { AstroCookies } from 'astro'

export const COUNTRY_COOKIE = 'shopnex_country'
const MAX_AGE_S = 365 * 24 * 60 * 60

const names = new Intl.DisplayNames(['en'], { type: 'region' })
const nameOf = (code: string) => {
  try {
    return names.of(code) ?? code
  } catch {
    return code
  }
}

export function readCountry(cookies: AstroCookies) {
  return cookies.get(COUNTRY_COOKIE)?.value
}

export function rememberCountry(cookies: AstroCookies, url: URL, code: string) {
  cookies.set(COUNTRY_COOKIE, code, {
    sameSite: 'lax',
    secure: url.protocol === 'https:',
    path: '/',
    maxAge: MAX_AGE_S,
  })
}

/**
 * `localization` in templates: `available_countries` (`iso_code`, `name`, sorted by name; empty unless the shop lists
 * two or more, so a theme only checks `.size > 0`), `country` (the visitor's choice, else the first of the shop's) and `currency`.
 */
export function localizationObject(shipTo: readonly string[], chosen: string | undefined, currency: string | null) {
  const countries = shipTo
    .map((code) => ({ iso_code: code, name: nameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const country = countries.find((c) => c.iso_code === chosen) ?? countries[0] ?? null
  return { available_countries: countries.length > 1 ? countries : [], country, currency }
}

/** A path on this site, nothing else: where the form sends the visitor back to */
export const localPath = (value: unknown) =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/'
