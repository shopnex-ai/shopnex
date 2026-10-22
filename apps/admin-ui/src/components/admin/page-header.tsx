import { Link, type ToOptions } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { ChevronLeftIcon } from 'lucide-react'

export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  /** Link shown above the title, e.g. { to: '/admin/customers', label: 'Customers' } */
  back?: { to: ToOptions['to']; label: string }
  actions?: ReactNode
}) {
  return (
    <div className="space-y-1">
      {back && (
        <Link
          to={back.to}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex items-center gap-2">{actions}</div>}
      </div>
    </div>
  )
}
