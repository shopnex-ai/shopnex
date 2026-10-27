'use client'

// Edit code (Shopify-style): the theme's Liquid files on the left, the file in the middle, the storefront on
// the right. The originals come from the storefront; Shopnex keeps the copy's edited files. Edits autosave to
// a draft (the preview shows it) and Publish writes the draft to the copy: on the live theme buyers see it then.
// Unsaved edits are kept per file while switching between them.
import { ORPCError } from '@orpc/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, FilePlusIcon, PaletteIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { THEME_CODE_FOLDERS, ThemeFilePath } from '@shopnex/storefront-sdk/theme'
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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { client, orpc } from '@/lib/orpc'
import { cn } from '@/lib/utils'
import { PreviewFrame } from '../preview-frame'
import { LiquidEditor } from '@/components/admin/liquid-editor'
import type { ThemeDefinition } from '@shopnex/storefront-sdk/theme'
import { PreviewPageSelect } from '../../preview-page-select'
import { useDebouncedCallback } from '@/hooks/use-debounced-callback'
import { previewPageForPath, previewPagePath, templatePreviewPage, type PreviewCatalog } from '../../preview-pages'

type Props = {
  storefrontUrl: string | null
  /** The library copy being edited */
  theme: { id: string; name: string; live: boolean }
  /** Each page's sections and where the preview shows it, to find the one a section file renders */
  pages: { path: string | null; sections: { id: string; type: string }[] }[]
  previewCatalog: PreviewCatalog
  definition: ThemeDefinition | null
}

type Problem = { message: string; line: number | null }

const AUTOSAVE_MS = 600

const FOLDER_NAMES: Record<(typeof THEME_CODE_FOLDERS)[number], string> = {
  layout: 'Layout',
  templates: 'Templates',
  sections: 'Sections',
  snippets: 'Snippets',
}

const fileName = (path: string) => path.slice(path.indexOf('/') + 1).replace(/\.liquid$/, '')

function problemOf(error: unknown): Problem {
  const data = error instanceof ORPCError ? (error.data as Partial<Problem> | undefined) : undefined
  return {
    message: error instanceof Error ? error.message : 'Could not save',
    line: typeof data?.line === 'number' ? data.line : null,
  }
}

export function ThemeCode({ storefrontUrl, theme, pages: themePages, previewCatalog, definition }: Props) {
  const id = theme.id
  const files = useQuery({ ...orpc.admin.themes.files.queryOptions({ input: { id } }), retry: false })
  const original = files.data?.original
  // What Shopnex has saved (the draft over the published files), kept up to date by this page's saves
  const [edited, setEdited] = useState<Record<string, string> | null>(null)
  // The paths whose saved version isn't published yet, and the draft's rev this page last saw
  const [changed, setChanged] = useState<Set<string>>(new Set())
  const rev = useRef(0)
  useEffect(() => {
    if (files.data && !edited) {
      setEdited(files.data.edited)
      setChanged(new Set(files.data.changed))
      rev.current = files.data.rev
    }
  }, [files.data, edited])

  const [selected, setSelected] = useState('layout/theme.liquid')
  const [buffers, setBuffers] = useState<Record<string, string>>({})
  const buffersRef = useRef(buffers)
  buffersRef.current = buffers
  // Remounts the editor when its file's content is replaced from outside (reset)
  const [generation, setGeneration] = useState(0)
  const [problem, setProblem] = useState<(Problem & { path: string }) | null>(null)
  const [showPreview, setShowPreview] = useState(true)
  const [previewPage, setPreviewPage] = useState('home')
  const [reloadKey, setReloadKey] = useState(0)
  const [confirm, setConfirm] = useState<'reset' | 'delete' | 'publish' | 'discard' | null>(null)
  const [adding, setAdding] = useState(false)

  const saved = (path: string) => edited?.[path] ?? original?.[path]
  const content = (path: string) => buffers[path] ?? saved(path) ?? ''
  const isDirty = (path: string) => path in buffers && buffers[path] !== saved(path)
  const dirtyPaths = Object.keys(buffers).filter(isDirty)

  // Opening sections/{type}.liquid points the preview at that section, on the first page that has one
  const shown = themePages
    .filter((p) => p.path)
    .flatMap((p) => p.sections.map((s) => ({ path: p.path!, ...s })))
    .find((s) => `sections/${s.type}.liquid` === selected)
  const previewSectionId = shown?.id ?? null
  useEffect(() => {
    const templatePage = templatePreviewPage(selected)
    if (templatePage) setPreviewPage(templatePage)
    else if (shown?.path) setPreviewPage(previewPageForPath(shown.path, definition, previewCatalog))
  }, [selected, shown?.path, definition, previewCatalog])
  const selectedPreviewPath = previewPagePath(previewPage, definition, previewCatalog)

  const paths = useMemo(
    () => [...new Set([...Object.keys(original ?? {}), ...Object.keys(edited ?? {})])].sort(),
    [original, edited],
  )

  // Leaving with unsaved edits asks first
  useEffect(() => {
    if (!dirtyPaths.length) return
    const onBeforeUnload = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirtyPaths.length])

  // `source` undefined: the copy has no edit of the file anymore. `expected`: the buffer is only dropped when it
  // still is what was saved, so keystrokes typed during the save aren't lost.
  const afterChange = (path: string, saved: { source: string | undefined; rev: number }, expected?: string) => {
    rev.current = Math.max(rev.current, saved.rev)
    setEdited((files) => {
      const next = { ...files }
      if (saved.source === undefined) delete next[path]
      else next[path] = saved.source
      return next
    })
    setChanged((paths) => new Set(paths).add(path))
    setBuffers((current) => {
      if (expected !== undefined && current[path] !== expected) return current
      const { [path]: _, ...rest } = current
      return rest
    })
    setProblem((p) => (p?.path === path ? null : p))
    setReloadKey((k) => k + 1)
  }

  const save = useMutation({
    mutationFn: async (path: string) => {
      const source = content(path)
      // Back to the theme's own content: drop the edit instead of keeping a copy of it
      const { rev } =
        original?.[path] === source
          ? await client.admin.themes.deleteFile({ id, path })
          : await client.admin.themes.saveFile({ id, path, source })
      return { path, source: original?.[path] === source ? undefined : source, rev, savedSource: source }
    },
    onSuccess: ({ path, source, rev, savedSource }) => afterChange(path, { source, rev }, savedSource),
    onError: (error, path) => setProblem({ path, ...problemOf(error) }),
  })

  // One file at a time, so the saves of a file land in the order they were typed. Files whose last save was
  // refused wait for their next edit.
  const inFlight = useRef<Promise<void> | null>(null)
  const problemRef = useRef(problem)
  problemRef.current = problem
  const savedRef = useRef(saved)
  savedRef.current = saved
  const saveAll = useCallback(async () => {
    // Wait for a run that's going (its files may be older than what is typed now), then do our own
    while (inFlight.current) await inFlight.current
    const run = (async () => {
      for (const path of Object.keys(buffersRef.current)) {
        const buffer = buffersRef.current[path]
        if (buffer === undefined || buffer === savedRef.current(path) || problemRef.current?.path === path) continue
        await save.mutateAsync(path).catch(() => {})
      }
    })()
    inFlight.current = run
    try {
      await run
    } finally {
      inFlight.current = null
    }
  }, [save])
  const { schedule: scheduleAutosave, cancel: cancelAutosave } = useDebouncedCallback(() => void saveAll(), AUTOSAVE_MS)
  const pending = JSON.stringify(dirtyPaths.map((path) => buffers[path]))
  useEffect(() => {
    if (dirtyPaths.length) scheduleAutosave()
  }, [pending, dirtyPaths.length, scheduleAutosave])

  const remove = useMutation({
    mutationFn: (path: string) => client.admin.themes.deleteFile({ id, path }).then(({ rev }) => ({ path, rev })),
    onSuccess: ({ path, rev }) => {
      const added = !(path in (original ?? {}))
      afterChange(path, { source: undefined, rev })
      setConfirm(null)
      setGeneration((g) => g + 1)
      if (added) setSelected('layout/theme.liquid')
      toast.success(added ? `Deleted ${fileName(path)}` : `${fileName(path)} is back to the theme’s version`)
    },
    onError: (error) => toast.error(error.message),
  })

  const create = useMutation({
    mutationFn: (path: string) => client.admin.themes.saveFile({ id, path, source: '' }).then(({ rev }) => ({ path, rev })),
    onSuccess: ({ path, rev }) => {
      afterChange(path, { source: '', rev })
      setSelected(path)
      setAdding(false)
    },
    onError: (error) => toast.error(error.message),
  })

  const onSave = () => {
    cancelAutosave()
    void saveAll()
  }

  const publish = useMutation({
    mutationFn: async () => {
      cancelAutosave()
      // Whatever is still typed goes to the draft first; a refused file stops the publish
      await saveAll()
      if (Object.keys(buffersRef.current).some((path) => buffersRef.current[path] !== savedRef.current(path))) {
        throw new Error('Fix the Liquid error first')
      }
      return client.admin.themes.publishCode({ id, rev: rev.current })
    },
    onSuccess: (result) => {
      rev.current = result.rev
      setChanged(new Set())
      setConfirm(null)
      toast.success(result.published ? 'Published: your code changes are in the theme' : 'Nothing to publish')
    },
    onError: (error) => {
      setConfirm(null)
      toast.error(error.message)
    },
  })

  const discard = useMutation({
    mutationFn: () => client.admin.themes.discardCode({ id }),
    onSuccess: async () => {
      setConfirm(null)
      setBuffers({})
      setProblem(null)
      setEdited(null)
      rev.current = 0
      await files.refetch()
      setGeneration((g) => g + 1)
      setReloadKey((k) => k + 1)
      toast.success('Unpublished code changes discarded')
    },
    onError: (error) => toast.error(error.message),
  })

  const isEdited = edited ? selected in edited : false
  const isAdded = original ? !(selected in original) : false

  const header = (
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
          <span className="truncate">{theme.name} · Edit code</span>
          <Badge variant={theme.live ? 'secondary' : 'outline'}>{theme.live ? 'Live' : 'Unpublished'}</Badge>
        </h1>
        <p className="text-xs text-muted-foreground">
          {theme.live
            ? 'Changes autosave to a draft you can preview. Publish to update your store.'
            : 'Changes autosave to a draft you can preview. Your store uses them once this theme is live.'}
        </p>
      </div>
      <Button
        variant="outline"
        size="sm"
        nativeButton={false}
        render={<Link to="/admin/online-store/themes/$id" params={{ id }} />}
      >
        <PaletteIcon />
        Customize
      </Button>
      {storefrontUrl && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => setShowPreview((s) => !s)}
          aria-label={showPreview ? 'Hide preview' : 'Show preview'}
          title={showPreview ? 'Hide preview' : 'Show preview'}
        >
          {showPreview ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      )}
      {changed.size > 0 && (
        <Button variant="ghost" size="sm" disabled={publish.isPending} onClick={() => setConfirm('discard')}>
          Discard
        </Button>
      )}
      <Button variant="outline" size="sm" disabled={!dirtyPaths.length || save.isPending} onClick={onSave}>
        {save.isPending ? 'Saving…' : dirtyPaths.length ? 'Save now' : 'Saved to draft'}
      </Button>
      <Button
        size="sm"
        disabled={publish.isPending || (!dirtyPaths.length && changed.size === 0)}
        onClick={() => (theme.live ? setConfirm('publish') : publish.mutate())}
      >
        {publish.isPending ? 'Publishing…' : 'Publish'}
      </Button>
    </div>
  )

  if (files.error || !original || !edited) {
    return (
      <div className="-m-4 flex h-[calc(100svh-3rem)] flex-col md:-m-6">
        {header}
        <div className="p-6">
          {files.error ? (
            <p className="text-sm text-destructive">{files.error.message}</p>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </div>
      </div>
    )
  }

  return (
    // Fill the dashboard's content area edge to edge (its header is h-12, padding p-4 / md:p-6)
    <div className="-m-4 flex h-[calc(100svh-3rem)] flex-col md:-m-6">
      {header}

      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 space-y-4 overflow-y-auto border-r p-3">
          {THEME_CODE_FOLDERS.map((folder) => (
            <div key={folder}>
              <div className="mb-1 flex items-center justify-between px-1">
                <h2 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                  {FOLDER_NAMES[folder]}
                </h2>
                {folder === 'snippets' && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => setAdding(true)}
                    aria-label="Add a snippet"
                    title="Add a snippet"
                  >
                    <FilePlusIcon />
                  </Button>
                )}
              </div>
              <ul>
                {paths
                  .filter((p) => p.startsWith(`${folder}/`))
                  .map((path) => (
                    <li key={path}>
                      <button
                        type="button"
                        onClick={() => setSelected(path)}
                        className={cn(
                          'flex w-full items-center gap-2 rounded-md px-2 py-1 text-left font-mono text-xs hover:bg-muted',
                          selected === path && 'bg-muted font-medium',
                        )}
                      >
                        <span className="truncate">{fileName(path)}</span>
                        {isDirty(path) ? (
                          <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500" title="Saving…" />
                        ) : !(path in original) ? (
                          <span className="ml-auto text-[10px] text-muted-foreground">new</span>
                        ) : (
                          path in edited && (
                            <span
                              className={cn(
                                'ml-auto size-1.5 shrink-0 rounded-full',
                                changed.has(path) ? 'bg-sky-500' : 'bg-primary',
                              )}
                              title={changed.has(path) ? 'Draft, not published' : 'Edited'}
                            />
                          )
                        )}
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-2 border-b px-3 py-1.5">
            <span className="mr-auto truncate font-mono text-xs">
              {selected.replace(/\.liquid$/, '')}
              {isDirty(selected) && ' •'}
            </span>
            {isEdited && !isAdded && (
              <Button variant="ghost" size="xs" onClick={() => setConfirm('reset')}>
                <RotateCcwIcon />
                Reset to original
              </Button>
            )}
            {isAdded && (
              <Button variant="ghost" size="xs" onClick={() => setConfirm('delete')}>
                <Trash2Icon />
                Delete
              </Button>
            )}
          </div>
          <div className="min-h-0 flex-1">
            <LiquidEditor
              key={`${selected}:${generation}`}
              value={content(selected)}
              onChange={(value) => {
                setBuffers((b) => ({ ...b, [selected]: value }))
                setProblem((current) => (current?.path === selected ? null : current))
              }}
              onSave={onSave}
              readOnly={publish.isPending}
              line={problem?.path === selected ? problem.line : null}
            />
          </div>
          {problem?.path === selected && (
            <p className="border-t bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">{problem.message}</p>
          )}
        </main>

        {storefrontUrl && showPreview && (
          <aside className="hidden w-[40%] shrink-0 border-l lg:block">
            <div className="border-b p-2">
              <PreviewPageSelect
                definition={definition}
                catalog={previewCatalog}
                value={previewPage}
                onChange={setPreviewPage}
                className="w-full"
              />
            </div>
            <PreviewFrame
              storefrontUrl={storefrontUrl}
              copyId={id}
              reloadKey={reloadKey}
              selectedSectionId={previewSectionId}
              path={selectedPreviewPath}
              device="desktop"
            />
          </aside>
        )}
      </div>

      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === 'publish'
                ? 'Publish code changes?'
                : confirm === 'discard'
                  ? 'Discard unpublished code changes?'
                  : confirm === 'delete'
                    ? `Delete ${fileName(selected)}?`
                    : `Reset ${fileName(selected)}?`}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'publish'
                ? 'Buyers see your code changes right away. Your unpublished design changes stay as they are.'
                : confirm === 'discard'
                  ? 'Every file goes back to its published version. Design changes are not affected.'
                  : confirm === 'delete'
                    ? 'Templates that render it will fail until you remove those {% render %} tags.'
                    : 'Your changes to this file are deleted and it goes back to the theme’s version.'}
              {(confirm === 'delete' || confirm === 'reset') && ' This is a draft until you publish.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            {confirm === 'publish' ? (
              <Button disabled={publish.isPending} onClick={() => publish.mutate()}>
                Publish
              </Button>
            ) : confirm === 'discard' ? (
              <Button variant="destructive" disabled={discard.isPending} onClick={() => discard.mutate()}>
                Discard changes
              </Button>
            ) : (
              <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(selected)}>
                {confirm === 'delete' ? 'Delete file' : 'Reset file'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AddSnippetDialog
        open={adding}
        existing={paths}
        pending={create.isPending}
        onClose={() => setAdding(false)}
        onAdd={(path) => create.mutate(path)}
      />
    </div>
  )
}

type AddProps = {
  open: boolean
  existing: string[]
  pending: boolean
  onClose: () => void
  onAdd: (path: string) => void
}

function AddSnippetDialog({ open, existing, pending, onClose, onAdd }: AddProps) {
  const [name, setName] = useState('')
  useEffect(() => {
    if (open) setName('')
  }, [open])
  const path = `snippets/${name.trim().replace(/\.liquid$/, '')}.liquid`
  const error = !name.trim()
    ? null
    : !ThemeFilePath.safeParse(path).success
      ? 'Lowercase letters, digits, - and _'
      : existing.includes(path)
        ? 'There’s already a snippet with this name'
        : null

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a snippet</DialogTitle>
          <DialogDescription>
            Render it from any template with {`{% render '${name.trim().replace(/\.liquid$/, '') || 'name'}' %}`}.
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (name.trim() && !error) onAdd(path)
          }}
          className="space-y-2"
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="promo-banner"
            aria-label="Snippet name"
            autoFocus
          />
          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!name.trim() || !!error || pending}>
              Add snippet
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
