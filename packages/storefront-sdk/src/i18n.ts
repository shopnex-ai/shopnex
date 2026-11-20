// A theme's text in the visitor's language (dependency-free, for servers and theme scripts alike). A theme keeps its text in locale
// files (locales/en.default.json, locales/fr.json…): nested JSON, read as dotted keys (`cart.empty`). A message may hold
// `{{ name }}` placeholders and plural forms: `{ "one": "{{ count }} item", "other": "{{ count }} items" }`.

export const PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const
type PluralCategory = (typeof PLURAL_CATEGORIES)[number]

export type Message = string | Partial<Record<PluralCategory, string>>
export type Messages = Record<string, Message>

const isPlural = (value: object) => {
  const keys = Object.keys(value)
  return keys.length > 0 && 'other' in value && keys.every((k) => (PLURAL_CATEGORIES as readonly string[]).includes(k))
}

/** Locale JSON as dotted keys: `{ cart: { empty: "…" } }` → `cart.empty`. An object of plural forms is one message. */
export function flattenMessages(tree: unknown, prefix = '', into: Messages = {}): Messages {
  if (typeof tree === 'string') {
    if (prefix) into[prefix] = tree
  } else if (tree && typeof tree === 'object' && !Array.isArray(tree)) {
    if (prefix && isPlural(tree)) into[prefix] = tree as Message
    else
      for (const [key, value] of Object.entries(tree)) flattenMessages(value, prefix ? `${prefix}.${key}` : key, into)
  }
  return into
}

/** The locale files to try for a language, most specific first: pt-BR → pt-BR, pt */
export function languageChain(language: string) {
  const chain = [language]
  const base = language.split('-')[0]
  if (base && base !== language) chain.push(base)
  return chain
}

function pluralCategory(count: number, language: string): PluralCategory {
  try {
    return new Intl.PluralRules(language).select(count)
  } catch {
    return count === 1 ? 'one' : 'other'
  }
}

/** Fills a message: the plural form for `count`, then each `{{ name }}` from `vars` (a name with no value stays as written) */
export function formatMessage(message: Message, vars: Record<string, unknown> | undefined, language: string): string {
  let text: string
  if (typeof message === 'string') text = message
  else {
    const count = Number(vars?.count)
    text = (Number.isFinite(count) ? message[pluralCategory(count, language)] : undefined) ?? message.other ?? ''
  }
  if (!vars) return text
  return text.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}

// ── in the browser ────────────────────────────────────────────────────────────

let embedded: Messages | undefined

/** The strings the page embeds for its scripts (<script type="application/json" id="shopnex-i18n">), read once */
function strings(): Messages {
  if (embedded) return embedded
  try {
    const el = typeof document === 'undefined' ? null : document.getElementById('shopnex-i18n')
    embedded = el?.textContent ? (JSON.parse(el.textContent) as Messages) : {}
  } catch {
    embedded = {}
  }
  return embedded
}

/** Theme text for a script, in the page's language; the key itself when the theme has no such text. */
export function t(key: string, vars?: Record<string, unknown>) {
  const message = strings()[key]
  const language = typeof document === 'undefined' ? 'en' : document.documentElement.lang || 'en'
  return message === undefined ? key : formatMessage(message, vars, language)
}
