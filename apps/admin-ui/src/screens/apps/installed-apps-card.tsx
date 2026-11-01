'use client'

import { useMutation, useQueryClient } from '@tanstack/react-query'
import { BlocksIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
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
import { orpc } from '@/lib/orpc'
import { cn } from '@/lib/utils'

// Where Install goes: the consent screen for managed apps (no redirect URLs), otherwise the app's own URL, which
// starts its OAuth flow
export function installLink(
  app: { appUrl: string; clientId: string; redirectUrls: string[] },
  shopId: string,
  instanceUrl: string,
) {
  if (app.redirectUrls.length === 0) return `/admin/oauth/authorize?${new URLSearchParams({ client_id: app.clientId })}`
  return appLink(app.appUrl, shopId, instanceUrl).toString()
}

// The app's own URL with the shop and this instance, as Install and Open send them
export function appLink(appUrl: string, shopId: string, instanceUrl: string) {
  const url = new URL(appUrl)
  url.searchParams.set('shop_id', shopId)
  url.searchParams.set('instance', instanceUrl)
  return url
}

export function AppIcon({ url, className }: { url: string | null; className?: string }) {
  return url ? (
    <img src={url} alt="" className={cn('size-10 shrink-0 rounded-lg border object-cover', className)} />
  ) : (
    <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg border bg-muted', className)}>
      <BlocksIcon className="size-1/2 text-muted-foreground" />
    </div>
  )
}

export function UninstallButton({
  installation,
  onUninstalled,
}: {
  installation: { id: string; app: { name: string } }
  onUninstalled?: () => void
}) {
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const uninstall = useMutation(orpc.admin.apps.uninstall.mutationOptions())

  async function onUninstall() {
    try {
      await uninstall.mutateAsync({ id: installation.id })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.admin.apps.key() }),
        queryClient.invalidateQueries({ queryKey: orpc.admin.webhooks.key() }),
      ])
      toast.success(`${installation.app.name} uninstalled`)
      setOpen(false)
      onUninstalled?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not uninstall')
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="sm" />}>Uninstall</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Uninstall {installation.app.name}?</DialogTitle>
          <DialogDescription>
            It loses access to your shop immediately and its webhooks are removed. Data the app already copied stays
            with the app.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
          <Button variant="destructive" onClick={onUninstall} disabled={uninstall.isPending}>
            {uninstall.isPending ? 'Uninstalling…' : 'Uninstall'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
