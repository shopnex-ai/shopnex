'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { CheckIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { orpc } from '@/lib/orpc'

const DISMISSED_KEY = 'shopnex:getting-started-dismissed'

// Per-browser convenience only: the checklist also disappears by itself once every item is done
function readDismissed(shopId: string) {
  try {
    return localStorage.getItem(`${DISMISSED_KEY}:${shopId}`) === '1'
  } catch {
    return false
  }
}

// "Getting started" on Home. Each item is derived from real data, so it ticks itself off and there is nothing
// to migrate or keep in sync. Hidden once everything is done or the merchant dismisses it.
export function GettingStarted({ shopId }: { shopId: string }) {
  const [dismissed, setDismissed] = useState(() => readDismissed(shopId))
  const payments = useQuery({ ...orpc.admin.paymentMethods.list.queryOptions(), enabled: !dismissed })
  const shipping = useQuery({ ...orpc.admin.shippingRates.list.queryOptions(), enabled: !dismissed })
  const carriers = useQuery({ ...orpc.admin.carrierServices.list.queryOptions(), enabled: !dismissed })
  const products = useQuery({ ...orpc.admin.products.list.queryOptions({ input: { limit: 1 } }), enabled: !dismissed })

  // Wait for all of them so the card doesn't flash with items that are already done. Carrier services are
  // optional (an error just means none), so they don't hold the card back.
  if (dismissed || !payments.data || !shipping.data || !products.data || carriers.isPending) return null

  // An app like CJ quotes shipping at checkout: that is shipping set up too
  const carrier = carriers.data?.find((s) => s.active && s.ready)

  const items = [
    {
      done: payments.data.some((m) => m.active && m.ready),
      title: 'Choose how customers pay',
      text: 'Add bank transfer or cash on delivery, or connect Stripe for cards.',
      to: '/admin/settings/payments',
      action: 'Set up payments',
    },
    {
      done: shipping.data.length > 0 || !!carrier,
      title: 'Set a shipping rate',
      text: 'Without one, checkout charges no shipping. Apps like CJ can also quote rates at checkout.',
      to: '/admin/settings/shipping',
      action: 'Set up shipping',
    },
    {
      done: products.data.total > 0,
      title: 'Add your first product',
      text: 'Create one by hand or import from a supplier app.',
      to: '/admin/products',
      action: 'Add a product',
    },
  ] as const
  const doneCount = items.filter((i) => i.done).length
  if (doneCount === items.length) return null

  function dismiss() {
    setDismissed(true)
    try {
      localStorage.setItem(`${DISMISSED_KEY}:${shopId}`, '1')
    } catch {
      // Private window or blocked storage: it just comes back next visit
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Getting started</CardTitle>
        <CardDescription>
          {doneCount} of {items.length} done. Your shop is ready to sell once these are set up.
        </CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" aria-label="Hide getting started" onClick={dismiss}>
            <XIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        <ul className="divide-y surface-inset">
          {items.map((item) => (
            <li key={item.title} className="flex items-center gap-3 p-3">
              <span
                aria-hidden
                className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-full border',
                  item.done && 'border-transparent bg-primary text-primary-foreground',
                )}
              >
                {item.done && <CheckIcon className="size-3" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className={cn('font-medium', item.done && 'text-muted-foreground line-through')}>{item.title}</div>
                {!item.done && <div className="text-sm text-muted-foreground">{item.text}</div>}
              </div>
              {!item.done && (
                <Button size="sm" variant="outline" render={<Link to={item.to} />}>
                  {item.action}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
