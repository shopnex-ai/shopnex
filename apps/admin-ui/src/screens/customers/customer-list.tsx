'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { useListParams } from '@/components/admin/list-params'
import { PageHeader } from '@/components/admin/page-header'
import { SearchInput } from '@/components/admin/search-input'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { formatDate } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'
import { CustomerForm } from './customer-form'

type Customer = Outputs['admin']['customers']['list']['items'][number]

const col = columnHelper<Customer>()
const columns = [
  col.accessor('name', { header: 'Name', cell: (c) => c.getValue() ?? '—' }),
  col.accessor('email', { header: 'Email' }),
  col.accessor('phone', { header: 'Phone', cell: (c) => c.getValue() ?? '—' }),
  col.accessor('createdAt', {
    header: 'Added',
    cell: (c) => formatDate(c.getValue()),
    meta: { className: 'text-right tabular-nums' },
  }),
]

export function CustomerList() {
  const { page, pageSize, search, range, setPage, setSearch } = useListParams()
  const { data, error, isPending } = useQuery({
    ...orpc.admin.customers.list.queryOptions({ input: { ...range, search: search || undefined } }),
    // Keep the current page visible while the next one loads
    placeholderData: keepPreviousData,
  })

  return (
    <div className="space-y-4">
      <PageHeader title="Customers" actions={<NewCustomerButton />} />
      <SearchInput value={search} onSearch={setSearch} placeholder="Search by name or email" />
      <DataTable
        columns={columns}
        data={data?.items}
        getRowId={(c) => c.id}
        rowLink={(c) => ({ to: '/admin/customers/$id', params: { id: c.id } })}
        isPending={isPending}
        error={error}
        empty={search ? `No customers match “${search}”.` : 'No customers yet.'}
        pagination={{ page, pageSize, total: data?.total, onPageChange: setPage }}
      />
    </div>
  )
}

function NewCustomerButton() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <PlusIcon />
        New customer
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New customer</DialogTitle>
          <DialogDescription>Customers placing orders at checkout are added automatically.</DialogDescription>
        </DialogHeader>
        <CustomerForm
          onSaved={(customer) => {
            setOpen(false)
            navigate({ to: '/admin/customers/$id', params: { id: customer.id } })
          }}
        />
      </DialogContent>
    </Dialog>
  )
}
