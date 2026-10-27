'use client'

import { useQuery } from '@tanstack/react-query'
import { DownloadIcon } from 'lucide-react'
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
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from '@/components/ui/sidebar'
import { getUpdateStatus } from '@/lib/updates.functions'

const updateStatusQuery = {
  queryKey: ['update-status'],
  queryFn: () => getUpdateStatus(),
  // The server caches GitHub for hours; there is no point asking it again more often than that
  staleTime: 60 * 60_000,
  retry: false,
}

// Super admins only; everyone else gets null from the server, so nothing renders
export function UpdateNotice({ enabled }: { enabled: boolean }) {
  const { data } = useQuery({ ...updateStatusQuery, enabled })
  if (!data) return null

  return (
    <>
      {data.updateAvailable && (
        <SidebarMenu>
          <SidebarMenuItem>
            <Dialog>
              <DialogTrigger render={<SidebarMenuButton tooltip="Update available" className="justify-center" />}>
                <DownloadIcon />
                <span>Update available</span>
                <span className="ml-auto size-2 rounded-full bg-green-500" aria-hidden />
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Shopnex {data.latest} is available</DialogTitle>
                  <DialogDescription>You are on {data.current}. Updates are never applied automatically.</DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm">
                  <p>Back up your database first, then update the way you installed Shopnex:</p>
                  <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                    <li>
                      <strong className="text-foreground">Install script:</strong> run the install command again.
                    </li>
                    <li>
                      <strong className="text-foreground">Docker Compose, Dokploy, Coolify:</strong> set{' '}
                      <code>SHOPNEX_VERSION={data.latest}</code>, then pull and restart the stack.
                    </li>
                    <li>
                      <strong className="text-foreground">Render, DigitalOcean:</strong> redeploy from the new
                      release.
                    </li>
                  </ul>
                </div>
                <DialogFooter>
                  <Button render={<a href={data.releaseUrl ?? '#'} target="_blank" rel="noopener" />}>
                    Release notes
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </SidebarMenuItem>
        </SidebarMenu>
      )}
      <p className="px-2 text-center text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
        Version {data.current ?? 'dev'}
      </p>
    </>
  )
}
