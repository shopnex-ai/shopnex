import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { FormatSelect, ImportDialog, platformOptions, type ImportOutcome } from '@/components/admin/import-dialog'
import { parseCsv, requireColumns, type CsvRow } from '@/lib/csv'
import { client, orpc } from '@/lib/orpc'

type ImportedAddress = {
  firstName: string | null; lastName: string | null; company: string | null; address1: string; address2: string | null
  city: string; province: string | null; countryCode: string; zip: string | null; phone: string | null
}
type ImportedOrder = {
  sourceOrderName: string; email: string; name: string | null; phone: string | null
  financialStatus: 'pending' | 'authorized' | 'partially_paid' | 'paid' | 'partially_refunded' | 'refunded' | 'voided'
  fulfillmentStatus: 'unfulfilled' | 'partially_fulfilled' | 'fulfilled'
  cancelledAt: string | null; fulfilledAt: string | null; currency: string
  subtotalCents: number; shippingCents: number; taxCents: number; discountCents: number; totalCents: number
  discountCodes: string[]; shippingTitle: string | null; shippingAddress: ImportedAddress | null
  billingAddress: ImportedAddress | null; paymentMethodName: string | null; note: string | null; createdAt: string
  items: { title: string; variantTitle: null; sku: string | null; vendor: string | null; imageUrl: null; unitPriceCents: number; quantity: number; discountCents: number }[]
}

const countryCodes: Record<string, string> = {
  'united states': 'US', 'united states of america': 'US', canada: 'CA', 'united kingdom': 'GB', uk: 'GB',
  australia: 'AU', 'new zealand': 'NZ', germany: 'DE', france: 'FR', italy: 'IT', spain: 'ES', netherlands: 'NL',
  ireland: 'IE', japan: 'JP', india: 'IN', singapore: 'SG', mexico: 'MX', brazil: 'BR', switzerland: 'CH',
  sweden: 'SE', norway: 'NO', denmark: 'DK', finland: 'FI', belgium: 'BE', austria: 'AT', portugal: 'PT',
  poland: 'PL', china: 'CN', 'hong kong': 'HK', taiwan: 'TW', 'south korea': 'KR', 'united arab emirates': 'AE',
  'south africa': 'ZA', georgia: 'GE',
}

function address(row: CsvRow, prefix: 'Billing' | 'Shipping'): ImportedAddress | null {
  const address1 = row[`${prefix} Address1`] || ''
  const city = row[`${prefix} City`] || ''
  const rawCountry = row[`${prefix} Country Code`] || row[`${prefix} Country`] || ''
  const countryCode = /^[A-Za-z]{2}$/.test(rawCountry) ? rawCountry.toUpperCase() : countryCodes[rawCountry.toLowerCase()]
  if (!address1 && !city && !rawCountry) return null
  if (!countryCode) return null
  const person = (row[`${prefix} Name`] || '').trim().split(/\s+/).filter(Boolean)
  return {
    firstName: person[0] ?? null,
    lastName: person.length > 1 ? person.slice(1).join(' ') : null,
    company: row[`${prefix} Company`] || null,
    address1,
    address2: row[`${prefix} Address2`] || null,
    city,
    province: row[`${prefix} Province Name`] || row[`${prefix} Province`] || null,
    countryCode,
    zip: row[`${prefix} Zip`] || null,
    phone: row[`${prefix} Phone`] || null,
  }
}

function cents(value: string, label: string, orderName: string, optional = false) {
  if (!value && optional) return 0
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0) throw new Error(`${orderName}: invalid ${label}.`)
  return Math.round(amount * 100)
}

function parseShopifyOrders(rows: CsvRow[]): ImportedOrder[] {
  requireColumns(rows, ['Name', 'Email', 'Currency', 'Created at', 'Lineitem name', 'Lineitem price', 'Lineitem quantity'], 'Shopify order export')
  const grouped = new Map<string, CsvRow[]>()
  let currentName = ''
  for (const row of rows) {
    if (row.Name) currentName = row.Name
    if (!currentName) continue
    const group = grouped.get(currentName) ?? []
    group.push(row)
    grouped.set(currentName, group)
  }
  return [...grouped.entries()].map(([orderName, group]) => {
    const firstValue = (field: string) => group.map((row) => row[field]).find((value) => value) ?? ''
    const first = group[0]!
    const email = firstValue('Email')
    if (!email) throw new Error(`${orderName}: customer email is missing; this order can't be imported.`)
    const currency = firstValue('Currency').toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`${orderName}: currency is missing or invalid.`)
    const createdAt = new Date(firstValue('Created at'))
    if (!Number.isFinite(createdAt.getTime())) throw new Error(`${orderName}: Created at is missing or invalid.`)
    const financial = firstValue('Financial Status').toLowerCase().replace(/[ -]+/g, '_')
    const financialStatus = (['pending', 'authorized', 'partially_paid', 'paid', 'partially_refunded', 'refunded', 'voided'].includes(financial) ? financial : 'pending') as ImportedOrder['financialStatus']
    const fulfillment = firstValue('Fulfillment Status').toLowerCase().replace(/[ -]+/g, '_')
    const fulfillmentStatus: ImportedOrder['fulfillmentStatus'] = fulfillment === 'fulfilled' ? 'fulfilled' : ['partial', 'partially_fulfilled'].includes(fulfillment) ? 'partially_fulfilled' : 'unfulfilled'
    const cancelledRaw = firstValue('Canceled at')
    const fulfilledRaw = firstValue('Fulfilled at')
    const items = group.filter((row) => row['Lineitem name']).map((row) => {
      const quantity = Number(row['Lineitem quantity'])
      if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`${orderName}: invalid line item quantity.`)
      return {
        title: row['Lineitem name']!,
        variantTitle: null,
        sku: row['Lineitem SKU'] || null,
        vendor: row.Vendor || null,
        imageUrl: null,
        unitPriceCents: cents(row['Lineitem price'] || '', 'line item price', orderName),
        quantity,
        discountCents: cents(row['Lineitem discount'] || '', 'line item discount', orderName, true),
      }
    })
    if (!items.length) throw new Error(`${orderName}: no line items were found.`)
    const shippingAddress = address(first, 'Shipping')
    const billingAddress = address(first, 'Billing')
    return {
      sourceOrderName: orderName,
      email,
      name: firstValue('Shipping Name') || firstValue('Billing Name') || null,
      phone: firstValue('Phone') || firstValue('Shipping Phone') || null,
      financialStatus,
      fulfillmentStatus,
      cancelledAt: cancelledRaw ? new Date(cancelledRaw).toISOString() : null,
      fulfilledAt: fulfilledRaw ? new Date(fulfilledRaw).toISOString() : null,
      currency,
      subtotalCents: cents(firstValue('Subtotal'), 'subtotal', orderName),
      shippingCents: cents(firstValue('Shipping'), 'shipping', orderName, true),
      taxCents: cents(firstValue('Taxes'), 'taxes', orderName, true),
      discountCents: cents(firstValue('Discount Amount'), 'discount amount', orderName, true),
      totalCents: cents(firstValue('Total'), 'total', orderName),
      discountCodes: firstValue('Discount Code').split(/\s+\+\s+|,\s*/).filter(Boolean),
      shippingTitle: firstValue('Shipping Method') || null,
      shippingAddress,
      billingAddress,
      paymentMethodName: firstValue('Payment Method') || null,
      note: firstValue('Notes') || null,
      createdAt: createdAt.toISOString(),
      items,
    }
  })
}

// WooCommerce order CSV (one row per order; line items in one cell as `name=…|sku=…|quantity=…|price=…`, items separated by `;`)
const wooStatuses: Record<string, Pick<ImportedOrder, 'financialStatus' | 'fulfillmentStatus'> & { cancelled?: true }> = {
  completed: { financialStatus: 'paid', fulfillmentStatus: 'fulfilled' },
  processing: { financialStatus: 'paid', fulfillmentStatus: 'unfulfilled' },
  'on-hold': { financialStatus: 'pending', fulfillmentStatus: 'unfulfilled' },
  pending: { financialStatus: 'pending', fulfillmentStatus: 'unfulfilled' },
  refunded: { financialStatus: 'refunded', fulfillmentStatus: 'unfulfilled' },
  cancelled: { financialStatus: 'voided', fulfillmentStatus: 'unfulfilled', cancelled: true },
  failed: { financialStatus: 'voided', fulfillmentStatus: 'unfulfilled', cancelled: true },
}

function wooAddress(row: CsvRow, prefix: 'billing' | 'shipping'): ImportedAddress | null {
  const address1 = row[`${prefix}_address_1`] || '', city = row[`${prefix}_city`] || ''
  const country = (row[`${prefix}_country`] || '').toUpperCase()
  if ((!address1 && !city) || !/^[A-Z]{2}$/.test(country)) return null
  return {
    firstName: row[`${prefix}_first_name`] || null, lastName: row[`${prefix}_last_name`] || null, company: row[`${prefix}_company`] || null,
    address1, address2: row[`${prefix}_address_2`] || null, city, province: row[`${prefix}_state`] || null,
    countryCode: country, zip: row[`${prefix}_postcode`] || null, phone: row[`${prefix}_phone`] || null,
  }
}

function parseWooOrders(rows: CsvRow[]): ImportedOrder[] {
  requireColumns(rows, ['order_number', 'order_date', 'status', 'order_currency', 'order_total', 'billing_email', 'line_items'], 'WooCommerce order export')
  return rows.map((row) => {
    const name = `#${row.order_number}`
    const email = row.billing_email || ''
    if (!email) throw new Error(`${name}: customer email is missing; this order can't be imported.`)
    const createdAt = new Date(row.order_date!)
    if (!Number.isFinite(createdAt.getTime())) throw new Error(`${name}: order_date is missing or invalid.`)
    const status = wooStatuses[(row.status || '').replace(/^wc-/, '').toLowerCase()] ?? wooStatuses.pending!
    const currency = (row.order_currency || '').toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`${name}: order_currency is missing or invalid.`)
    const items = (row.line_items || '').split(';').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
      const fields = Object.fromEntries(entry.split('|').map((part) => {
        const at = part.indexOf('=')
        return [part.slice(0, at).trim(), part.slice(at + 1).trim()]
      }))
      const quantity = Number(fields.quantity)
      if (!fields.name) throw new Error(`${name}: a line item has no name.`)
      if (!Number.isInteger(quantity) || quantity < 1) throw new Error(`${name}: invalid line item quantity.`)
      return {
        title: fields.name, variantTitle: null, sku: fields.sku || null, vendor: null, imageUrl: null,
        unitPriceCents: cents(fields.price || '', 'line item price', name), quantity, discountCents: 0,
      }
    })
    if (!items.length) throw new Error(`${name}: no line items were found.`)
    const shippingCents = cents(row.shipping_total || '', 'shipping_total', name, true)
    const taxCents = cents(row.tax_total || '', 'tax_total', name, true)
    const discountCents = cents(row.discount_total || '', 'discount_total', name, true)
    const totalCents = cents(row.order_total || '', 'order_total', name)
    return {
      sourceOrderName: name, email,
      name: [row.billing_first_name, row.billing_last_name].filter(Boolean).join(' ') || null,
      phone: row.billing_phone || null,
      financialStatus: status.financialStatus, fulfillmentStatus: status.fulfillmentStatus,
      cancelledAt: status.cancelled ? createdAt.toISOString() : null, fulfilledAt: status.fulfillmentStatus === 'fulfilled' ? createdAt.toISOString() : null,
      currency, subtotalCents: Math.max(0, totalCents - shippingCents - taxCents + discountCents), shippingCents, taxCents, discountCents, totalCents,
      discountCodes: (row.coupon_items || '').split(',').map((code) => code.trim()).filter(Boolean),
      shippingTitle: row.shipping_method || null, shippingAddress: wooAddress(row, 'shipping'), billingAddress: wooAddress(row, 'billing'),
      paymentMethodName: row.payment_method_title || null, note: row.customer_note || null, createdAt: createdAt.toISOString(), items,
    }
  })
}

type Source = 'shopify' | 'woocommerce'
const sources = platformOptions<Source>(['shopify', 'woocommerce'], 'Orders CSV')
const parsers: Record<Source, (rows: CsvRow[]) => ImportedOrder[]> = { shopify: parseShopifyOrders, woocommerce: parseWooOrders }

type BatchResult = Awaited<ReturnType<typeof client.admin.orders.importHistorical>>

export function ImportOrdersDialog() {
  const queryClient = useQueryClient()
  const [source, setSource] = useState<Source>('shopify')

  async function run(orders: ImportedOrder[], onProgress: (done: number) => void): Promise<ImportOutcome> {
    const outcome: ImportOutcome = { imported: 0, skipped: 0, errors: [] }
    const add = (result: BatchResult) => {
      outcome.imported += result.imported.length
      outcome.skipped = (outcome.skipped ?? 0) + result.skipped.length
    }
    for (let offset = 0; offset < orders.length; offset += 25) {
      const batch = orders.slice(offset, offset + 25)
      try {
        add(await client.admin.orders.importHistorical({ orders: batch }))
      } catch {
        // A batch is one transaction, so retry its orders one by one to find (and report) the bad ones.
        for (const order of batch) {
          try { add(await client.admin.orders.importHistorical({ orders: [order] })) }
          catch (error) { outcome.errors.push(`${order.sourceOrderName}: ${error instanceof Error ? error.message : 'Import failed'}`) }
        }
      }
      onProgress(Math.min(offset + batch.length, orders.length))
    }
    return outcome
  }

  return <ImportDialog<ImportedOrder>
    title="Import orders"
    description="Upload an order export CSV from another platform. Imported orders keep their historical prices and totals; they won't reserve stock or charge payments."
    noun="orders"
    hint="Customers are matched or created by email. Orders already imported from the same file are skipped."
    resetKey={source}
    options={<FormatSelect label="Import from" value={source} options={sources} onChange={setSource} />}
    parse={(text) => parsers[source](parseCsv(text, 'order'))}
    previewHeaders={['Order', 'Email', 'Items', 'Total', 'Date']}
    previewRow={(order) => [
      order.sourceOrderName, order.email, order.items.length,
      new Intl.NumberFormat(undefined, { style: 'currency', currency: order.currency }).format(order.totalCents / 100),
      new Date(order.createdAt).toLocaleDateString(),
    ]}
    run={run}
    onFinished={() => Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.orders.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.customers.key() }),
    ]).then(() => undefined)}
  />
}
