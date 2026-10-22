'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
import { marketplaceConnectInput } from '@shopnex/api/schemas'
import { FormError, TextField, setServerError, useZodForm } from '@/components/admin/form'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'

// This install's link to the app marketplace (super admins)
export function MarketplaceCard({
  defaultMarketplaceUrl,
  defaultPublicUrl,
}: {
  defaultMarketplaceUrl: string
  defaultPublicUrl: string
}) {
  const { data: connection, error, isPending } = useQuery(orpc.admin.marketplace.get.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Marketplace</CardTitle>
        <CardDescription>
          Connects this Shopnex install to the app marketplace: its apps appear in the App Store for every shop, and
          installs are reported so apps can trust them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : error ? (
          <p className="text-destructive">{error.message}</p>
        ) : connection ? (
          <Connected connection={connection} />
        ) : (
          <ConnectForm defaultMarketplaceUrl={defaultMarketplaceUrl} defaultPublicUrl={defaultPublicUrl} />
        )}
      </CardContent>
    </Card>
  )
}

function useRefresh() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.marketplace.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.apps.key() }),
    ])
}

function ConnectForm({
  defaultMarketplaceUrl,
  defaultPublicUrl,
}: {
  defaultMarketplaceUrl: string
  defaultPublicUrl: string
}) {
  const refresh = useRefresh()
  const form = useZodForm(marketplaceConnectInput, {
    defaultValues: { marketplaceUrl: defaultMarketplaceUrl, publicUrl: defaultPublicUrl },
  })
  const connect = useMutation(orpc.admin.marketplace.connect.mutationOptions())

  const onSubmit = form.handleSubmit(async (values) => {
    try {
      await connect.mutateAsync(values)
      await refresh()
      toast.success('Connected to the marketplace')
    } catch (error) {
      setServerError(form, error)
    }
  })

  return (
    <form onSubmit={onSubmit} noValidate>
      <FieldGroup>
        <TextField control={form.control} name="marketplaceUrl" label="Marketplace URL" type="url" autoComplete="off" />
        <TextField
          control={form.control}
          name="publicUrl"
          label="This install's public URL"
          type="url"
          autoComplete="off"
          description="The marketplace checks it by calling this URL, and apps call your Admin API here."
        />
        <FormError form={form} />
        <Field orientation="horizontal" className="justify-end">
          <Button type="submit" disabled={form.formState.isSubmitting}>
            {form.formState.isSubmitting ? 'Connecting…' : 'Connect'}
          </Button>
        </Field>
      </FieldGroup>
    </form>
  )
}

type Connection = NonNullable<Outputs['admin']['marketplace']['get']>

function Connected({ connection }: { connection: Connection }) {
  const refresh = useRefresh()
  const sync = useMutation(orpc.admin.marketplace.sync.mutationOptions())

  async function onSync() {
    try {
      await sync.mutateAsync({})
      await refresh()
      toast.success('Catalog synced')
    } catch (error) {
      await refresh()
      toast.error(error instanceof Error ? error.message : 'Sync failed')
    }
  }

  return (
    <div className="space-y-3 text-sm">
      <dl className="grid grid-cols-[10rem_1fr] gap-y-1">
        <dt className="text-muted-foreground">Marketplace</dt>
        <dd className="truncate font-mono text-xs">{connection.marketplaceUrl}</dd>
        <dt className="text-muted-foreground">This install</dt>
        <dd className="truncate font-mono text-xs">{connection.publicUrl}</dd>
        <dt className="text-muted-foreground">Last sync</dt>
        <dd className="tabular-nums">{connection.lastSyncAt ? formatDateTime(connection.lastSyncAt) : 'Never'}</dd>
      </dl>
      {connection.lastSyncError && <p className="text-destructive">Last sync failed: {connection.lastSyncError}</p>}
      <div className="flex justify-end gap-2">
        <DisconnectButton />
        <Button variant="outline" size="sm" onClick={onSync} disabled={sync.isPending}>
          {sync.isPending ? 'Syncing…' : 'Sync now'}
        </Button>
      </div>
    </div>
  )
}

function DisconnectButton() {
  const refresh = useRefresh()
  const [open, setOpen] = useState(false)
  const disconnect = useMutation(orpc.admin.marketplace.disconnect.mutationOptions())

  async function onDisconnect() {
    try {
      await disconnect.mutateAsync({})
      await refresh()
      toast.success('Disconnected')
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not disconnect')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Disconnect</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Disconnect from the marketplace?</DialogTitle>
          <DialogDescription>
            The App Store goes away for every shop. Installed marketplace apps keep their access until uninstalled, but
            the marketplace stops vouching for them, so some apps may stop working.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={onDisconnect} disabled={disconnect.isPending}>
            {disconnect.isPending ? 'Disconnecting…' : 'Disconnect'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
