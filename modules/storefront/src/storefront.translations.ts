// The translated text of a response. The records are mapped as always, in the shop's own language; when the request is for a
// published language, each field that has a translation is replaced, and one that has none keeps the record's own text.
import { htmlToText, sanitizeHtml } from '@shopnex/catalog'
import { db } from '@shopnex/db'
import { languageService, optionNameField, optionValueField, type TranslatableResource } from '@shopnex/languages'
import type { Collection, Page, Product } from '@shopnex/storefront-sdk'
import { summarize } from './storefront.mappers'

interface Scope {
  shop: { id: string }
  language: string | null
}

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

// Options like Shopify's: the option's name and each value, by id. Variants are not translated themselves: what they say is made of
// the translated options (their selected options, and the title that is those values joined), so a theme that picks a variant by
// matching the options on the page against its selected options still finds it.
const valueKey = (option: string, value: string) => `${option}\u0000${value}`

function translateOptions(product: Product, t: Record<string, string>): Product {
  const names = new Map<string, string>()
  const values = new Map<string, string>()
  const options = product.options.map((option) => {
    const name = t[optionNameField(option.id)]
    if (name) names.set(option.name, name)
    return {
      ...option,
      name: name ?? option.name,
      optionValues: option.optionValues.map((value) => {
        const translated = t[optionValueField(value.id)]
        if (translated) values.set(valueKey(option.name, value.name), translated)
        return translated ? { ...value, name: translated } : value
      }),
    }
  })
  if (names.size === 0 && values.size === 0) return product
  const variants = product.variants.map((variant) => {
    const selectedOptions = variant.selectedOptions.map((s) => ({
      name: names.get(s.name) ?? s.name,
      value: values.get(valueKey(s.name, s.value)) ?? s.value,
    }))
    // A variant titled by its option values ("M / Black") is titled by the translated ones; a custom title stays
    const made = variant.selectedOptions.map((s) => s.value).join(' / ')
    return {
      ...variant,
      selectedOptions,
      title: variant.title === made ? selectedOptions.map((s) => s.value).join(' / ') : variant.title,
    }
  })
  return { ...product, options, variants }
}

export async function translateProducts(scope: Scope, products: Product[]): Promise<Product[]> {
  const found = await translationsOf(
    scope,
    'product',
    products.map((p) => p.id),
  )
  return products.map((p) => {
    const t = found.get(p.id)
    return t ? translateOptions({ ...p, ...(t.title && { title: t.title }), ...describe(t.description) }, t) : p
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

// One record, for the routes that answer a single product, collection or page
export const translateProduct = async (scope: Scope, product: Product) =>
  (await translateProducts(scope, [product]))[0] ?? product
export const translateCollection = async (scope: Scope, collection: Collection) =>
  (await translateCollections(scope, [collection]))[0] ?? collection
export const translatePage = async (scope: Scope, page: Page) => (await translatePages(scope, [page]))[0] ?? page
