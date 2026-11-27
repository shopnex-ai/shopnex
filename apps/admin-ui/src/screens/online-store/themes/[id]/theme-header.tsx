import { CodeIcon, PaletteIcon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { PageHeader } from '@/components/admin/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The theme editor's and the code editor's place in the admin's top bar: a link back to the themes, the theme's name with
 * whether it is the live theme, and the page's own actions. The button to the other editor (Edit code / Customize) is the last of the actions,
 * against the bar's right edge, so it stays put whatever the name or the other actions take.
 */
export function ThemeHeader({
  id,
  mode,
  name,
  live,
  actions,
}: {
  /** The library copy being edited */
  id: string
  /** Which editor this is */
  mode: 'visual' | 'code'
  /** e.g. "Storeplate · Home page" or "Storeplate · Edit code" */
  name: string
  live: boolean
  actions: ReactNode
}) {
  return (
    <PageHeader
      back={{ to: '/admin/online-store', label: 'Themes' }}
      title={
        <span className="flex items-center gap-2">
          <span className="truncate">{name}</span>
          <Badge variant={live ? 'secondary' : 'outline'}>{live ? 'Live' : 'Unpublished'}</Badge>
        </span>
      }
      actions={
        <>
          {actions}
          <EditorSwitch id={id} mode={mode} />
        </>
      }
    />
  )
}

// One button to the other editor
function EditorSwitch({ id, mode }: { id: string; mode: 'visual' | 'code' }) {
  const Icon = mode === 'visual' ? CodeIcon : PaletteIcon
  return (
    <Button
      variant="outline"
      size="sm"
      nativeButton={false}
      render={
        mode === 'visual' ? (
          <Link to="/admin/online-store/editor/$id/code" params={{ id }} />
        ) : (
          <Link to="/admin/online-store/editor/$id" params={{ id }} />
        )
      }
    >
      <Icon />
      <span className="max-md:hidden">{mode === 'visual' ? 'Edit code' : 'Customize'}</span>
    </Button>
  )
}

export type SaveState = 'saved' | 'pending' | 'saving' | 'error'

/** What both editors say first among their actions: whether the work is saved, and whether buyers see it */
export function ThemeSaveStatus({
  state,
  live,
  unpublished,
}: {
  state: SaveState
  live: boolean
  /** The draft differs from what is published */
  unpublished: boolean
}) {
  const text = {
    saved: !live ? 'Saved · not your live theme' : unpublished ? 'Draft saved · not published' : 'Published',
    pending: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Not saved',
  }[state]
  return (
    <span className={cn('text-xs text-muted-foreground max-md:hidden', state === 'error' && 'text-destructive')}>
      {text}
    </span>
  )
}

/** The bordered group the editors keep their view controls in (devices, preview on/off), in the same place on both */
export function ViewControls({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex rounded-md border p-0.5', className)}>{children}</div>
}
