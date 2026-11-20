// What a visitor picked in a theme's selectors: a country (where the order ships to) and a language (which translation of the
// store's text they read). The countries and languages come from the shop (Settings → General → Ship-to countries and Settings →
// Languages); each choice lives in a cookie and is what `localization.country` and `localization.language` answer in templates.
// Prices stay in the shop's one currency: the country picks where an order ships to, not what it costs.
import type { AstroCookies } from 'astro'

export const COUNTRY_COOKIE = 'shopnex_country'
export const LANGUAGE_COOKIE = 'shopnex_language'
const MAX_AGE_S = 365 * 24 * 60 * 60

const names = new Intl.DisplayNames(['en'], { type: 'region' })
const nameOf = (code: string) => {
  try {
    return names.of(code) ?? code
  } catch {
    return code
  }
}

// A language is named in itself (Français, Deutsch): that is how a visitor who doesn't read the page finds theirs
const languageName = (code: string) => {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code) ?? code
    return name.charAt(0).toLocaleUpperCase(code) + name.slice(1)
  } catch {
    return code
  }
}

export function readCountry(cookies: AstroCookies) {
  return cookies.get(COUNTRY_COOKIE)?.value
}

/** The language cookie, if it looks like a language tag at all: it is sent on as a header, so nothing else may through */
export function readLanguage(cookies: AstroCookies) {
  const value = cookies.get(LANGUAGE_COOKIE)?.value
  return value && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value) ? value : undefined
}

function remember(cookies: AstroCookies, url: URL, name: string, value: string) {
  cookies.set(name, value, { sameSite: 'lax', secure: url.protocol === 'https:', path: '/', maxAge: MAX_AGE_S })
}
export const rememberCountry = (cookies: AstroCookies, url: URL, code: string) =>
  remember(cookies, url, COUNTRY_COOKIE, code)
export const rememberLanguage = (cookies: AstroCookies, url: URL, code: string) =>
  remember(cookies, url, LANGUAGE_COOKIE, code)

type Choice = {
  shipTo: readonly string[]
  country?: string
  language?: string
  shopLanguage: string
  languages: readonly string[]
}

/**
 * `localization` in templates:
 * - `available_countries` (`iso_code`, `name`, sorted by name; empty unless the shop lists two or more), `country` (the
 *   visitor's choice, else the first of the shop's) and `currency`;
 * - `available_languages` (`iso_code`, `name` in the language itself, the shop's own first; empty unless the shop publishes
 *   another one) and `language` (the visitor's choice if the shop publishes it, else the shop's own).
 * A theme only checks `.size > 0` to know whether to draw a selector.
 */
export function localizationObject(choice: Choice, currency: string | null) {
  const countries = choice.shipTo
    .map((code) => ({ iso_code: code, name: nameOf(code) }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const country = countries.find((c) => c.iso_code === choice.country) ?? countries[0] ?? null

  const all = [choice.shopLanguage, ...choice.languages.filter((l) => l !== choice.shopLanguage)]
  const languages = all.map((code) => ({ iso_code: code, name: languageName(code) }))
  const language = languages.find((l) => l.iso_code === choice.language) ?? languages[0]!

  return {
    available_countries: countries.length > 1 ? countries : [],
    country,
    currency,
    available_languages: languages.length > 1 ? languages : [],
    language,
  }
}

/** A path on this site, nothing else: where the form sends the visitor back to */
export const localPath = (value: unknown) =>
  typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('\\') ? value : '/'
