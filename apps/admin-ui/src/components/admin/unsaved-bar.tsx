import { Button } from '@/components/ui/button'

/**
 * The one Save for an editor page: a bar that sticks to the top while the form has changes and is gone otherwise.
 * Inside a <form> it submits it; pass `onSave` for an editor that isn't a form.
 */
export function UnsavedBar({
  dirty,
  saving,
  onDiscard,
  onSave,
  capture,
}: {
  dirty: boolean
  saving: boolean
  onDiscard: () => void
  onSave?: () => void
  /** PostHog capture name for the Save click */
  capture?: string
}) {
  if (!dirty) return null
  return (
    <div className="sticky top-2 z-10 flex items-center justify-between gap-3 rounded-xl bg-card/95 px-4 py-2 shadow-flyout backdrop-blur">
      <span className="text-sm font-medium">Unsaved changes</span>
      <div className="flex gap-2">
        <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onDiscard}>
          Discard
        </Button>
        <Button
          data-ph-capture={capture}
          type={onSave ? 'button' : 'submit'}
          size="sm"
          disabled={saving}
          onClick={onSave}
        >
          {saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </div>
  )
}
