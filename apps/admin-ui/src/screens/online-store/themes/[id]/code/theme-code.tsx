'use client'

// Edit code (Shopify-style): the theme's Liquid files on the left, the file in the middle, the storefront on
// the right. The originals come from the storefront; Shopnex autosaves edits to the copy's draft files,
// which the preview reads. Publishing applies those files to the live storefront.
import { ORPCError } from '@orpc/client'
import { useMutation, useQuery } from '@tanstack/react-query'
import { ArrowLeftIcon, EyeIcon, EyeOffIcon, FilePlusIcon, PaletteIcon, RotateCcwIcon, Trash2Icon } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { useEffect, useMemo, useRef, useState } from 'react'
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
import { previewPageForPath, previewPagePath, templatePreviewPage, type PreviewCatalog } from '../../preview-pages'
import { useDebouncedCallback } from '@/hooks/use-debounced-callback'

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
  // What Shopnex has saved, kept up to date by this page's saves
  const [edited, setEdited] = useState<Record<string, string> | null>(null)
  useEffect(() => {
    if (files.data && !edited) setEdited(files.data.edited)
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
  const [confirm, setConfirm] = useState<'reset' | 'delete' | null>(null)
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

  const afterChange = (path: string, source: string | undefined, expected?: string) => {
    setEdited((files) => {
      const next = { ...files }
      if (source === undefined) delete next[path]
      else next[path] = source
      return next
    })
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
      if (original?.[path] === source) await client.admin.themes.deleteFile({ id, path })
      else await client.admin.themes.saveFile({ id, path, source })
      return { path, source: original?.[path] === source ? undefined : source, savedSource: source }
    },
    onSuccess: ({ path, source, savedSource }) => {
      afterChange(path, source, savedSource)
    },
    onError: (error, path) => setProblem({ path, ...problemOf(error) }),
  })

  const remove = useMutation({
    mutationFn: (path: string) => client.admin.themes.deleteFile({ id, path }).then(() => path),
    onSuccess: (path) => {
      const added = !(path in (original ?? {}))
      afterChange(path, undefined)
      setConfirm(null)
      setGeneration((g) => g + 1)
      if (added) setSelected('layout/theme.liquid')
      toast.success(added ? `Deleted ${fileName(path)}` : `${fileName(path)} is back to the theme’s version`)
    },
    onError: (error) => toast.error(error.message),
  })

  const create = useMutation({
    mutationFn: (path: string) => client.admin.themes.saveFile({ id, path, source: '' }).then(() => path),
    onSuccess: (path) => {
      afterChange(path, '')
      setSelected(path)
      setAdding(false)
    },
    onError: (error) => toast.error(error.message),
  })

  const onSave = () => {
    if (isDirty(selected) && !save.isPending) save.mutate(selected)
  }

  const pendingCode = JSON.stringify(dirtyPaths.map((path) => [path, buffers[path]]))
  const { schedule: scheduleAutosave, cancel: cancelAutosave } = useDebouncedCallback((paths: string[]) => {
    for (const path of paths) {
      if (path in buffersRef.current && !save.isPending && problem?.path !== path) save.mutate(path)
    }
  }, 600)
  useEffect(() => {
    if (save.isPending) cancelAutosave()
    else scheduleAutosave(dirtyPaths)
  }, [pendingCode, save.isPending, problem?.path, scheduleAutosave, cancelAutosave])

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
            ? 'Code changes autosave to the draft preview. Publish to update your store.'
            : 'Code changes autosave to the draft preview. Publish this theme to make them live.'}
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
      <Button size="sm" variant="outline" disabled={!dirtyPaths.length && !save.isPending} onClick={onSave}>
        {save.isPending ? 'Saving…' : dirtyPaths.length ? 'Saving shortly…' : 'Saved to draft'}
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
                          <span className="ml-auto size-1.5 shrink-0 rounded-full bg-amber-500" title="Unsaved" />
                        ) : !(path in original) ? (
                          <span className="ml-auto text-[10px] text-muted-foreground">new</span>
                        ) : (
                          path in edited && (
                            <span className="ml-auto size-1.5 shrink-0 rounded-full bg-primary" title="Edited" />
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
              {confirm === 'delete' ? `Delete ${fileName(selected)}?` : `Reset ${fileName(selected)}?`}
            </DialogTitle>
            <DialogDescription>
              {confirm === 'delete'
                ? 'Templates that render it will fail until you remove those {% render %} tags.'
                : 'Your changes to this file are deleted and it goes back to the theme’s version.'}
              {theme.live && ' Buyers see this right away.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(selected)}>
              {confirm === 'delete' ? 'Delete file' : 'Reset file'}
            </Button>
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
