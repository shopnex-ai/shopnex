'use client'

import { Fragment } from 'react'
import { AddressLines } from '@/components/admin/address'
import { formatDate, orderName } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import type { Outputs } from '@/lib/orpc'

export type Order = Outputs['admin']['orders']['get']
export type Shop = Outputs['admin']['shop']['get']

type Address = NonNullable<Order['shippingAddress']>
const sameAddress = (a: Address, b: Address) =>
  [a.firstName, a.lastName, a.company, a.address1, a.address2, a.city, a.province, a.countryCode, a.zip]
    .map((part) => part ?? '')
    .join('|') ===
  [b.firstName, b.lastName, b.company, b.address1, b.address2, b.city, b.province, b.countryCode, b.zip]
    .map((part) => part ?? '')
    .join('|')

// The invoice number is the order number: it is unique and counts up without gaps unless orders are deleted
export const invoiceNumber = (orderNumber: number) => `INV-${orderNumber}`

/** One invoice: who issues it, who it is for, what was bought, the tax by rate and the total */
export function InvoiceDocument({ order: o, shop }: { order: Order; shop: Shop }) {
  const money = (cents: number) => formatMoney(cents, o.currency)
  const billTo = o.billingAddress ?? o.shippingAddress
  // Only when it is somewhere else: an order's billing address is often a copy of the shipping one
  const shipTo =
    o.billingAddress && o.shippingAddress && !sameAddress(o.billingAddress, o.shippingAddress)
      ? o.shippingAddress
      : null
  const shipping = o.shippingLines[0]
  const refunded = o.transactions
    .filter((t) => t.kind === 'refund' && t.status === 'success')
    .reduce((sum, t) => sum + t.amountCents, 0)
  // Tax is part of the total when prices include it and on top of it otherwise: either way the total minus tax is net
  const netCents = o.totalCents - o.taxCents
  const paid =
    o.financialStatus === 'paid' || o.financialStatus === 'partially_refunded' || o.financialStatus === 'refunded'

  return (
    <article className="space-y-8 p-8 text-sm print:p-0">
      {o.cancelledAt && (
        <p className="border border-neutral-900 p-2 text-center font-semibold uppercase tracking-wide">
          This order was cancelled
        </p>
      )}

      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-1">
          <p className="text-base font-semibold">{shop.legalName || shop.name}</p>
          {shop.businessAddress && <p className="whitespace-pre-line leading-relaxed">{shop.businessAddress}</p>}
          {shop.taxId && <p>VAT / Tax ID: {shop.taxId}</p>}
        </div>
        <div className="space-y-1 sm:text-right">
          <h1 className="text-2xl font-semibold">Invoice</h1>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 sm:justify-end">
            <dt className="text-neutral-500">Invoice number</dt>
            <dd className="font-medium">{invoiceNumber(o.orderNumber)}</dd>
            <dt className="text-neutral-500">Invoice date</dt>
            <dd>{formatDate(o.createdAt)}</dd>
            <dt className="text-neutral-500">Order</dt>
            <dd>{orderName(o.orderNumber)}</dd>
          </dl>
        </div>
      </header>

      <section className="grid gap-6 sm:grid-cols-2">
        <div className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Bill to</h2>
          {billTo && <AddressLines address={billTo} />}
          <p>{o.email}</p>
        </div>
        {shipTo && (
          <div className="space-y-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Ship to</h2>
            <AddressLines address={shipTo} />
          </div>
        )}
      </section>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 pr-4 font-semibold">Description</th>
            <th className="px-2 py-2 text-right font-semibold">Qty</th>
            <th className="px-2 py-2 text-right font-semibold">Unit price</th>
            <th className="py-2 pl-2 text-right font-semibold">Amount</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((item) => (
            <tr key={item.id} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-4">
                <div>{item.title}</div>
                {(item.variantTitle || item.sku) && (
                  <div className="text-xs text-neutral-500">
                    {[item.variantTitle, item.sku && `SKU ${item.sku}`].filter(Boolean).join(' · ')}
                  </div>
                )}
              </td>
              <td className="px-2 py-2 text-right tabular-nums">{item.quantity}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(item.unitPriceCents)}</td>
              <td className="py-2 pl-2 text-right tabular-nums">{money(item.unitPriceCents * item.quantity)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <dl className="ml-auto grid max-w-xs grid-cols-[1fr_auto] gap-x-6 gap-y-1 tabular-nums">
        <dt>Subtotal</dt>
        <dd className="text-right">{money(o.subtotalCents)}</dd>
        <dt>{shipping ? `Shipping · ${shipping.title}` : 'Shipping'}</dt>
        <dd className="text-right">{money(o.shippingCents)}</dd>
        {o.discountCents > 0 && (
          <>
            <dt>Discount</dt>
            <dd className="text-right">−{money(o.discountCents)}</dd>
          </>
        )}
        {o.taxCents > 0 && (
          <>
            <dt className="mt-1 border-t border-neutral-300 pt-1">Total excluding tax</dt>
            <dd className="mt-1 border-t border-neutral-300 pt-1 text-right">{money(netCents)}</dd>
            {o.taxLines.map((t, i) => (
              <Fragment key={i}>
                <dt>
                  {t.title} {t.ratePercent}%
                </dt>
                <dd className="text-right">{money(t.amountCents)}</dd>
              </Fragment>
            ))}
          </>
        )}
        <dt className="mt-1 border-t border-neutral-900 pt-1 text-base font-semibold">
          Total{o.taxCents > 0 ? ' incl. tax' : ''}
        </dt>
        <dd className="mt-1 border-t border-neutral-900 pt-1 text-right text-base font-semibold">
          {money(o.totalCents)}
        </dd>
        {refunded > 0 && (
          <>
            <dt className="text-neutral-500">Refunded</dt>
            <dd className="text-right text-neutral-500">−{money(refunded)}</dd>
          </>
        )}
      </dl>

      <footer className="space-y-1 border-t border-neutral-200 pt-4 text-xs text-neutral-600">
        {o.taxCents > 0 && o.taxesIncluded && <p>Prices include tax.</p>}
        <p>
          {paid ? 'Paid' : 'Payment pending'}
          {o.paymentMethodName ? ` · ${o.paymentMethodName}` : ''}
        </p>
        {!paid && !o.cancelledAt && o.paymentInstructions && (
          <p className="whitespace-pre-line">{o.paymentInstructions}</p>
        )}
      </footer>
    </article>
  )
}

/** One packing slip: where it goes and what goes in the box. No prices: it travels with the parcel */
export function PackingSlipDocument({ order: o, shop }: { order: Order; shop: Shop }) {
  const shipping = o.shippingLines[0]
  const units = o.items.reduce((sum, item) => sum + item.quantity, 0)

  return (
    <article className="space-y-8 p-8 text-sm print:p-0">
      {o.cancelledAt && (
        <p className="border border-neutral-900 p-2 text-center font-semibold uppercase tracking-wide">
          This order was cancelled: do not ship
        </p>
      )}

      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="space-y-1">
          <p className="text-base font-semibold">{shop.legalName || shop.name}</p>
          {shop.businessAddress && <p className="whitespace-pre-line leading-relaxed">{shop.businessAddress}</p>}
        </div>
        <div className="space-y-1 sm:text-right">
          <h1 className="text-2xl font-semibold">Packing slip</h1>
          <dl className="grid grid-cols-[auto_auto] gap-x-4 gap-y-0.5 sm:justify-end">
            <dt className="text-neutral-500">Order</dt>
            <dd className="font-medium">{orderName(o.orderNumber)}</dd>
            <dt className="text-neutral-500">Order date</dt>
            <dd>{formatDate(o.createdAt)}</dd>
            {shipping && (
              <>
                <dt className="text-neutral-500">Shipping</dt>
                <dd>{shipping.title}</dd>
              </>
            )}
          </dl>
        </div>
      </header>

      <section className="space-y-1">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Ship to</h2>
        {o.shippingAddress ? <AddressLines address={o.shippingAddress} /> : <p>No shipping address</p>}
        <p>{o.email}</p>
      </section>

      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-neutral-900 text-left text-xs uppercase tracking-wide text-neutral-500">
            <th className="py-2 pr-4 font-semibold">Item</th>
            <th className="px-2 py-2 font-semibold">SKU</th>
            <th className="py-2 pl-2 text-right font-semibold">Qty</th>
          </tr>
        </thead>
        <tbody>
          {o.items.map((item) => (
            <tr key={item.id} className="border-b border-neutral-200 align-top">
              <td className="py-2 pr-4">
                <div>{item.title}</div>
                {item.variantTitle && <div className="text-xs text-neutral-500">{item.variantTitle}</div>}
              </td>
              <td className="px-2 py-2 text-neutral-600">{item.sku ?? ''}</td>
              <td className="py-2 pl-2 text-right text-base font-semibold tabular-nums">{item.quantity}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={2} className="py-2 text-right text-neutral-500">
              Items in this parcel
            </td>
            <td className="py-2 pl-2 text-right font-semibold tabular-nums">{units}</td>
          </tr>
        </tfoot>
      </table>

      {o.note && (
        <section className="space-y-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Note</h2>
          <p className="whitespace-pre-line">{o.note}</p>
        </section>
      )}
    </article>
  )
}
