import { csvTable, type CsvRow } from '@/lib/csv'

export type DiscountSource = 'shopify' | 'woocommerce' | 'shopnex'

/** Canonical discount: percentage `value` is a whole percent; fixed_amount `value` is cents; free_shipping has no value. */
export type DiscountRecord = {
  code: string
  type: 'percentage' | 'fixed_amount' | 'free_shipping'
  value: number
  minSubtotalCents: number
  usageLimit: number | null
  oncePerCustomer: boolean
  active: boolean
  startsAt: string | null
  endsAt: string | null
}

const yes = (value: string | undefined, fallback: boolean) =>
  value ? ['true', '1', 'yes', 'active'].includes(value.toLowerCase()) : fallback
const toCents = (value: string | undefined) => (value ? Math.round(Number(value) * 100) : 0)
const money = (cents: number | null) => ((cents ?? 0) / 100).toFixed(2)
const iso = (value: Date | string | null) => (value ? new Date(value).toISOString() : '')

export type ExportableDiscount = Omit<DiscountRecord, 'startsAt' | 'endsAt' | 'minSubtotalCents'> & {
  minSubtotalCents: number | null
  startsAt: Date | string | null
  endsAt: Date | string | null
}

type Format = {
  required: string[]
  headers: string[]
  read: (
    row: CsvRow,
  ) => Omit<DiscountRecord, 'startsAt' | 'endsAt' | 'type'> & { startsAt: string; endsAt: string; type: string }
  write: (d: ExportableDiscount) => unknown[]
}

// WooCommerce coupons (percent / fixed_cart) and Shopify discount-code sheets carry amounts in currency units
export const formats: Record<DiscountSource, Format> = {
  shopnex: {
    required: ['Code', 'Type', 'Value'],
    headers: [
      'Code',
      'Type',
      'Value',
      'Minimum subtotal cents',
      'Usage limit',
      'Once per customer',
      'Active',
      'Starts at',
      'Ends at',
    ],
    read: (r) => ({
      code: r.Code ?? '',
      type: (r.Type ?? '').toLowerCase(),
      value: Number(r.Value),
      minSubtotalCents: Number(r['Minimum subtotal cents'] || 0),
      usageLimit: r['Usage limit'] ? Number(r['Usage limit']) : null,
      oncePerCustomer: yes(r['Once per customer'], false),
      active: yes(r.Active, true),
      startsAt: r['Starts at'] ?? '',
      endsAt: r['Ends at'] ?? '',
    }),
    write: (d) => [
      d.code,
      d.type,
      d.value,
      d.minSubtotalCents,
      d.usageLimit,
      d.oncePerCustomer,
      d.active,
      iso(d.startsAt),
      iso(d.endsAt),
    ],
  },
  shopify: {
    required: ['Discount Code', 'Type', 'Value'],
    headers: [
      'Discount Code',
      'Type',
      'Value',
      'Minimum purchase amount',
      'Usage limit',
      'One use per customer',
      'Status',
      'Start date',
      'End date',
    ],
    read: (r) => {
      const kind = (r.Type ?? '').toLowerCase()
      const percentage = kind.startsWith('percent')
      return {
        code: r['Discount Code'] ?? '',
        type: kind.includes('shipping') ? 'free_shipping' : percentage ? 'percentage' : 'fixed_amount',
        value: kind.includes('shipping') ? 0 : percentage ? Number(r.Value) : toCents(r.Value),
        minSubtotalCents: toCents(r['Minimum purchase amount']),
        usageLimit: r['Usage limit'] ? Number(r['Usage limit']) : null,
        oncePerCustomer: yes(r['One use per customer'], false),
        active: yes(r.Status, true),
        startsAt: r['Start date'] ?? '',
        endsAt: r['End date'] ?? '',
      }
    },
    write: (d) => [
      d.code,
      d.type === 'percentage' ? 'Percentage' : d.type === 'free_shipping' ? 'Free shipping' : 'Fixed amount',
      d.type === 'percentage' ? d.value : money(d.value),
      money(d.minSubtotalCents),
      d.usageLimit,
      d.oncePerCustomer ? 'TRUE' : 'FALSE',
      d.active ? 'Active' : 'Disabled',
      iso(d.startsAt),
      iso(d.endsAt),
    ],
  },
  woocommerce: {
    required: ['code', 'discount_type', 'amount'],
    headers: [
      'code',
      'discount_type',
      'amount',
      'free_shipping',
      'minimum_amount',
      'usage_limit',
      'usage_limit_per_user',
      'status',
      'date_starts',
      'date_expires',
    ],
    read: (r) => {
      const percentage = (r.discount_type ?? '').toLowerCase() === 'percent'
      const freeShipping = yes(r.free_shipping, false) && !Number(r.amount)
      return {
        code: r.code ?? '',
        type: freeShipping ? 'free_shipping' : percentage ? 'percentage' : 'fixed_amount',
        value: freeShipping ? 0 : percentage ? Number(r.amount) : toCents(r.amount),
        minSubtotalCents: toCents(r.minimum_amount),
        usageLimit: r.usage_limit ? Number(r.usage_limit) : null,
        oncePerCustomer: r.usage_limit_per_user === '1',
        active: (r.status || 'publish').toLowerCase() === 'publish',
        startsAt: r.date_starts ?? '',
        endsAt: r.date_expires ?? '',
      }
    },
    write: (d) => [
      d.code,
      d.type === 'percentage' ? 'percent' : 'fixed_cart',
      d.type === 'percentage' ? d.value : money(d.value),
      d.type === 'free_shipping' ? 1 : '',
      money(d.minSubtotalCents),
      d.usageLimit,
      d.oncePerCustomer ? 1 : '',
      d.active ? 'publish' : 'draft',
      iso(d.startsAt),
      iso(d.endsAt),
    ],
  },
}

export function discountsCsv(source: DiscountSource, discounts: ExportableDiscount[]) {
  return csvTable(
    formats[source].headers,
    discounts.map((discount) => formats[source].write(discount)),
  )
}
