import { useMemo, useRef, useState, type ComponentType, type KeyboardEvent, type ReactNode } from 'react'
import { MagentoLogo, ShopifyLogo, WooCommerceLogo } from '@/components/admin/platform-logos'
import { ShopnexLogo } from '@/components/admin/shopnex-logo'
import { AlertCircleIcon, CheckCircle2Icon, FileSpreadsheetIcon, UploadIcon, XIcon } from 'lucide-react'
import { ORPCError } from '@orpc/client'
import { toast } from 'sonner'
import { downloadCsv, mapPool } from '@/lib/csv'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { cn } from 'cn'

export type ImportOutcome = { imported: number; skipped?: number; errors: string[] }

/** Runs one create call per item, counting "already exists" conflicts as skipped and other failures as errors. */
export async function createEach<T>(items: T[], label: (item: T) => string, create: (item: T) => Promise<unknown>, onProgress: (done: number) => void, concurrency = 3): Promise<ImportOutcome> {
  const outcome: ImportOutcome = { imported: 0, skipped: 0, errors: [] }
  await mapPool(items, concurrency, async (item) => {
    try { await create(item); outcome.imported++ }
    catch (error) {
      if (error instanceof ORPCError && error.code === 'CONFLICT') outcome.skipped = (outcome.skipped ?? 0) + 1
      else outcome.errors.push(`${label(item)}: ${error instanceof Error ? error.message : 'Import failed'}`)
    }
  }, onProgress)
  return outcome
}

export type FormatOption<T extends string> = { value: T; label: string; description?: string; icon?: ComponentType<{ className?: string }> }

const PLATFORMS = {
  shopify: { label: 'Shopify', icon: ShopifyLogo },
  woocommerce: { label: 'WooCommerce', icon: WooCommerceLogo },
  magento: { label: 'Magento', icon: MagentoLogo },
  shopnex: { label: 'Shopnex', icon: ShopnexLogo },
}
export type Platform = keyof typeof PLATFORMS

/** Card options for the given platforms; `caption` is the small line under each name (e.g. "Customers CSV"). */
export function platformOptions<T extends Platform>(keys: T[], caption: string): FormatOption<T>[] {
  return keys.map((key) => ({ value: key, label: PLATFORMS[key].label, icon: PLATFORMS[key].icon, description: caption }))
}

export function FormatSelect<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: FormatOption<T>[]
  onChange: (value: T) => void
}) {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([])
  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (index + 1) % options.length
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (index + options.length - 1) % options.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = options.length - 1
    if (nextIndex === undefined) return
    event.preventDefault()
    onChange(options[nextIndex]!.value)
    optionRefs.current[nextIndex]?.focus()
  }
  return <fieldset className="space-y-1.5">
    <legend className="text-sm font-medium">{label}</legend>
    <div role="radiogroup" className={cn('grid gap-2', options.length === 2 ? 'sm:grid-cols-2' : options.length === 3 ? 'sm:grid-cols-3' : 'sm:grid-cols-4')}>
      {options.map((option) => {
        const selected = option.value === value
        const Icon = option.icon
        const index = options.findIndex((item) => item.value === option.value)
        return <button key={option.value} ref={(element) => { optionRefs.current[index] = element }} type="button" role="radio" aria-checked={selected}
          tabIndex={selected ? 0 : -1} onKeyDown={(event) => handleKeyDown(event, index)}
          onClick={() => onChange(option.value)}
          className={cn('group relative flex min-h-28 min-w-0 flex-col items-center justify-center gap-2.5 rounded-xl border bg-background px-2 py-4 text-center outline-none transition-all hover:border-foreground/25 hover:bg-muted/40 focus-visible:ring-3 focus-visible:ring-ring/50',
            selected && 'border-primary bg-primary/[0.04] ring-1 ring-primary')}>
          <span className="flex size-11 shrink-0 items-center justify-center rounded-lg border bg-white shadow-sm">
            {Icon ? <Icon className="size-7" /> : <span className="text-sm font-semibold text-muted-foreground">{option.label.slice(0, 1)}</span>}
          </span>
          <span className="max-w-full truncate text-sm font-semibold leading-tight">{option.label}</span>
        </button>
      })}
    </div>
  </fieldset>
}

/** Export modal: `build` returns the CSV and how many records it holds; this handles busy state, download and toasts. */
export function ExportDialog({ title, description, noun, filename, children, build }: {
  title: string
  description: string
  noun: string
  filename: string
  children?: ReactNode
  build: () => Promise<{ csv: string; count: number }>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  async function download() {
    setBusy(true)
    try {
      const { csv, count } = await build()
      if (!count) throw new Error(`There are no ${noun} to export yet.`)
      downloadCsv(csv, filename)
      toast.success(`Exported ${count} ${noun}`)
      setOpen(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not export ${noun}.`)
    } finally {
      setBusy(false)
    }
  }
  return <Dialog open={open} onOpenChange={(next) => { if (!busy) setOpen(next) }}>
    <DialogTrigger render={<Button variant="outline" />}><UploadIcon className="rotate-180" />Export</DialogTrigger>
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      {children}
      <DialogFooter>
        <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
        <Button disabled={busy} onClick={() => void download()}>{busy ? 'Preparing export…' : 'Download CSV'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

/**
 * Shared CSV import flow: pick a file → validate and preview → import with progress → summary.
 * `parse` runs again whenever its identity changes (e.g. the user switches source platform).
 */
export function ImportDialog<T>({
  title, description, noun, options, parse, previewHeaders, previewRow, run, onFinished, resetKey, hint,
}: {
  title: string
  description: string
  noun: string
  options?: ReactNode
  parse: (text: string) => T[]
  previewHeaders: string[]
  previewRow: (item: T) => ReactNode[]
  run: (items: T[], onProgress: (done: number) => void) => Promise<ImportOutcome>
  onFinished: () => void | Promise<void>
  resetKey?: unknown
  hint?: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<{ name: string; text: string } | null>(null)
  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const busy = progress !== null

  const parsed = useMemo(() => {
    if (!file) return null
    try { return { items: parse(file.text), error: null } }
    catch (error) { return { items: [] as T[], error: error instanceof Error ? error.message : 'Could not read this CSV.' } }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file, resetKey])
  const items = parsed?.items ?? []

  function reset() {
    setFile(null); setOutcome(null); setProgress(null)
    if (input.current) input.current.value = ''
  }

  async function choose(selected?: File) {
    if (!selected) return
    setOutcome(null)
    if (selected.size > 25 * 1024 * 1024) { toast.error('This file is larger than 25 MB.'); return }
    setFile({ name: selected.name, text: await selected.text() })
  }

  async function start() {
    setProgress(0)
    try {
      const result = await run(items, setProgress)
      setOutcome(result)
      if (result.imported) {
        await onFinished()
        if (!result.errors.length) toast.success(`${result.imported} ${noun} imported`)
      }
    } catch (error) {
      setOutcome({ imported: 0, errors: [error instanceof Error ? error.message : 'Import failed.'] })
    } finally {
      setProgress(null)
    }
  }

  const percent = busy && items.length ? Math.round((progress / items.length) * 100) : 0
  return <Dialog open={open} onOpenChange={(next) => { if (busy) return; setOpen(next); if (!next) reset() }}>
    <DialogTrigger render={<Button variant="outline" />}><UploadIcon />Import</DialogTrigger>
    <DialogContent className="max-h-[90vh] grid-rows-[auto_minmax(0,1fr)_auto] sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
      </DialogHeader>
      <div className="-mx-4 min-h-0 space-y-4 overflow-y-auto px-4 py-1">
        {options}
        {outcome ? <ImportSummary outcome={outcome} noun={noun} /> : <>
          {file ? <div className="flex items-center gap-3 rounded-lg border bg-muted/40 p-3">
            <FileSpreadsheetIcon className="size-5 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{parsed?.error ? 'Needs attention' : `${items.length} ${noun} ready to import`}</p>
            </div>
            <Button variant="ghost" size="icon-sm" disabled={busy} onClick={reset}><XIcon /><span className="sr-only">Remove file</span></Button>
          </div> : <button type="button" onClick={() => input.current?.click()}
            onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => { event.preventDefault(); setDragging(false); void choose(event.dataTransfer.files[0]) }}
            className={cn('flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-8 text-center transition-colors hover:bg-muted/50', dragging && 'border-primary bg-primary/5')}>
            <UploadIcon className="size-6 text-muted-foreground" />
            <span className="text-sm font-medium">Drop a CSV file here, or click to browse</span>
            <span className="text-xs text-muted-foreground px-4">{hint ?? 'Up to 25 MB'}</span>
          </button>}
          <input ref={input} type="file" accept=".csv,text/csv" hidden onChange={(event) => void choose(event.target.files?.[0])} />
          {parsed?.error && <p className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            <AlertCircleIcon className="mt-0.5 size-4 shrink-0" />{parsed.error}
          </p>}
          {items.length > 0 && <div className="max-h-64 overflow-auto rounded-lg border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr>{previewHeaders.map((header) => <th key={header} className="px-3 py-2 font-medium">{header}</th>)}</tr>
              </thead>
              <tbody>{items.slice(0, 50).map((item, index) => <tr key={index} className="border-t">
                {previewRow(item).map((value, column) => <td key={column} className="max-w-56 truncate px-3 py-2">{value}</td>)}
              </tr>)}</tbody>
            </table>
            {items.length > 50 && <p className="border-t p-2 text-center text-xs text-muted-foreground">Showing the first 50 of {items.length} {noun}.</p>}
          </div>}
          {busy && <div className="space-y-1.5" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${percent}%` }} /></div>
            <p className="text-xs text-muted-foreground">Importing {progress} of {items.length} {noun}… keep this window open.</p>
          </div>}
        </>}
      </div>
      <DialogFooter>
        {outcome ? <>
          <Button variant="outline" onClick={reset}>Import another file</Button>
          <Button onClick={() => { setOpen(false); reset() }}>Done</Button>
        </> : <>
          <Button variant="outline" disabled={busy} onClick={() => { setOpen(false); reset() }}>Cancel</Button>
          <Button disabled={!items.length || busy} onClick={() => void start()}>{busy ? 'Importing…' : items.length ? `Import ${items.length} ${noun}` : 'Import'}</Button>
        </>}
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

function ImportSummary({ outcome, noun }: { outcome: ImportOutcome; noun: string }) {
  const failed = outcome.errors.length
  return <div className="space-y-3">
    <div className={cn('flex items-start gap-3 rounded-lg border p-3', failed && !outcome.imported ? 'border-destructive/30 bg-destructive/5' : 'bg-muted/40')}>
      {failed && !outcome.imported ? <AlertCircleIcon className="mt-0.5 size-5 shrink-0 text-destructive" /> : <CheckCircle2Icon className="mt-0.5 size-5 shrink-0 text-emerald-600" />}
      <div className="text-sm">
        <p className="font-medium">{outcome.imported} {noun} imported</p>
        <p className="text-muted-foreground">
          {[outcome.skipped ? `${outcome.skipped} skipped (already exist)` : '', failed ? `${failed} failed` : ''].filter(Boolean).join(' · ') || 'Everything in the file was imported.'}
        </p>
      </div>
    </div>
    {failed > 0 && <ul className="max-h-48 space-y-1 overflow-auto rounded-lg border p-3 text-xs text-muted-foreground">
      {outcome.errors.map((error, index) => <li key={index}>{error}</li>)}
    </ul>}
  </div>
}
