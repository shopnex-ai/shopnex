import { Link, type ToOptions } from '@tanstack/react-router'
import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeftIcon } from 'lucide-react'

/** The ids of the two places in the admin's top bar that a page's title and actions are shown in */
export const TITLE_SLOT = 'page-title'
export const ACTIONS_SLOT = 'page-actions'

/** Provided by the admin layout, which has the top bar: a header there waits for the bar instead of drawing itself */
export const TopBarContext = createContext(false)

const noSubscription = () => () => {}

// The bar is part of the layout, so after the first load it is already in the page when a header mounts and the header
// goes straight into it. While the page is rendered on the server (and hydrated) there is no bar to find yet.
const useSlot = (id: string) =>
  useSyncExternalStore(
    noSubscription,
    () => document.getElementById(id),
    () => null,
  )

/**
 * A page's title, back link and actions. In the admin they appear in the top bar, where they stay in the same place
 * on every page; anywhere there is no top bar they are shown at the top of the page. A description stays in the page.
 */
export function PageHeader({
  title,
  description,
  back,
  actions,
}: {
  title: ReactNode
  description?: ReactNode
  /** Link shown before the title, e.g. { to: '/admin/customers', label: 'Customers' } */
  back?: { to: ToOptions['to']; label: string }
  actions?: ReactNode
}) {
  const titleSlot = useSlot(TITLE_SLOT)
  const actionsSlot = useSlot(ACTIONS_SLOT)
  const hasTopBar = useContext(TopBarContext)

  const heading = (inBar: boolean) => (
    <>
      {back && (
        <Link
          to={back.to}
          className="inline-flex shrink-0 items-center gap-0.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ChevronLeftIcon className="size-4" />
          {back.label}
        </Link>
      )}
      {back && inBar && <span className="text-muted-foreground/50">/</span>}
      <h1 className={inBar ? 'truncate text-sm font-medium' : 'text-2xl font-semibold tracking-tight'}>{title}</h1>
    </>
  )

  // The bar is there but not reachable yet (first render on the server or while hydrating): draw nothing, not a header
  // that would jump into the bar a moment later
  if (!titleSlot && hasTopBar)
    return description ? <p className="text-sm text-muted-foreground">{description}</p> : null

  // No top bar at all: the whole header is part of the page
  if (!titleSlot) {
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">{heading(false)}</div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
      </div>
    )
  }

  return (
    <>
      {createPortal(heading(true), titleSlot)}
      {actions && actionsSlot && createPortal(actions, actionsSlot)}
      {description && <p className="text-sm text-muted-foreground">{description}</p>}
    </>
  )
}
