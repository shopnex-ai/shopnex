// A theme's text in the visitor's language. The theme keeps it in locales/ (locales/en.default.json is its own language and the
// fallback, locales/fr.json and locales/pt-BR.json are translations of it), see @shopnex/storefront-sdk/i18n for the format.
// A key a language has no text for falls back to the theme's default language, key by key, so a half-translated theme never shows
// blanks.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { flattenMessages, formatMessage, languageChain, type Messages } from '@shopnex/storefront-sdk/i18n'

const dev = import.meta.env?.DEV ?? false

interface Catalog {
  /** Messages by lower-case language tag */
  languages: Map<string, Messages>
  defaultLanguage: string
  /** The folder's modification time when read: in development an edited file is read again */
  stamp: number
  /** What a language sees: the default's text with its own over it (built once per language) */
  merged: Map<string, Messages>
}

const FILE = /^([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)(\.default)?\.json$/
const catalogs = new Map<string, Catalog>()

function read(dir: string, stamp: number): Catalog {
  const folder = join(dir, 'locales')
  const languages = new Map<string, Messages>()
  let defaultLanguage = 'en'
  if (existsSync(folder)) {
    for (const file of readdirSync(folder).sort()) {
      const match = FILE.exec(file)
      if (!match?.[1]) continue
      try {
        languages.set(match[1].toLowerCase(), flattenMessages(JSON.parse(readFileSync(join(folder, file), 'utf8'))))
      } catch {
        // A broken file counts as missing: the theme shows its default language instead of failing the page
        continue
      }
      if (match[2]) defaultLanguage = match[1].toLowerCase()
    }
  }
  return { languages, defaultLanguage, stamp, merged: new Map() }
}

function catalogOf(dir: string): Catalog {
  const stamp = dev ? (existsSync(join(dir, 'locales')) ? statSync(join(dir, 'locales')).mtimeMs : 0) : 0
  const found = catalogs.get(dir)
  if (found && found.stamp === stamp) return found
  const catalog = read(dir, stamp)
  catalogs.set(dir, catalog)
  return catalog
}

/** Everything the theme says to a language: its default language's text, with the language's own (and its base's) over it */
export function messagesFor(dir: string, language: string): Messages {
  const catalog = catalogOf(dir)
  const key = language.toLowerCase()
  let merged = catalog.merged.get(key)
  if (!merged) {
    merged = { ...catalog.languages.get(catalog.defaultLanguage) }
    for (const tag of languageChain(key).reverse()) Object.assign(merged, catalog.languages.get(tag))
    catalog.merged.set(key, merged)
  }
  return merged
}

/** `{{ 'cart.empty' | t }}`: the text for a key, in a language. A key the theme has no text for says so, like Shopify's. */
export function translateKey(dir: string, language: string, key: string, vars?: Record<string, unknown>) {
  const message = messagesFor(dir, language)[key]
  return message === undefined ? `translation missing: ${key}` : formatMessage(message, vars, language)
}

/** What a theme's scripts need in a language: its `js.*` text, embedded in the page (read there with `t` from the SDK) */
export function scriptMessages(dir: string, language: string): Messages {
  return Object.fromEntries(Object.entries(messagesFor(dir, language)).filter(([key]) => key.startsWith('js.')))
}
