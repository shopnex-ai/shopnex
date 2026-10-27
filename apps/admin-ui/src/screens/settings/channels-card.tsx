'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { channelInput } from '@shopnex/api/schemas'
import { DataTable, columnHelper } from '@/components/admin/data-table'
import { FormError, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Field, FieldGroup } from '@/components/ui/field'
import { orpc, type Outputs } from '@/lib/orpc'

type Channel = Outputs['admin']['channels']['list'][number]

const TYPE_NAMES = { online_store: 'Online Store', headless: 'Headless' } as const

// The Online Store is every shop's own channel: it can't be deleted
const isDefault = (c: Channel) => c.handle === 'online-store'

export function ChannelsCard() {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery(orpc.admin.channels.list.queryOptions())
  const update = useMutation(orpc.admin.channels.update.mutationOptions())

  const col = columnHelper<Channel>()
  const columns = [
    col.accessor('name', {
      header: 'Name',
      cell: ({ row: { original: c } }) => (
        <span className="flex items-center gap-2">
          <span className="font-medium">{c.name}</span>
          <span className="font-mono text-xs text-muted-foreground">{c.handle}</span>
        </span>
      ),
    }),
    col.accessor('type', {
      header: 'Type',
      cell: ({ row: { original: c } }) => <Badge variant="outline">{TYPE_NAMES[c.type]}</Badge>,
    }),
    col.display({
      id: 'autoPublish',
      header: 'New products',
      cell: ({ row: { original: c } }) => (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={c.autoPublish}
            disabled={update.isPending}
            onChange={async (e) => {
              try {
                await update.mutateAsync({ id: c.id, autoPublish: e.target.checked })
                await queryClient.invalidateQueries({ queryKey: orpc.admin.channels.key() })
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Could not save')
              }
            }}
          />
          Publish automatically
        </label>
      ),
    }),
    col.display({
      id: 'actions',
      cell: ({ row: { original: c } }) => (isDefault(c) ? null : <DeleteChannelButton channel={c} />),
      meta: { className: 'text-right' },
    }),
  ]

  return (
    <Card>
      <CardHeader>
        <CardTitle>Channels</CardTitle>
        <CardDescription>
          Storefront keys read one channel, and carts and orders belong to the channel they were made on.
        </CardDescription>
        <CardAction>
          <NewChannelButton />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data}
          getRowId={(c) => c.id}
          isPending={isPending}
          error={error}
          empty="No channels."
        />
      </CardContent>
    </Card>
  )
}

function NewChannelButton() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const form = useZodForm(channelInput, { defaultValues: { name: '' } })
  const create = useMutation(orpc.admin.channels.create.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync(values)
      await queryClient.invalidateQueries({ queryKey: orpc.admin.channels.key() })
      toast.success('Channel created')
      setOpen(false)
      form.reset()
    } catch (error) {
      setServerError(form, error, { CONFLICT: 'handle' })
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon />
        New channel
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New sales channel</DialogTitle>
          <DialogDescription>
            Create one per storefront or app that should see its own catalog. Then publish products on it and give its
            storefront a key.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField
              control={form.control}
              name="name"
              label="Name"
              placeholder="Wholesale portal"
              autoComplete="off"
            />
            <TextField
              control={form.control}
              name="handle"
              label="Handle"
              placeholder="wholesale-portal"
              description="Leave empty to generate it from the name. It can’t be changed later."
            />
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creating…' : 'Create channel'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DeleteChannelButton({ channel }: { channel: Channel }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const remove = useMutation(orpc.admin.channels.delete.mutationOptions())

  async function onDelete() {
    try {
      await remove.mutateAsync({ id: channel.id })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.channels.key() })
      toast.success('Channel deleted')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete channel')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Delete</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete “{channel.name}”?</DialogTitle>
          <DialogDescription>
            Its publications are removed. A channel with orders or storefront keys can’t be deleted.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={onDelete} disabled={remove.isPending}>
            {remove.isPending ? 'Deleting…' : 'Delete channel'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
