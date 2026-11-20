import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A full-height screen (the theme editor, the code editor, translations, an app embedded in the admin): it fills the content area
 * edge to edge under the top bar (the bar is h-12, the content has p-4 / md:p-6), so the page itself never scrolls and the panes
 * inside, each with its own `overflow-y-auto`, scroll on their own.
 */
export function Workspace({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('-m-4 flex h-[calc(100svh-3rem)] flex-col md:-m-6', className)}>{children}</div>
}

/** The row under a workspace's bars: panes side by side. `min-h-0` is what lets them scroll instead of growing the page. */
export function WorkspaceBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-0 flex-1', className)}>{children}</div>
}
