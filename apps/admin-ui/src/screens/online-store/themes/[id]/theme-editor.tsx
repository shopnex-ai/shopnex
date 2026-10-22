'use client'

// Theme editor (Shopify-style): sections on the left, the real storefront in the middle, the selected
// section's (or the theme's) settings on the right. Every change autosaves the draft and reloads the
// preview; Publish makes the draft what buyers see (for an unpublished copy: it becomes the live theme).
import { useMutation } from '@tanstack/react-query'
import { ArrowLeftIcon, CodeIcon, MonitorIcon, PaletteIcon, SmartphoneIcon, Trash2Icon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  applyPreset,
  resolveSettings,
  type ThemeDefinition,
  type ThemeDocument,
  type ThemeSection,
  type ThemeSettingValue,
} from '@shopnex/storefront-sdk/theme'
import { Badge } from '@/components/ui/badge'
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
import { client } from '@/lib/orpc'
import { cn } from '@/lib/utils'
import { PreviewFrame } from './preview-frame'
import { SectionList } from './section-list'
import { SettingFields } from './setting-fields'
import { StylePicker } from './style-picker'

const PAGE = 'home'
const AUTOSAVE_MS = 700

type Props = {
  definition: ThemeDefinition
  storefrontUrl: string
  /** The library copy being edited */
  theme: { id: string; name: string; live: boolean }
  initialDraft: ThemeDocument
  initialPublished: ThemeDocument | null
}

type SaveState = 'saved' | 'pending' | 'saving' | 'error'

// jsonb doesn't keep key order, so compare documents with sorted keys
const stable = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)))
      : v,
  )

const newSectionId = () => `s${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`

export function ThemeEditor({ definition, storefrontUrl, theme, initialDraft, initialPublished }: Props) {
  const id = theme.id
  const [live, setLive] = useState(theme.live)
  const [draft, setDraft] = useState(initialDraft)
  const [published, setPublished] = useState(initialPublished)
  const [selected, setSelected] = useState<string | null>(null) // section id; null = theme settings
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [reloadKey, setReloadKey] = useState(0)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [confirmPublish, setConfirmPublish] = useState(false)

  // ── autosave: one request at a time, always the latest document ──
  const latest = useRef(draft)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const inFlight = useRef<Promise<void> | null>(null)
  const dirty = useRef(false)

  const flush = useCallback(async (): Promise<boolean> => {
    clearTimeout(timer.current)
    if (inFlight.current) await inFlight.current
    if (!dirty.current) return true
    dirty.current = false
    setSaveState('saving')
    let ok = true
    inFlight.current = client.admin.themes
      .saveDraft({ id, document: latest.current })
      .then(() => {
        setReloadKey((k) => k + 1)
      })
      .catch((error) => {
        ok = false
        dirty.current = true
        toast.error(error instanceof Error ? error.message : 'Could not save')
      })
      .finally(() => {
        inFlight.current = null
      })
    await inFlight.current
    // More edits may have arrived while saving
    if (ok && dirty.current) return flush()
    setSaveState(ok ? 'saved' : 'error')
    return ok
  }, [id])

  const update = useCallback(
    (next: ThemeDocument) => {
      latest.current = next
      dirty.current = true
      setDraft(next)
      setSaveState('pending')
      clearTimeout(timer.current)
      timer.current = setTimeout(flush, AUTOSAVE_MS)
    },
    [flush],
  )

  // Leaving with unsaved edits: let the browser ask
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) e.preventDefault()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  // ── document edits ──
  const sections = draft.pages[PAGE]?.sections ?? []
  const setSections = (next: ThemeSection[]) =>
    update({ ...draft, pages: { ...draft.pages, [PAGE]: { sections: next } } })

  function addSection(type: string) {
    const section: ThemeSection = {
      id: newSectionId(),
      type,
      settings: resolveSettings(definition.sections[type]!.settings),
    }
    // After the selected section, else at the end
    const index = sections.findIndex((s) => s.id === selected)
    const at = index === -1 ? sections.length : index + 1
    setSections([...sections.slice(0, at), section, ...sections.slice(at)])
    setSelected(section.id)
  }

  function removeSection(id: string) {
    setSections(sections.filter((s) => s.id !== id))
    setSelected(null)
  }

  const selectedSection = sections.find((s) => s.id === selected) ?? null
  const selectedDefinition = selectedSection ? definition.sections[selectedSection.type] : undefined

  function setSectionSetting(id: string, value: ThemeSettingValue) {
    if (!selectedSection || !selectedDefinition) return
    const settings = { ...resolveSettings(selectedDefinition.settings, selectedSection.settings), [id]: value }
    setSections(sections.map((s) => (s.id === selectedSection.id ? { ...s, settings } : s)))
  }

  function setThemeSetting(id: string, value: ThemeSettingValue) {
    update({ ...draft, settings: { ...resolveSettings(definition.settings, draft.settings), [id]: value } })
  }

  function setStyle(presetId: string | null) {
    update(applyPreset(definition, draft, presetId))
  }

  // ── publish / discard ──
  // An unpublished copy can always be published: that makes it the live theme
  const unpublished = !live || published === null || stable(draft) !== stable(published)

  const publish = useMutation({
    mutationFn: async () => {
      // Always save first: a shop that never edited has no draft on the server yet
      dirty.current = true
      if (!(await flush())) throw new Error('Save failed, so nothing was published')
      return client.admin.themes.publish({ id })
    },
    onSuccess: () => {
      setPublished(latest.current)
      setConfirmPublish(false)
      toast.success(
        live ? 'Published: your storefront shows these changes now' : `${theme.name} is now your live theme`,
      )
      setLive(true)
    },
    onError: (error) => toast.error(error.message),
  })

  const discard = useMutation({
    mutationFn: async () => {
      clearTimeout(timer.current)
      dirty.current = false
      if (inFlight.current) await inFlight.current
      return client.admin.themes.discardDraft({ id })
    },
    onSuccess: ({ draft: restored }) => {
      latest.current = restored
      setDraft(restored)
      setSaveState('saved')
      setSelected(null)
      setConfirmDiscard(false)
      setReloadKey((k) => k + 1)
      toast.success('Changes discarded')
    },
    onError: (error) => toast.error(error.message),
  })

  const status = {
    saved: !live ? 'Saved · not your live theme' : unpublished ? 'Draft saved · not published' : 'Published',
    pending: 'Unsaved changes',
    saving: 'Saving…',
    error: 'Not saved',
  }[saveState]

  return (
    // Fill the dashboard's content area edge to edge (its header is h-12, padding p-4 / md:p-6)
    <div className="-m-4 flex h-[calc(100svh-3rem)] flex-col md:-m-6">
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
        <Button
          variant="ghost"
          size="icon-sm"
          nativeButton={false}
          render={<Link to={theme.live ? '/admin/online-store/themes' : '/admin/online-store/themes/select'} />}
          aria-label="Back to themes"
          title="Back to themes"
        >
          <ArrowLeftIcon />
        </Button>
        <div className="mr-auto min-w-0">
          <h1 className="flex items-center gap-2 text-sm font-semibold">
            <span className="truncate">
              {theme.name} · {definition.pages?.[PAGE]?.name ?? 'Home page'}
            </span>
            <Badge variant={live ? 'secondary' : 'outline'}>{live ? 'Live' : 'Unpublished'}</Badge>
          </h1>
          <p className={cn('text-xs text-muted-foreground', saveState === 'error' && 'text-destructive')}>{status}</p>
        </div>
        <div className="flex rounded-md border p-0.5">
          {(['desktop', 'mobile'] as const).map((d) => (
            <Button
              key={d}
              variant={device === d ? 'secondary' : 'ghost'}
              size="icon-sm"
              onClick={() => setDevice(d)}
              aria-label={d === 'desktop' ? 'Desktop preview' : 'Mobile preview'}
            >
              {d === 'desktop' ? <MonitorIcon /> : <SmartphoneIcon />}
            </Button>
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          nativeButton={false}
          render={<Link to="/admin/online-store/themes/$id/code" params={{ id }} />}
        >
          <CodeIcon />
          Edit code
        </Button>
        <Button
          variant="outline"
          size="sm"
          nativeButton={false}
          render={<a href={storefrontUrl} target="_blank" rel="noopener" />}
        >
          View store
        </Button>
        {live && published && unpublished && (
          <Button variant="ghost" size="sm" onClick={() => setConfirmDiscard(true)}>
            Discard
          </Button>
        )}
        <Button
          size="sm"
          disabled={!unpublished || publish.isPending}
          onClick={() => (live ? publish.mutate() : setConfirmPublish(true))}
        >
          {publish.isPending ? 'Publishing…' : 'Publish'}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 space-y-4 overflow-y-auto border-r p-3">
          <div>
            <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sections</h2>
            <SectionList
              definition={definition}
              sections={sections}
              selectedId={selected}
              onSelect={setSelected}
              onChange={setSections}
              onAdd={addSection}
            />
          </div>
          <button
            type="button"
            onClick={() => setSelected(null)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium',
              selected === null && 'border-primary ring-1 ring-primary',
            )}
          >
            <PaletteIcon className="size-4 text-muted-foreground" />
            Theme settings
          </button>
        </aside>

        <main className="min-w-0 flex-1">
          <PreviewFrame
            storefrontUrl={storefrontUrl}
            copyId={id}
            reloadKey={reloadKey}
            selectedSectionId={selected}
            device={device}
          />
        </main>

        <aside className="w-80 shrink-0 overflow-y-auto border-l p-4">
          {selectedSection ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">
                  {selectedDefinition?.name ?? `Unknown section (${selectedSection.type})`}
                </h2>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeSection(selectedSection.id)}
                  aria-label="Remove section"
                  title="Remove section"
                >
                  <Trash2Icon />
                </Button>
              </div>
              {selectedDefinition ? (
                <SettingFields
                  fields={selectedDefinition.settings}
                  values={resolveSettings(selectedDefinition.settings, selectedSection.settings)}
                  onChange={setSectionSetting}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  The theme no longer has this section, so the storefront skips it. You can remove it.
                </p>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <h2 className="font-semibold">Theme settings</h2>
              <StylePicker definition={definition} current={draft.preset} onApply={setStyle} />
              <SettingFields
                fields={definition.settings}
                values={resolveSettings(definition.settings, draft.settings)}
                onChange={setThemeSetting}
              />
            </div>
          )}
        </aside>
      </div>

      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish {theme.name}?</DialogTitle>
            <DialogDescription>
              It replaces your current theme, so buyers see it right away. The theme it replaces stays in your library.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
              {publish.isPending ? 'Publishing…' : 'Publish'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unpublished changes?</DialogTitle>
            <DialogDescription>The editor goes back to what your storefront shows now.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Keep editing</DialogClose>
            <Button variant="destructive" disabled={discard.isPending} onClick={() => discard.mutate()}>
              Discard changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
