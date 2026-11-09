import { ArrowDownRightIcon, ArrowUpRightIcon } from 'lucide-react'
import { cn } from 'cn'
import { Skeleton } from '@/components/ui/skeleton'

// Relative change; null when there's nothing to compare with
export function change(current: number, previous: number) {
  if (previous === 0) return current === 0 ? 0 : null
  return (current - previous) / previous
}

export function formatPercent(v: number) {
  return new Intl.NumberFormat('en', { style: 'percent', maximumFractionDigits: 1 }).format(v)
}

export function StatTile({
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
