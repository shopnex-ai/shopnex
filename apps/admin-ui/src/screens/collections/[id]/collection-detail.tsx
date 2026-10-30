'use client'

import { ORPCError } from '@orpc/client'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { PlusIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ChannelPicker } from '@/components/admin/channel-picker'
import { FormError, setServerError } from '@/components/admin/form'
import { PageHeader } from '@/components/admin/page-header'
import { SearchInput } from '@/components/admin/search-input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'
import { CollectionFields, useCollectionForm } from '../collection-fields'

type Collection = Outputs['admin']['collections']['get']

const back = { to: '/admin/collections', label: 'Collections' } as const

const toValues = (c: Pick<Collection, 'title' | 'slug' | 'description'>) => ({ title: c.title, slug: c.slug, description: c.description })

export function CollectionDetail({ id }: { id: string }) {
  const collection = useQuery(orpc.admin.collections.get.queryOptions({ input: { id } }))

  if (collection.isPending) {
    return (
      <div className="space-y-4">
        <PageHeader back={back} title={<Skeleton className="h-8 w-64" />} />
        <Skeleton className="h-96 w-full" />
      </div>
    )
  }
  if (collection.error) {
    // BAD_REQUEST: the id in the URL isn't a valid uuid
    const notFound =
      collection.error instanceof ORPCError &&
      (collection.error.code === 'NOT_FOUND' || collection.error.code === 'BAD_REQUEST')
    return (
      <div className="space-y-4">
        <PageHeader back={back} title={notFound ? 'Collection not found' : 'Could not load collection'} />
        <p className="text-muted-foreground">
          {notFound ? 'It may have been removed, or it belongs to another shop.' : collection.error.message}
        </p>
      </div>
    )
  }
  // key: fresh form defaults if another collection loads into this view
  return <CollectionEditor key={collection.data.id} collection={collection.data} />
}

function CollectionEditor({ collection }: { collection: Collection }) {
  const queryClient = useQueryClient()
  const form = useCollectionForm(toValues(collection))
  const update = useMutation(orpc.admin.collections.update.mutationOptions())
  const { isDirty, isSubmitting } = form.formState

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      const saved = await update.mutateAsync({ id: collection.id, ...values })
      // The page reads the collection through `get`, so refetch it along with the list
      await queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() })
      form.reset(toValues(saved))
      toast.success('Collection saved')
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'slug' })
    }
  })

  return (
    <div className="space-y-6">
      <PageHeader
        back={back}
        title={collection.title}
        description={<span className="font-mono">/{collection.slug}</span>}
        actions={<DeleteCollection collection={collection} />}
      />

      <form onSubmit={onSubmit} noValidate className="space-y-6">
        {isDirty && (
          <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-xl bg-card/95 px-4 py-2 shadow-flyout backdrop-blur">
            <span className="text-sm font-medium">Unsaved changes</span>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={() => form.reset()}>
                Discard
              </Button>
              <Button type="submit" size="sm" disabled={isSubmitting}>
                {isSubmitting ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        )}
        <FormError form={form} />
        <Card>
          <CardContent>
            <CollectionFields control={form.control} />
          </CardContent>
        </Card>
      </form>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <CollectionProducts collectionId={collection.id} />
        <CollectionChannels collection={collection} />
      </div>
    </div>
  )
}

// Membership saves immediately, independent of the form above
function CollectionProducts({ collectionId }: { collectionId: string }) {
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const members = useQuery(orpc.admin.collections.products.queryOptions({ input: { id: collectionId } }))
  const results = useQuery({
    ...orpc.admin.products.list.queryOptions({ input: { limit: 20, search } }),
    enabled: search !== '',
  })
  const add = useMutation(orpc.admin.collections.addProduct.mutationOptions())
  const remove = useMutation(orpc.admin.collections.removeProduct.mutationOptions())

  const run = async (action: () => Promise<unknown>) => {
    try {
      await action()
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.admin.products.key() }),
      ])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Something went wrong')
    }
  }

  const inCollection = new Set(members.data?.map((p) => p.id))
  const matches = (results.data?.items ?? []).filter((p) => !inCollection.has(p.id))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Products</CardTitle>
        <CardDescription>
          {members.data ? `${members.data.length} in this collection.` : 'Products shown together in your store.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <SearchInput value={search} onSearch={setSearch} placeholder="Search products to add" />
          {search !== '' &&
            (results.isPending ? (
              <p className="text-sm text-muted-foreground">Searching…</p>
            ) : matches.length ? (
              <ul className="divide-y rounded-lg border">
                {matches.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate">{p.title}</span>
                      {p.status !== 'active' && <Badge variant="outline">{p.status}</Badge>}
                    </span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={add.isPending}
                      onClick={() => run(() => add.mutateAsync({ id: collectionId, productId: p.id }))}
                    >
                      <PlusIcon />
                      Add
                    </Button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No other products match “{search}”.</p>
            ))}
        </div>

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
          <p className="text-sm text-muted-foreground">No products in this collection yet.</p>
        )}
      </CardContent>
    </Card>
  )
}

function CollectionChannels({ collection }: { collection: Collection }) {
  const queryClient = useQueryClient()
  const save = useMutation(orpc.admin.collections.setPublications.mutationOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Sales channels</CardTitle>
        <CardDescription>Where this collection is shown.</CardDescription>
      </CardHeader>
      <CardContent>
        <ChannelPicker
          publications={collection.publications}
          isPending={false}
          saving={save.isPending}
          onSave={async (channelIds) => {
            try {
              await save.mutateAsync({
                id: collection.id,
                publications: channelIds.map((channelId) => ({ channelId })),
              })
              await queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() })
            } catch (error) {
              toast.error(error instanceof Error ? error.message : 'Could not save sales channels')
            }
          }}
        />
      </CardContent>
    </Card>
  )
}

function DeleteCollection({ collection }: { collection: Collection }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const remove = useMutation(orpc.admin.collections.delete.mutationOptions())

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: collection.id })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.collections.key() })
      toast.success('Collection deleted')
      await navigate({ to: '/admin/collections' })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete the collection')
      setOpen(false)
    }
  }

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        Delete
      </Button>
      <Dialog open={open} onOpenChange={(next) => !remove.isPending && setOpen(next)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete “{collection.title}”?</DialogTitle>
            <DialogDescription>Deleting a collection does not delete its products.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" disabled={remove.isPending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => void onDelete()}>
              {remove.isPending ? 'Deleting…' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
