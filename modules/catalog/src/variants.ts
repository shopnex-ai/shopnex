// Shopify-style options → values → variants.
// Invariants (enforced here and by unique indexes):
//   - every product has ≥ 1 variant; a product without options has exactly one default variant (optionsKey '')
//   - a variant picks exactly one value per option; each combination exists at most once per product
//   - variants are the source of truth for price; products.price_cents is a cached minimum (syncPriceCache)
import { and, asc, eq, inArray, min, ne, notInArray, sql } from 'drizzle-orm'
import { publicationService } from '@shopnex/channels'
import { db, schema, type Conn } from '@shopnex/db'
import type { ProductVariant } from '@shopnex/db/schema'
import { CatalogError } from './errors'
// Cycle with ./products is fine: only used inside functions
import { emitProductEvent } from './products'

export type OptionInput = { name: string; values: string[] }

export type VariantInput = {
  /** option name → value; omit for a product without options */
  options?: Record<string, string>
  sku?: string | null
  priceCents: number
  compareAtPriceCents?: number | null
  /** null/omitted = not tracked (always available) */
  inventoryQuantity?: number | null
  imageUrl?: string | null
}

export type VariantsInput = { options: OptionInput[]; variants: VariantInput[] }

export type VariantDetail = Pick<
  ProductVariant,
  'id' | 'title' | 'sku' | 'priceCents' | 'compareAtPriceCents' | 'inventoryQuantity' | 'imageUrl'
> & {
  available: boolean
  /** option name → value */
  options: Record<string, string>
  /** Same, as an array in option order (Shopify's selectedOptions) */
  selectedOptions: { name: string; value: string }[]
}

export type OptionValueDetail = {
  id: string
  name: string
  /** Variant pairing this value with the first value of every other option (Shopify semantics) */
  firstSelectableVariantId: string | null
}

export type OptionDetail = { id: string; name: string; values: string[]; optionValues: OptionValueDetail[] }

const DEFAULT_KEY = ''
// Shopify's convention for the hidden default variant (themes check for it)
export const DEFAULT_VARIANT_TITLE = 'Default Title'

// Canonical, order-independent identity of a combination (stable across option re-ordering)
export function optionsKey(options: Record<string, string>): string {
  const entries = Object.entries(options).sort(([a], [b]) => a.localeCompare(b))
  return entries.length ? JSON.stringify(entries) : DEFAULT_KEY
}

const isAvailable = (v: Pick<ProductVariant, 'inventoryQuantity'>) =>
  v.inventoryQuantity == null || v.inventoryQuantity > 0

function invalid(message: string): never {
  throw new CatalogError('INVALID_VARIANTS', message)
}

// Normalizes and validates; returns variants with their key + title
function validate(input: VariantsInput) {
  const options = input.options.map((o) => ({ name: o.name.trim(), values: o.values.map((v) => v.trim()) }))
  const names = new Set<string>()
  for (const o of options) {
    if (!o.name) invalid('Option names must not be empty')
    if (names.has(o.name.toLowerCase())) invalid(`Duplicate option "${o.name}"`)
    names.add(o.name.toLowerCase())
    if (o.values.length === 0) invalid(`Option "${o.name}" needs at least one value`)
    if (o.values.some((v) => !v)) invalid(`Option "${o.name}" has an empty value`)
    if (new Set(o.values).size !== o.values.length) invalid(`Option "${o.name}" has duplicate values`)
  }
  if (input.variants.length === 0) invalid('A product needs at least one variant')
  if (options.length === 0 && input.variants.length !== 1) invalid('A product without options has exactly one variant')

  const keys = new Set<string>()
  const skus = new Set<string>()
  const variants = input.variants.map((v, position) => {
    const picked = Object.fromEntries(Object.entries(v.options ?? {}).map(([k, val]) => [k.trim(), val.trim()]))
    if (Object.keys(picked).length !== options.length) {
      invalid(
        `Variant ${position + 1} must pick exactly one value for each option (${options.map((o) => o.name).join(', ') || 'none'})`,
      )
    }
    for (const o of options) {
      const value = picked[o.name]
      if (value === undefined) invalid(`Variant ${position + 1} is missing option "${o.name}"`)
      if (!o.values.includes(value)) invalid(`Variant ${position + 1}: "${value}" is not a value of "${o.name}"`)
    }
    const key = optionsKey(picked)
    if (keys.has(key)) invalid(`Duplicate variant for ${options.map((o) => `${o.name}=${picked[o.name]}`).join(', ')}`)
    keys.add(key)
    const sku = v.sku?.trim() || null
    if (sku) {
      if (skus.has(sku)) invalid(`Duplicate SKU "${sku}"`)
      skus.add(sku)
    }
    return {
      key,
      position,
      picked,
      sku,
      title: options.length ? options.map((o) => picked[o.name]).join(' / ') : DEFAULT_VARIANT_TITLE,
      priceCents: v.priceCents,
      compareAtPriceCents: v.compareAtPriceCents ?? null,
      inventoryQuantity: v.inventoryQuantity ?? null,
      imageUrl: v.imageUrl ?? null,
    }
  })
  return { options, variants }
}

async function assertSkusFree(conn: Conn, shopId: string, productId: string, skus: string[]) {
  if (skus.length === 0) return
  const [clash] = await conn
    .select({ sku: schema.productVariants.sku })
    .from(schema.productVariants)
    .where(
      and(
        eq(schema.productVariants.shopId, shopId),
        inArray(schema.productVariants.sku, skus),
        ne(schema.productVariants.productId, productId),
      ),
    )
    .limit(1)
  if (clash) throw new CatalogError('SKU_TAKEN', `SKU "${clash.sku}" is already used by another product`)
}

// products.price_cents := lowest variant price (deprecated cache, see schema)
export async function syncPriceCache(conn: Conn, productId: string) {
  const [{ lowest } = { lowest: null }] = await conn
    .select({ lowest: min(schema.productVariants.priceCents) })
    .from(schema.productVariants)
    .where(eq(schema.productVariants.productId, productId))
  if (lowest != null) {
    await conn
      .update(schema.products)
      .set({ priceCents: lowest, updatedAt: new Date() })
      .where(eq(schema.products.id, productId))
  }
}

// Replaces a product's options + variants. Existing variants are matched by option combination
// and keep their ids (orders/carts reference them); only combinations no longer present are deleted.
// Caller must have verified the product belongs to shopId and run this inside a transaction.
export async function applyVariants(conn: Conn, shopId: string, productId: string, input: VariantsInput) {
  const { options, variants } = validate(input)
  await assertSkusFree(
    conn,
    shopId,
    productId,
    variants.flatMap((v) => (v.sku ? [v.sku] : [])),
  )

  // 1. Options: upsert by name, delete the rest (cascades to values + variant links)
  const existingOptions = await conn
    .select()
    .from(schema.productOptions)
    .where(eq(schema.productOptions.productId, productId))
  const keepNames = new Set(options.map((o) => o.name))
  const removedOptionIds = existingOptions.filter((o) => !keepNames.has(o.name)).map((o) => o.id)
  if (removedOptionIds.length) {
    await conn.delete(schema.productOptions).where(inArray(schema.productOptions.id, removedOptionIds))
  }

  const valueIds = new Map<string, Map<string, string>>() // option name → value → value id
  for (const [position, option] of options.entries()) {
    const [row] = await conn
      .insert(schema.productOptions)
      .values({ productId, name: option.name, position })
      .onConflictDoUpdate({
        target: [schema.productOptions.productId, schema.productOptions.name],
        set: { position },
      })
      .returning()
    const optionId = row!.id

    // 2. Values: upsert by value, delete the rest
    await conn
      .delete(schema.productOptionValues)
      .where(
        and(
          eq(schema.productOptionValues.optionId, optionId),
          notInArray(schema.productOptionValues.value, option.values),
        ),
      )
    const ids = new Map<string, string>()
    for (const [valuePosition, value] of option.values.entries()) {
      const [v] = await conn
        .insert(schema.productOptionValues)
        .values({ optionId, value, position: valuePosition })
        .onConflictDoUpdate({
          target: [schema.productOptionValues.optionId, schema.productOptionValues.value],
          set: { position: valuePosition },
        })
        .returning()
      ids.set(value, v!.id)
    }
    valueIds.set(option.name, ids)
  }

  // 3. Variants: upsert by combination key, delete combinations that are gone
  const existingVariants = await conn
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.productId, productId))
  const byKey = new Map(existingVariants.map((v) => [v.optionsKey, v]))
  const keepKeys = new Set(variants.map((v) => v.key))
  const removedVariantIds = existingVariants.filter((v) => !keepKeys.has(v.optionsKey)).map((v) => v.id)
  if (removedVariantIds.length) {
    await conn.delete(schema.productVariants).where(inArray(schema.productVariants.id, removedVariantIds))
  }

  const savedIds: string[] = []
  for (const v of variants) {
    const fields = {
      title: v.title,
      sku: v.sku,
      priceCents: v.priceCents,
      compareAtPriceCents: v.compareAtPriceCents,
      inventoryQuantity: v.inventoryQuantity,
      imageUrl: v.imageUrl,
      position: v.position,
      updatedAt: new Date(),
    }
    const existing = byKey.get(v.key)
    if (existing) {
      await conn.update(schema.productVariants).set(fields).where(eq(schema.productVariants.id, existing.id))
      savedIds.push(existing.id)
    } else {
      const [row] = await conn
        .insert(schema.productVariants)
        .values({ ...fields, shopId, productId, optionsKey: v.key })
        .returning({ id: schema.productVariants.id })
      savedIds.push(row!.id)
    }
  }

  // 4. Variant ↔ option value links, rebuilt from scratch
  await conn.delete(schema.variantOptionValues).where(inArray(schema.variantOptionValues.variantId, savedIds))
  const links = variants.flatMap((v, i) =>
    Object.entries(v.picked).map(([name, value]) => ({
      variantId: savedIds[i]!,
      optionValueId: valueIds.get(name)!.get(value)!,
    })),
  )
  if (links.length) await conn.insert(schema.variantOptionValues).values(links)

  await syncPriceCache(conn, productId)
}

// Batch-load options + variants for many products (4 queries, no N+1)
export async function loadForProducts(productIds: string[], conn: Conn = db) {
  const options = new Map<string, OptionDetail[]>()
  const variants = new Map<string, VariantDetail[]>()
  if (productIds.length === 0) return { options, variants }

  const optionRows = await conn
    .select()
    .from(schema.productOptions)
    .where(inArray(schema.productOptions.productId, productIds))
    .orderBy(asc(schema.productOptions.position))
  const valueRows = optionRows.length
    ? await conn
        .select()
        .from(schema.productOptionValues)
        .where(
          inArray(
            schema.productOptionValues.optionId,
            optionRows.map((o) => o.id),
          ),
        )
        .orderBy(asc(schema.productOptionValues.position))
    : []
  const variantRows = await conn
    .select()
    .from(schema.productVariants)
    .where(inArray(schema.productVariants.productId, productIds))
    .orderBy(asc(schema.productVariants.position))
  const linkRows = variantRows.length
    ? await conn
        .select({
          variantId: schema.variantOptionValues.variantId,
          name: schema.productOptions.name,
          value: schema.productOptionValues.value,
        })
        .from(schema.variantOptionValues)
        .innerJoin(
          schema.productOptionValues,
          eq(schema.productOptionValues.id, schema.variantOptionValues.optionValueId),
        )
        .innerJoin(schema.productOptions, eq(schema.productOptions.id, schema.productOptionValues.optionId))
        .where(
          inArray(
            schema.variantOptionValues.variantId,
            variantRows.map((v) => v.id),
          ),
        )
    : []

  const linksByVariant = new Map<string, Record<string, string>>()
  for (const l of linkRows) linksByVariant.set(l.variantId, { ...linksByVariant.get(l.variantId), [l.name]: l.value })

  for (const v of variantRows) {
    const picked = linksByVariant.get(v.id) ?? {}
    const productOptions = optionRows.filter((o) => o.productId === v.productId)
    const list = variants.get(v.productId) ?? []
    list.push({
      id: v.id,
      title: v.title,
      sku: v.sku,
      priceCents: v.priceCents,
      compareAtPriceCents: v.compareAtPriceCents,
      inventoryQuantity: v.inventoryQuantity,
      imageUrl: v.imageUrl,
      available: isAvailable(v),
      options: picked,
      selectedOptions: productOptions.flatMap((o) =>
        picked[o.name] ? [{ name: o.name, value: picked[o.name]! }] : [],
      ),
    })
    variants.set(v.productId, list)
  }

  for (const o of optionRows) {
    const values = valueRows.filter((v) => v.optionId === o.id)
    const productVariants = variants.get(o.productId) ?? []
    const others = optionRows.filter((x) => x.productId === o.productId && x.id !== o.id)
    // Rank of a variant = positions of its values in the *other* options (lower = earlier)
    const rank = (variant: VariantDetail) =>
      others.map(
        (x) => valueRows.find((v) => v.optionId === x.id && v.value === variant.options[x.name])?.position ?? Infinity,
      )
    const earlier = (a: number[], b: number[]) => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i]! < b[i]!
      return false
    }
    const list = options.get(o.productId) ?? []
    list.push({
      id: o.id,
      name: o.name,
      values: values.map((v) => v.value),
      optionValues: values.map((value) => {
        let best: VariantDetail | null = null
        for (const variant of productVariants) {
          if (variant.options[o.name] !== value.value) continue
          if (!best || earlier(rank(variant), rank(best))) best = variant
        }
        return { id: value.id, name: value.value, firstSelectableVariantId: best?.id ?? null }
      }),
    })
    options.set(o.productId, list)
  }
  return { options, variants }
}

export async function listByProduct(productId: string, conn: Conn = db) {
  return conn
    .select()
    .from(schema.productVariants)
    .where(eq(schema.productVariants.productId, productId))
    .orderBy(asc(schema.productVariants.position))
}

// For orders: variants (with product title) by id, scoped to the shop
// Product details copied onto order lines: vendor, and the image (variant's own, else the product's first)
const orderSnapshotFields = {
  productVendor: schema.products.vendor,
  imageUrl: sql<
    string | null
  >`coalesce(${schema.productVariants.imageUrl}, (select ${schema.productImages.url} from ${schema.productImages} where ${schema.productImages.productId} = ${schema.products.id} order by ${schema.productImages.position} limit 1))`,
}

/** `channelId`: only variants of products published on that channel now */
export async function getManyByIds(shopId: string, ids: string[], conn: Conn = db, opts: { channelId?: string } = {}) {
  if (ids.length === 0) return []
  return conn
    .select({
      variant: schema.productVariants,
      productTitle: schema.products.title,
      productStatus: schema.products.status,
      ...orderSnapshotFields,
    })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(
      and(
        eq(schema.productVariants.shopId, shopId),
        inArray(schema.productVariants.id, ids),
        opts.channelId ? publicationService.liveOn('product', opts.channelId, schema.products.id) : undefined,
      ),
    )
}

// For orders: all variants of the given products (with product title), scoped to the shop
export async function listForProducts(shopId: string, productIds: string[], conn: Conn = db) {
  if (productIds.length === 0) return []
  return conn
    .select({ variant: schema.productVariants, productTitle: schema.products.title, ...orderSnapshotFields })
    .from(schema.productVariants)
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(and(eq(schema.productVariants.shopId, shopId), inArray(schema.productVariants.productId, productIds)))
}

// Partial update of one variant (price, SKU, stock). Returns null if not in this shop.
export async function update(
  shopId: string,
  id: string,
  patch: Partial<Pick<VariantInput, 'sku' | 'priceCents' | 'compareAtPriceCents' | 'inventoryQuantity'>>,
) {
  return db.transaction(async (tx) => {
    const [variant] = await tx
      .select()
      .from(schema.productVariants)
      .where(and(eq(schema.productVariants.shopId, shopId), eq(schema.productVariants.id, id)))
    if (!variant) return null
    const sku = patch.sku === undefined ? undefined : patch.sku?.trim() || null
    if (sku) {
      const [clash] = await tx
        .select({ id: schema.productVariants.id })
        .from(schema.productVariants)
        .where(
          and(
            eq(schema.productVariants.shopId, shopId),
            eq(schema.productVariants.sku, sku),
            ne(schema.productVariants.id, id),
          ),
        )
      if (clash) throw new CatalogError('SKU_TAKEN', `SKU "${sku}" is already used`)
    }
    const [updated] = await tx
      .update(schema.productVariants)
      .set({ ...patch, ...(sku !== undefined && { sku }), updatedAt: new Date() })
      .where(eq(schema.productVariants.id, id))
      .returning()
    await syncPriceCache(tx, variant.productId)
    await emitProductEvent(tx, shopId, variant.productId, 'product.updated')
    return { ...updated!, available: isAvailable(updated!) }
  })
}

// Atomically takes stock for an order line. Untracked variants always succeed.
export async function reserveStock(conn: Conn, variantId: string, quantity: number) {
  const [row] = await conn
    .update(schema.productVariants)
    .set({ inventoryQuantity: sql`${schema.productVariants.inventoryQuantity} - ${quantity}` })
    .where(
      and(eq(schema.productVariants.id, variantId), sql`${schema.productVariants.inventoryQuantity} >= ${quantity}`),
    )
    .returning({ id: schema.productVariants.id })
  if (row) return true
  const [untracked] = await conn
    .select({ id: schema.productVariants.id })
    .from(schema.productVariants)
    .where(and(eq(schema.productVariants.id, variantId), sql`${schema.productVariants.inventoryQuantity} is null`))
  return !!untracked
}

// Gives stock back (e.g. order cancelled). No-op for untracked or deleted variants.
export async function restock(conn: Conn, variantId: string, quantity: number) {
  await conn
    .update(schema.productVariants)
    .set({ inventoryQuantity: sql`${schema.productVariants.inventoryQuantity} + ${quantity}` })
    .where(and(eq(schema.productVariants.id, variantId), sql`${schema.productVariants.inventoryQuantity} is not null`))
}
