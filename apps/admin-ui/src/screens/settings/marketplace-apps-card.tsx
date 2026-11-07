'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc, type Outputs } from '@/lib/orpc'
import { scopeSummary } from '@/lib/scopes'
import { AppIcon } from '@/screens/apps/installed-apps-card'

type MarketplaceApp = Outputs['admin']['appRegistry']['marketplace']['apps'][number]

// Marketplace apps are written by third parties. With the requirement on, shops can only install the ones a super
// admin approved here; off (the default), any marketplace app can be installed.
export function MarketplaceAppsCard() {
  const { data, error, isPending } = useQuery(orpc.admin.appRegistry.marketplace.queryOptions())
  return (
    <Card>
      <CardHeader>
        <CardTitle>Marketplace apps</CardTitle>
        <CardDescription>
          Choose which marketplace apps shops on this install can add. Useful when the shop owners aren't the people who
          run the install.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : error ? (
          <p className="text-destructive">{error.message}</p>
        ) : (
          <>
            <RequireApproval value={data.requireApproval} />
            {data.apps.length === 0 ? (
              <p className="py-6 text-center text-muted-foreground">
                No marketplace apps yet. Connect and sync the marketplace to see its apps here.
              </p>
            ) : (
              <ul className="divide-y surface-inset">
                {data.apps.map((app) => (
                  <AppRow key={app.id} app={app} required={data.requireApproval} />
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

function useRefresh() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: orpc.admin.appRegistry.key() }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.apps.key() }),
    ])
}

function RequireApproval({ value }: { value: boolean }) {
  const refresh = useRefresh()
  const set = useMutation(orpc.admin.appRegistry.setApprovalRequired.mutationOptions())

  async function onChange(requireApproval: boolean) {
    try {
      await set.mutateAsync({ requireApproval })
      await refresh()
      toast.success(requireApproval ? 'Shops can only install approved apps' : 'Shops can install any marketplace app')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    }
  }

  return (
    <label className="flex items-start gap-2 text-sm">
      <input
        type="checkbox"
        checked={value}
        disabled={set.isPending}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 size-4 accent-primary"
      />
      <span>
        <span className="font-medium">Require approval</span>
        <span className="block text-muted-foreground">
          Shops can only install marketplace apps you approve below. Apps shops already run are approved when you turn
          this on, and keep working if you take an approval back; only new installs stop.
        </span>
      </span>
    </label>
  )
}

function AppRow({ app, required }: { app: MarketplaceApp; required: boolean }) {
  const refresh = useRefresh()
  const approve = useMutation(orpc.admin.appRegistry.approve.mutationOptions())
  const unapprove = useMutation(orpc.admin.appRegistry.unapprove.mutationOptions())
  const pending = approve.isPending || unapprove.isPending

  async function toggle() {
    try {
      await (app.approved ? unapprove : approve).mutateAsync({ id: app.id })
      await refresh()
      toast.success(app.approved ? `${app.name} approval taken back` : `${app.name} approved`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update the app')
    }
  }

  return (
    <li className="flex items-center gap-3 p-3">
      <AppIcon url={app.iconUrl} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium">{app.name}</span>
          {app.approved ? (
            <Badge variant="secondary">Approved</Badge>
          ) : (
            <Badge variant="outline">Awaiting approval</Badge>
          )}
        </div>
        {app.developerName && <div className="text-xs text-muted-foreground">by {app.developerName}</div>}
        <div className="text-xs text-muted-foreground">Can access: {scopeSummary(app.scopes)}</div>
        {app.installs > 0 && (
          <div className="text-xs text-muted-foreground">
            Installed on {app.installs} {app.installs === 1 ? 'shop' : 'shops'}
          </div>
        )}
      </div>
      <Button variant={app.approved ? 'ghost' : 'default'} size="sm" onClick={toggle} disabled={pending}>
        {app.approved ? 'Take back' : 'Approve'}
      </Button>
    </li>
  )
}
