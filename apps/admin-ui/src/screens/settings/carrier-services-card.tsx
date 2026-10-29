'use client'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { orpc } from '@/lib/orpc'

// Carrier services: apps that quote live shipping rates at checkout. They register themselves; staff only switch
// them on and off here (uninstalling the app removes its service). Hidden while no app has registered one.
export function CarrierServicesCard() {
  const queryClient = useQueryClient()
  const { data, error, isPending } = useQuery(orpc.admin.carrierServices.list.queryOptions())
  const update = useMutation(orpc.admin.carrierServices.update.mutationOptions())
  if (isPending) return <Skeleton className="h-24 w-full" />
  if (error || !data?.length) return null

  async function toggle(id: string, active: boolean) {
    try {
      await update.mutateAsync({ id, active })
      await queryClient.invalidateQueries({ queryKey: orpc.admin.carrierServices.key() })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not update the carrier service')
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Carrier services</CardTitle>
        <CardDescription>
          Apps that quote live shipping rates once the buyer has entered an address. When one prices a cart, its rates
          are offered instead of your own; otherwise your rates apply.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y surface-inset">
          {data.map((s) => (
            <li key={s.id} className="flex items-center gap-3 p-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-medium">
                  {s.name}
                  {!s.ready && <Badge variant="outline">Not ready</Badge>}
                  {!s.active && <Badge variant="outline">Off</Badge>}
                </div>
                {!s.ready && (
                  <div className="text-sm text-muted-foreground">
                    The app hasn't finished setting this up, so it isn't offered at checkout yet.
                  </div>
                )}
              </div>
              <Button
                size="sm"
                variant="outline"
                disabled={update.isPending}
                onClick={() => void toggle(s.id, !s.active)}
              >
                {s.active ? 'Turn off' : 'Turn on'}
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
