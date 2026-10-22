'use client'

import { ORPCError } from '@orpc/client'
import { useQuery } from '@tanstack/react-query'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { OrderStatusBadges } from '@/components/admin/order-status'
import { PageHeader } from '@/components/admin/page-header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, orderName } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { orpc, type Outputs } from '@/lib/orpc'
import { CustomerForm } from '../customer-form'

type Order = Outputs['admin']['orders']['list']['items'][number]

const RECENT_ORDERS = 10

const col = columnHelper<Order>()
const orderColumns = [
  col.accessor('orderNumber', { header: 'Order', cell: (c) => orderName(c.getValue()) }),
  col.accessor('createdAt', { header: 'Date', cell: (c) => formatDate(c.getValue()) }),
  col.display({ id: 'status', header: 'Status', cell: ({ row }) => <OrderStatusBadges order={row.original} /> }),
  col.accessor('totalCents', {
    header: 'Total',
    cell: (c) => formatMoney(c.getValue(), c.row.original.currency),
    meta: { className: 'text-right tabular-nums' },
  }),
]

const back = { to: '/admin/customers', label: 'Customers' } as const

export function CustomerDetail({ id }: { id: string }) {
  const customer = useQuery(orpc.admin.customers.get.queryOptions({ input: { id } }))
  const orders = useQuery(
    orpc.admin.orders.list.queryOptions({ input: { customerId: id, limit: RECENT_ORDERS, offset: 0 } }),
  )

  if (customer.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader back={back} title={<Skeleton className="h-8 w-56" />} />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (customer.error) {
    // BAD_REQUEST: the id in the URL isn't a valid uuid
    const notFound =
      customer.error instanceof ORPCError &&
      (customer.error.code === 'NOT_FOUND' || customer.error.code === 'BAD_REQUEST')
    return (
      <div className="space-y-4">
        <PageHeader back={back} title={notFound ? 'Customer not found' : 'Could not load customer'} />
        <p className="text-muted-foreground">
          {notFound ? 'It may have been removed, or it belongs to another shop.' : customer.error.message}
        </p>
      </div>
    )
  }

  const c = customer.data
  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title={c.name ?? c.email}
        description={`${c.name ? `${c.email} · ` : ''}Customer since ${formatDate(c.createdAt)}`}
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            {/* key: re-mount with fresh defaults if another customer loads into this view */}
            <CustomerForm key={c.id} customer={c} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recent orders</CardTitle>
          </CardHeader>
          <CardContent>
            <DataTable
              columns={orderColumns}
              data={orders.data?.items}
              getRowId={(o) => o.id}
              rowLink={(o) => ({ to: '/admin/orders/$id', params: { id: o.id } })}
              isPending={orders.isPending}
              error={orders.error}
              empty="No orders yet."
            />
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
