'use client'

// Online store → Pages: About, FAQ, Shipping policy… Storefronts show visible pages at /pages/{handle};
// add them to a menu under Navigation.
import { useQuery } from '@tanstack/react-query'
import { PlusIcon, NotebookTextIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { EmptyState } from '@/components/admin/empty-state'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatDate } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'

type Page = Outputs['admin']['pages']['list'][number]

export function PageList() {
  const { data, error, isPending } = useQuery(orpc.admin.pages.list.queryOptions())

  const col = columnHelper<Page>()
  const columns = [
    col.accessor('title', {
      header: 'Title',
      cell: ({ row: { original: p } }) => (
        <span className="flex items-center gap-2">
          <Link to="/admin/online-store/pages/$id" params={{ id: p.id }} className="font-medium hover:underline">
            {p.title}
          </Link>
          {!p.publishedAt && <Badge variant="outline">Hidden</Badge>}
        </span>
      ),
    }),
    col.accessor('handle', {
      header: 'URL',
      cell: ({ getValue }) => <span className="font-mono text-sm text-muted-foreground">/pages/{getValue()}</span>,
    }),
    col.accessor('updatedAt', {
      header: 'Updated',
      cell: ({ getValue }) => formatDate(getValue()),
      meta: { className: 'text-right' },
    }),
  ]

  const addButton = (
    <Button size="sm" nativeButton={false} render={<Link to="/admin/online-store/pages/$id" params={{ id: 'new' }} />}>
      <PlusIcon />
      Add page
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Pages" actions={addButton} />
      <DataTable
        columns={columns}
        data={data}
        getRowId={(p) => p.id}
        isPending={isPending}
        error={error}
        blank={
          <EmptyState icon={NotebookTextIcon} title="Add your first page" action={addButton}>
            Pages like About, FAQ or shipping and return policies. Link them from a menu under Navigation.
          </EmptyState>
        }
      />
    </div>
  )
}
