'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowRightIcon, CheckCircle2Icon, ChevronRightIcon, CircleDollarSignIcon, TruckIcon } from 'lucide-react'
import type { ComponentType, ReactNode } from 'react'
import { cn } from 'cn'
import { OrderStatusBadges } from '@/components/admin/order-status'
import { PageHeader } from '@/components/admin/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatDateTime, orderName } from '@/lib/format'
import { formatMoney } from '@/lib/money'
import { orpc } from '@/lib/orpc'
import { change, StatTile } from '../analytics/stat-tile'
import { GettingStarted } from './getting-started'

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

function greeting(hour = new Date().getHours()) {
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'
}

// Home: what needs doing right now, today's numbers, and the latest orders. Charts live on the Analytics page.
export function Today({ currency, shopId }: { currency: string; shopId: string }) {
  // One day against the day before it: the same endpoint the Analytics page uses
  const { data, error } = useQuery(orpc.admin.analytics.overview.queryOptions({ input: { days: 1, timezone } }))
  const money = (cents: number) => formatMoney(Math.round(cents), currency)

  return (
    <div className="space-y-6">
      <PageHeader
        title={greeting()}
        description={new Intl.DateTimeFormat('en', { dateStyle: 'full' }).format(new Date())}
        actions={
          <Button variant="ghost" size="sm" render={<Link to="/admin/analytics" />}>
            Analytics
            <ArrowRightIcon />
          </Button>
        }
      />

      <GettingStarted shopId={shopId} />

      {error ? (
        <p className="text-sm text-destructive">Couldn’t load today’s numbers: {error.message}</p>
      ) : (
        <>
          <NeedsYou attention={data?.attention} />

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
            <StatTile
              label="Sales today"
              value={data && money(data.current.salesCents)}
              change={data && change(data.current.salesCents, data.previous.salesCents)}
            />
            <StatTile
              label="Orders today"
              value={data && data.current.orders.toLocaleString('en')}
              change={data && change(data.current.orders, data.previous.orders)}
            />
            <StatTile
              label="Average order"
              value={data && money(data.current.averageOrderCents)}
              change={data && change(data.current.averageOrderCents, data.previous.averageOrderCents)}
            />
          </div>
          <p className="-mt-3 text-xs text-muted-foreground">Compared with yesterday</p>
        </>
      )}

      <RecentOrders />
    </div>
  )
}

type Attention = { unfulfilled: number; unpaid: number }

// The things only the merchant can move forward, most urgent first. Empty means all caught up.
function NeedsYou({ attention }: { attention: Attention | undefined }) {
  if (!attention) return <Skeleton className="h-24 w-full rounded-xl" />

  const items: { count: number; icon: ComponentType<{ className?: string }>; title: string; view: string }[] = [
    {
      count: attention.unfulfilled,
      icon: TruckIcon,
      title: attention.unfulfilled === 1 ? 'order to fulfill' : 'orders to fulfill',
      view: 'unfulfilled',
    },
    {
      count: attention.unpaid,
      icon: CircleDollarSignIcon,
      title: attention.unpaid === 1 ? 'order awaiting payment' : 'orders awaiting payment',
      view: 'unpaid',
    },
  ]
  const open = items.filter((i) => i.count > 0)

  if (!open.length) {
    return (
      <div className="flex items-center gap-3 rounded-xl bg-card p-4 shadow-card">
        <CheckCircle2Icon className="size-5 text-emerald-600 dark:text-emerald-400" aria-hidden />
        <div>
          <div className="font-medium">You’re all caught up</div>
          <div className="text-sm text-muted-foreground">Nothing is waiting on you right now.</div>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Needs you</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y surface-inset">
          {open.map((i, index) => (
            <li key={i.view}>
              <Link
                to="/admin/orders"
                search={{ view: i.view }}
                className="flex items-center gap-3 p-3 transition-colors hover:bg-muted/50"
              >
                <i.icon className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className={cn('text-2xl font-semibold tabular-nums', index === 0 && 'text-brand')}>
                  {i.count}
                </span>
                <span className="flex-1">{i.title}</span>
                <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function RecentOrders(): ReactNode {
  const { data, isPending } = useQuery(orpc.admin.orders.list.queryOptions({ input: { limit: 6 } }))

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent orders</CardTitle>
        <CardAction>
          <Button variant="ghost" size="sm" render={<Link to="/admin/orders" />}>
            View all
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : !data || data.items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No orders yet. Orders placed at checkout show up here.</p>
        ) : (
          <ul className="divide-y surface-inset">
            {data.items.map((o) => (
              <li key={o.id}>
                <Link
                  to="/admin/orders/$id"
                  params={{ id: o.id }}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 p-3 transition-colors hover:bg-muted/50"
                >
                  <span className="font-medium tabular-nums">{orderName(o.orderNumber)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{o.customerName ?? o.email}</span>
                  <OrderStatusBadges order={o} />
                  <span className="w-24 text-right tabular-nums">{formatMoney(o.totalCents, o.currency)}</span>
                  <span className="hidden w-36 text-right text-xs text-muted-foreground sm:block">
                    {formatDateTime(o.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
