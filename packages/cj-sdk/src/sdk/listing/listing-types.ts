// Listing a CJ product on a store the merchant linked in CJ (TikTok Shop and others), and the lookups it needs.
// Shapes follow CJ's "12 Listing" and "9 Shop" docs; fields the app doesn't read are left out.

/** A store linked to the CJ account. `type` is the platform: shopify, tiktok, tiktok_us, tiktok_us_cross, ... */
export interface CjShop {
  id: string
  name: string
  aliasName?: string
  type: string
  /** 0 deleted, 1 authorized, 2 deactivated, 3 authorization failed, 4 authorization expired, 5 in transition */
  status: number
  marketplace?: string
  countryCode?: string
  currencyCode?: string
}

export interface ListingShopInfo {
  shopId: string
  type: string
  shopStatusCode: number
  country?: { countryCode: string; countryName: string }
  defaultCurrency?: string
}

export interface PlatformCategory {
  categoryId: string
  categoryName: string
  categoryParentId?: string
  leafCategory: boolean
  /** CJ marks the platform category that matches the product's own category */
  defaultMatching?: boolean
}

export interface PlatformBrand {
  brandId: string
  brandName: string
}

export interface AttributeValue {
  id: string
  value: string
}

/** How a CJ variant maps to the platform's sales options (returned with the category attributes) */
export interface VariantSpecific {
  vid: string
  optionName: string
  optionNameId?: string
  optionValue: string
  optionValueId?: string
}

export interface CategoryAttribute {
  id: string
  name: string
  label?: string
  /** text, richText, enumInput, multiEnum, InputmultiSelect, singleSelect, numeric, date */
  type: string
  isRequired: boolean
  /** A sales attribute (Color, Size): filled from variantSpecificsVOS, not asked of the merchant */
  variationSpecifics?: boolean
  isSupportCustomizedValue?: boolean
  isCanMountPictures?: boolean
  valueRecommendations?: string[]
  values?: AttributeValue[]
  variantSpecificsVOS?: VariantSpecific[]
}

export interface CategoryCertification {
  id: string
  name: string
  /** CJ has the certificate on file and fills it in */
  isBindCj: boolean
  isApply: boolean
  sampleImageUrl?: string
}

export interface ListingOption {
  optionName: string
  optionValue: string
  optionNameId?: string
  optionValueId?: string
  customized?: boolean
}

export interface ListingVariant {
  variantId: string
  /** In publishPriceCurrency */
  price: number
  sku?: string
  image?: string
  /** Grams */
  weight?: number
  /** Millimetres */
  length?: number
  width?: number
  height?: number
  options?: ListingOption[]
}

export interface ListingAttribute {
  platformAttributeId: string
  platformAttributeName: string
  attributeValueList: { platformAttributeValueId?: string; platformAttributeValue: string }[]
}

export interface PublishParams {
  shopId: string
  /** CJ product id */
  productId: string
  productTitle: string
  productDescription?: string
  images?: { url: string }[]
  variants: ListingVariant[]
  publishPriceCurrency?: string
  defaultAreaId?: string
  sourceCountryCode?: string
  targetCountryCode?: string
  categoryId?: string
  platformBrandId?: string
  productCategoryAttributes?: ListingAttribute[]
  needUploadImgOptionName?: string
  productCertificationList?: { platformCertificationId: string; platformCertificationName?: string }[]
}

export type ListedStatus = 'PRODUCT_STAY' | 'PRODUCT_CENTRE' | 'PRODUCT_SUCCESS' | 'PRODUCT_FAIL' | 'PRODUCT_CANCEL'

export interface PublishStatus {
  cjProductId: string
  listedStatus: ListedStatus
  listedFailMessage: string | null
  platformProductUrl: string | null
}
