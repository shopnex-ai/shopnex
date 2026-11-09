// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Every query is scoped by shopId; there is deliberately no unscoped variant.
import { and, asc, eq, sql } from 'drizzle-orm'
import { db, schema, type Conn } from '@shopnex/db'
import type {
  CustomFieldDefinition,
  CustomFieldResource,
  CustomFieldType,
  CustomFieldValue,
  CustomFieldValues,
} from '@shopnex/db/schema'
import { CustomFieldError } from './errors'

export type CustomFieldInput = {
  resource: CustomFieldResource
  key: string
  label: string
  type: CustomFieldType
  /** The allowed values of a `choice` field; required for it and refused for the other types */
  options?: string[]
  storefront?: boolean
}

// The key, resource and type are fixed once created (values already stored depend on them)
// Choices can be added, never removed (values already saved may use them)
export type CustomFieldPatch = Partial<Pick<CustomFieldDefinition, 'label' | 'storefront' | 'position' | 'options'>>

/** What a request sends: a value sets the field, null clears it, keys left out stay as they are */
export type CustomFieldUpdates = Record<string, CustomFieldValue | null>

const MAX_TEXT = 1000

const tables = {
  product: schema.products,
  order: schema.orders,
  customer: schema.customers,
} as const

export async function list(shopId: string, resource?: CustomFieldResource, conn: Conn = db) {
  return conn
    .select()
    .from(schema.customFieldDefinitions)
    .where(
      and(
        eq(schema.customFieldDefinitions.shopId, shopId),
        resource ? eq(schema.customFieldDefinitions.resource, resource) : undefined,
      ),
    )
    .orderBy(
      asc(schema.customFieldDefinitions.resource),
      asc(schema.customFieldDefinitions.position),
      asc(schema.customFieldDefinitions.createdAt),
    )
}

const invalid = (message: string) => new CustomFieldError('INVALID_VALUE', message)

function cleanOptions(type: CustomFieldType, options: string[] | undefined) {
  const clean = [...new Set((options ?? []).map((o) => o.trim()).filter(Boolean))]
  if (type !== 'choice') {
    if (clean.length) throw invalid('Only a choice field has options')
    return clean
  }
  if (!clean.length) throw invalid('A choice field needs at least one option')
  if (clean.length > 50 || clean.some((o) => o.length > 100)) throw invalid('Up to 50 options of 100 characters')
  return clean
}

export async function create(shopId: string, input: CustomFieldInput, conn: Conn = db) {
  const existing = await list(shopId, input.resource, conn)
  const [row] = await conn
    .insert(schema.customFieldDefinitions)
    .values({
      ...input,
      options: cleanOptions(input.type, input.options),
      shopId,
      position: existing.reduce((max, f) => Math.max(max, f.position), -1) + 1,
    })
    .onConflictDoNothing()
    .returning()
  if (!row)
    throw new CustomFieldError('KEY_TAKEN', `A ${input.resource} field with the key "${input.key}" already exists`)
  return row
}

// Null when not found
export async function update(shopId: string, id: string, patch: CustomFieldPatch, conn: Conn = db) {
  if (patch.options) {
    const [current] = await conn
      .select()
      .from(schema.customFieldDefinitions)
      .where(and(eq(schema.customFieldDefinitions.shopId, shopId), eq(schema.customFieldDefinitions.id, id)))
    if (!current) return null
    const options = cleanOptions(current.type, patch.options)
    if (current.options.some((o) => !options.includes(o))) throw invalid('Options can be added but not removed')
    patch = { ...patch, options }
  }
  const [row] = await conn
    .update(schema.customFieldDefinitions)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(schema.customFieldDefinitions.shopId, shopId), eq(schema.customFieldDefinitions.id, id)))
    .returning()
  return row ?? null
}

// Deletes the definition and the values stored under its key. Null when not found.
export async function remove(shopId: string, id: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(schema.customFieldDefinitions)
      .where(and(eq(schema.customFieldDefinitions.shopId, shopId), eq(schema.customFieldDefinitions.id, id)))
      .returning()
    if (!row) return null
    const table = tables[row.resource]
    await tx
      .update(table)
      .set({ customFields: sql`${table.customFields} - ${row.key}::text` })
      .where(and(eq(table.shopId, shopId), sql`${table.customFields} ? ${row.key}::text`))
    return row
  })
}

function check(def: CustomFieldDefinition, value: CustomFieldValue): CustomFieldValue {
  const bad = (why: string) => new CustomFieldError('INVALID_VALUE', `Custom field "${def.key}" (${def.type}): ${why}`)
  switch (def.type) {
    case 'text': {
      if (typeof value !== 'string') throw bad('expected text')
      if (value.length > MAX_TEXT) throw bad(`at most ${MAX_TEXT} characters`)
      return value
    }
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw bad('expected a number')
      return value
    }
    case 'boolean': {
      if (typeof value !== 'boolean') throw bad('expected true or false')
      return value
    }
    case 'choice': {
      if (typeof value !== 'string' || !def.options.includes(value)) {
        throw bad(`expected one of: ${def.options.join(', ')}`)
      }
      return value
    }
    case 'file': {
      // The URL an upload (Admin API: files) answers with
      if (typeof value !== 'string' || value.length > 2000) throw bad('expected the URL of an uploaded file')
      let url: URL
      try {
        url = new URL(value)
      } catch {
        throw bad('expected an absolute http(s) URL')
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw bad('expected an absolute http(s) URL')
      return value
    }
  }
}

/**
 * The values a record ends up with after `updates` are applied to its `current` ones: each value is checked against
 * the field's type, null clears a field, and a key without a definition is rejected.
 */
export async function merge(
  shopId: string,
  resource: CustomFieldResource,
  updates: CustomFieldUpdates,
  current: CustomFieldValues = {},
  conn: Conn = db,
): Promise<CustomFieldValues> {
  const keys = Object.keys(updates)
  if (!keys.length) return current
  const defs = new Map((await list(shopId, resource, conn)).map((d) => [d.key, d]))
  const next = { ...current }
  for (const key of keys) {
    const def = defs.get(key)
    if (!def) throw new CustomFieldError('INVALID_VALUE', `There is no ${resource} custom field "${key}"`)
    const value = updates[key]
    if (value === null || value === undefined) delete next[key]
    else next[key] = check(def, value)
  }
  return next
}

/** The fields themes and the Storefront API may show for `resource`: storefront-visible definitions, non-empty values */
export async function storefrontView(
  shopId: string,
  resource: CustomFieldResource,
  conn: Conn = db,
): Promise<(values: CustomFieldValues) => CustomFieldValues> {
  const keys = (await list(shopId, resource, conn)).filter((d) => d.storefront).map((d) => d.key)
  return (values) => Object.fromEntries(keys.flatMap((k) => (values[k] === undefined ? [] : [[k, values[k]!]])))
}

/**
 * Conditions for filtering a list by custom field values: "key:value" pairs, all of which must match. With
 * `storefrontOnly`, a key that is not shown on the storefront matches nothing, so private values can't be probed.
 */
export async function parseFilters(
  shopId: string,
  resource: CustomFieldResource,
  pairs: string[],
  opts: { storefrontOnly?: boolean } = {},
  conn: Conn = db,
): Promise<Record<string, string>> {
  if (!pairs.length) return {}
  const defs = new Map(
    (await list(shopId, resource, conn)).filter((d) => !opts.storefrontOnly || d.storefront).map((d) => [d.key, d]),
  )
  const filters: Record<string, string> = {}
  for (const pair of pairs) {
    const at = pair.indexOf(':')
    const key = pair.slice(0, at)
    if (at < 1 || !defs.has(key)) throw invalid(`There is no ${resource} custom field to filter by in "${pair}"`)
    filters[key] = pair.slice(at + 1)
  }
  return filters
}
