'use client'

import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowDownRightIcon, ArrowUpRightIcon, ChevronRightIcon, PackageIcon } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { cn } from 'cn'
import { useListParams } from '@/components/admin/list-params'
import { PageHeader } from '@/components/admin/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { formatMoney } from '@/lib/money'
import { orpc, type Outputs } from '@/lib/orpc'

type Overview = Outputs['admin']['analytics']['overview']
type Day = Overview['series'][number]

const RANGES = [
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
]

// Metrics the chart can plot; picked by clicking their tile
type Metric = 'sales' | 'orders' | 'aov'
const METRICS: Record<Metric, { label: string; current: (d: Day) => number; previous: (d: Day) => number }> = {
  sales: { label: 'Total sales', current: (d) => d.salesCents, previous: (d) => d.previousSalesCents },
  orders: { label: 'Orders', current: (d) => d.orders, previous: (d) => d.previousOrders },
  aov: {
    label: 'Average order value',
    current: (d) => (d.orders ? d.salesCents / d.orders : 0),
    previous: (d) => (d.previousOrders ? d.previousSalesCents / d.previousOrders : 0),
  },
}

const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone

export function HomeDashboard({ currency }: { currency: string }) {
  const { filter, setFilter } = useListParams()
  const days = RANGES.find((r) => String(r.days) === filter('range'))?.days ?? 30
  const [metric, setMetric] = useState<Metric>('sales')
  const { data, error, isPending } = useQuery(orpc.admin.analytics.overview.queryOptions({ input: { days, timezone } }))

  const money = (cents: number) => formatMoney(Math.round(cents), currency)
  const format = (m: Metric, v: number) => (m === 'orders' ? v.toLocaleString('en') : money(v))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Home"
        description={`Last ${days} days compared with the ${days} days before`}
        actions={
          <div className="flex gap-1" role="group" aria-label="Date range">
            {RANGES.map((r) => (
              <Button
                key={r.days}
                size="sm"
                variant={r.days === days ? 'secondary' : 'ghost'}
                aria-pressed={r.days === days}
                onClick={() => setFilter('range', r.days === 30 ? '' : String(r.days))}
              >
                {r.label}
              </Button>
            ))}
          </div>
        }
      />

      {error ? (
        <p className="text-sm text-destructive">Couldn’t load analytics: {error.message}</p>
      ) : (
        <>
          {data && <Attention attention={data.attention} />}

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(['sales', 'orders', 'aov'] as const).map((m) => (
              <StatTile
                key={m}
                label={METRICS[m].label}
                value={data && format(m, totalOf(data, m, 'current'))}
                change={data && change(totalOf(data, m, 'current'), totalOf(data, m, 'previous'))}
                selected={metric === m}
                onSelect={() => setMetric(m)}
              />
            ))}
            <StatTile
              label="Returning customers"
              value={data && formatPercent(data.current.returningCustomerRate)}
              change={data && change(data.current.returningCustomerRate, data.previous.returningCustomerRate)}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{METRICS[metric].label} over time</CardTitle>
              <Legend />
            </CardHeader>
            <CardContent>
              {isPending ? (
                <Skeleton className="h-64 w-full" />
              ) : (
                <TrendChart series={data!.series} metric={metric} format={(v) => format(metric, v)} />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Top products</CardTitle>
            </CardHeader>
            <CardContent>
              {isPending ? (
                <Skeleton className="h-40 w-full" />
              ) : data!.topProducts.length === 0 ? (
                <p className="text-sm text-muted-foreground">No sales in this period yet.</p>
              ) : (
                <TopProducts products={data!.topProducts} money={money} />
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}

function totalOf(data: Overview, metric: Metric, period: 'current' | 'previous') {
  const t = data[period]
  return metric === 'sales' ? t.salesCents : metric === 'orders' ? t.orders : t.averageOrderCents
}

// Relative change; null when there's nothing to compare with
function change(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / previous
}

function formatPercent(v: number) {
  return new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(v)
}

function Attention({ attention }: { attention: Overview['attention'] }) {
  const items = [
    { count: attention.unfulfilled, label: 'to fulfill', view: 'unfulfilled' },
    { count: attention.unpaid, label: 'awaiting payment', view: 'unpaid' },
  ].filter((i) => i.count > 0)
  if (!items.length) return null
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((i) => (
        <Link
          key={i.view}
          to="/admin/orders"
          search={{ view: i.view }}
          className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1.5 text-sm shadow-card hover:bg-muted"
        >
          <span className="font-medium tabular-nums">
            {i.count} {i.count === 1 ? 'order' : 'orders'}
          </span>
          <span className="text-muted-foreground">{i.label}</span>
          <ChevronRightIcon className="size-4 text-muted-foreground" />
        </Link>
      ))}
    </div>
  )
}

function StatTile({
  label,
  value,
  change,
  selected,
  onSelect,
}: {
  label: string
  value: string | undefined
  change: number | null | undefined
  selected?: boolean
  /** Makes the tile a button that plots this metric */
  onSelect?: () => void
}) {
  const body = (
    <>
      <div className="text-sm text-muted-foreground">{label}</div>
      {value === undefined ? (
        <Skeleton className="mt-1 h-7 w-24" />
      ) : (
        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
          <span className="text-2xl font-semibold tabular-nums">{value}</span>
          <Change value={change ?? null} />
        </div>
      )}
    </>
  )
  const className = cn(
    'rounded-xl bg-card p-4 text-left shadow-card',
    onSelect && 'transition-colors hover:bg-muted/50',
    selected && 'ring-2 ring-brand',
  )
  return onSelect ? (
    <button type="button" className={className} aria-pressed={selected} onClick={onSelect}>
      {body}
    </button>
  ) : (
    <div className={className}>{body}</div>
  )
}

function Change({ value }: { value: number | null }) {
  if (value === null) return <span className="text-xs text-muted-foreground">—</span>
  if (Math.abs(value) < 0.0005) return <span className="text-xs text-muted-foreground">0%</span>
  const up = value > 0
  const Icon = up ? ArrowUpRightIcon : ArrowDownRightIcon
  return (
    <span
      className={cn(
        'inline-flex items-center text-xs font-medium tabular-nums',
        up ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400',
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      <span className="sr-only">{up ? 'Up' : 'Down'}</span>
      {formatPercent(Math.abs(value))}
    </span>
  )
}

function Legend() {
  return (
    <div className="flex gap-4 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded-full bg-brand" />
        This period
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="w-4 border-t-2 border-dashed border-muted-foreground/60" />
        Previous period
      </span>
    </div>
  )
}

const dayLabel = (date: string, opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' }) =>
  new Intl.DateTimeFormat('en', { ...opts, timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`))

// Round axis maximum: 1, 2, 2.5 or 5 times a power of ten
function niceMax(v: number) {
  if (v <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(v))
  return ([1, 2, 2.5, 5, 10].find((m) => m * pow >= v) ?? 10) * pow
}

const W = 600
const H = 220

function TrendChart({ series, metric, format }: { series: Day[]; metric: Metric; format: (v: number) => string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const { current, previous } = METRICS[metric]
  const { cur, prev, max } = useMemo(() => {
    const cur = series.map(current)
    const prev = series.map(previous)
    return { cur, prev, max: niceMax(Math.max(...cur, ...prev)) }
  }, [series, current, previous])

  const x = (i: number) => (series.length === 1 ? W / 2 : (i / (series.length - 1)) * W)
  const y = (v: number) => H - (v / max) * H
  const path = (values: number[]) => values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('')
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max)
  const labelEvery = Math.ceil(series.length / 6)

  const onMove = (e: React.PointerEvent) => {
    const rect = ref.current!.getBoundingClientRect()
    const i = Math.round(((e.clientX - rect.left) / rect.width) * (series.length - 1))
    setHover(Math.max(0, Math.min(series.length - 1, i)))
  }

  const h = hover !== null ? series[hover] : undefined
  return (
    <div className="flex gap-3">
      {/* Y axis labels, aligned with the gridlines */}
      <div
        className="relative w-16 shrink-0 text-right text-xs text-muted-foreground tabular-nums"
        style={{ height: H }}
      >
        {ticks.map((t) => (
          <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: y(t) }}>
            {format(t)}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div
          ref={ref}
          className="relative touch-none"
          style={{ height: H }}
          onPointerMove={onMove}
          onPointerDown={onMove}
          onPointerLeave={() => setHover(null)}
        >
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="size-full overflow-visible" aria-hidden>
            {ticks.map((t) => (
              <line
                key={t}
                x1={0}
                x2={W}
                y1={y(t)}
                y2={y(t)}
                className="stroke-foreground/10"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path
              d={path(prev)}
              fill="none"
              strokeWidth={2}
              strokeDasharray="4 4"
              className="stroke-muted-foreground/60"
              vectorEffect="non-scaling-stroke"
            />
            <path d={`${path(cur)}L${x(series.length - 1)},${H}L${x(0)},${H}Z`} className="fill-brand/12" />
            <path
              d={path(cur)}
              fill="none"
              strokeWidth={2}
              strokeLinejoin="round"
              className="stroke-brand"
              vectorEffect="non-scaling-stroke"
            />
            {hover !== null && (
              <line
                x1={x(hover)}
                x2={x(hover)}
                y1={0}
                y2={H}
                className="stroke-foreground/30"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          {hover !== null && (
            // Marker as HTML so it stays round in the stretched SVG
            <span
              className="pointer-events-none absolute size-2.5 -translate-1/2 rounded-full bg-brand ring-2 ring-card"
              style={{ left: `${(x(hover) / W) * 100}%`, top: y(cur[hover]!) }}
            />
          )}
          {h && (
            <div
              className={cn(
                'pointer-events-none absolute top-0 z-10 min-w-44 rounded-lg bg-popover p-2.5 text-xs text-popover-foreground shadow-md shadow-card',
                hover! > series.length / 2 ? '-translate-x-[calc(100%+12px)]' : 'translate-x-3',
              )}
              style={{ left: `${(x(hover!) / W) * 100}%` }}
            >
              <TooltipRow color="bg-brand" label={dayLabel(h.date)} value={format(cur[hover!]!)} />
              <TooltipRow
                color="bg-muted-foreground/60"
                label={dayLabel(h.previousDate)}
                value={format(prev[hover!]!)}
              />
            </div>
          )}
        </div>
        <div className="relative mt-2 h-4 text-xs text-muted-foreground">
          {series.map((d, i) =>
            (series.length - 1 - i) % labelEvery === 0 ? (
              <span
                key={d.date}
                className={cn(
                  'absolute whitespace-nowrap',
                  i === 0 ? '' : i === series.length - 1 ? '-translate-x-full' : '-translate-x-1/2',
                )}
                style={{ left: `${(x(i) / W) * 100}%` }}
              >
                {dayLabel(d.date)}
              </span>
            ) : null,
          )}
        </div>
      </div>
    </div>
  )
}

function TooltipRow({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className={cn('size-2 rounded-full', color)} />
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto pl-3 font-medium tabular-nums">{value}</span>
    </div>
  )
}

function TopProducts({ products, money }: { products: Overview['topProducts']; money: (cents: number) => string }) {
  const max = products[0]?.salesCents || 1
  return (
    <ul className="space-y-3">
      {products.map((p) => {
        const content = (
          <>
            <div className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
              <PackageIcon className="size-4 text-muted-foreground" />
              {p.imageUrl && (
                <img
                  src={p.imageUrl}
                  alt=""
                  className="absolute inset-0 size-full object-cover"
                  // A dead image link falls back to the icon behind it
                  onError={(e) => (e.currentTarget.style.display = 'none')}
                />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-3">
                <span className="truncate font-medium">{p.title}</span>
                <span className="shrink-0 tabular-nums">{money(p.salesCents)}</span>
              </div>
              <div className="mt-1 flex items-center gap-3">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-brand" style={{ width: `${(p.salesCents / max) * 100}%` }} />
                </div>
                <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                  {p.units} {p.units === 1 ? 'unit' : 'units'}
                </span>
              </div>
            </div>
          </>
        )
        return (
          <li key={p.productId ?? p.title}>
            {p.productId ? (
              <Link
                to="/admin/products/$id"
                params={{ id: p.productId }}
                className="-m-1.5 flex items-center gap-3 rounded-lg p-1.5 hover:bg-muted/50"
              >
                {content}
              </Link>
            ) : (
              <div className="flex items-center gap-3">{content}</div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
