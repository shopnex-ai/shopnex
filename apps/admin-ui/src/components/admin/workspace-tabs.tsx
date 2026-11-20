import { cn } from '@/lib/utils'

/**
 * On a phone a workspace shows one pane at a time: this is the bar that switches between them. From `md` up every pane is
 * on screen and the bar is hidden, so a pane is hidden on a phone with `max-md:hidden` while it isn't the chosen one.
 */
export function WorkspaceTabs<T extends string>({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div role="tablist" className="flex shrink-0 border-b md:hidden">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={value === tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            'flex-1 border-b-2 py-2 text-sm font-medium text-muted-foreground',
            value === tab.id ? 'border-primary text-foreground' : 'border-transparent',
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
