// Lists CJ products on the merchant's TikTok Shop through CJ. The merchant links their TikTok store in CJ (CJ holds
// the TikTok authorization); this app picks the TikTok category, brand and attributes, prices the variants, and
// asks CJ to publish. CJ then connects the TikTok product to the CJ one, so TikTok orders are fulfilled by CJ.
import type { ShopContext } from '@shopnex/app'
import type {
  CategoryAttribute,
  CategoryCertification,
  CjShop,
  ListingAttribute,
  ListingOption,
  ListingShopInfo,
  ListingVariant,
  ProductDetails,
  PublishParams,
} from '@shopnex/cj-sdk'
import { cjFor } from './cj'
import type { Tables } from './db'
import { isOpenListing } from './db'
import { imagesOf } from './import'

/** tiktok, tiktok_us, tiktok_us_cross */
export const isTikTok = (type: string) => type.startsWith('tiktok')

// CJ's stores: 1 authorized, 4 authorization expired. Others (deleted, deactivated, ...) are not worth showing.
export const STORE_OK = 1
const STORE_SHOWN = new Set([1, 2, 3, 4, 5])

// TikTok takes at most 100 variants, 9 main images and a title of 255 characters (188 ASCII recommended)
const MAX_VARIANTS = 100
const MAX_IMAGES = 9
const MAX_TITLE = 188

export const attributeField = (id: string) => `attr_${id}`

export const listingTitle = (name: string) => name.replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE).trim()

/** CJ's price plus the markup, to the cent. CJ has no pricing API: the price is ours to set. */
export function priceWithMarkup(base: number, markupPercent: number) {
  return Math.max(0.01, Math.round(base * (1 + markupPercent / 100) * 100) / 100)
}

/** The sales options (Color, Size, ...) TikTok matched to each CJ variant, found in the category's attributes */
export function optionsByVariant(attributes: CategoryAttribute[]) {
  const byVid = new Map<string, ListingOption[]>()
  for (const attribute of attributes) {
    for (const s of attribute.variantSpecificsVOS ?? []) {
      const options = byVid.get(s.vid) ?? []
      options.push({
        optionName: s.optionName,
        optionValue: s.optionValue,
        optionNameId: s.optionNameId,
        optionValueId: s.optionValueId,
        // TikTok's own value when CJ matched one, otherwise the text as it is
        customized: !s.optionValueId,
      })
      byVid.set(s.vid, options)
    }
  }
  return byVid
}

/** What the merchant has to fill in: required attributes that aren't sales options (those come from the variants) */
export const askedAttributes = (attributes: CategoryAttribute[]) =>
  attributes.filter((a) => a.isRequired && !a.variationSpecifics)

/** The merchant's answers → the attributes CJ expects. A required one left empty is an error naming it. */
export function readAttributes(attributes: CategoryAttribute[], form: Record<string, unknown>): ListingAttribute[] {
  const out: ListingAttribute[] = []
  for (const attribute of askedAttributes(attributes)) {
    const raw = form[attributeField(attribute.id)]
    const answer = typeof raw === 'string' ? raw.trim() : ''
    const label = attribute.label || attribute.name
    if (!answer) throw new Error(`${label} is required`)
    const chosen = attribute.values?.find((v) => v.id === answer)
    if (attribute.values?.length && !chosen) throw new Error(`Choose one of the listed values for ${label}`)
    out.push({
      platformAttributeId: attribute.id,
      platformAttributeName: attribute.name,
      attributeValueList: [
        chosen
          ? { platformAttributeValueId: chosen.id, platformAttributeValue: chosen.value }
          : { platformAttributeValue: answer },
      ],
    })
  }
  return out
}

export type BuildInput = {
  store: CjShop
  info?: ListingShopInfo
  details: ProductDetails
  categoryId: string
  brandId?: string
  /** Everything the category returned, to find the sales options */
  attributes: CategoryAttribute[]
  /** The merchant's answers for the required attributes */
  values: ListingAttribute[]
  certifications: CategoryCertification[]
  markupPercent: number
}

/** The publish request for one CJ product on one TikTok store */
export function buildPublish(input: BuildInput): PublishParams {
  const { store, info, details, attributes } = input
  const cjVariants = details.variants ?? []
  if (cjVariants.length === 0) throw new Error('CJ returned no variants for this product')
  if (cjVariants.length > MAX_VARIANTS) {
    throw new Error(`TikTok takes up to ${MAX_VARIANTS} variants per product; this one has ${cjVariants.length}`)
  }

  const options = optionsByVariant(attributes)
  const variants: ListingVariant[] = cjVariants.map((v) => {
    const matched = options.get(v.vid)
    // Several variants and no matched options: TikTok would reject them as duplicates, say why instead
    if (cjVariants.length > 1 && !matched?.length) {
      throw new Error(`TikTok's options could not be matched to the variant ${v.variantSku}; try another category`)
    }
    return {
      variantId: v.vid,
      sku: v.variantSku,
      price: priceWithMarkup(v.variantSellPrice ?? details.sellPrice, input.markupPercent),
      image: v.variantImage,
      weight: v.variantWeight,
      length: v.variantLength,
      width: v.variantWidth,
      height: v.variantHeight,
      options: matched,
    }
  })

  // The sales option whose values carry pictures (usually Color); otherwise the first one
  const withPictures = attributes.find((a) => a.variationSpecifics && a.isCanMountPictures)
  const pictureOption = withPictures?.name ?? variants[0]?.options?.[0]?.optionName

  const params: PublishParams = {
    shopId: store.id,
    productId: details.pid,
    productTitle: listingTitle(details.productNameEn || details.productName?.[0] || details.productSku),
    productDescription: details.description,
    images: imagesOf(details.productImage)
      .filter((u) => /^https?:\/\//.test(u))
      .slice(0, MAX_IMAGES)
      .map((url) => ({ url })),
    variants,
    publishPriceCurrency: 'USD',
    targetCountryCode: info?.country?.countryCode ?? store.countryCode,
    categoryId: input.categoryId,
    platformBrandId: input.brandId || undefined,
    productCategoryAttributes: input.values,
    needUploadImgOptionName: pictureOption,
    // The certificates CJ already has on file; CJ fills in the files
    productCertificationList: input.certifications
      .filter((c) => c.isBindCj)
      .map((c) => ({ platformCertificationId: c.id, platformCertificationName: c.name })),
  }
  // US stores ship from CJ's US warehouse
  if (store.type === 'tiktok_us') {
    params.defaultAreaId = '2'
    params.sourceCountryCode = 'US'
  }
  return params
}

/** Certificates the category asks for that CJ doesn't have on file: the merchant must add them in CJ */
export const missingCertifications = (certifications: CategoryCertification[]) =>
  certifications.filter((c) => !c.isBindCj)

// --- calls to CJ ---

/** The SDK's calls report failure as { error }: this turns that into a throw */
function need<T>(result: { data?: T; error?: string }, fallback: string): T {
  if (result.data === undefined || result.data === null) throw new Error(result.error ?? fallback)
  return result.data
}

/** The TikTok stores linked to the merchant's CJ account */
export async function tiktokStores(shop: ShopContext) {
  const { cj } = await cjFor(shop)
  const shops = need(await cj.shops.list(), 'Could not read your stores from CJ')
  return shops.filter((s) => isTikTok(s.type) && STORE_SHOWN.has(s.status))
}

/** Everything the listing form needs for a product in a category */
export async function loadForm(shop: ShopContext, params: { cjShopId: string; pid: string; categoryId: string }) {
  const { cj } = await cjFor(shop)
  const { cjShopId: shopId, pid: productId, categoryId } = params
  const attributes = need(
    await cj.listing.getCategoryAttributes({ shopId, categoryId, productId }),
    'Could not read the category attributes',
  )
  const [brands, certifications, details] = await Promise.all([
    cj.listing.getBrands({ shopId, categoryId }),
    cj.listing.getCategoryCertifications({ shopId, categoryId, productId }),
    cj.products.getProductDetails({ pid: productId }),
  ])
  return {
    attributes: askedAttributes(attributes),
    brands: brands.data ?? [],
    certifications: certifications.data ?? [],
    title: listingTitle(details.data?.productNameEn ?? productId),
  }
}

/** Publishes the product and remembers the listing; CJ finishes it in the background (see refreshListings) */
export async function listProduct(
  shop: ShopContext,
  tables: Tables,
  markupPercent: number,
  form: Record<string, unknown>,
) {
  const text = (key: string) => (typeof form[key] === 'string' ? (form[key] as string).trim() : '')
  const cjShopId = text('shopId')
  const pid = text('pid')
  const categoryId = text('categoryId')
  if (!cjShopId || !pid || !categoryId) throw new Error('Choose a store, a product and a category')
  const markup = Number(form.markupPercent ?? markupPercent)
  if (!Number.isFinite(markup) || markup < 0 || markup > 1000) throw new Error('Markup is a percentage from 0 to 1000')

  const { cj } = await cjFor(shop)
  const store = (await tiktokStores(shop)).find((s) => s.id === cjShopId)
  if (!store) throw new Error('That TikTok store is not linked to your CJ account')
  if (store.status !== STORE_OK) {
    throw new Error('CJ no longer has access to this TikTok store. Authorize it again in CJ.')
  }

  const [details, attributes, certifications, info] = await Promise.all([
    cj.products.getProductDetails({ pid }),
    cj.listing.getCategoryAttributes({ shopId: cjShopId, categoryId, productId: pid }),
    cj.listing.getCategoryCertifications({ shopId: cjShopId, categoryId, productId: pid }),
    cj.listing.getShopInfo(cjShopId),
  ])
  const product = need(details, 'CJ product not found')
  const allAttributes = need(attributes, 'Could not read the category attributes')

  const params = buildPublish({
    store,
    info: info.data?.[0],
    details: product,
    categoryId,
    brandId: text('brandId'),
    attributes: allAttributes,
    values: readAttributes(allAttributes, form),
    certifications: certifications.data ?? [],
    markupPercent: markup,
  })
  const listedId = need(await cj.listing.publish(params), 'CJ did not accept the listing')
  tables.addListing(
    shop,
    String(listedId),
    { id: store.id, name: store.aliasName || store.name },
    { pid, title: params.productTitle },
  )
  return params.productTitle
}

/** Asks CJ how the shop's open listings are doing (each call costs the account API points, so only open ones) */
export async function refreshListings(shop: ShopContext, tables: Tables) {
  const open = tables.openListingIds(shop)
  if (open.length === 0) return
  const { cj } = await cjFor(shop)
  for (const listedId of open) {
    const result = await cj.listing.queryStatus(listedId)
    const status = result.data
    if (!status || isOpenListing(status.listedStatus)) continue
    tables.setListing(shop, listedId, status.listedStatus, {
      url: status.platformProductUrl,
      error: status.listedFailMessage,
    })
  }
}
