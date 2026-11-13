'use client'

import { ORPCError } from '@orpc/client'
import { useQueries, useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeftIcon, PrinterIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { orderName } from '@/lib/format'
import { orpc } from '@/lib/orpc'
import { InvoiceDocument, PackingSlipDocument } from './documents'

export type PrintType = 'invoice' | 'packing-slip'

/** Like Shopify's print menu: a batch is capped so the page stays quick to load and to print */
export const MAX_PRINT_ORDERS = 50

const noun = (type: PrintType, count: number) =>
  type === 'invoice' ? (count === 1 ? 'invoice' : 'invoices') : count === 1 ? 'packing slip' : 'packing slips'

/**
 * Invoices or packing slips for one or several orders, one document per page, shown without the admin around it so
 * printing (or "Save as PDF") gives the pages and nothing else.
 */
export function PrintPage({ ids, type }: { ids: string[]; type: PrintType }) {
  const shop = useQuery(orpc.admin.shop.get.queryOptions())
  const tooMany = ids.length > MAX_PRINT_ORDERS
  const orders = useQueries({
    queries: (tooMany ? [] : ids).map((id) => orpc.admin.orders.get.queryOptions({ input: { id } })),
  })

  const back =
    ids.length === 1
      ? { to: '/admin/orders/$id' as const, params: { id: ids[0]! }, label: 'Order' }
      : { to: '/admin/orders' as const, params: {}, label: 'Orders' }

  if (ids.length === 0 || tooMany) {
    return (
      <Frame>
        <p className="p-8 text-sm">
          {tooMany
            ? `Print up to ${MAX_PRINT_ORDERS} orders at a time. Select fewer orders in the list.`
            : 'Choose orders to print from the orders list.'}
        </p>
      </Frame>
    )
  }
  const failed = orders.find((o) => o.error)
  if (failed?.error) {
    const notFound =
      failed.error instanceof ORPCError && (failed.error.code === 'NOT_FOUND' || failed.error.code === 'BAD_REQUEST')
    return (
      <Frame>
        <p className="p-8 text-sm">{notFound ? 'An order was not found.' : failed.error.message}</p>
      </Frame>
    )
  }
  if (!shop.data || orders.some((o) => !o.data)) {
    return (
      <Frame>
        <Skeleton className="m-8 h-96 w-auto bg-neutral-200" />
      </Frame>
    )
  }

  const loaded = orders.map((o) => o.data!)
  const missing =
    type === 'invoice'
      ? [!shop.data.businessAddress && 'business address', !shop.data.taxId && 'VAT or tax number'].filter(Boolean)
      : []
  const Document = type === 'invoice' ? InvoiceDocument : PackingSlipDocument

  return (
    <Frame
      toolbar={
        <div className="mb-4 space-y-3 print:hidden">
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              size="sm"
              render={<Link to={back.to} params={back.params} />}
              className="text-neutral-900"
            >
              <ArrowLeftIcon />
              {ids.length === 1 ? orderName(loaded[0]!.orderNumber) : back.label}
            </Button>
            <div className="flex items-center gap-3">
              <span className="text-sm text-neutral-600">
                {loaded.length} {noun(type, loaded.length)}
              </span>
              <Button size="sm" onClick={() => window.print()}>
                <PrinterIcon />
                Print or save as PDF
              </Button>
            </div>
          </div>
          {missing.length > 0 && (
            <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {loaded.length === 1 ? 'This invoice has' : 'These invoices have'} no {missing.join(' and no ')}. An
              invoice in the EU has to show them (the VAT number only if you are registered).{' '}
              <Link to="/admin/settings/general" className="font-medium underline">
                Add them in Settings
              </Link>
              .
            </p>
          )}
        </div>
      }
    >
      {loaded.map((order) => (
        // One document per printed page
        <div key={order.id} className="break-after-page last:break-after-auto">
          <Document order={order} shop={shop.data} />
        </div>
      ))}
    </Frame>
  )
}

function Frame({ children, toolbar }: { children: ReactNode; toolbar?: ReactNode }) {
  return (
    <div className="min-h-svh bg-neutral-100 p-4 text-neutral-900 print:bg-white print:p-0 md:p-8">
      <div className="mx-auto max-w-3xl">
        {toolbar}
        <div className="divide-y-8 divide-neutral-100 bg-white shadow-sm print:divide-y-0 print:shadow-none">
          {children}
        </div>
      </div>
    </div>
  )
}
