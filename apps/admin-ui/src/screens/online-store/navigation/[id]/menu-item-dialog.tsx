'use client'

// Add or edit one menu item: its name and what it links to (home page, all products, a collection,
// a product, a page, search, or any address).
import { useQuery } from '@tanstack/react-query'
import { useEffect, useId, useState } from 'react'
import type { MenuItemType, StoredMenuItem } from '@shopnex/api/schemas'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { orpc } from '@/lib/orpc'
import { cn } from '@/lib/utils'
import { newItemId } from '../menu-items'

const TYPES: { value: MenuItemType; label: string }[] = [
  { value: 'frontpage', label: 'Home page' },
  { value: 'catalog', label: 'All products' },
  { value: 'collection', label: 'Collection' },
  { value: 'product', label: 'Product' },
  { value: 'page', label: 'Page' },
  { value: 'search', label: 'Search' },
  { value: 'http', label: 'Web address' },
]
const typeLabel = (type: MenuItemType) => TYPES.find((t) => t.value === type)!.label

const useCollections = () => useQuery(orpc.admin.collections.list.queryOptions({ input: { limit: 100, offset: 0 } }))
const usePages = () => useQuery(orpc.admin.pages.list.queryOptions())

const linksResource = (type: MenuItemType) => type === 'collection' || type === 'product' || type === 'page'

/** "Collection · Summer", "Web address · https://…" */
export function LinkLabel({ item }: { item: StoredMenuItem }) {
  const { data: collections } = useCollections()
  const { data: pages } = usePages()
  const { data: product } = useQuery({
    ...orpc.admin.products.get.queryOptions({ input: { id: item.resourceId ?? '' } }),
    enabled: item.type === 'product' && !!item.resourceId,
    retry: false,
  })
  let detail: string | null = null
  if (item.type === 'collection') detail = collections?.find((c) => c.id === item.resourceId)?.title ?? null
  if (item.type === 'product') detail = product?.title ?? null
  if (item.type === 'page') detail = pages?.find((p) => p.id === item.resourceId)?.title ?? null
  if (item.type === 'http') detail = item.url ?? null
  return (
    <>
      {typeLabel(item.type)}
      {detail && ` · ${detail}`}
    </>
  )
}

type Errors = Partial<Record<'title' | 'resourceId' | 'url', string>>

export function MenuItemDialog({
  open,
  item,
  onOpenChange,
  onSave,
}: {
  open: boolean
  /** Omitted: a new item */
  item?: StoredMenuItem
  onOpenChange: (open: boolean) => void
  onSave: (item: StoredMenuItem) => void
}) {
  const [title, setTitle] = useState('')
  const [type, setType] = useState<MenuItemType>('collection')
  const [resourceId, setResourceId] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const titleId = useId()
  const urlId = useId()

  useEffect(() => {
    if (!open) return
    setTitle(item?.title ?? '')
    setType(item?.type ?? 'collection')
    setResourceId(item?.resourceId ?? null)
    setUrl(item?.url ?? '')
    setErrors({})
  }, [open, item])

  // Picking a page fills in an empty name
  const pick = (id: string, name: string) => {
    setResourceId(id)
    setErrors((e) => ({ ...e, resourceId: undefined }))
    if (!title.trim()) setTitle(name)
  }

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const next: Errors = {}
    if (!title.trim()) next.title = 'Enter a name'
    if (linksResource(type) && !resourceId) next.resourceId = `Choose a ${type}`
    if (type === 'http' && !/^(\/|#|https?:\/\/|mailto:|tel:)/i.test(url.trim())) {
      next.url = 'Use a path like /about, or a full https:// address'
    }
    setErrors(next)
    if (Object.keys(next).length) return
    onSave({
      id: item?.id ?? newItemId(),
      title: title.trim(),
      type,
      resourceId: linksResource(type) ? resourceId : null,
      url: type === 'http' ? url.trim() : null,
      items: item?.items ?? [],
    })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item ? 'Edit menu item' : 'Add menu item'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={submit}>
          <FieldGroup>
            <Field>
              <FieldLabel>Link to</FieldLabel>
              <Select
                items={TYPES}
                value={type}
                onValueChange={(v) => {
                  setType(v as MenuItemType)
                  setResourceId(null)
                  setErrors({})
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {type === 'collection' && <CollectionPicker value={resourceId} onPick={pick} error={errors.resourceId} />}
            {type === 'product' && <ProductPicker value={resourceId} onPick={pick} error={errors.resourceId} />}
            {type === 'page' && <PagePicker value={resourceId} onPick={pick} error={errors.resourceId} />}
            {type === 'http' && (
              <Field data-invalid={!!errors.url || undefined}>
                <FieldLabel htmlFor={urlId}>Address</FieldLabel>
                <Input
                  id={urlId}
                  value={url}
                  placeholder="https://… or /about"
                  aria-invalid={!!errors.url || undefined}
                  onChange={(e) => setUrl(e.target.value)}
                />
                {errors.url && <FieldError>{errors.url}</FieldError>}
              </Field>
            )}
            <Field data-invalid={!!errors.title || undefined}>
              <FieldLabel htmlFor={titleId}>Name</FieldLabel>
              <Input
                id={titleId}
                value={title}
                aria-invalid={!!errors.title || undefined}
                onChange={(e) => setTitle(e.target.value)}
              />
              {errors.title ? (
                <FieldError>{errors.title}</FieldError>
              ) : (
                <FieldDescription>What buyers see</FieldDescription>
              )}
            </Field>
          </FieldGroup>
          <DialogFooter className="mt-6">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">{item ? 'Done' : 'Add'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

type PickerProps = { value: string | null; onPick: (id: string, name: string) => void; error?: string }

function CollectionPicker(props: PickerProps) {
  const { data = [], isPending } = useCollections()
  return (
    <ResourceSelect
      {...props}
      label="Collection"
      items={data.map((c) => ({ value: c.id, label: c.title }))}
      placeholder={isPending ? 'Loading…' : data.length ? 'Choose a collection' : 'No collections yet'}
    />
  )
}

function PagePicker(props: PickerProps) {
  const { data = [], isPending } = usePages()
  return (
    <ResourceSelect
      {...props}
      label="Page"
      items={data.map((p) => ({ value: p.id, label: p.publishedAt ? p.title : `${p.title} (hidden)` }))}
      placeholder={isPending ? 'Loading…' : data.length ? 'Choose a page' : 'No pages yet (add them under Pages)'}
    />
  )
}

function ResourceSelect({
  value,
  onPick,
  error,
  label,
  items,
  placeholder,
}: PickerProps & { label: string; items: { value: string; label: string }[]; placeholder: string }) {
  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel>{label}</FieldLabel>
      <Select
        items={items}
        value={value ?? ''}
        onValueChange={(v) => onPick(String(v), items.find((i) => i.value === v)?.label ?? '')}
      >
        <SelectTrigger className="w-full" aria-invalid={!!error || undefined}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {items.map((i) => (
            <SelectItem key={i.value} value={i.value}>
              {i.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error && <FieldError>{error}</FieldError>}
    </Field>
  )
}

// Search as you type (shops can have thousands of products)
function ProductPicker({ value, onPick, error }: PickerProps) {
  const [search, setSearch] = useState('')
  const id = useId()
  const { data: selected } = useQuery({
    ...orpc.admin.products.get.queryOptions({ input: { id: value ?? '' } }),
    enabled: !!value,
    retry: false,
  })
  const { data, isFetching } = useQuery(
    orpc.admin.products.list.queryOptions({ input: { limit: 8, offset: 0, search: search.trim() || undefined } }),
  )
  return (
    <Field data-invalid={!!error || undefined}>
      <FieldLabel htmlFor={id}>Product</FieldLabel>
      {selected && (
        <p className="text-sm">
          Selected: <span className="font-medium">{selected.title}</span>
        </p>
      )}
      <Input
        id={id}
        value={search}
        placeholder="Search products"
        aria-invalid={!!error || undefined}
        onChange={(e) => setSearch(e.target.value)}
      />
      <ul className="max-h-48 overflow-y-auto surface-inset">
        {data?.items.map((p) => (
          <li key={p.id}>
            <button
              type="button"
              onClick={() => onPick(p.id, p.title)}
              className={cn(
                'flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted',
                p.id === value && 'bg-muted font-medium',
              )}
            >
              <span className="truncate">{p.title}</span>
              {p.status !== 'active' && <span className="text-xs text-muted-foreground">{p.status}</span>}
            </button>
          </li>
        ))}
        {data && !data.items.length && (
          <li className="px-3 py-2 text-sm text-muted-foreground">{isFetching ? 'Searching…' : 'No products found'}</li>
        )}
      </ul>
      {error ? (
        <FieldError>{error}</FieldError>
      ) : (
        <FieldDescription>Draft and archived products are hidden from the storefront menu</FieldDescription>
      )}
    </Field>
  )
}
