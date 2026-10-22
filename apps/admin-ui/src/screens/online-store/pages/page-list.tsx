'use client'

// Online store → Pages: About, FAQ, Shipping policy… Storefronts show visible pages at /pages/{handle};
// add them to a menu under Navigation.
import { useQuery } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
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

  return (
    <div className="space-y-4">
      <PageHeader
        title="Pages"
        description="About, FAQ, shipping and return policies… Add them to a menu under Navigation."
        actions={
          <Button
            size="sm"
            nativeButton={false}
            render={<Link to="/admin/online-store/pages/$id" params={{ id: 'new' }} />}
          >
            <PlusIcon />
            Add page
          </Button>
        }
      />
      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={data}
            getRowId={(p) => p.id}
            isPending={isPending}
            error={error}
            empty="No pages yet."
          />
        </CardContent>
      </Card>
    </div>
  )
}
