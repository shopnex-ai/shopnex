// Line item properties: what a buyer typed for one cart line ("Engraving: Anna", "Gift message: …"), kept on the order's line.
// Shopify calls them line item properties (a form field named properties[Engraving]); the Storefront API calls them attributes.
// A name that starts with an underscore is the shop's own bookkeeping: it is stored and sent to apps, but not shown to the buyer
// or printed on the invoice.

export type LineProperty = { name: string; value: string }

export const MAX_PROPERTIES = 20
export const MAX_PROPERTY_NAME = 100
export const MAX_PROPERTY_VALUE = 1000

// C0 controls other than tab and newline: they would break a one-line display and mean nothing in a typed value
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g

/**
 * What is kept of what a buyer sent: trimmed, controls removed, a property without a name or without a value dropped (a field the
 * buyer left empty is not a property), a name given twice keeps its last value, and the limits applied. Order is kept.
 */
export function normalizeProperties(input: readonly LineProperty[] | null | undefined): LineProperty[] {
  const byName = new Map<string, LineProperty>()
  for (const raw of input ?? []) {
    const name = raw.name.replace(CONTROL, '').trim().slice(0, MAX_PROPERTY_NAME)
    const value = raw.value.replace(CONTROL, '').trim().slice(0, MAX_PROPERTY_VALUE)
    if (!name || !value) continue
    byName.delete(name)
    byName.set(name, { name, value })
  }
  return [...byName.values()].slice(0, MAX_PROPERTIES)
}

/** Two lines of one variant are the same line only when this is the same: '' for no properties */
export function propertiesKey(properties: readonly LineProperty[]): string {
  return properties.length === 0 ? '' : JSON.stringify(properties.map((p) => [p.name, p.value]))
}

/** The shop's own bookkeeping (name starts with "_"): not shown to the buyer */
export const isHiddenProperty = (name: string) => name.startsWith('_')

/** What the buyer sees: without the hidden ones */
export const visibleProperties = (properties: readonly LineProperty[]) =>
  properties.filter((p) => !isHiddenProperty(p.name))
