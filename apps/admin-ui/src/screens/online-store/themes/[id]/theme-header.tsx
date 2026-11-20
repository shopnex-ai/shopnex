import type { ReactNode } from 'react'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'

/**
 * The theme editor's and the code editor's place in the admin's top bar: a link back to the themes, the theme's name with
 * what it is showing, whether it is the live theme, and the page's own actions.
 */
export function ThemeHeader({
  name,
  live,
  actions,
}: {
  /** e.g. "Storeplate · Home page" or "Storeplate · Edit code" */
  name: string
  live: boolean
  actions: ReactNode
}) {
  return (
    <PageHeader
      back={{ to: live ? '/admin/online-store' : '/admin/online-store/select', label: 'Themes' }}
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{name}</span>
          <Badge variant={live ? 'secondary' : 'outline'}>{live ? 'Live' : 'Unpublished'}</Badge>
        </span>
      }
      actions={actions}
    />
  )
}
