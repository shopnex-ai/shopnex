'use client'

import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { useListParams } from '@/components/admin/list-params'
import { PageHeader } from '@/components/admin/page-header'
import { SearchInput } from '@/components/admin/search-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'

type PlatformShop = Outputs['admin']['platform']['shops']['items'][number]
type PlatformUser = Outputs['admin']['platform']['users']['items'][number]

const shopCol = columnHelper<PlatformShop>()
const shopColumns = [
  shopCol.accessor('name', { header: 'Shop' }),
  shopCol.accessor('slug', {
    header: 'Slug',
    cell: (c) => <span className="text-muted-foreground">{c.getValue()}</span>,
  }),
  shopCol.accessor('ownerEmail', { header: 'Owner', cell: (c) => c.getValue() ?? '—' }),
  shopCol.accessor('members', { header: 'Staff', meta: { className: 'text-right tabular-nums' } }),
  shopCol.accessor('orders', { header: 'Orders', meta: { className: 'text-right tabular-nums' } }),
  shopCol.accessor('createdAt', {
    header: 'Created',
    cell: (c) => formatDate(c.getValue()),
    meta: { className: 'text-right tabular-nums' },
  }),
]

const userCol = columnHelper<PlatformUser>()
const userColumns = [
  userCol.accessor('name', { header: 'Name' }),
  userCol.accessor('email', { header: 'Email' }),
  userCol.display({
    id: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <div className="flex gap-1">
        {row.original.role === 'superadmin' && <Badge>Super admin</Badge>}
        {row.original.banned && <Badge variant="destructive">Banned</Badge>}
        {row.original.role !== 'superadmin' && !row.original.banned && (
          <span className="text-muted-foreground">Active</span>
        )}
      </div>
    ),
  }),
  userCol.accessor('shops', { header: 'Shops', meta: { className: 'text-right tabular-nums' } }),
  userCol.accessor('createdAt', {
    header: 'Signed up',
    cell: (c) => formatDate(c.getValue()),
    meta: { className: 'text-right tabular-nums' },
  }),
]

// Every shop and user on this install (super admins)
export function PlatformDashboard() {
  const { filter, setFilter } = useListParams()
  const tab = filter('tab') === 'users' ? 'users' : 'shops'
  return (
    <div className="space-y-6">
      <PageHeader title="Platform" description="Every shop and user on this install." />
      <Overview />
      <div className="flex gap-2">
        <Button variant={tab === 'shops' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('tab', '')}>
          Shops
        </Button>
        <Button variant={tab === 'users' ? 'default' : 'outline'} size="sm" onClick={() => setFilter('tab', 'users')}>
          Users
        </Button>
      </div>
      {tab === 'shops' ? <ShopsTable /> : <UsersTable />}
    </div>
  )
}

function Overview() {
  const { data, error, isPending } = useQuery(orpc.admin.platform.overview.queryOptions())
  if (error) return <p className="text-destructive">{error.message}</p>
  const stats = [
    { label: 'Shops', value: data?.shops },
    { label: 'Users', value: data?.users },
    { label: `New shops, ${data?.recentDays ?? 7} days`, value: data?.newShops },
    { label: `Signups, ${data?.recentDays ?? 7} days`, value: data?.newUsers },
  ]
  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {stats.map((stat) => (
        <Card key={stat.label} size="sm">
          <CardHeader>
            <CardDescription>{stat.label}</CardDescription>
            <CardTitle className="text-2xl tabular-nums">
              {isPending ? <Skeleton className="h-8 w-16" /> : stat.value}
            </CardTitle>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}

function ShopsTable() {
  const { page, pageSize, search, range, setPage, setSearch } = useListParams()
  const { data, error, isPending } = useQuery({
    ...orpc.admin.platform.shops.queryOptions({ input: { ...range, search: search || undefined } }),
    placeholderData: keepPreviousData,
  })
  return (
    <div className="space-y-4">
      <SearchInput value={search} onSearch={setSearch} placeholder="Search by name or slug" />
      <DataTable
        columns={shopColumns}
        data={data?.items}
        getRowId={(s) => s.id}
        isPending={isPending}
        error={error}
        empty={search ? `No shops match “${search}”.` : 'No shops yet.'}
        pagination={{ page, pageSize, total: data?.total, onPageChange: setPage }}
      />
    </div>
  )
}

function UsersTable() {
  const { page, pageSize, search, range, setPage, setSearch } = useListParams()
  const { data, error, isPending } = useQuery({
    ...orpc.admin.platform.users.queryOptions({ input: { ...range, search: search || undefined } }),
    placeholderData: keepPreviousData,
  })
  return (
    <div className="space-y-4">
      <SearchInput value={search} onSearch={setSearch} placeholder="Search by name or email" />
      <DataTable
        columns={userColumns}
        data={data?.items}
        getRowId={(u) => u.id}
        isPending={isPending}
        error={error}
        empty={search ? `No users match “${search}”.` : 'No users yet.'}
        pagination={{ page, pageSize, total: data?.total, onPageChange: setPage }}
      />
    </div>
  )
}
