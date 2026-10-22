'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ImageIcon } from 'lucide-react'
import { useMemo } from 'react'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { useListParams } from '@/components/admin/list-params'
import { PageHeader } from '@/components/admin/page-header'
import { SearchInput } from '@/components/admin/search-input'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { orpc, type Outputs } from '@/lib/orpc'
import { NewProductButton } from './new-product-button'

type Product = Outputs['admin']['products']['list']['items'][number]

const statusVariant = { active: 'default', draft: 'secondary', archived: 'outline' } as const

// Shopify-style: "12 in stock for 3 variants"; variants with no stock tracking don't count
function inventory(p: Product) {
  const tracked = p.variants.filter((v) => v.inventoryQuantity != null)
  if (tracked.length === 0) return <span className="text-muted-foreground">Not tracked</span>
  const total = tracked.reduce((sum, v) => sum + v.inventoryQuantity!, 0)
  const forVariants = p.variants.length > 1 ? ` for ${p.variants.length} variants` : ''
  return <span className={total <= 0 ? 'text-destructive' : undefined}>{`${total} in stock${forVariants}`}</span>
}

function price(p: Product, currency: string) {
  const prices = p.variants.map((v) => v.priceCents)
  if (prices.length === 0) return '—'
  const [min, max] = [Math.min(...prices), Math.max(...prices)]
  return min === max ? formatMoney(min, currency) : `${formatMoney(min, currency)} – ${formatMoney(max, currency)}`
}

const columnsFor = (currency: string) => {
  const col = columnHelper<Product>()
  return [
    col.accessor('title', {
      header: 'Product',
      cell: ({ row: { original: p } }) => (
        <div className="flex items-center gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">
            {p.images[0] ? (
              <img src={p.images[0].url} alt={p.images[0].alt ?? ''} className="size-full object-cover" />
            ) : (
              <ImageIcon className="size-4 text-muted-foreground" />
            )}
          </div>
          <span className="font-medium">{p.title}</span>
        </div>
      ),
    }),
    col.accessor('status', {
      header: 'Status',
      cell: (c) => (
        <Badge variant={statusVariant[c.getValue()]} className="capitalize">
          {c.getValue()}
        </Badge>
      ),
    }),
    col.display({ id: 'inventory', header: 'Inventory', cell: ({ row }) => inventory(row.original) }),
    col.display({
      id: 'price',
      header: 'Price',
      cell: ({ row }) => price(row.original, currency),
      meta: { className: 'text-right tabular-nums' },
    }),
    col.accessor('updatedAt', {
      header: 'Updated',
      cell: (c) => formatDate(c.getValue()),
      meta: { className: 'text-right tabular-nums' },
    }),
  ]
}

export function ProductList({ currency }: { currency: string }) {
  const columns = useMemo(() => columnsFor(currency), [currency])
  const { page, pageSize, search, range, setPage, setSearch } = useListParams()
  const { data, error, isPending } = useQuery({
    ...orpc.admin.products.list.queryOptions({ input: { ...range, search: search || undefined } }),
    placeholderData: keepPreviousData,
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Products" actions={<NewProductButton currency={currency} />} />
      <SearchInput value={search} onSearch={setSearch} placeholder="Search products" />
      <DataTable
        columns={columns}
        data={data?.items}
        getRowId={(p) => p.id}
        rowLink={(p) => ({ to: '/admin/products/$id', params: { id: p.id } })}
        isPending={isPending}
        error={error}
        empty={search ? `No products match “${search}”.` : 'No products yet. Create one to start selling.'}
        pagination={{ page, pageSize, total: data?.total, onPageChange: setPage }}
      />
    </div>
  )
}
