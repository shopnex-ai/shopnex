// Admin API scopes as staff see them: one access level per resource (write_x includes read_x)
export const SCOPE_RESOURCES = [
  { key: 'products', label: 'Products', hint: 'Products, variants, stock and collections' },
  { key: 'orders', label: 'Orders', hint: 'Orders, payments and fulfillments' },
  { key: 'customers', label: 'Customers', hint: 'Customer names, emails and phones' },
  { key: 'discounts', label: 'Discounts', hint: 'Discount codes and their usage' },
  { key: 'payment_sessions', label: 'Payment sessions', hint: 'Take payments and refunds (payments apps)' },
  {
    key: 'ai_capabilities',
    label: 'AI capabilities',
    hint: 'Provide AI suggestions, e.g. product descriptions (AI apps)',
  },
] as const

export type Access = 'none' | 'read' | 'write'

export const accessOf = (scopes: readonly string[], resource: string): Access =>
  scopes.includes(`write_${resource}`) ? 'write' : scopes.includes(`read_${resource}`) ? 'read' : 'none'

/** "Products: read · Orders: read/write" */
export const scopeSummary = (scopes: readonly string[]) =>
  SCOPE_RESOURCES.flatMap((r) => {
    const access = accessOf(scopes, r.key)
    return access === 'none' ? [] : [`${r.label}: ${access === 'write' ? 'read/write' : 'read'}`]
  }).join(' · ')
