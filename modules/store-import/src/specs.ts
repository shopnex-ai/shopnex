// Facts a store publishes about a product that have no column in the catalog (a Shopify data tag `allbirds::gender => unisex`,
// a WooCommerce attribute "Material: Cotton", a weight) become the shop's product custom fields: one text field per label,
// shown on the storefront like the store showed them. A store is untrusted, so counts, lengths and keys are bounded here.
import { customFieldService, type CustomFieldUpdates } from '@shopnex/custom-fields'
import type { Conn } from '@shopnex/db'

/** The most fields one import adds to a shop */
export const MAX_FIELDS = 20
const KEY_MAX = 40
const LABEL_MAX = 100
/** The custom field text limit */
const VALUE_MAX = 1000

export type Specs = { label: string; value: string }[]

/** "Care Instructions" -> care_instructions; null when nothing usable is left */
export function fieldKey(label: string): string | null {
  const slug = label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, KEY_MAX)
    .replace(/_+$/, '')
  if (!slug) return null
  return /^[a-z]/.test(slug) ? slug : `f_${slug}`.slice(0, KEY_MAX)
}

/** A long run of letters and digits with both in it: a generated id */
const isId = (word: string) => /^[A-Za-z0-9]{12,}$/.test(word) && /\d/.test(word) && /[A-Za-z]/.test(word)

/** The data tags of a product as specs: "allbirds::gender => unisex" is Gender: unisex. Other tags are labels, not data. */
export function specsFromTags(tags: string[]): Specs {
  const byLabel = new Map<string, Set<string>>()
  for (const tag of tags) {
    const at = tag.indexOf(' => ')
    if (at < 1) continue
    const name = tag.slice(0, at).split('::').pop()!.replace(/[_-]+/g, ' ').trim()
    const value = tag.slice(at + 4).trim()
    // An app's per-item key (`kit-discount-69llI09wAI...`) is an id, not a fact about the product
    if (!name || !value || name.split(/\s+/).some(isId)) continue
    const label = name.charAt(0).toUpperCase() + name.slice(1)
    byLabel.set(label, (byLabel.get(label) ?? new Set()).add(value))
  }
  return [...byLabel].map(([label, values]) => ({ label, value: [...values].join(', ') }))
}

/**
 * Defines a text field for each label the products carry (the most common first, at most MAX_FIELDS), adds nothing to a key
 * the shop already uses for another type of field, and returns each product's values keyed for `productService.create`.
 */
export async function defineFields(shopId: string, all: Specs[], conn: Conn): Promise<CustomFieldUpdates[]> {
  const labels = new Map<string, { label: string; count: number }>()
  for (const specs of all)
    for (const { label } of specs) {
      const key = fieldKey(label)
      if (key) labels.set(key, { label: label.slice(0, LABEL_MAX), count: (labels.get(key)?.count ?? 0) + 1 })
    }
  const existing = new Map((await customFieldService.list(shopId, 'product', conn)).map((d) => [d.key, d]))
  const usable = new Set<string>()
  const wanted = [...labels].sort((a, b) => b[1].count - a[1].count).slice(0, MAX_FIELDS)
  for (const [key, { label }] of wanted) {
    const have = existing.get(key)
    if (have) {
      if (have.type === 'text') usable.add(key)
      continue
    }
    await customFieldService.create(shopId, { resource: 'product', key, label, type: 'text', storefront: true }, conn)
    usable.add(key)
  }
  return all.map((specs) =>
    Object.fromEntries(
      specs.flatMap(({ label, value }) => {
        const key = fieldKey(label)
        const text = value.trim().slice(0, VALUE_MAX)
        return key && usable.has(key) && text ? [[key, text] as const] : []
      }),
    ),
  )
}
