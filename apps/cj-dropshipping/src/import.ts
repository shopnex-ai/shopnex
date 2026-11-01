// CJ product → Shopnex product. The new product is a draft the merchant reviews; each variant keeps CJ's SKU, which
// is how an order line is matched back to CJ (the CJ ids are in the app's database).
import { ShopnexError, type ShopContext } from '@shopnex/app'
import type { ProductDetails } from '@shopnex/cj-sdk'
import { cjFor, settingsOf } from './cj'
import type { Tables } from './db'

type Product = { id: string; title: string }

/** CJ error 1602002: the product was taken off sale. Nothing to retry. */
export const isOffSale = (error: unknown) =>
  (error as { code?: number }).code === 1602002 || String((error as Error)?.message).includes('(1602002)')

export const OFF_SALE_MESSAGE = 'CJ has taken this product off sale, so it can no longer be imported.'

// CJ allows one call a second, so the background checks below step aside while the merchant is waiting on a click
let foreground = 0
export async function foregroundTask<T>(task: () => Promise<T>) {
  foreground++
  try {
    return await task()
  } finally {
    foreground--
  }
}

const STALE_MS = 24 * 3600_000
const checking = new Set<string>()

/**
 * Finds out which of the shop's My Products CJ still sells, one at a time (CJ allows one call a second), and
 * remembers the answer for a day. Runs in the background; the list shows the answers on its next load.
 */
export async function checkAvailability(shop: ShopContext, tables: Tables, pids: string[]) {
  const key = `${shop.instance}|${shop.shopId}`
  if (checking.has(key)) return
  checking.add(key)
  try {
    const { cj } = await cjFor(shop)
    for (const pid of pids) {
      while (foreground > 0) await new Promise((resolve) => setTimeout(resolve, 500))
      try {
        await cj.products.getProductDetails({ pid })
        tables.setAvailable(shop, pid, true)
      } catch (error) {
        // Anything else (rate limit, CJ down) says nothing about the product
        if (isOffSale(error)) tables.setAvailable(shop, pid, false)
      }
    }
  } catch (error) {
    console.warn('[cj] availability check:', error instanceof Error ? error.message : error)
  } finally {
    checking.delete(key)
  }
}

export const needsCheck = (known: ReturnType<Tables['availability']>, pid: string) => {
  const status = known.get(pid)
  return !status || Date.now() - status.checkedAt > STALE_MS
}

/** CJ sends a JSON array of URLs, a single URL, or a comma-separated list, depending on the endpoint */
const imagesOf = (raw: string | undefined) => {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return parsed.filter((u): u is string => typeof u === 'string')
  } catch {
    // not JSON
  }
  return raw.split(',').map((u) => u.trim())
}

const httpUrl = (u: string) => /^https?:\/\//.test(u)

export async function importProduct(shop: ShopContext, tables: Tables, pid: string) {
  const { cj } = await cjFor(shop)
  const details = await cj.products.getProductDetails({ pid })
  if (!details.data) throw new Error(details.error ?? 'CJ product not found')
  const product: ProductDetails = details.data
  const cjVariants = product.variants ?? []
  if (cjVariants.length === 0) throw new Error('This CJ product has no variants')

  const { markupPercent } = await settingsOf(shop)
  const stock = await cj.products.getProductInventoryByPid(pid)
  if (stock.error) console.warn(`[cj] no stock for ${pid}, variants imported without a stock count:`, stock.error)
  const inventory = new Map<string, number>()
  for (const v of stock.data?.variantInventories ?? []) {
    inventory.set(
      v.vid,
      v.inventory.reduce((sum, i) => sum + i.totalInventory, 0),
    )
  }

  const seen = new Set<string>()
  const variants = cjVariants.map((v) => {
    // Option values must be unique; fall back to the SKU when CJ's names collide
    let value = (v.variantKey || v.variantNameEn || v.variantSku).slice(0, 60)
    if (seen.has(value)) value = v.variantSku.slice(0, 60)
    seen.add(value)
    return {
      sku: v.variantSku,
      priceCents: Math.round((v.variantSellPrice ?? product.sellPrice) * (1 + markupPercent / 100) * 100),
      // No figure from CJ means unknown (left untracked), not sold out
      inventoryQuantity: inventory.get(v.vid),
      imageUrl: v.variantImage && httpUrl(v.variantImage) ? v.variantImage : undefined,
      options: { Variant: value },
      value,
    }
  })

  const created = await shop.admin.post<Product>('/products', {
    title: product.productNameEn || product.productName[0],
    status: 'draft',
    descriptionHtml: product.description ?? '',
    vendor: 'CJ Dropshipping',
    images: imagesOf(product.productImage)
      .filter(httpUrl)
      .slice(0, 20)
      .map((url) => ({ url })),
    options: [{ name: 'Variant', values: variants.map((v) => v.value) }],
    variants: variants.map(({ value: _, ...v }) => v),
  })

  cjVariants.forEach((v) => tables.saveVariant(shop, v.variantSku, pid, v.vid))
  tables.setAvailable(shop, pid, true)
  return created
}

/** Every SKU in the shop's catalog (up to 500 products): what tells us a CJ product is already there */
export async function shopSkus(shop: ShopContext) {
  const skus = new Set<string>()
  for (let offset = 0; offset < 500; offset += 100) {
    const page = await shop.admin.get<{ items: { variants: { sku: string | null }[] }[]; total: number }>(
      `/products?limit=100&offset=${offset}`,
    )
    for (const product of page.items) for (const v of product.variants) if (v.sku) skus.add(v.sku)
    if (offset + 100 >= page.total) break
  }
  return skus
}

/**
 * Whether a CJ product is in the shop's catalog. For one the app has imported or linked it knows the exact SKUs;
 * otherwise it guesses from CJ's naming, where a variant's SKU starts with its product's (CJZBNSSY01155-Rose blue,
 * CJDS230029501AZ). `skus` is null when the catalog couldn't be read: then what the app has tied to CJ stands.
 */
export const inShop = (skus: Set<string> | null, productSku: string | null, linkedSkus: string[] | undefined) => {
  if (!skus) return Boolean(linkedSkus)
  if (linkedSkus) return linkedSkus.some((s) => skus.has(s))
  return Boolean(productSku) && [...skus].some((s) => s.startsWith(productSku!))
}

/**
 * For a product that is already in the shop (imported earlier, or by hand): remembers which CJ variant each SKU is,
 * so paid orders for it are sent to CJ. Nothing in the shop changes.
 */
export async function linkProduct(shop: ShopContext, tables: Tables, pid: string) {
  const { cj } = await cjFor(shop)
  const details = await cj.products.getProductDetails({ pid })
  const variants = details.data?.variants ?? []
  if (variants.length === 0) throw new Error(details.error ?? 'This CJ product has no variants')
  variants.forEach((v) => tables.saveVariant(shop, v.variantSku, pid, v.vid))
  tables.setAvailable(shop, pid, true)
  return variants.length
}

export const isSkuConflict = (error: unknown) => error instanceof ShopnexError && error.status === 409
