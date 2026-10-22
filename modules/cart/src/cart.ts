// Business logic only — no HTTP / oRPC / Hono imports in this module.
// Carts are scoped by shopId; the token alone is never enough to touch another shop's cart.
import { randomBytes } from 'node:crypto'
import { and, asc, eq, gt, inArray, sql } from 'drizzle-orm'
import { variantService } from '@shopnex/catalog'
import { all, db, schema, type Conn } from '@shopnex/db'
import type { Cart, CartStatus } from '@shopnex/db/schema'
import { calculate, discountService, type PricingDiscount } from '@shopnex/pricing'
import { CartError } from './errors'

const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000
const MAX_LINE_QUANTITY = 999

export type LineInput = { variantId: string; quantity: number }
export type LineUpdate = { lineId: string; quantity: number }

export type CartLineView = {
  lineId: string
  variantId: string
  variantTitle: string
  /** true for a product's hidden default variant */
  isDefaultVariant: boolean
  sku: string | null
  selectedOptions: { name: string; value: string }[]
  productId: string
  productSlug: string
  title: string
  /** Variant image, else the product's first image */
  imageUrl: string | null
  /** Live price from the variant — not locked until checkout */
  unitPriceCents: number
  compareAtPriceCents: number | null
  quantity: number
  lineTotalCents: number
  /** This line's share of the cart's discount code (estimate; final at checkout) */
  discountCents: number
  /** false when tracked stock is below the quantity, or the product is no longer active */
  available: boolean
}

export type CartView = {
  token: string
  status: CartStatus
  currency: string
  lines: CartLineView[]
  subtotalCents: number
  /** Code the buyer entered. applicable: usable now and the subtotal reaches its minimum ("once per
   *  customer" is only known at checkout, from the email). */
  discountCode: { code: string; applicable: boolean } | null
  /** The code's rule when applicable (checkout recomputes totals with it, e.g. free shipping) */
  discount: PricingDiscount | null
  /** Line discounts (free shipping isn't known until a shipping rate is chosen) */
  discountCents: number
  /** Subtotal minus line discounts; before shipping and tax */
  totalCents: number
  totalQuantity: number
  orderId: string | null
  createdAt: Date
  updatedAt: Date
}

const newToken = () => `cart_${randomBytes(24).toString('base64url')}`
const expiry = () => new Date(Date.now() + CART_TTL_MS)

// shopId null = resolve by token alone (hosted checkout page, which learns the shop from the cart)
export async function findByToken(shopId: string | null, token: string, conn: Conn = db): Promise<Cart | null> {
  const [cart] = await conn
    .select()
    .from(schema.carts)
    .where(
      and(
        eq(schema.carts.token, token),
        shopId ? eq(schema.carts.shopId, shopId) : undefined,
        gt(schema.carts.expiresAt, new Date()),
      ),
    )
  return cart ?? null
}

async function requireActive(shopId: string, token: string, conn: Conn) {
  const cart = await findByToken(shopId, token, conn)
  if (!cart) throw new CartError('CART_NOT_FOUND', 'Cart not found or expired')
  if (cart.status !== 'active') throw new CartError('CART_COMPLETED', 'Cart is already checked out')
  return cart
}

export async function view(cart: Cart, conn: Conn = db): Promise<CartView> {
  // Re-read so updatedAt reflects changes made earlier in this transaction
  const [fresh] = await conn.select().from(schema.carts).where(eq(schema.carts.id, cart.id))
  const [shop] = await conn
    .select({ currency: schema.shops.currency })
    .from(schema.shops)
    .where(eq(schema.shops.id, cart.shopId))
  const rows = await conn
    .select({ line: schema.cartLines, variant: schema.productVariants, product: schema.products })
    .from(schema.cartLines)
    .innerJoin(schema.productVariants, eq(schema.productVariants.id, schema.cartLines.variantId))
    .innerJoin(schema.products, eq(schema.products.id, schema.productVariants.productId))
    .where(eq(schema.cartLines.cartId, cart.id))
    .orderBy(asc(schema.cartLines.createdAt), asc(schema.cartLines.id))
  const productIds = [...new Set(rows.map((r) => r.product.id))]
  const [images, details] = await all(conn, [
    async () =>
      productIds.length
        ? conn
            .select({ productId: schema.productImages.productId, url: schema.productImages.url })
            .from(schema.productImages)
            .where(and(inArray(schema.productImages.productId, productIds), eq(schema.productImages.position, 0)))
        : [],
    () => variantService.loadForProducts(productIds, conn),
  ])

  const lines = rows.map(({ line, variant, product }): Omit<CartLineView, 'discountCents'> => {
    const detail = details.variants.get(product.id)?.find((v) => v.id === variant.id)
    return {
      lineId: line.id,
      variantId: variant.id,
      variantTitle: variant.title,
      isDefaultVariant: variant.optionsKey === '',
      sku: variant.sku,
      selectedOptions: detail?.selectedOptions ?? [],
      productId: product.id,
      productSlug: product.slug,
      title: product.title,
      imageUrl: variant.imageUrl ?? images.find((i) => i.productId === product.id)?.url ?? null,
      unitPriceCents: variant.priceCents,
      compareAtPriceCents: variant.compareAtPriceCents,
      quantity: line.quantity,
      lineTotalCents: variant.priceCents * line.quantity,
      available:
        product.status === 'active' &&
        (variant.inventoryQuantity == null || variant.inventoryQuantity >= line.quantity),
    }
  })

  // Discount estimate: an unusable code stays on the cart (as in Shopify) but isn't applied
  const found = fresh!.discountCode ? await discountService.findByCode(cart.shopId, fresh!.discountCode, conn) : null
  const usable = found && !discountService.unavailableReason(found) ? found : null
  const discount: PricingDiscount | null = usable && {
    code: usable.code,
    type: usable.type,
    value: usable.value,
    minSubtotalCents: usable.minSubtotalCents,
  }
  const totals = calculate({
    lines: lines.map((l) => l.lineTotalCents),
    shippingCents: 0,
    discount,
    taxesIncluded: false,
    taxShipping: false,
  })
  const applicable = discount != null && totals.discountApplicable
  const lineDiscountsCents = totals.lineDiscountCents.reduce((a, b) => a + b, 0)
  return {
    token: fresh!.token,
    status: fresh!.status,
    currency: shop!.currency,
    lines: lines.map((l, i) => ({ ...l, discountCents: totals.lineDiscountCents[i]! })),
    subtotalCents: totals.subtotalCents,
    discountCode: fresh!.discountCode ? { code: usable?.code ?? fresh!.discountCode, applicable } : null,
    discount: applicable ? discount : null,
    discountCents: lineDiscountsCents,
    totalCents: totals.subtotalCents - lineDiscountsCents,
    totalQuantity: lines.reduce((sum, l) => sum + l.quantity, 0),
    orderId: fresh!.orderId,
    createdAt: fresh!.createdAt,
    updatedAt: fresh!.updatedAt,
  }
}

// Sets quantities (not increments) after verifying variants belong to the shop, are sellable and in stock
async function setLines(conn: Conn, cart: Cart, lines: LineInput[]) {
  const ids = [...new Set(lines.map((l) => l.variantId))]
  const found = new Map(
    (await variantService.getManyByIds(cart.shopId, ids, conn))
      .filter((r) => r.productStatus === 'active')
      .map((r) => [r.variant.id, r.variant]),
  )
  const missing = ids.filter((id) => !found.has(id))
  if (missing.length) {
    throw new CartError('VARIANT_NOT_FOUND', `Merchandise not found: ${missing.join(', ')}`, { variantIds: missing })
  }

  for (const l of lines) {
    const variant = found.get(l.variantId)!
    if (l.quantity <= 0) {
      await conn
        .delete(schema.cartLines)
        .where(and(eq(schema.cartLines.cartId, cart.id), eq(schema.cartLines.variantId, l.variantId)))
      continue
    }
    const quantity = Math.min(l.quantity, MAX_LINE_QUANTITY)
    // Friendly early check; the real guarantee is the atomic reservation at checkout
    if (variant.inventoryQuantity != null && variant.inventoryQuantity < quantity) {
      throw new CartError('OUT_OF_STOCK', `Only ${variant.inventoryQuantity} left of "${variant.title}"`, {
        variantId: variant.id,
        available: variant.inventoryQuantity,
      })
    }
    await conn
      .insert(schema.cartLines)
      .values({ cartId: cart.id, variantId: l.variantId, quantity })
      .onConflictDoUpdate({ target: [schema.cartLines.cartId, schema.cartLines.variantId], set: { quantity } })
  }
  await touch(conn, cart.id)
}

const touch = (conn: Conn, cartId: string) =>
  conn.update(schema.carts).set({ updatedAt: new Date(), expiresAt: expiry() }).where(eq(schema.carts.id, cartId))

async function currentLines(conn: Conn, cartId: string) {
  return conn
    .select({ id: schema.cartLines.id, variantId: schema.cartLines.variantId, quantity: schema.cartLines.quantity })
    .from(schema.cartLines)
    .where(eq(schema.cartLines.cartId, cartId))
}

// Turn "add 2" into "set to existing + 2" (same variant merges into one line)
function mergeAdds(existing: { variantId: string; quantity: number }[], lines: LineInput[]): LineInput[] {
  const totals = new Map(existing.map((l) => [l.variantId, l.quantity]))
  const touched = new Set<string>()
  for (const l of lines) {
    totals.set(l.variantId, (totals.get(l.variantId) ?? 0) + l.quantity)
    touched.add(l.variantId)
  }
  return [...touched].map((variantId) => ({ variantId, quantity: totals.get(variantId)! }))
}

// Line ids → variant ids, all-or-nothing
async function resolveLineIds(conn: Conn, cartId: string, lineIds: string[]) {
  const lines = new Map((await currentLines(conn, cartId)).map((l) => [l.id, l]))
  const missing = [...new Set(lineIds)].filter((id) => !lines.has(id))
  if (missing.length)
    throw new CartError('LINE_NOT_FOUND', `Cart lines not found: ${missing.join(', ')}`, { lineIds: missing })
  return lines
}

export async function create(shopId: string, lines: LineInput[] = []) {
  return db.transaction(async (tx) => {
    const [cart] = await tx.insert(schema.carts).values({ shopId, token: newToken(), expiresAt: expiry() }).returning()
    if (lines.length) await setLines(tx, cart!, mergeAdds([], lines))
    return view(cart!, tx)
  })
}

export async function get(shopId: string, token: string) {
  const cart = await findByToken(shopId, token)
  if (!cart) throw new CartError('CART_NOT_FOUND', 'Cart not found or expired')
  return view(cart)
}

// Adds to existing quantities
export async function addLines(shopId: string, token: string, lines: LineInput[]) {
  return db.transaction(async (tx) => {
    const cart = await requireActive(shopId, token, tx)
    await setLines(tx, cart, mergeAdds(await currentLines(tx, cart.id), lines))
    return view(cart, tx)
  })
}

// Sets quantities by line id; 0 removes the line
export async function updateLines(shopId: string, token: string, updates: LineUpdate[]) {
  return db.transaction(async (tx) => {
    const cart = await requireActive(shopId, token, tx)
    const lines = await resolveLineIds(
      tx,
      cart.id,
      updates.map((u) => u.lineId),
    )
    await setLines(
      tx,
      cart,
      updates.map((u) => ({ variantId: lines.get(u.lineId)!.variantId, quantity: u.quantity })),
    )
    return view(cart, tx)
  })
}

export async function removeLines(shopId: string, token: string, lineIds: string[]) {
  return db.transaction(async (tx) => {
    const cart = await requireActive(shopId, token, tx)
    await resolveLineIds(tx, cart.id, lineIds)
    await tx
      .delete(schema.cartLines)
      .where(and(eq(schema.cartLines.cartId, cart.id), inArray(schema.cartLines.id, lineIds)))
    await touch(tx, cart.id)
    return view(cart, tx)
  })
}

// One code per cart for now; null (or blank) removes it. Stored even when not applicable, like Shopify:
// the view says whether it applies.
export async function setDiscountCode(shopId: string, token: string, code: string | null) {
  return db.transaction(async (tx) => {
    const cart = await requireActive(shopId, token, tx)
    await tx
      .update(schema.carts)
      .set({ discountCode: code?.trim() || null, updatedAt: new Date(), expiresAt: expiry() })
      .where(eq(schema.carts.id, cart.id))
    return view(cart, tx)
  })
}

// Lock the cart row for the rest of the transaction (concurrent checkouts of one cart)
export async function lockForCheckout(conn: Conn, shopId: string, token: string) {
  const [cart] = await conn
    .select()
    .from(schema.carts)
    .where(and(eq(schema.carts.token, token), eq(schema.carts.shopId, shopId), gt(schema.carts.expiresAt, new Date())))
    .for('update')
  return cart ?? null
}

export async function lineInputs(conn: Conn, cartId: string): Promise<LineInput[]> {
  return conn
    .select({ variantId: schema.cartLines.variantId, quantity: schema.cartLines.quantity })
    .from(schema.cartLines)
    .where(eq(schema.cartLines.cartId, cartId))
    .orderBy(asc(schema.cartLines.createdAt))
}

export async function markCompleted(
  conn: Conn,
  cartId: string,
  order: { id: string; customerId: string | null; email: string },
) {
  await conn
    .update(schema.carts)
    .set({
      status: 'completed',
      orderId: order.id,
      customerId: order.customerId,
      email: order.email,
      updatedAt: sql`now()`,
    })
    .where(eq(schema.carts.id, cartId))
}
