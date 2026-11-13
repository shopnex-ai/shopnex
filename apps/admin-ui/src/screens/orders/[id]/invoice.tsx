'use client'

import { ORPCError } from '@orpc/client'
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeftIcon, PrinterIcon } from 'lucide-react'
import { Fragment } from 'react'
import { AddressLines } from '@/components/admin/address'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, orderName } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { orpc, type Outputs } from '@/lib/orpc'

type Order = Outputs['admin']['orders']['get']
type Shop = Outputs['admin']['shop']['get']

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

/**
 * Printable invoice for one order: who issues it, who it is for, what was bought, the tax by rate and the total.
 * Shown without the admin around it, so printing (or "Save as PDF") gives the page and nothing else.
 */
export function InvoicePage({ id }: { id: string }) {
  const order = useQuery(orpc.admin.orders.get.queryOptions({ input: { id } }))
  const shop = useQuery(orpc.admin.shop.get.queryOptions())

  if (order.error) {
    const notFound =
      order.error instanceof ORPCError && (order.error.code === 'NOT_FOUND' || order.error.code === 'BAD_REQUEST')
    return (
      <Frame>
        <p className="p-8 text-sm">{notFound ? 'Order not found.' : order.error.message}</p>
      </Frame>
    )
  }
  if (!order.data || !shop.data) {
    return (
      <Frame>
        <Skeleton className="m-8 h-96 w-auto bg-neutral-200" />
      </Frame>
    )
  }
  return <Invoice order={order.data} shop={shop.data} />
}

function Frame({ children, toolbar }: { children: React.ReactNode; toolbar?: React.ReactNode }) {
  return (
    <div className="min-h-svh bg-neutral-100 p-4 text-neutral-900 print:bg-white print:p-0 md:p-8">
      <div className="mx-auto max-w-3xl">
        {toolbar}
        <div className="bg-white shadow-sm print:shadow-none">{children}</div>
      </div>
    </div>
  )
}

function Invoice({ order: o, shop }: { order: Order; shop: Shop }) {
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
  const missing = [!shop.businessAddress && 'business address', !shop.taxId && 'VAT or tax number'].filter(Boolean)
  const paid =
    o.financialStatus === 'paid' || o.financialStatus === 'partially_refunded' || o.financialStatus === 'refunded'

  return (
    <Frame
      toolbar={
        <div className="mb-4 space-y-3 print:hidden">
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              render={<Link to="/admin/orders/$id" params={{ id: o.id }} />}
              className="text-neutral-900"
            >
              <ArrowLeftIcon />
              {orderName(o.orderNumber)}
            </Button>
            <Button size="sm" onClick={() => window.print()}>
              <PrinterIcon />
              Print or save as PDF
            </Button>
          </div>
          {missing.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              This invoice has no {missing.join(' and no ')}. An invoice in the EU has to show them (the VAT number only
              if you are registered).{' '}
              <Link to="/admin/settings/general" className="font-medium underline">
                Add them in Settings
              </Link>
              .
            </p>
          )}
        </div>
      }
    >
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
    </Frame>
  )
}
