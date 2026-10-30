'use client'

import { useQuery } from '@tanstack/react-query'
import { ExternalLinkIcon } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'
import { scopeSummary } from '@/lib/scopes'
import { AppIcon, installLink } from './installed-apps-card'

type CatalogApp = Outputs['admin']['apps']['catalog']['apps'][number]
type Origin = CatalogApp['origin']

const ORIGINS: { key: Origin; label: string }[] = [
  { key: 'bundled', label: 'Built-in' },
  { key: 'marketplace', label: 'Marketplace' },
  { key: 'custom', label: 'Custom' },
]

// Every app this shop can install, whatever its source. Install shows what the app can access first.
export function AppCatalogCard({ shopId, superAdmin }: { shopId: string; superAdmin: boolean }) {
  const { data, error, isPending } = useQuery(orpc.admin.apps.catalog.queryOptions())
  const [origin, setOrigin] = useState<Origin | null>(null)
  const apps = data?.apps.filter((app) => !app.installed && (origin === null || app.origin === origin)) ?? []
  const origins = ORIGINS.filter((o) => data?.apps.some((app) => !app.installed && app.origin === o.key))
  return (
    <Card>
      <CardHeader>
        <CardTitle>Discover apps</CardTitle>
        <CardDescription>
          Apps that come with this install, from the Shopnex marketplace, or registered by your team. Installing shows
          what each app can access first.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {origins.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant={origin === null ? 'secondary' : 'ghost'} onClick={() => setOrigin(null)}>
              All
            </Button>
            {origins.map((o) => (
              <Button
                key={o.key}
                size="sm"
                variant={origin === o.key ? 'secondary' : 'ghost'}
                onClick={() => setOrigin(o.key)}
              >
                {o.label}
              </Button>
            ))}
          </div>
        )}
        {isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <p className="text-destructive">{error.message}</p>
        ) : apps.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">
            {data.marketplaceConnected
              ? 'No more apps to install.'
              : superAdmin
                ? 'No more apps to install. Connect this install to the marketplace in Settings to browse more.'
                : 'No more apps to install. A super admin can connect this install to the marketplace for more.'}
          </p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {apps.map((app) => (
              <CatalogItem key={app.id} app={app} shopId={shopId} instanceUrl={data.instanceUrl} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function CatalogItem({ app, shopId, instanceUrl }: { app: CatalogApp; shopId: string; instanceUrl: string }) {
  const label = ORIGINS.find((o) => o.key === app.origin)!.label
  return (
    <li className="flex flex-col gap-3 surface-inset p-3">
      <div className="flex gap-3">
        <AppIcon url={app.iconUrl} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium">{app.name}</span>
            <Badge variant="secondary">{label}</Badge>
          </div>
          {app.developerName && <div className="text-xs text-muted-foreground">by {app.developerName}</div>}
          {(app.tagline ?? app.description) && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{app.tagline ?? app.description}</p>
          )}
        </div>
      </div>
      <div className="truncate text-xs text-muted-foreground">{scopeSummary(app.scopes)}</div>
      <div className="mt-auto flex items-center gap-2">
        <Button size="sm" render={<a href={installLink(app, shopId, instanceUrl)} />}>
          Install
        </Button>
        {app.listingUrl && (
          <Button variant="ghost" size="sm" render={<a href={app.listingUrl} target="_blank" rel="noreferrer" />}>
            Details
            <ExternalLinkIcon />
          </Button>
        )}
      </div>
    </li>
  )
}
