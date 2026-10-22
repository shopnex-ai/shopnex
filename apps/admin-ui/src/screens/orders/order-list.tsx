'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { useListParams } from '@/components/admin/list-params'
import { FinancialStatusBadge, FulfillmentStatusBadge } from '@/components/admin/order-status'
import { PageHeader } from '@/components/admin/page-header'
import { SearchInput } from '@/components/admin/search-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate, orderName } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { orpc, type Inputs, type Outputs } from '@/lib/orpc'

type Order = Outputs['admin']['orders']['list']['items'][number]

const col = columnHelper<Order>()
const columns = [
  col.accessor('orderNumber', { header: 'Order', cell: (c) => orderName(c.getValue()) }),
  col.accessor('createdAt', {
    header: 'Date',
    cell: (c) => formatDate(c.getValue()),
    meta: { className: 'tabular-nums' },
  }),
  col.accessor('email', {
    header: 'Customer',
    cell: ({ row: { original: o } }) => o.customerName ?? o.email,
  }),
  col.accessor('financialStatus', {
    header: 'Payment',
    cell: ({ row: { original: o } }) => <FinancialStatusBadge status={o.financialStatus} />,
  }),
  col.accessor('fulfillmentStatus', {
    header: 'Fulfillment',
    cell: ({ row: { original: o } }) =>
      o.cancelledAt ? (
        <Badge variant="destructive">Cancelled</Badge>
      ) : (
        <FulfillmentStatusBadge status={o.fulfillmentStatus} />
      ),
  }),
  col.accessor('totalCents', {
    header: 'Total',
    cell: (c) => formatMoney(c.getValue(), c.row.original.currency),
    meta: { className: 'text-right tabular-nums' },
  }),
]

type ListFilters = Omit<Inputs['admin']['orders']['list'], 'limit' | 'offset' | 'search' | 'customerId'>

// Shopify's default order views
const VIEWS: { key: string; label: string; filters: ListFilters; empty: string }[] = [
  { key: '', label: 'All', filters: {}, empty: 'No orders yet. Orders placed at checkout show up here.' },
  {
    key: 'unpaid',
    label: 'Unpaid',
    filters: { financialStatus: 'pending', cancelled: false },
    empty: 'No unpaid orders.',
  },
  {
    key: 'unfulfilled',
    label: 'Unfulfilled',
    filters: { fulfillmentStatus: 'unfulfilled', cancelled: false },
    empty: 'Nothing to ship.',
  },
  { key: 'cancelled', label: 'Cancelled', filters: { cancelled: true }, empty: 'No cancelled orders.' },
]

export function OrderList() {
  const { page, pageSize, search, range, setPage, setSearch, filter, setFilter } = useListParams()
  const view = VIEWS.find((v) => v.key === filter('view')) ?? VIEWS[0]!
  const { data, error, isPending } = useQuery({
    ...orpc.admin.orders.list.queryOptions({ input: { ...range, ...view.filters, search: search || undefined } }),
    // Keep the current page visible while the next one loads
    placeholderData: keepPreviousData,
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Orders" />
      <div className="flex flex-wrap gap-1" role="group" aria-label="Order views">
        {VIEWS.map((v) => (
          <Button
            key={v.key || 'all'}
            size="sm"
            variant={v === view ? 'secondary' : 'ghost'}
            aria-pressed={v === view}
            onClick={() => setFilter('view', v.key)}
          >
            {v.label}
          </Button>
        ))}
      </div>
      <SearchInput value={search} onSearch={setSearch} placeholder="Search by order number, email or customer" />
      <DataTable
        columns={columns}
        data={data?.items}
        getRowId={(o) => o.id}
        rowLink={(o) => ({ to: '/admin/orders/$id', params: { id: o.id } })}
        isPending={isPending}
        error={error}
        empty={search ? `No orders match “${search}”.` : view.empty}
        pagination={{ page, pageSize, total: data?.total, onPageChange: setPage }}
      />
    </div>
  )
}
