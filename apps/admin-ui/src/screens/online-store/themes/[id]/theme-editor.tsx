// Theme editor (Shopify-style): sections on the left, the real storefront in the middle, the selected
// section's (or the theme's) settings on the right. Every change autosaves the draft and reloads the
// preview; Publish makes the draft what buyers see (for an unpublished copy: it becomes the live theme).
import { useMutation } from '@tanstack/react-query'
import { ChevronLeftIcon, CodeIcon, MonitorIcon, PaletteIcon, SmartphoneIcon, Trash2Icon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  MAX_SECTION_BLOCKS,
  applyPreset,
  resolveSettings,
  type ThemeBlock,
  type ThemeDefinition,
  type ThemeDocument,
  type ThemeSection,
  type ThemeSettingValue,
} from '@shopnex/storefront-sdk/theme'
import { Button } from '@/components/ui/button'
import { Workspace, WorkspaceBody } from '@/components/admin/workspace'
import { WorkspaceTabs } from '@/components/admin/workspace-tabs'
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
import { ThemeHeader } from './theme-header'
import { ItemList, SectionList } from './section-list'
import { SettingFields } from './setting-fields'
import { StylePicker } from './style-picker'
import { PreviewPageSelect } from '../preview-page-select'
import { previewPagePath, type PreviewCatalog } from '../preview-pages'

const HOME = 'home'
const AUTOSAVE_MS = 700

type Props = {
  definition: ThemeDefinition
  previewCatalog: PreviewCatalog
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
const newBlockId = () => `b${crypto.randomUUID().replaceAll('-', '').slice(0, 10)}`

export function ThemeEditor({
  definition,
  previewCatalog,
  storefrontUrl,
  theme,
  initialDraft,
  initialPublished,
}: Props) {
  const id = theme.id
  const [live, setLive] = useState(theme.live)
  const [draft, setDraft] = useState(initialDraft)
  const [published, setPublished] = useState(initialPublished)
  const [page, setPage] = useState(HOME in definition.pages ? HOME : (Object.keys(definition.pages)[0] ?? HOME))
  const [selected, setSelected] = useState<string | null>(null) // section id; null = theme settings
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null) // a block of the selected section
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop')
  // On a phone one pane is shown at a time; from md up all three are
  const [pane, setPane] = useState<'sections' | 'preview' | 'settings'>('sections')
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
  // A page the merchant hasn't edited yet shows the theme's default sections (as the storefront does)
  const sections = draft.pages[page]?.sections ?? definition.pages[page]?.sections ?? []
  const setSections = (next: ThemeSection[]) =>
    update({ ...draft, pages: { ...draft.pages, [page]: { sections: next } } })
  const pagePath = previewPagePath(page, definition, previewCatalog)

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
    setPane('settings')
  }

  function removeSection(id: string) {
    setSections(sections.filter((s) => s.id !== id))
    setSelected(null)
    setSelectedBlockId(null)
    setPane('sections')
  }

  const selectedSection = sections.find((s) => s.id === selected) ?? null
  const selectedDefinition = selectedSection ? definition.sections[selectedSection.type] : undefined

  function setSectionSetting(id: string, value: ThemeSettingValue) {
    if (!selectedSection || !selectedDefinition) return
    const settings = { ...resolveSettings(selectedDefinition.settings, selectedSection.settings), [id]: value }
    setSections(sections.map((s) => (s.id === selectedSection.id ? { ...s, settings } : s)))
  }

  // ── blocks of the selected section ──
  const blocks = selectedSection?.blocks ?? []
  const setBlocks = (next: ThemeBlock[]) => {
    if (!selectedSection) return
    setSections(sections.map((s) => (s.id === selectedSection.id ? { ...s, blocks: next } : s)))
  }
  const selectedBlock = blocks.find((b) => b.id === selectedBlockId) ?? null
  const blockDefinition = selectedBlock ? selectedDefinition?.blocks[selectedBlock.type] : undefined
  const blockTypes = Object.entries(selectedDefinition?.blocks ?? {})
  const blocksFull = blocks.length >= (selectedDefinition?.max_blocks ?? MAX_SECTION_BLOCKS)

  function addBlock(type: string) {
    const definitionOfType = selectedDefinition?.blocks[type]
    if (!definitionOfType) return
    const block: ThemeBlock = { id: newBlockId(), type, settings: resolveSettings(definitionOfType.settings) }
    setBlocks([...blocks, block])
    setSelectedBlockId(block.id)
  }

  function removeBlock(id: string) {
    setBlocks(blocks.filter((b) => b.id !== id))
    setSelectedBlockId(null)
  }

  function setBlockSetting(id: string, value: ThemeSettingValue) {
    if (!selectedBlock || !blockDefinition) return
    const settings = { ...resolveSettings(blockDefinition.settings, selectedBlock.settings), [id]: value }
    setBlocks(blocks.map((b) => (b.id === selectedBlock.id ? { ...b, settings } : b)))
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
      setSelectedBlockId(null)
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
    <Workspace>
      {/* Title and actions go in the admin's top bar, like every other page */}
      <ThemeHeader
        name={`${theme.name} · ${definition.pages[page]?.name ?? page}`}
        live={live}
        actions={
          <>
            <span
              className={cn('text-xs text-muted-foreground max-md:hidden', saveState === 'error' && 'text-destructive')}
            >
              {status}
            </span>
            <div className="flex rounded-md border p-0.5 max-md:hidden">
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
              render={<Link to="/admin/online-store/editor/$id/code" params={{ id }} />}
            >
              <CodeIcon />
              <span className="max-md:hidden">Edit code</span>
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
          </>
        }
      />

      <WorkspaceTabs
        tabs={[
          { id: 'sections', label: 'Sections' },
          { id: 'preview', label: 'Preview' },
          { id: 'settings', label: 'Settings' },
        ]}
        value={pane}
        onChange={setPane}
      />

      <WorkspaceBody>
        <aside
          className={cn(
            'w-full shrink-0 space-y-4 overflow-y-auto border-r p-3 md:w-64',
            pane !== 'sections' && 'max-md:hidden',
          )}
        >
          <div>
            {definition.pages && (
              <PreviewPageSelect
                definition={definition}
                catalog={previewCatalog}
                value={page}
                onChange={(value) => {
                  setPage(value)
                  setSelected(null)
                  setSelectedBlockId(null)
                }}
                className="mb-3 w-full"
              />
            )}
            <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Sections</h2>
            <SectionList
              definition={definition}
              sections={sections}
              selectedId={selected}
              onSelect={(id) => {
                setSelected(id)
                setSelectedBlockId(null)
                setPane('settings')
              }}
              onChange={setSections}
              onAdd={addSection}
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSelected(null)
              setSelectedBlockId(null)
              setPane('settings')
            }}
            className={cn(
              'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm font-medium',
              selected === null && 'border-primary ring-1 ring-primary',
            )}
          >
            <PaletteIcon className="size-4 text-muted-foreground" />
            Theme settings
          </button>
        </aside>

        <main className={cn('min-w-0 flex-1', pane !== 'preview' && 'max-md:hidden')}>
          <PreviewFrame
            storefrontUrl={storefrontUrl}
            copyId={id}
            reloadKey={reloadKey}
            selectedSectionId={selected}
            selectedBlockId={selectedBlockId}
            path={pagePath}
            device={device}
          />
        </main>

        <aside
          className={cn('w-full shrink-0 overflow-y-auto border-l p-4 md:w-80', pane !== 'settings' && 'max-md:hidden')}
        >
          {selectedSection && selectedBlock ? (
            <div className="space-y-4">
              <Button variant="ghost" size="sm" className="-ml-2" onClick={() => setSelectedBlockId(null)}>
                <ChevronLeftIcon />
                {selectedDefinition?.name ?? 'Section'}
              </Button>
              <div className="flex items-center justify-between gap-2">
                <h2 className="font-semibold">{blockDefinition?.name ?? `Unknown block (${selectedBlock.type})`}</h2>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => removeBlock(selectedBlock.id)}
                  aria-label="Remove block"
                  title="Remove block"
                >
                  <Trash2Icon />
                </Button>
              </div>
              {blockDefinition ? (
                <SettingFields
                  fields={blockDefinition.settings}
                  values={resolveSettings(blockDefinition.settings, selectedBlock.settings)}
                  onChange={setBlockSetting}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  The theme no longer has this block, so the storefront skips it. You can remove it.
                </p>
              )}
            </div>
          ) : selectedSection ? (
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
                <>
                  {selectedDefinition.settings.length > 0 || blockTypes.length === 0 ? (
                    <SettingFields
                      fields={selectedDefinition.settings}
                      values={resolveSettings(selectedDefinition.settings, selectedSection.settings)}
                      onChange={setSectionSetting}
                    />
                  ) : null}
                  {blockTypes.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Blocks</h3>
                      <ItemList
                        items={blocks}
                        names={Object.fromEntries(blockTypes.map(([type, def]) => [type, def.name]))}
                        noun="block"
                        addable={blockTypes.map(([type, def]) => ({
                          type,
                          name: def.name,
                          full: def.limit != null && blocks.filter((b) => b.type === type).length >= def.limit,
                        }))}
                        disableAdd={blocksFull}
                        selectedId={selectedBlockId}
                        onSelect={setSelectedBlockId}
                        onChange={setBlocks}
                        onAdd={addBlock}
                      />
                    </div>
                  )}
                </>
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
      </WorkspaceBody>

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
    </Workspace>
  )
}
