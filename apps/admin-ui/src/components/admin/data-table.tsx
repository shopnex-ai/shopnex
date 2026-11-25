// Shared list table: server-paginated data from an oRPC query, rendered with TanStack Table.
// Sorting/filtering happen on the server, so the table only uses core features.
import { Link, useNavigate, useRouter, type ToOptions } from '@tanstack/react-router'
import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useState, type MouseEvent, type ReactNode } from 'react'
import { listCountsQuery, PAGE_SIZE, useListCount, type ListCounts, type ListKey } from '@/lib/list-counts'
import {
  createColumnHelper,
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnDef,
  type RowData,
} from '@tanstack/react-table'
import { DeleteSelectedButton } from '@/components/admin/delete-selected-button'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

/** How long a list loads before it shows skeleton rows */
const SKELETON_DELAY_MS = 250
/** Just after the page loads the first request goes out late (after the scripts are loaded and hydrated): wait longer */
const SKELETON_DELAY_AFTER_LOAD_MS = 800
const JUST_LOADED_MS = 3000

// `skeleton`: what a loading row shows in this column, for a cell that is taller or shaped differently than a line of text
const features = tableFeatures({ columnMeta: {} as { className?: string; skeleton?: ReactNode }, rowSelectionFeature })

type Features = typeof features
// `any` value: one table mixes columns of different value types
export type DataTableColumn<TData extends RowData> = ColumnDef<Features, TData, any>

/** Typed column builder: `const col = columnHelper<Customer>()` then `col.accessor('email', { header: 'Email' })` */
export const columnHelper = <TData extends RowData>() => createColumnHelper<Features, TData>()

type DataTableProps<TData extends RowData> = {
  columns: DataTableColumn<TData>[]
  data: TData[] | undefined
  getRowId: (row: TData) => string
  /** Whole row opens this page; the first cell is also a real link (cmd/middle-click, keyboard) */
  rowLink?: (row: TData) => ToOptions
  isPending?: boolean
  error?: Error | null
  /** A short line inside the table when there are no rows (a search with no match, an empty view) */
  empty?: ReactNode
  /** When there are no rows at all: shown in place of the table, as a panel. Leave out while a search or filter is on. */
  blank?: ReactNode
  /** Extra actions for the selected rows, next to "N selected" */
  selectionActions?: (ids: string[], clearSelection: () => void) => ReactNode
  /** "Delete selected" for the selected rows: `entity` is the singular name, `invalidate` the list's query key */
  bulkDelete?: { entity: string; remove: (ids: string[]) => Promise<unknown>; invalidate: QueryKey }
  /** Omit for tables that show a fixed slice (e.g. "recent orders") */
  pagination?: PaginationProps
  /**
   * Which list this is, when the table shows all of it (no search or filter on). The admin layout knows the row
   * count of every list, so while the rows load this table draws the right thing at once: the empty state, or
   * skeleton rows for the rows that are coming. Its own rows keep the count right for the rest of the session.
   */
  countKey?: ListKey
}

type PaginationProps = {
  page: number
  pageSize: number
  total: number | undefined
  onPageChange: (page: number) => void
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  rowLink,
  isPending,
  error,
  empty = 'Nothing here yet.',
  blank,
  selectionActions,
  bulkDelete,
  pagination,
  countKey,
}: DataTableProps<TData>) {
  const navigate = useNavigate()
  const router = useRouter()
  const table = useTable({ features, columns, data: data ?? [], getRowId: (row) => getRowId(row) })
  const rows = table.getRowModel().rows

  const queryClient = useQueryClient()
  const known = useListCount(countKey)
  const total = pagination?.total ?? data?.length
  useEffect(() => {
    if (!countKey || data === undefined || total === undefined) return
    const count = Math.min(total, PAGE_SIZE)
    queryClient.setQueryData<ListCounts>(listCountsQuery.queryKey, (old) =>
      old && old[countKey] !== count ? { ...old, [countKey]: count } : old,
    )
  }, [queryClient, countKey, data, total])

  // The skeleton waits a moment: a list that answers at once, or turns out to be empty, shows no rows that then jump
  const loading = Boolean(isPending && !data)
  const [showSkeleton, setShowSkeleton] = useState(false)
  useEffect(() => {
    if (!loading) return setShowSkeleton(false)
    const justLoaded = performance.now() < JUST_LOADED_MS // time since the page started loading
    const timer = setTimeout(() => setShowSkeleton(true), justLoaded ? SKELETON_DELAY_AFTER_LOAD_MS : SKELETON_DELAY_MS)
    return () => clearTimeout(timer)
  }, [loading])
  const selectedIds = table.getSelectedRowIds()

  const onRowClick = (link: ToOptions) => (e: MouseEvent) => {
    // Let links/buttons inside the row, and text selection, behave normally
    if ((e.target as HTMLElement).closest('a, button, input, [role="button"]')) return
    if (window.getSelection()?.toString()) return
    if (e.metaKey || e.ctrlKey) window.open(router.buildLocation(link).href, '_blank')
    else navigate(link)
  }

  // The count is known: an empty list shows its empty state at once, a list with rows shows skeleton rows to match
  if (loading && blank && known === 0)
    return <div className="overflow-hidden rounded-xl bg-card shadow-card">{blank}</div>
  if (loading && !showSkeleton && !known) return null

  if (blank && !isPending && !error && rows.length === 0) {
    return <div className="overflow-hidden rounded-xl bg-card shadow-card">{blank}</div>
  }

  return (
    <div className="space-y-3">
      {/* On the page a raised card; inside a card an inset well */}
      <div className="overflow-hidden rounded-xl bg-card shadow-card in-data-[slot=card]:rounded-lg in-data-[slot=card]:surface-inset">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((group) => (
              <TableRow key={group.id}>
                <TableHead className="w-10 min-w-10">
                  <div
                    className="-m-2 flex min-h-10 min-w-10 cursor-pointer items-center justify-center"
                    onClick={(event) => {
                      event.stopPropagation()
                      if ((event.target as HTMLElement).tagName !== 'INPUT') table.toggleAllPageRowsSelected()
                    }}
                  >
                    <input
                      type="checkbox"
                      aria-label="Select all rows on this page"
                      checked={table.getIsAllPageRowsSelected()}
                      ref={(element) => {
                        if (element)
                          element.indeterminate = table.getIsSomePageRowsSelected() && !table.getIsAllPageRowsSelected()
                      }}
                      onChange={table.getToggleAllPageRowsSelectedHandler()}
                      className="size-4 cursor-pointer accent-primary"
                    />
                  </div>
                </TableHead>
                {selectedIds.length > 0 ? (
                  <TableHead colSpan={columns.length} className="h-10">
                    <div className="flex flex-wrap items-center gap-3">
                      <span>{selectedIds.length} selected</span>
                      {selectionActions?.(selectedIds, () => table.resetRowSelection(true))}
                      {bulkDelete && (
                        <DeleteSelectedButton
                          ids={selectedIds}
                          entity={selectedIds.length === 1 ? bulkDelete.entity : `${bulkDelete.entity}s`}
                          remove={bulkDelete.remove}
                          onDeleted={async () => {
                            table.resetRowSelection(true)
                            await queryClient.invalidateQueries({ queryKey: bulkDelete.invalidate })
                          }}
                        />
                      )}
                    </div>
                  </TableHead>
                ) : (
                  group.headers.map((header) => (
                    <TableHead key={header.id} className={header.column.columnDef.meta?.className}>
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </TableHead>
                  ))
                )}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: known ? Math.min(known, PAGE_SIZE) : 5 }, (_, i) => (
                <TableRow key={i}>
                  <TableCell className="w-10 min-w-10">
                    {/* The same box as the real checkbox, so the two line up */}
                    <div className="-m-2 flex min-h-10 min-w-10 items-center justify-center">
                      <Skeleton className="size-4 rounded-[4px]" />
                    </div>
                  </TableCell>
                  {columns.map((column, j) => (
                    <TableCell key={j} className={column.meta?.className}>
                      {column.meta?.skeleton ?? <Skeleton className="h-4 w-full max-w-40" />}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : error ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="py-8 text-center text-destructive">
                  {error.message}
                </TableCell>
              </TableRow>
            ) : rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={columns.length + 1} className="py-8 text-center text-muted-foreground">
                  {empty}
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow
                  key={row.id}
                  onClick={rowLink ? onRowClick(rowLink(row.original)) : undefined}
                  className={rowLink ? 'cursor-pointer' : undefined}
                >
                  <TableCell
                    className="w-10 min-w-10 cursor-pointer"
                    onClick={(event) => {
                      event.stopPropagation()
                      if ((event.target as HTMLElement).tagName !== 'INPUT') row.toggleSelected()
                    }}
                  >
                    <div className="-m-2 flex min-h-10 min-w-10 cursor-pointer items-center justify-center">
                      <input
                        type="checkbox"
                        aria-label={`Select row ${row.id}`}
                        checked={row.getIsSelected()}
                        onChange={row.getToggleSelectedHandler()}
                        className="size-4 cursor-pointer accent-primary"
                      />
                    </div>
                  </TableCell>
                  {row.getAllCells().map((cell, i) => (
                    <TableCell key={cell.id} className={cell.column.columnDef.meta?.className}>
                      {i === 0 && rowLink ? (
                        <Link {...rowLink(row.original)} className="font-medium hover:underline">
                          <table.FlexRender cell={cell} />
                        </Link>
                      ) : (
                        <table.FlexRender cell={cell} />
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
      {pagination && <Pagination {...pagination} />}
    </div>
  )
}

function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  if (!total) return null
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className="flex items-center justify-between text-sm text-muted-foreground">
      <span className="tabular-nums">
        {from}–{to} of {total}
      </span>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
          Next
        </Button>
      </div>
    </div>
  )
}
