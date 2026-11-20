// Translations: one place to translate the shop's products, collections and pages. A language and a kind of record at the top,
// the records on the left with whether each is translated, outdated or missing, and the open record on the right with the
// original (Reference) beside the translation. The two panes scroll on their own under a fixed toolbar.
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
import { sourceDigest } from '@shopnex/languages/contract'
import { PageHeader } from '@/components/admin/page-header'
import { RichTextEditor } from '@/components/admin/rich-text-editor'
import {
  nameOf,
  plain,
  useTranslationDrafts,
  type Resource,
  type TranslatableField,
  type TranslationRow,
} from '@/components/admin/translations-card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { client, orpc } from '@/lib/orpc'
import { cn } from '@/lib/utils'

export interface WorkspaceSearch {
  resource?: Resource
  id?: string
  language?: string
}

type Status = 'translated' | 'outdated' | 'missing'
type Filter = 'all' | Exclude<Status, 'translated'>

interface Record_ {
  id: string
  title: string
  fields: TranslatableField[]
}

const RESOURCES: { value: Resource; label: string }[] = [
  { value: 'product', label: 'Products' },
  { value: 'collection', label: 'Collections' },
  { value: 'page', label: 'Pages' },
]
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'missing', label: 'Needs translation' },
  { value: 'outdated', label: 'Outdated' },
]
const PAGE_SIZE = 100

const withText = (row: { title: string; description: string | null; descriptionHtml: string | null }) => [
  { key: 'title', label: 'Title', kind: 'text' as const, source: row.title },
  {
    key: 'description',
    label: 'Description',
    kind: 'html' as const,
    source: row.descriptionHtml ?? row.description ?? '',
  },
]

/** Products and collections come page by page, pages all at once */
function useRecords(resource: Resource, search: string) {
  const products = useInfiniteQuery({
    queryKey: ['translation-records', 'product', search],
    enabled: resource === 'product',
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      client.admin.products.list({ limit: PAGE_SIZE, offset: pageParam, search: search || undefined }),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((n, p) => n + p.items.length, 0)
      return loaded < last.total ? loaded : undefined
    },
  })
  const collections = useInfiniteQuery({
    queryKey: ['translation-records', 'collection'],
    enabled: resource === 'collection',
    initialPageParam: 0,
    queryFn: ({ pageParam }) => client.admin.collections.list({ limit: PAGE_SIZE, offset: pageParam }),
    // Collections come without a total: another page exists when this one was full
    getNextPageParam: (last, all) => (last.length === PAGE_SIZE ? all.reduce((n, p) => n + p.length, 0) : undefined),
  })
  const pages = useQuery({ ...orpc.admin.pages.list.queryOptions(), enabled: resource === 'page' })

  return useMemo(() => {
    const q = search.trim().toLowerCase()
    const match = (r: Record_) => resource === 'product' || !q || r.title.toLowerCase().includes(q)
    if (resource === 'product') {
      const rows = (products.data?.pages ?? []).flatMap((p) => p.items)
      return {
        records: rows.map((r): Record_ => ({ id: r.id, title: r.title, fields: withText(r) })),
        total: products.data?.pages[0]?.total ?? 0,
        loading: products.isPending,
        error: products.error,
        more: products.hasNextPage ? () => void products.fetchNextPage() : undefined,
      }
    }
    if (resource === 'collection') {
      const rows = (collections.data?.pages ?? []).flat()
      const records = rows.map((r): Record_ => ({ id: r.id, title: r.title, fields: withText(r) })).filter(match)
      return {
        records,
        total: rows.length,
        loading: collections.isPending,
        error: collections.error,
        more: collections.hasNextPage ? () => void collections.fetchNextPage() : undefined,
      }
    }
    const records = (pages.data ?? [])
      .map((r): Record_ => ({
        id: r.id,
        title: r.title,
        fields: [
          { key: 'title', label: 'Title', kind: 'text', source: r.title },
          { key: 'body', label: 'Content', kind: 'html', source: r.bodyHtml },
        ],
      }))
      .filter(match)
    return { records, total: pages.data?.length ?? 0, loading: pages.isPending, error: pages.error, more: undefined }
  }, [resource, search, products, collections, pages])
}

/** Translated when every field that has text has a translation of that text; outdated when one was made from older text */
function statusOfRecord(record: Record_, digests: Map<string, string>): Status {
  let missing = false
  let outdated = false
  for (const field of record.fields) {
    if (!field.source.trim()) continue
    const digest = digests.get(`${record.id}:${field.key}`)
    if (digest === undefined) missing = true
    else if (digest !== sourceDigest(field.source)) outdated = true
  }
  return outdated ? 'outdated' : missing ? 'missing' : 'translated'
}

const STATUS_LABEL: Record<Status, string> = {
  translated: 'Translated',
  outdated: 'Outdated',
  missing: 'Needs translation',
}
const STATUS_DOT: Record<Status, string> = {
  translated: 'bg-emerald-500',
  outdated: 'bg-amber-500',
  missing: 'bg-muted-foreground/40',
}

export function TranslationWorkspace({
  search,
  onChange,
}: {
  search: WorkspaceSearch
  onChange: (patch: Partial<WorkspaceSearch>) => void
}) {
  const languages = useQuery(orpc.admin.languages.list.queryOptions())
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('all')

  const resource = search.resource ?? 'product'
  const published = languages.data?.languages ?? []
  const language = search.language && published.includes(search.language) ? search.language : published[0]

  const records = useRecords(resource, query)
  const statuses = useQuery({
    ...orpc.admin.languages.translations.status.queryOptions({ input: { resource, language: language ?? 'en' } }),
    enabled: !!language,
  })
  const digests = useMemo(
    () => new Map((statuses.data ?? []).map((r) => [`${r.resourceId}:${r.field}`, r.sourceDigest])),
    [statuses.data],
  )
  const withStatus = useMemo(
    () => records.records.map((record) => ({ record, status: statusOfRecord(record, digests) })),
    [records.records, digests],
  )
  const shown = withStatus.filter((r) => filter === 'all' || r.status === filter)
  const open = shown.find((r) => r.record.id === search.id) ?? shown[0]

  return (
    <div className="-m-4 flex h-[calc(100svh-3rem)] flex-col md:-m-6">
      <PageHeader title="Translations" />

      {languages.isPending ? (
        <Skeleton className="m-4 h-24" />
      ) : languages.error ? (
        <p className="p-4 text-sm text-destructive">{languages.error.message}</p>
      ) : !language ? (
        <div className="m-4 max-w-xl space-y-2 text-sm text-muted-foreground">
          <p>You have not published another language yet.</p>
          <p>
            <Link to="/admin/settings/languages" className="underline">
              Add a language in Settings → Languages
            </Link>{' '}
            and come back here to translate your products, collections and pages into it.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
            <Select
              items={published.map((code) => ({ value: code, label: `Translating ${nameOf(code)}` }))}
              value={language}
              onValueChange={(value) => onChange({ language: value ?? undefined, id: undefined })}
            >
              <SelectTrigger className="w-52" aria-label="Language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {published.map((code) => (
                  <SelectItem key={code} value={code}>
                    Translating {nameOf(code)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={RESOURCES}
              value={resource}
              onValueChange={(value) => onChange({ resource: (value as Resource | null) ?? 'product', id: undefined })}
            >
              <SelectTrigger className="w-40" aria-label="Kind of record">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESOURCES.map((r) => (
                  <SelectItem key={r.value} value={r.value}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              items={FILTERS}
              value={filter}
              onValueChange={(value) => setFilter((value as Filter | null) ?? 'all')}
            >
              <SelectTrigger className="w-44" aria-label="Show">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by title"
              aria-label="Search by title"
              className="ml-auto w-56"
            />
          </div>

          <div className="flex min-h-0 flex-1">
            <aside className="flex w-80 shrink-0 flex-col border-r">
              <p className="border-b px-4 py-2 text-sm text-muted-foreground">
                {records.loading ? 'Loading…' : `Showing ${String(shown.length)} of ${String(records.total)} items`}
              </p>
              <ul className="min-h-0 flex-1 overflow-y-auto">
                {records.error && <li className="p-4 text-sm text-destructive">{records.error.message}</li>}
                {shown.map(({ record, status }) => (
                  <li key={record.id}>
                    <button
                      type="button"
                      onClick={() => onChange({ id: record.id })}
                      aria-current={open?.record.id === record.id}
                      className={cn(
                        'flex w-full items-start gap-3 border-b px-4 py-3 text-left text-sm hover:bg-muted/60',
                        open?.record.id === record.id && 'bg-muted',
                      )}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="line-clamp-2 font-medium">{record.title || 'Untitled'}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{STATUS_LABEL[status]}</span>
                      </span>
                      <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', STATUS_DOT[status])} aria-hidden />
                    </button>
                  </li>
                ))}
                {!records.loading && shown.length === 0 && (
                  <li className="p-4 text-sm text-muted-foreground">Nothing matches.</li>
                )}
                {records.more && (
                  <li className="p-3">
                    <Button type="button" variant="outline" size="sm" className="w-full" onClick={records.more}>
                      Load more
                    </Button>
                  </li>
                )}
              </ul>
            </aside>

            <section className="min-w-0 flex-1 overflow-y-auto">
              {open ? (
                <RecordEditor
                  key={`${resource}:${open.record.id}:${language}`}
                  resource={resource}
                  record={open.record}
                  language={language}
                  defaultLanguage={languages.data?.default ?? 'en'}
                />
              ) : (
                !records.loading && <p className="p-6 text-sm text-muted-foreground">Choose something to translate.</p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  )
}

function RecordEditor({
  resource,
  record,
  language,
  defaultLanguage,
}: {
  resource: Resource
  record: Record_
  language: string
  defaultLanguage: string
}) {
  const queryClient = useQueryClient()
  const rows = useQuery(
    orpc.admin.languages.translations.list.queryOptions({ input: { resource, resourceId: record.id, language } }),
  )
  if (rows.isPending) return <Skeleton className="m-6 h-64" />
  if (rows.error) return <p className="p-6 text-sm text-destructive">{rows.error.message}</p>
  return (
    <TranslationTable
      resource={resource}
      record={record}
      language={language}
      defaultLanguage={defaultLanguage}
      saved={Object.fromEntries(rows.data.map((r) => [r.field, r]))}
      onSaved={() =>
        Promise.all([queryClient.invalidateQueries({ queryKey: orpc.admin.languages.translations.key() })])
      }
    />
  )
}

function TranslationTable({
  resource,
  record,
  language,
  defaultLanguage,
  saved,
  onSaved,
}: {
  resource: Resource
  record: Record_
  language: string
  defaultLanguage: string
  saved: Record<string, TranslationRow>
  onSaved: () => Promise<unknown>
}) {
  const t = useTranslationDrafts({ resource, resourceId: record.id, language, fields: record.fields, saved, onSaved })
  return (
    <div>
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <h2 className="min-w-0 flex-1 truncate text-lg font-semibold">{record.title || 'Untitled'}</h2>
        {t.anyOutdated && (
          <Button type="button" variant="ghost" disabled={t.saving} onClick={() => t.save(true)}>
            Mark as up to date
          </Button>
        )}
        <Button type="button" disabled={!t.dirty || t.saving} onClick={() => t.save(false)}>
          {t.saving ? 'Saving…' : 'Save'}
        </Button>
      </div>
      <div className="grid grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)] text-sm">
        <div className="border-b px-6 py-3" />
        <div className="border-b px-4 py-3 text-muted-foreground">Reference</div>
        <div className="border-b px-4 py-3 text-muted-foreground">{nameOf(language)}</div>
        {record.fields.map((field) => {
          const id = `workspace-${field.key}`
          return (
            <div key={field.key} className="contents">
              <div className="border-b px-6 py-4">
                <label htmlFor={id} className="font-medium">
                  {field.label}
                </label>
                <p className="text-xs text-muted-foreground">Source: {nameOf(defaultLanguage)}</p>
                {t.isOutdated(field) && (
                  <Badge variant="outline" className="mt-2">
                    Outdated
                  </Badge>
                )}
              </div>
              <div className="whitespace-pre-wrap border-b bg-muted/40 px-4 py-4 text-muted-foreground">
                {(field.kind === 'html' ? plain(field.source) : field.source) || 'Nothing to translate yet'}
              </div>
              <div className="border-b px-4 py-3">
                {field.kind === 'html' ? (
                  <RichTextEditor
                    id={id}
                    value={t.drafts[field.key] ?? ''}
                    onChange={(html) => t.setDraft(field.key, html)}
                  />
                ) : (
                  <Input
                    id={id}
                    value={t.drafts[field.key] ?? ''}
                    onChange={(e) => t.setDraft(field.key, e.target.value)}
                  />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
