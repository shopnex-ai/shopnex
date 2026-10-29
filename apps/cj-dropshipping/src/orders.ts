// Paid Shopnex order → CJ order, and CJ's tracking → Shopnex fulfillment.
import type { ShopContext } from '@shopnex/app'
import { cjFor, settingsOf } from './cj'
import type { Tables } from './db'

// The parts of the order webhook payload (the admin API's order) this app reads
export type PaidOrder = {
  id: string
  orderNumber: number
  email: string
  phone: string | null
  shippingAddress: {
    firstName: string | null
    lastName: string | null
    address1: string
    address2: string | null
    city: string
    province: string | null
    countryCode: string
    zip: string | null
    phone: string | null
  } | null
  items: { sku: string | null; quantity: number }[]
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** Sends the CJ lines of a paid order to CJ. Orders without CJ products are left alone. */
export async function forwardOrder(shop: ShopContext, tables: Tables, order: PaidOrder) {
  const lines = order.items.flatMap((item) => {
    const mapped = item.sku ? tables.findVariant(shop, item.sku) : undefined
    return mapped ? [{ vid: mapped.vid, quantity: item.quantity }] : []
  })
  if (lines.length === 0) return
  if (!tables.claimOrder(shop, order.id, order.orderNumber)) return

  try {
    const to = order.shippingAddress
    if (!to) throw new Error('The order has no shipping address')
    const { cj } = await cjFor(shop)
    const settings = await settingsOf(shop)

    // Cheapest method CJ offers from China to the destination
    const freight = await cj.logistics.calculateFreight({
      startCountryCode: 'CN',
      endCountryCode: to.countryCode,
      zip: to.zip ?? undefined,
      products: lines,
    })
    const method = freight.data?.reduce((best, o) => (o.logisticPrice < best.logisticPrice ? o : best))
    if (!method) throw new Error(freight.error ?? `CJ has no shipping method to ${to.countryCode}`)

    const created = await cj.orders.createOrder({
      orderNumber: `SNX-${order.orderNumber}`,
      shippingCustomerName: [to.firstName, to.lastName].filter(Boolean).join(' ') || order.email,
      shippingAddress: to.address1,
      shippingAddress2: to.address2 ?? undefined,
      shippingCity: to.city,
      shippingProvince: to.province ?? to.city,
      shippingCountry: to.countryCode,
      shippingCountryCode: to.countryCode,
      shippingZip: to.zip ?? undefined,
      shippingPhone: to.phone ?? order.phone ?? undefined,
      email: order.email,
      fromCountryCode: 'CN',
      logisticName: method.logisticName,
      // 2: pay from the CJ balance now; 3: create the order and leave payment to the merchant
      payType: settings.autoPay ? 2 : 3,
      products: lines,
    })
    if (!created.data) throw new Error(created.error ?? 'CJ did not create the order')
    tables.setOrder(shop, order.id, 'created', { cjOrderId: created.data.orderId })
  } catch (error) {
    console.error(`[cj] order ${order.orderNumber}:`, message(error))
    tables.setOrder(shop, order.id, 'failed', { error: message(error) })
  }
}

/** Marks the shop's CJ orders fulfilled once CJ has a tracking number for them */
export async function syncTracking(shop: ShopContext, tables: Tables) {
  const open = tables.awaitingTracking(shop)
  if (open.length === 0) return
  const { cj } = await cjFor(shop)
  for (const { order_id, cj_order_id } of open) {
    try {
      const result = await cj.orders.queryOrder({ orderId: cj_order_id })
      const trackingNumber = result.data?.trackNumber
      if (!trackingNumber) continue
      await shop.admin.post(`/orders/${order_id}/fulfill`, {
        trackingNumber,
        trackingCompany: result.data?.logisticName,
      })
      tables.setOrder(shop, order_id, 'fulfilled', { trackingNumber })
    } catch (error) {
      console.error(`[cj] tracking for ${cj_order_id}:`, message(error))
    }
  }
}
