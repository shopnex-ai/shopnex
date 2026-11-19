import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { PlusIcon, LayersIcon } from 'lucide-react'
import { publishedOn } from '@/components/admin/channel-picker'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { DeleteSelectedButton } from '@/components/admin/delete-selected-button'
import { EmptyState } from '@/components/admin/empty-state'
import { PageHeader } from '@/components/admin/page-header'
import { Button } from '@/components/ui/button'
import { client, orpc, type Outputs } from '@/lib/orpc'

type Collection = Outputs['admin']['collections']['list'][number]

export function CollectionList() {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery(orpc.admin.collections.list.queryOptions({ input: { limit: 100 } }))

  const channels = useQuery(orpc.admin.channels.list.queryOptions())
  const col = columnHelper<Collection>()
  const columns = [
    col.accessor('title', {
      header: 'Title',
      cell: ({ row: { original: c } }) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{c.title}</span>
          <span className="font-mono text-xs text-muted-foreground">/{c.slug}</span>
        </span>
      ),
    }),
    col.display({
      id: 'channels',
      header: 'Sales channels',
      cell: ({ row: { original: c } }) =>
        publishedOn(c.publications, channels.data) ?? <span className="text-muted-foreground">Not published</span>,
    }),
    col.accessor('productCount', {
      header: 'Products',
      cell: ({ row: { original: c } }) => c.productCount,
      meta: { className: 'text-right tabular-nums' },
    }),
  ]

  const createButton = (
    <Button render={<Link to="/admin/collections/new" />}>
      <PlusIcon />
      Create collection
    </Button>
  )

  return (
    <div className="space-y-4">
      <PageHeader title="Collections" actions={createButton} />
      <DataTable
        countKey="collections"
        columns={columns}
        data={data}
        getRowId={(c) => c.id}
        rowLink={(c) => ({ to: '/admin/collections/$id', params: { id: c.id } })}
        isPending={isPending}
        error={error}
        blank={
          <EmptyState icon={LayersIcon} title="Group your products into collections" action={createButton}>
            Collections organize your products in your store and navigation.
          </EmptyState>
        }
        selectionActions={(ids, clearSelection) => (
          <DeleteSelectedButton
            ids={ids}
            entity={ids.length === 1 ? 'collection' : 'collections'}
            remove={(selected) => client.admin.collections.deleteMany({ ids: selected })}
            onDeleted={async () => {
              clearSelection()
              await queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() })
            }}
          />
        )}
      />
    </div>
  )
}
