// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Every query is scoped by shopId; there is deliberately no unscoped variant.
import { and, asc, count, eq, inArray } from 'drizzle-orm'
import type { Conn } from '@shopnex/db'
import { shops } from '@shopnex/core/schema'
import { sourceDigest } from './languages.contract'
import { LanguageError } from './languages.errors'
import {
  MAX_LANGUAGES,
  TRANSLATABLE_FIELDS,
  shopLanguages,
  translations,
  type TranslatableResource,
} from './languages.schema'

/** The shop's own language and the others it publishes */
export async function list(shopId: string, conn: Conn) {
  const [[shop], rows] = await Promise.all([
    conn.select({ language: shops.language }).from(shops).where(eq(shops.id, shopId)),
    conn.select().from(shopLanguages).where(eq(shopLanguages.shopId, shopId)).orderBy(asc(shopLanguages.code)),
  ])
  return { default: shop?.language ?? 'en', languages: rows.map((r) => r.code) }
}

/** Publishes a language (a canonical code). Publishing the default or an already published one changes nothing. */
export async function publish(shopId: string, code: string, conn: Conn) {
  const current = await list(shopId, conn)
  if (code === current.default || current.languages.includes(code)) return current
  if (current.languages.length >= MAX_LANGUAGES) {
    throw new LanguageError('TOO_MANY_LANGUAGES', `A shop can publish up to ${MAX_LANGUAGES} languages`)
  }
  await conn.insert(shopLanguages).values({ shopId, code }).onConflictDoNothing()
  return list(shopId, conn)
}

/** Stops publishing a language. Its translations are kept, so publishing it again brings them back. */
export async function unpublish(shopId: string, code: string, conn: Conn) {
  await conn.delete(shopLanguages).where(and(eq(shopLanguages.shopId, shopId), eq(shopLanguages.code, code)))
  return list(shopId, conn)
}

/** What a record has translated: one language, or all of them */
export function translationsOf(
  shopId: string,
  resource: TranslatableResource,
  resourceId: string,
  language: string | undefined,
  conn: Conn,
) {
  return conn
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.shopId, shopId),
        eq(translations.resource, resource),
        eq(translations.resourceId, resourceId),
        language ? eq(translations.language, language) : undefined,
      ),
    )
    .orderBy(asc(translations.language), asc(translations.field))
}

export interface TranslateInput {
  resource: TranslatableResource
  resourceId: string
  language: string
  field: string
  /** Empty text removes the translation */
  value: string
  /** The text in the shop's language this was translated from */
  source: string
}

/** Sets one translated field, or removes it when the text is empty. Returns the stored translation, or null when removed. */
export async function translate(shopId: string, input: TranslateInput, conn: Conn) {
  const fields: readonly string[] = TRANSLATABLE_FIELDS[input.resource]
  if (!fields.includes(input.field)) {
    throw new LanguageError(
      'INVALID_FIELD',
      `A ${input.resource}'s ${fields.join(' and ')} can be translated, not "${input.field}"`,
    )
  }
  const { languages } = await list(shopId, conn)
  if (!languages.includes(input.language)) {
    throw new LanguageError('LANGUAGE_NOT_PUBLISHED', `Publish ${input.language} before translating into it`)
  }
  const where = and(
    eq(translations.shopId, shopId),
    eq(translations.resource, input.resource),
    eq(translations.resourceId, input.resourceId),
    eq(translations.field, input.field),
    eq(translations.language, input.language),
  )
  if (input.value.trim() === '') {
    await conn.delete(translations).where(where)
    return null
  }
  const values = { value: input.value, sourceDigest: sourceDigest(input.source) }
  const [row] = await conn
    .insert(translations)
    .values({
      shopId,
      resource: input.resource,
      resourceId: input.resourceId,
      field: input.field,
      language: input.language,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        translations.shopId,
        translations.resource,
        translations.resourceId,
        translations.field,
        translations.language,
      ],
      set: { ...values, updatedAt: new Date() },
    })
    .returning()
  return row!
}

/**
 * For the storefront: the translated fields of many records in one language, by record id. A record or field with no
 * translation is simply absent, so the caller keeps the record's own text.
 */
export async function forResources(
  shopId: string,
  resource: TranslatableResource,
  ids: string[],
  language: string,
  conn: Conn,
) {
  const byId = new Map<string, Record<string, string>>()
  if (ids.length === 0) return byId
  const rows = await conn
    .select()
    .from(translations)
    .where(
      and(
        eq(translations.shopId, shopId),
        eq(translations.resource, resource),
        eq(translations.language, language),
        inArray(translations.resourceId, ids),
      ),
    )
  for (const row of rows) {
    const fields = byId.get(row.resourceId) ?? {}
    fields[row.field] = row.value
    byId.set(row.resourceId, fields)
  }
  return byId
}

/** For the module that owns the record: delete its translations along with it */
export async function removeFor(
  shopId: string,
  resource: TranslatableResource,
  resourceIds: string | string[],
  conn: Conn,
) {
  const ids = Array.isArray(resourceIds) ? resourceIds : [resourceIds]
  if (!ids.length) return
  await conn
    .delete(translations)
    .where(
      and(eq(translations.shopId, shopId), eq(translations.resource, resource), inArray(translations.resourceId, ids)),
    )
}

/** How many translations a shop has (for the admin's overview and tests) */
export async function countFor(shopId: string, conn: Conn) {
  const [row] = await conn.select({ n: count() }).from(translations).where(eq(translations.shopId, shopId))
  return row?.n ?? 0
}
