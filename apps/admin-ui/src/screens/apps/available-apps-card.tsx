'use client'

import { useQuery } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { orpc } from '@/lib/orpc'
import { AppIcon, installLink } from './installed-apps-card'

// Apps that ship with this install (e.g. CJ Dropshipping) and aren't installed in this shop yet. Install shows
// what the app can access first.
export function AvailableAppsCard({ shopId }: { shopId: string }) {
  const { data } = useQuery(orpc.admin.apps.available.queryOptions())
  if (!data?.apps.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle>Available apps</CardTitle>
        <CardDescription>
          Apps that come with this install. Installing shows what each app can access first.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y surface-inset">
          {data.apps.map((app) => (
            <li key={app.id} className="flex items-center gap-3 p-3">
              <AppIcon url={app.iconUrl} />
              <div className="min-w-0 flex-1">
                <div className="font-medium">{app.name}</div>
                {app.description && <div className="text-sm text-muted-foreground">{app.description}</div>}
              </div>
              <Button size="sm" render={<a href={installLink(app, shopId, data.instanceUrl)} />}>
                Install
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
