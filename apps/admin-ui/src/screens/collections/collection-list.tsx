'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { collectionInput } from '@shopnex/api/schemas'
import { ChannelPicker, publishedOn } from '@/components/admin/channel-picker'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { DeleteSelectedButton } from '@/components/admin/delete-selected-button'
import { FormError, TextField, TextareaField, setServerError, useZodForm } from '@/components/admin/form'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { client, orpc, type Outputs } from '@/lib/orpc'
import { GenerateCollectionDescription, GenerateCollectionSeo, htmlToPlainText } from './ai-generate'

type Collection = Outputs['admin']['collections']['list'][number]

export function CollectionList() {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery(orpc.admin.collections.list.queryOptions({ input: { limit: 100 } }))

  const channels = useQuery(orpc.admin.channels.list.queryOptions())
  // The edit dialog lives here, not in a table cell: a cell can remount (and would close it)
  const [editingId, setEditing] = useState<string | null>(null)
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
    col.display({
      id: 'actions',
      cell: ({ row: { original: c } }) => (
        <Button variant="ghost" size="sm" onClick={() => setEditing(c.id)}>
          Edit
        </Button>
      ),
      meta: { className: 'text-right' },
    }),
  ]
  const editing = data?.find((c) => c.id === editingId)

  return (
    <div className="space-y-4">
      <PageHeader
        title="Collections"
        description="Group products to show them together in your store and navigation."
        actions={<CollectionDialog />}
      />
      <Card>
        <CardContent>
          <DataTable
            columns={columns}
            data={data}
            getRowId={(c) => c.id}
            isPending={isPending}
            error={error}
            empty="No collections yet."
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
        </CardContent>
      </Card>
      {editing && <CollectionDialog key={editing.id} collection={editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

const empty = {
  title: '',
  slug: undefined,
  description: null,
  descriptionHtml: null,
  seo: { title: null, description: null },
}

// Create when `collection` is omitted, otherwise edit (or delete) it
function CollectionDialog({
  collection,
  onClose,
}: {
  collection?: Collection
  /** Set when the dialog is opened from outside (always open): called when it closes */
  onClose?: () => void
}) {
  const queryClient = useQueryClient()
  const [openState, setOpenState] = useState(false)
  const open = onClose ? true : openState
  const setOpen = (next: boolean) => (onClose ? !next && onClose() : setOpenState(next))
  const toValues = () =>
    collection
      ? {
          title: collection.title,
          slug: collection.slug,
          description: collection.description,
          descriptionHtml: collection.descriptionHtml,
          seo: { title: collection.seoTitle, description: collection.seoDescription },
        }
      : empty
  const form = useZodForm(collectionInput, { defaultValues: toValues() })
  const create = useMutation(orpc.admin.collections.create.mutationOptions())
  const update = useMutation(orpc.admin.collections.update.mutationOptions())
  const remove = useMutation(orpc.admin.collections.delete.mutationOptions())
  const refresh = () => queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() })

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      if (collection) await update.mutateAsync({ id: collection.id, ...values })
      else await create.mutateAsync(values)
      await refresh()
      toast.success(collection ? 'Collection saved' : 'Collection created')
      setOpen(false)
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'slug' })
    }
  })

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: collection!.id })
      await refresh()
      toast.success('Collection deleted')
      setOpen(false)
    } catch (error) {
      setServerError(form, error)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (next) form.reset(toValues())
      }}
    >
      {!collection && (
        <DialogTrigger render={<Button size="sm" />}>
          <PlusIcon />
          Create collection
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{collection ? 'Edit collection' : 'Create collection'}</DialogTitle>
          <DialogDescription>
            {collection ? 'Deleting a collection does not delete its products.' : 'Add products once it is created.'}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField control={form.control} name="title" label="Title" placeholder="Summer linen" />
            <TextField
              control={form.control}
              name="slug"
              label="Handle"
              placeholder="summer-linen"
              description={collection ? undefined : 'Leave empty to generate it from the title.'}
            />
            {collection && (
              <div className="-mb-3 flex justify-end">
                <GenerateCollectionDescription
                  collectionId={collection.id}
                  onUse={(html) => {
                    form.setValue('descriptionHtml', html, { shouldDirty: true })
                    form.setValue('description', htmlToPlainText(html), { shouldDirty: true })
                  }}
                />
              </div>
            )}
            <TextareaField control={form.control} name="description" label="Description (optional)" nullable />
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Search engine listing</p>
              {collection && (
                <GenerateCollectionSeo
                  collectionId={collection.id}
                  onUse={(seo) => {
                    form.setValue('seo.title', seo.title, { shouldDirty: true })
                    form.setValue('seo.description', seo.description, { shouldDirty: true })
                  }}
                />
              )}
            </div>
            <TextField
              control={form.control}
              name="seo.title"
              label="Page title"
              nullable
              placeholder={collection?.title}
            />
            <TextareaField control={form.control} name="seo.description" label="Meta description" nullable />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-between">
              {collection ? (
                <Button type="button" variant="ghost" onClick={onDelete} disabled={remove.isPending}>
                  Delete
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Saving…' : collection ? 'Save' : 'Create collection'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
        {collection && open && <CollectionChannels collection={collection} />}
        {collection && open && <CollectionProducts collectionId={collection.id} />}
      </DialogContent>
    </Dialog>
  )
}

// Membership saves immediately, independent of the form above
function CollectionProducts({ collectionId }: { collectionId: string }) {
  const queryClient = useQueryClient()
  const members = useQuery(orpc.admin.collections.products.queryOptions({ input: { id: collectionId } }))
  const catalog = useQuery(orpc.admin.products.list.queryOptions({ input: { limit: 100 } }))
  const add = useMutation(orpc.admin.collections.addProduct.mutationOptions())
  const remove = useMutation(orpc.admin.collections.removeProduct.mutationOptions())

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.products.key() }),
    ])
  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong')
    }
  }

  const inCollection = new Set(members.data?.map((p) => p.id))
  const options = (catalog.data?.items ?? [])
    .filter((p) => !inCollection.has(p.id))
    .map((p) => ({ value: p.id, label: p.title }))

  return (
    <div className="space-y-3 border-t pt-4">
      <p className="text-sm font-medium">Products</p>
      {members.isPending ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : members.data?.length ? (
        <ul className="space-y-1">
          {members.data.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="truncate">{p.title}</span>
                {p.status !== 'active' && <Badge variant="outline">{p.status}</Badge>}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${p.title}`}
                disabled={remove.isPending}
                onClick={() => run(() => remove.mutateAsync({ id: collectionId, productId: p.id }))}
              >
                <XIcon />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No products in this collection.</p>
      )}
      {options.length > 0 && (
        <Select
          items={options}
          value={null}
          onValueChange={(productId) => productId && run(() => add.mutateAsync({ id: collectionId, productId }))}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Add a product…" />
          </SelectTrigger>
          <SelectContent>
            {options.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  )
}

function CollectionChannels({ collection }: { collection: Collection }) {
  const queryClient = useQueryClient()
  const save = useMutation(orpc.admin.collections.setPublications.mutationOptions())
  return (
    <div className="space-y-2 border-t pt-4">
      <p className="text-sm font-medium">Sales channels</p>
      <ChannelPicker
        publications={collection.publications}
        isPending={false}
        saving={save.isPending}
        onSave={async (channelIds) => {
          try {
            await save.mutateAsync({ id: collection.id, publications: channelIds.map((channelId) => ({ channelId })) })
            await queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() })
          } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not save sales channels')
          }
        }}
      />
    </div>
  )
}
