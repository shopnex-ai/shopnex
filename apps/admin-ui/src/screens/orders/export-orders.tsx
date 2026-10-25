import { useState } from 'react'
import { ExportDialog, FormatSelect, platformOptions } from '@/components/admin/import-dialog'
import { csvTable, fetchAll, mapPool } from '@/lib/csv'
import { client } from '@/lib/orpc'

const shopifyHeaders = [
  'Name', 'Email', 'Financial Status', 'Fulfillment Status', 'Fulfilled at', 'Canceled at', 'Currency', 'Created at',
  'Subtotal', 'Shipping', 'Taxes', 'Total', 'Discount Code', 'Discount Amount', 'Shipping Method', 'Payment Method', 'Notes',
  'Lineitem quantity', 'Lineitem name', 'Lineitem price', 'Lineitem SKU', 'Lineitem discount', 'Vendor',
  'Billing Name', 'Billing Company', 'Billing Address1', 'Billing Address2', 'Billing City', 'Billing Zip', 'Billing Province', 'Billing Country Code', 'Billing Phone',
  'Shipping Name', 'Shipping Company', 'Shipping Address1', 'Shipping Address2', 'Shipping City', 'Shipping Zip', 'Shipping Province', 'Shipping Country Code', 'Shipping Phone',
  'Phone',
]

type Order = Awaited<ReturnType<typeof client.admin.orders.get>>
type Address = Order['shippingAddress']

const amount = (cents: number) => (cents / 100).toFixed(2)
const iso = (date: Date | string | null | undefined) => date ? new Date(date).toISOString() : ''

function addressColumns(address: Address) {
  if (!address) return Array(9).fill('')
  return [
    [address.firstName, address.lastName].filter(Boolean).join(' '), address.company, address.address1, address.address2,
    address.city, address.zip, address.province, address.countryCode, address.phone,
  ]
}

// Shopify-style: order-level columns on the first row, then one row per extra line item
function shopifyRows(order: Order) {
  return order.items.map((item, index) => {
    const first = index === 0
    return [
      `#${order.orderNumber}`, order.email, order.financialStatus, order.fulfillmentStatus,
      first ? iso(order.fulfillments[0]?.createdAt) : '', first ? iso(order.cancelledAt) : '', order.currency, iso(order.createdAt),
      first ? amount(order.subtotalCents) : '', first ? amount(order.shippingCents) : '', first ? amount(order.taxCents) : '',
      first ? amount(order.totalCents) : '', first ? order.discountCodes.join(', ') : '', first ? amount(order.discountCents) : '',
      first ? order.shippingLines[0]?.title ?? '' : '', first ? order.paymentMethodName ?? '' : '', first ? order.note ?? '' : '',
      item.quantity, [item.title, item.variantTitle].filter(Boolean).join(' - '), amount(item.unitPriceCents), item.sku ?? '',
      amount(item.discountCents), item.vendor ?? '',
      ...addressColumns(order.billingAddress), ...addressColumns(order.shippingAddress), order.phone ?? '',
    ]
  })
}

const wooHeaders = [
  'order_number', 'order_date', 'status', 'order_currency', 'order_total', 'shipping_total', 'tax_total', 'discount_total', 'coupon_items',
  'payment_method_title', 'shipping_method', 'customer_note',
  ...['billing', 'shipping'].flatMap((p) => ['first_name', 'last_name', 'company', 'address_1', 'address_2', 'city', 'state', 'postcode', 'country', 'phone'].map((f) => `${p}_${f}`)),
  'line_items',
]
const wooAddress = (a: Address) => [a?.firstName, a?.lastName, a?.company, a?.address1, a?.address2, a?.city, a?.province, a?.zip, a?.countryCode, a?.phone].map((v) => v ?? '')
const clean = (text: string) => text.replace(/[;|=\r\n]+/g, ' ').trim()

function wooStatus(order: Order) {
  if (order.cancelledAt) return 'cancelled'
  if (order.financialStatus === 'refunded') return 'refunded'
  if (order.fulfillmentStatus === 'fulfilled') return 'completed'
  return order.financialStatus === 'paid' ? 'processing' : 'pending'
}

function wooRows(order: Order) {
  return [[
    order.orderNumber, iso(order.createdAt), wooStatus(order), order.currency, amount(order.totalCents), amount(order.shippingCents), amount(order.taxCents),
    amount(order.discountCents), order.discountCodes.join(','), order.paymentMethodName ?? '', order.shippingLines[0]?.title ?? '', order.note ?? '',
    ...wooAddress(order.billingAddress), ...wooAddress(order.shippingAddress),
    order.items.map((i) => `name=${clean([i.title, i.variantTitle].filter(Boolean).join(' - '))}|sku=${clean(i.sku ?? '')}|quantity=${i.quantity}|price=${amount(i.unitPriceCents)}`).join(';'),
  ]]
}

type Source = 'shopify' | 'woocommerce'
const formats = platformOptions<Source>(['shopify', 'woocommerce'], 'Orders CSV')
const layouts = { shopify: { headers: shopifyHeaders, rows: shopifyRows }, woocommerce: { headers: wooHeaders, rows: wooRows } }

export function ExportOrdersDialog() {
  const [source, setSource] = useState<Source>('shopify')

  async function build() {
    const summaries = await fetchAll((page) => client.admin.orders.list(page))
    const orders = await mapPool(summaries, 6, (order) => client.admin.orders.get({ id: order.id }))
    const { headers, rows } = layouts[source]
    return { csv: csvTable(headers, orders.flatMap(rows)), count: orders.length }
  }

  return <ExportDialog title="Export orders" noun="orders" filename={`shopnex-orders-${source}`} build={build}
    description="Download every order as a CSV formatted for another commerce platform, including addresses, discounts and line items.">
    <FormatSelect label="Export format" value={source} options={formats} onChange={setSource} />
  </ExportDialog>
}
