import type { ProductInput } from '@shopnex/catalog'
import type { Specs } from './specs'

/** What a platform's fetcher found, in one shape the loader understands whatever the platform */
export type Found = {
  origin: string
  platform: 'shopify' | 'woocommerce'
  /** ISO code, e.g. USD */
  currency: string
  /** The store's language as a BCP 47 tag (fr, pt-BR), when its home page says one */
  language?: string | null
  products: {
    /** The product's handle on the store, to tell which of its collections it is in */
    key?: string
    input: ProductInput
    /** Facts with no catalog column (Shopify data tags, WooCommerce attributes, weight): they become custom fields */
    specs?: Specs
    /** Collection names this product belongs to (categories or product types) */
    groups: string[]
    /** What a collection made from it shows, when it is the first of its group */
    groupImage: string | null
  }[]
  /** The store's own collections (title, picture, and the `key` of each product in it), when it has them */
  collections?: { title: string; image: string | null; keys: string[] }[]
  /** Candidate pages, any order: the loader keeps the usual shop pages */
  pages: { title: string; handle: string; html: string }[]
  /** How many products the store has in all, when it says */
  total?: number
}
