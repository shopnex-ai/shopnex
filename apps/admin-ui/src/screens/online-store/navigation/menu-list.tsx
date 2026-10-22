'use client'

// Online store → Navigation: the shop's menus. Storefronts ask for them by handle; Shopify themes and the
// bundled templates look for "main-menu" (header) and "footer", so those can be created in one click.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { menuInput, type StoredMenuItem } from '@shopnex/api/schemas'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { FormError, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { PageHeader } from '@/components/admin/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { client, orpc, type Outputs } from '@/lib/orpc'
import { newItemId } from './menu-items'

type Menu = Outputs['admin']['menus']['list'][number]

const countItems = (items: StoredMenuItem[]): number => items.reduce((n, i) => n + 1 + countItems(i.items), 0)

// Shopify's defaults
const DEFAULT_MENUS = [
  {
    handle: 'main-menu',
    title: 'Main menu',
    items: [
      { id: newItemId(), title: 'Home', type: 'frontpage' as const, items: [] },
      { id: newItemId(), title: 'Catalog', type: 'catalog' as const, items: [] },
    ],
  },
  {
    handle: 'footer',
    title: 'Footer menu',
    items: [{ id: newItemId(), title: 'Search', type: 'search' as const, items: [] }],
  },
]

export function MenuList() {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery(orpc.admin.menus.list.queryOptions())
  const createDefaults = useMutation({
    mutationFn: async (missing: typeof DEFAULT_MENUS) => {
      for (const menu of missing) await client.admin.menus.create(menu)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: orpc.admin.menus.key() }),
    onError: (e) => toast.error(e.message),
  })
  const missingDefaults = data ? DEFAULT_MENUS.filter((d) => !data.some((m) => m.handle === d.handle)) : []

  const col = columnHelper<Menu>()
  const columns = [
    col.accessor('title', {
      header: 'Menu',
      cell: ({ row: { original: m } }) => (
        <Link to="/admin/online-store/navigation/$id" params={{ id: m.id }} className="font-medium hover:underline">
          {m.title}
        </Link>
      ),
    }),
    col.accessor('handle', {
      header: 'Handle',
      cell: ({ getValue }) => <span className="font-mono text-sm text-muted-foreground">{getValue()}</span>,
    }),
    col.display({
      id: 'items',
      header: 'Items',
      cell: ({ row: { original: m } }) => countItems(m.items),
      meta: { className: 'text-right tabular-nums' },
    }),
  ]

  return (
    <div className="space-y-4">
      <PageHeader
        title="Navigation"
        description="Menus your storefront shows, like the header and footer links."
        actions={<NewMenuDialog />}
      />
      {missingDefaults.length > 0 && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <p className="text-muted-foreground">
              Storefronts look for menus with the handles{' '}
              {missingDefaults.map((d, i) => (
                <span key={d.handle}>
                  {i > 0 && ' and '}
                  <code className="font-mono text-foreground">{d.handle}</code>
                </span>
              ))}
              .
            </p>
            <Button
              size="sm"
              variant="outline"
              disabled={createDefaults.isPending}
              onClick={() => createDefaults.mutate(missingDefaults)}
            >
              Create {missingDefaults.length === 1 ? 'it' : 'them'}
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={data}
            getRowId={(m) => m.id}
            isPending={isPending}
            error={error}
            empty="No menus yet."
          />
        </CardContent>
      </Card>
    </div>
  )
}

const handleFrom = (title: string) =>
  title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const newMenuForm = menuInput.pick({ title: true, handle: true })

function NewMenuDialog() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const form = useZodForm(newMenuForm, { defaultValues: { title: '', handle: '' } })
  const create = useMutation(orpc.admin.menus.create.mutationOptions())
  // The handle follows the title until it's edited by hand
  const title = form.watch('title')
  const autoHandle = useRef('')
  useEffect(() => {
    if (form.getValues('handle') !== autoHandle.current) return
    autoHandle.current = handleFrom(title)
    form.setValue('handle', autoHandle.current)
  }, [title, form])

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const menu = await create.mutateAsync({ ...values, items: [] })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.menus.key() })
      navigate({ to: '/admin/online-store/navigation/$id', params: { id: menu.id } })
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'handle' })
    }
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) {
          form.reset({ title: '', handle: '' })
          autoHandle.current = ''
        }
      }}
    >
      <DialogTrigger render={<Button size="sm" />}>
        <PlusIcon />
        Add menu
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add menu</DialogTitle>
          <DialogDescription>Add its links on the next screen.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit}>
          <FieldGroup>
            <TextField control={form.control} name="title" label="Name" placeholder="Main menu" />
            <TextField
              control={form.control}
              name="handle"
              label="Handle"
              description="What storefronts ask for"
              className="font-mono"
            />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                Add menu
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}
