'use client'

import { useQuery } from '@tanstack/react-query'
import { ExternalLinkIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc } from '@/lib/orpc'
import { scopeSummary } from '@/lib/scopes'
import { AppIcon, installLink } from './installed-apps-card'

// Marketplace apps synced to this instance. Install opens the app, which sends the merchant to the consent screen.
export function AppStoreCard({ shopId, superAdmin }: { shopId: string; superAdmin: boolean }) {
  const { data, error, isPending } = useQuery(orpc.admin.apps.store.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>App Store</CardTitle>
        <CardDescription>
          Apps from the Shopnex marketplace. Installing shows what each app can access first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p className="text-destructive">{error.message}</p>
        ) : !data.connected ? (
          <p className="py-6 text-center text-muted-foreground">
            {superAdmin
              ? 'Connect this install to the marketplace below to browse apps.'
              : 'The App Store is off: a super admin needs to connect this install to the marketplace.'}
          </p>
        ) : data.apps.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">No apps in the marketplace yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {data.apps.map((app) => (
              <li key={app.id} className="flex flex-col gap-3 surface-inset p-3">
                <div className="flex gap-3">
                  <AppIcon url={app.iconUrl} />
                  <div className="min-w-0">
                    <div className="font-medium">{app.name}</div>
                    <div className="text-xs text-muted-foreground">by {app.developerName}</div>
                    <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{app.tagline}</p>
                  </div>
                </div>
                <div className="truncate text-xs text-muted-foreground">{scopeSummary(app.scopes)} · Free</div>
                <div className="mt-auto flex items-center gap-2">
                  {app.installed ? (
                    <Badge variant="secondary">Installed</Badge>
                  ) : (
                    <Button size="sm" render={<a href={installLink(app, shopId, data.instanceUrl)} />}>
                      Install
                    </Button>
                  )}
                  {app.listingUrl && (
                    <Button
                      variant="ghost"
                      size="sm"
                      render={<a href={app.listingUrl} target="_blank" rel="noreferrer" />}
                    >
                      Details
                      <ExternalLinkIcon />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
