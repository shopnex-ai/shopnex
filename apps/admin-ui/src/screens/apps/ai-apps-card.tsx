'use client'

import { useQuery } from '@tanstack/react-query'
import { SparklesIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { orpc } from '@/lib/orpc'
import { AppIcon, installLink } from './installed-apps-card'

// AI apps that could add ✨ Generate here (e.g. the bundled AI app). Install asks for consent; the app then
// registers its capabilities once the merchant has set it up.
export function AiAppsCard({ shopId }: { shopId: string }) {
  const { data } = useQuery(orpc.admin.ai.availableApps.queryOptions())
  if (!data?.apps.length) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <SparklesIcon className="size-4" />
          Add AI to your shop
        </CardTitle>
        <CardDescription>
          AI apps write product descriptions and search listings. Staff review every suggestion before it&apos;s saved.
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
