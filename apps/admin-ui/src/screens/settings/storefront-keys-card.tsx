'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CopyIcon, PlusIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { storefrontKeyInput } from '@shopnex/api/schemas'
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
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatDate } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'

type StorefrontKey = Outputs['admin']['storefrontKeys']['list'][number]

const col = columnHelper<StorefrontKey>()
const columnsFor = (channelName: (id: string) => string) => [
  col.accessor('name', { header: 'Name' }),
  col.accessor('channelId', { header: 'Channel', cell: ({ row: { original: k } }) => channelName(k.channelId) }),
  col.accessor('token', {
    header: 'Key',
    cell: ({ row: { original: k } }) => (
      <div className="flex items-center gap-1">
        <code className="truncate font-mono text-xs">{k.token}</code>
        {!k.revokedAt && <CopyButton text={k.token} />}
      </div>
    ),
    meta: { className: 'max-w-64' },
  }),
  col.accessor('createdAt', {
    header: 'Created',
    cell: ({ row: { original: k } }) =>
      k.revokedAt ? <Badge variant="outline">Revoked</Badge> : formatDate(k.createdAt),
    meta: { className: 'tabular-nums' },
  }),
  col.display({
    id: 'actions',
    cell: ({ row: { original: k } }) => (k.revokedAt ? null : <RevokeButton storefrontKey={k} />),
    meta: { className: 'text-right' },
  }),
]

export function StorefrontKeysCard() {
  const { data, error, isPending } = useQuery(orpc.admin.storefrontKeys.list.queryOptions())
  const channels = useQuery(orpc.admin.channels.list.queryOptions())
  const columns = columnsFor((id) => channels.data?.find((c) => c.id === id)?.name ?? '—')
  return (
    <Card>
      <CardHeader>
        <CardTitle>Storefront keys</CardTitle>
        <CardDescription>
          Publishable keys connect an external storefront (e.g. a template from <code>templates/</code>) to this shop.
          They are safe to use in browser code.
        </CardDescription>
        <CardAction>
          <NewKeyButton />
        </CardAction>
      </CardHeader>
      <CardContent>
        <DataTable
          columns={columns}
          data={data}
          getRowId={(k) => k.id}
          isPending={isPending}
          error={error}
          empty="No keys yet."
        />
      </CardContent>
    </Card>
  )
}

function CopyButton({ text }: { text: string }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label="Copy key"
      onClick={async () => {
        await navigator.clipboard.writeText(text)
        toast.success('Key copied')
      }}
    >
      <CopyIcon />
    </Button>
  )
}

function NewKeyButton() {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const form = useZodForm(storefrontKeyInput, { defaultValues: { name: '' } })
  const channels = useQuery(orpc.admin.channels.list.queryOptions())
  const [channelId, setChannelId] = useState<string | null>(null)
  const create = useMutation(orpc.admin.storefrontKeys.create.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await create.mutateAsync({ ...values, channelId: channelId ?? undefined })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.storefrontKeys.key() })
      toast.success('Key created')
      setOpen(false)
      form.reset()
    } catch (error) {
      setServerError(form, error)
    }
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        <PlusIcon />
        New key
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New storefront key</DialogTitle>
          <DialogDescription>Name it after the storefront that will use it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} noValidate>
          <FieldGroup>
            <TextField
              control={form.control}
              name="name"
              label="Name"
              placeholder="Main storefront"
              autoComplete="off"
            />
            {channels.data && channels.data.length > 1 && (
              <Field>
                <Label>Channel</Label>
                <Select
                  items={channels.data.map((c) => ({ value: c.id, label: c.name }))}
                  value={channelId ?? channels.data[0]!.id}
                  onValueChange={(value) => setChannelId(value)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.data.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">The storefront sees what’s published on this channel.</p>
              </Field>
            )}
            <FormError form={form} />
            <Field orientation="horizontal" className="justify-end">
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? 'Creating…' : 'Create key'}
              </Button>
            </Field>
          </FieldGroup>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function RevokeButton({ storefrontKey }: { storefrontKey: StorefrontKey }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const revoke = useMutation(orpc.admin.storefrontKeys.revoke.mutationOptions())

  async function onRevoke() {
    try {
      await revoke.mutateAsync({ id: storefrontKey.id })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.storefrontKeys.key() })
      toast.success('Key revoked')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not revoke key')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Revoke</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Revoke “{storefrontKey.name}”?</DialogTitle>
          <DialogDescription>
            Storefronts using this key stop working immediately. This can&apos;t be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={onRevoke} disabled={revoke.isPending}>
            {revoke.isPending ? 'Revoking…' : 'Revoke key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
