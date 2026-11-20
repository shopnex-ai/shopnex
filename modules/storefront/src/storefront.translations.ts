// The translated text of a response. The records are mapped as always, in the shop's own language; when the request is for a
// published language, each field that has a translation is replaced, and one that has none keeps the record's own text.
import { htmlToText, sanitizeHtml } from '@shopnex/catalog'
import { db } from '@shopnex/db'
import { languageService, type TranslatableResource } from '@shopnex/languages'
import type { Collection, Page, Product } from '@shopnex/storefront-sdk'
import { summarize } from './storefront.mappers'

type Scope = { shop: { id: string }; language: string | null }

async function translationsOf(scope: Scope, resource: TranslatableResource, ids: string[]) {
  if (!scope.language || ids.length === 0) return new Map<string, Record<string, string>>()
  return languageService.forResources(scope.shop.id, resource, ids, scope.language, db)
}

// A translated description is HTML (the admin edits it like the original), sanitized here because it is stored as typed
function describe(html: string | undefined) {
  if (html === undefined) return {}
  const descriptionHtml = sanitizeHtml(html)
  return { description: htmlToText(descriptionHtml), descriptionHtml }
}

export async function translateProducts(scope: Scope, products: Product[]): Promise<Product[]> {
  const found = await translationsOf(
    scope,
    'product',
    products.map((p) => p.id),
  )
  return products.map((p) => {
    const t = found.get(p.id)
    return t ? { ...p, ...(t.title && { title: t.title }), ...describe(t.description) } : p
  })
}

export async function translateCollections(scope: Scope, collections: Collection[]): Promise<Collection[]> {
  const found = await translationsOf(
    scope,
    'collection',
    collections.map((c) => c.id),
  )
  return collections.map((c) => {
    const t = found.get(c.id)
    return t ? { ...c, ...(t.title && { title: t.title }), ...describe(t.description) } : c
  })
}

export async function translatePages(scope: Scope, pages: Page[]): Promise<Page[]> {
  const found = await translationsOf(
    scope,
    'page',
    pages.map((p) => p.id),
  )
  return pages.map((p) => {
    const t = found.get(p.id)
    if (!t) return p
    const body = t.body === undefined ? undefined : sanitizeHtml(t.body)
    return {
      ...p,
      ...(t.title && { title: t.title }),
      ...(body !== undefined && { body, bodySummary: summarize(body) }),
    }
  })
}
