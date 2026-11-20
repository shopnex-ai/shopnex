// The shapes of this module's API: what the admin routes accept and answer. Plain Zod, no oRPC or server code, so the
// admin UI imports the same schemas for its forms.
import { z } from 'zod'
import { TRANSLATABLE_RESOURCES } from './languages.schema'

/** A language tag's shape once canonical: 2 or 3 letters, then subtags such as a script or a region (fr, pt-BR, zh-Hant) */
export const LANGUAGE_TAG_PATTERN = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/

/** The canonical form of a language tag (EN → en, pt-br → pt-BR), or null when it isn't one. Pure: safe in the browser. */
export function canonicalLanguage(tag: string): string | null {
  try {
    const [canonical] = Intl.getCanonicalLocales(tag.trim())
    return canonical && canonical !== 'und' && LANGUAGE_TAG_PATTERN.test(canonical) ? canonical : null
  } catch {
    return null
  }
}

/**
 * A short fingerprint of a source text (not a security hash): the admin compares the one stored with a translation to the
 * record's current text to tell whether the text changed since it was translated. The same function runs in the browser.
 */
export function sourceDigest(text: string) {
  // cyrb53: 53 bits, fast, no dependencies
  let h1 = 0xdeadbeef
  let h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 2654435761)
    h2 = Math.imul(h2 ^ c, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

export const language = z
  .string()
  .transform((l, ctx) => {
    const canonical = canonicalLanguage(l)
    if (!canonical) ctx.addIssue({ code: 'custom', message: 'Use a language code such as en, fr or pt-BR' })
    return canonical ?? ''
  })
  .describe('A BCP 47 language tag, e.g. fr or pt-BR')

export const languagesOutput = z.object({
  /** The shop's own language: the text on the records themselves */
  default: z.string(),
  /** The other languages the shop publishes */
  languages: z.array(z.string()),
})

export const languageInput = z.object({ code: language })

export const translationOutput = z.object({
  field: z.string(),
  language: z.string(),
  value: z.string(),
  sourceDigest: z.string(),
  updatedAt: z.date(),
})

export const translationsQuery = z.object({
  resource: z.enum(TRANSLATABLE_RESOURCES),
  resourceId: z.uuid(),
  language: language.optional(),
})

export const translationStatusQuery = z.object({
  resource: z.enum(TRANSLATABLE_RESOURCES),
  language,
})

export const translationStatusOutput = z.array(
  z.object({ resourceId: z.uuid(), field: z.string(), sourceDigest: z.string() }),
)

export const translationInput = z.object({
  resource: z.enum(TRANSLATABLE_RESOURCES),
  resourceId: z.uuid(),
  language,
  field: z.string().min(1).max(80),
  /** The translated text; an empty text removes the translation */
  value: z.string().max(100_000),
  /** The record's text in the shop's language that this was translated from (its fingerprint is kept to spot later edits) */
  source: z.string().max(100_000),
})
