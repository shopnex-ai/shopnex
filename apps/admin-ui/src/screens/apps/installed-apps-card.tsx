'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { BlocksIcon } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { Skeleton } from '@/components/ui/skeleton'
import { formatDate, formatDateTime } from '@/lib/format'
import { orpc, type Outputs } from '@/lib/orpc'
import { scopeSummary } from '@/lib/scopes'
import { cn } from '@/lib/utils'

type Installation = Outputs['admin']['apps']['list'][number]

export function InstalledAppsCard() {
  const { data, error, isPending } = useQuery(orpc.admin.apps.list.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Installed apps</CardTitle>
        <CardDescription>
          Apps working with this shop. Each one only has the access you approved when installing it.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : error ? (
          <p className="text-destructive">{error.message}</p>
        ) : data.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">No apps installed.</p>
        ) : (
          <ul className="divide-y surface-inset">
            {data.map((i) => (
              <InstalledApp key={i.id} installation={i} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

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

function InstalledApp({ installation: i }: { installation: Installation }) {
  return (
    <li className="flex items-center gap-3 p-3">
      <AppIcon url={i.app.iconUrl} />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          {i.app.name}
          {i.app.developerName && <span className="font-normal text-muted-foreground"> by {i.app.developerName}</span>}
        </div>
        <div className="truncate text-xs text-muted-foreground">{scopeSummary(i.scopes)}</div>
        <div className="text-xs text-muted-foreground tabular-nums">
          Installed {formatDate(i.installedAt)} ·{' '}
          {i.lastUsedAt ? `last active ${formatDateTime(i.lastUsedAt)}` : 'not used yet'}
        </div>
      </div>
      <Button variant="outline" size="sm" render={<Link to="/admin/apps/$id" params={{ id: i.id }} />}>
        Open
      </Button>
      <UninstallButton installation={i} />
    </li>
  )
}

function UninstallButton({ installation }: { installation: Installation }) {
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
