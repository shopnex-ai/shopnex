import type { ProductInput } from '@shopnex/catalog'

/** What a platform's fetcher found, in one shape the loader understands whatever the platform */
export type Found = {
  origin: string
  platform: 'shopify' | 'woocommerce'
  /** ISO code, e.g. USD */
  currency: string
  /** The store's language as a BCP 47 tag (fr, pt-BR), when its home page says one */
  language?: string | null
  products: {
    input: ProductInput
    /** Collection names this product belongs to (categories or product types) */
    groups: string[]
    /** What a collection made from it shows, when it is the first of its group */
    groupImage: string | null
  }[]
  /** Candidate pages, any order: the loader keeps the usual shop pages */
  pages: { title: string; handle: string; html: string }[]
  /** How many products the store has in all, when it says */
  total?: number
}
