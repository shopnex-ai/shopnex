'use client'

import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowRightIcon, DownloadIcon, ExternalLinkIcon, LoaderCircleIcon, TriangleAlertIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { DropdownMenuGroup, DropdownMenuLabel } from '@/components/ui/dropdown-menu'
import { SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { getUpdateProgress, getUpdateStatus, requestUpdate } from '@/lib/updates.functions'

const updateStatusQuery = {
  queryKey: ['update-status'],
  queryFn: () => getUpdateStatus(),
  // The server caches GitHub for hours; there is no point asking it again more often than that
  staleTime: 60 * 60_000,
  retry: false,
}

function useUpdateStatus(enabled: boolean) {
  return useQuery({ ...updateStatusQuery, enabled }).data
}

// Rendered inside the sidebar's bottom menu next to Settings and API reference. Super admins only; everyone
// else gets null from the server, so nothing renders.
export function UpdateMenuItem({ enabled }: { enabled: boolean }) {
  const data = useUpdateStatus(enabled)
  if (!data?.updateAvailable) return null

  return (
    <SidebarMenuItem>
      <Dialog>
        <DialogTrigger render={<SidebarMenuButton tooltip="Update available" size="sm" />}>
          <DownloadIcon />
          <span>Update available</span>
          <span className="ml-auto size-1.5 rounded-full bg-green-500" aria-hidden />
        </DialogTrigger>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <div className="mb-1 flex size-10 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
              <DownloadIcon className="size-5" />
            </div>
            <DialogTitle className="text-lg">A new version of Shopnex is available</DialogTitle>
            <DialogDescription className="flex items-center gap-2 pt-1">
              <code className="rounded-md bg-muted px-2 py-0.5 font-mono text-xs">{data.current}</code>
              <ArrowRightIcon className="size-3.5" />
              <code className="rounded-md bg-green-500/15 px-2 py-0.5 font-mono text-xs font-medium text-green-700 dark:text-green-400">
                {data.latest}
              </code>
            </DialogDescription>
          </DialogHeader>

          {data.canUpdate && data.latest ? (
            <UpdateAction target={data.latest} />
          ) : (
            <>
              <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p>
                  <span className="font-medium">Back up your database first.</span>{' '}
                  <span className="text-muted-foreground">Updates are never applied automatically.</span>
                </p>
              </div>

              <div className="space-y-2">
                <p className="text-sm font-medium">Then update the way you installed Shopnex</p>
                <UpdateMethod title="Install script">Run the install command again on your server.</UpdateMethod>
                <UpdateMethod title="Docker Compose, Dokploy, Coolify">
                  Set the version, then pull and restart the stack.
                  <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-2.5 font-mono text-xs text-foreground">
                    {`SHOPNEX_VERSION=${data.latest}\ndocker compose pull && docker compose up -d`}
                  </pre>
                </UpdateMethod>
                <UpdateMethod title="Render, DigitalOcean">Redeploy from the new release.</UpdateMethod>
              </div>
            </>
          )}

          <DialogFooter>
            <Button render={<a href={data.releaseUrl ?? '#'} target="_blank" rel="noopener" />}>
              Release notes
              <ExternalLinkIcon />
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SidebarMenuItem>
  )
}

// Shown at the bottom of the account menu
export function VersionLabel({ enabled }: { enabled: boolean }) {
  const data = useUpdateStatus(enabled)
  if (!data) return null
  return (
    <DropdownMenuGroup>
      <DropdownMenuLabel className="text-xs">Version {data.current ?? 'dev'}</DropdownMenuLabel>
    </DropdownMenuGroup>
  )
}

function UpdateMethod({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border p-3 text-sm">
      <p className="font-medium">{title}</p>
      <div className="mt-0.5 text-muted-foreground">{children}</div>
    </div>
  )
}

const STEP_LABELS: Record<string, string> = {
  checking: 'Checking the release',
  backup: 'Backing up the database',
  download: 'Downloading the new version',
  pull: 'Pulling the new images',
  restart: 'Restarting Shopnex',
}

// Asks the host updater to do the update, then follows its progress. The app restarts near the end, so
// polling errors are expected and simply retried until the updater reports it is done.
function UpdateAction({ target }: { target: string }) {
  const [requestedAt, setRequestedAt] = useState<number | null>(null)
  const request = useMutation({
    mutationFn: () => requestUpdate(),
    onSuccess: ({ requestedAt }) => setRequestedAt(requestedAt),
  })
  const progress = useQuery({
    queryKey: ['update-progress'],
    queryFn: () => getUpdateProgress(),
    refetchInterval: (query) => (requestedAt !== null || query.state.data?.state === 'running' ? 2_000 : false),
    retry: true,
    retryDelay: 2_000,
  })

  // Ignore a leftover result from an earlier run
  const status = progress.data
  const relevant =
    status &&
    status.version === target &&
    (requestedAt === null ? status.state === 'running' : status.at >= requestedAt - 2)
      ? status
      : null

  useEffect(() => {
    if (relevant?.state === 'done') window.location.reload()
  }, [relevant?.state])

  if (relevant?.state === 'failed') {
    return (
      <div className="space-y-3">
        <div className="flex gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-sm">
          <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
          <p>{relevant.message}</p>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setRequestedAt(null)
            request.reset()
          }}
        >
          Try again
        </Button>
      </div>
    )
  }

  if (relevant?.state === 'running' || relevant?.state === 'done' || requestedAt !== null) {
    return (
      <div className="flex items-center gap-3 rounded-lg border p-3 text-sm">
        <LoaderCircleIcon className="size-4 shrink-0 animate-spin text-muted-foreground" />
        <div>
          <p className="font-medium">{STEP_LABELS[relevant?.step ?? ''] ?? 'Starting the update'}</p>
          <p className="text-muted-foreground">Keep this page open. It reloads when the update is done.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
        <TriangleAlertIcon className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <p>
          <span className="font-medium">Your shop is unavailable for a minute or two.</span>{' '}
          <span className="text-muted-foreground">
            A database backup is taken first and kept on the server. If the new version does not start, the old one is
            restored.
          </span>
        </p>
      </div>
      {request.error && <p className="text-sm text-destructive">{request.error.message}</p>}
      <Button onClick={() => request.mutate()} disabled={request.isPending}>
        <DownloadIcon />
        Update to {target}
      </Button>
    </div>
  )
}
