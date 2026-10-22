'use client'

// Theme styles (ThemeDefinition.presets, plus the theme's own defaults): a card per style with its colors.
// Picking one only changes the draft; a style that brings its own sections asks first, since it replaces
// the merchant's.
import { CheckIcon } from 'lucide-react'
import { useState } from 'react'
import { resolveSettings, type ThemeDefinition, type ThemeSettings } from '@shopnex/storefront-sdk/theme'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

type Style = { id: string | null; name: string; description?: string; settings: ThemeSettings; replacesPages: string[] }

export function StylePicker({
  definition,
  current,
  onApply,
}: {
  definition: ThemeDefinition
  /** The document's preset; undefined: the theme's defaults */
  current: string | undefined
  onApply: (presetId: string | null) => void
}) {
  const [confirm, setConfirm] = useState<Style | null>(null)
  const presets = Object.entries(definition.presets)
  if (!presets.length) return null

  const styles: Style[] = [
    { id: null, name: 'Original', description: `${definition.name} as designed`, settings: {}, replacesPages: [] },
    ...presets.map(([id, p]) => ({
      id,
      name: p.name,
      description: p.description,
      settings: p.settings,
      replacesPages: Object.keys(p.pages ?? {}),
    })),
  ]
  const colorFields = definition.settings.filter((f) => f.type === 'color')

  function pick(style: Style) {
    if (style.replacesPages.length) setConfirm(style)
    else onApply(style.id)
  }

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium">Style</h3>
      <div className="grid grid-cols-2 gap-2">
        {styles.map((style) => {
          const active = (current ?? null) === style.id
          const values = resolveSettings(colorFields, style.settings)
          return (
            <button
              key={style.id ?? ''}
              type="button"
              onClick={() => pick(style)}
              title={style.description}
              aria-pressed={active}
              className={cn(
                'relative rounded-md border p-2 text-left text-xs hover:bg-muted/50',
                active && 'border-primary ring-1 ring-primary',
              )}
            >
              <div className="mb-1.5 flex h-6 overflow-hidden rounded border">
                {colorFields.map((f) => (
                  <span key={f.id} className="flex-1" style={{ background: String(values[f.id]) }} />
                ))}
              </div>
              <span className="font-medium">{style.name}</span>
              {active && (
                <CheckIcon className="absolute top-1 right-1 size-3.5 rounded-full bg-primary p-0.5 text-primary-foreground" />
              )}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">Sets colors and fonts. Your custom code stays.</p>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Apply {confirm?.name}?</DialogTitle>
            <DialogDescription>
              This style comes with its own sections, which replace yours on{' '}
              {confirm?.replacesPages.map((p) => definition.pages?.[p]?.name ?? p).join(', ')}. Nothing goes live until
              you publish, and Discard brings back your published version.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button
              onClick={() => {
                onApply(confirm!.id)
                setConfirm(null)
              }}
            >
              Apply style
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
