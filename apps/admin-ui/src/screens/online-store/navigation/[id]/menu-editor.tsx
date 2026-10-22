'use client'

// One menu: name, handle and its links (up to 3 levels). Edits stay local until Save, like a form.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  IndentDecreaseIcon,
  IndentIncreaseIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useEffect, useId, useState } from 'react'
import { toast } from 'sonner'
import { ORPCError } from '@orpc/client'
import type { StoredMenuItem } from '@shopnex/api/schemas'
import { PageHeader } from '@/components/admin/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { client, orpc } from '@/lib/orpc'
import {
  addItem,
  canAddChild,
  canIndent,
  canOutdent,
  getItem,
  indent,
  moveItem,
  outdent,
  removeItem,
  replaceItem,
  type Path,
} from '../menu-items'
import { LinkLabel, MenuItemDialog } from './menu-item-dialog'

const back = { to: '/admin/online-store/navigation', label: 'Navigation' } as const

type Draft = { title: string; handle: string; items: StoredMenuItem[] }

export function MenuEditor({ id }: { id: string }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: menu, error } = useQuery(orpc.admin.menus.get.queryOptions({ input: { id } }))
  const [draft, setDraft] = useState<Draft | null>(null)
  const [handleError, setHandleError] = useState<string | null>(null)
  // Which item the dialog edits: a path, or where a new one goes
  const [dialog, setDialog] = useState<{ edit: Path } | { addTo: Path } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const titleId = useId()
  const handleId = useId()

  useEffect(() => {
    if (menu && !draft) setDraft({ title: menu.title, handle: menu.handle, items: menu.items })
  }, [menu, draft])

  const save = useMutation({
    mutationFn: (d: Draft) => client.admin.menus.update({ id, ...d }),
    onSuccess: async (saved) => {
      setHandleError(null)
      setDraft({ title: saved.title, handle: saved.handle, items: saved.items })
      queryClient.setQueryData(orpc.admin.menus.get.queryKey({ input: { id } }), saved)
      await queryClient.invalidateQueries({ queryKey: orpc.admin.menus.list.key() })
      toast.success('Menu saved')
    },
    onError: (e) => {
      if (e instanceof ORPCError && e.code === 'CONFLICT') setHandleError(e.message)
      else toast.error(e.message)
    },
  })

  const remove = useMutation({
    mutationFn: () => client.admin.menus.delete({ id }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: orpc.admin.menus.key() })
      toast.success('Menu deleted')
      navigate({ to: back.to })
    },
    onError: (e) => toast.error(e.message),
  })

  if (error) return <p className="text-sm text-destructive">{error.message}</p>
  if (!menu || !draft) return <Skeleton className="h-96 w-full" />

  const dirty = JSON.stringify(draft) !== JSON.stringify({ title: menu.title, handle: menu.handle, items: menu.items })
  const setItems = (items: StoredMenuItem[]) => setDraft({ ...draft, items })

  return (
    <div className="space-y-4">
      <PageHeader
        back={back}
        title={draft.title || 'Menu'}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate(draft)}>
              {save.isPending ? 'Saving…' : 'Save'}
            </Button>
          </>
        }
      />

      <Card>
        <CardContent>
          <FieldGroup className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor={titleId}>Name</FieldLabel>
              <Input id={titleId} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </Field>
            <Field data-invalid={!!handleError || undefined}>
              <FieldLabel htmlFor={handleId}>Handle</FieldLabel>
              <Input
                id={handleId}
                className="font-mono"
                value={draft.handle}
                aria-invalid={!!handleError || undefined}
                onChange={(e) => {
                  setHandleError(null)
                  setDraft({ ...draft, handle: e.target.value })
                }}
              />
              {handleError ? (
                <FieldError>{handleError}</FieldError>
              ) : (
                <FieldDescription>What storefronts ask for, e.g. main-menu</FieldDescription>
              )}
            </Field>
          </FieldGroup>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Menu items</CardTitle>
          <CardDescription>Up to 3 levels. Indent an item to put it under the one above.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {draft.items.length ? (
            <ItemTree
              items={draft.items}
              all={draft.items}
              parent={[]}
              onChange={setItems}
              onEdit={(path) => setDialog({ edit: path })}
              onAddChild={(path) => setDialog({ addTo: path })}
            />
          ) : (
            <p className="py-6 text-center text-sm text-muted-foreground">This menu has no items yet.</p>
          )}
          <Button variant="outline" size="sm" onClick={() => setDialog({ addTo: [] })}>
            <PlusIcon />
            Add menu item
          </Button>
        </CardContent>
      </Card>

      <MenuItemDialog
        open={dialog !== null}
        item={dialog && 'edit' in dialog ? getItem(draft.items, dialog.edit) : undefined}
        onOpenChange={(open) => !open && setDialog(null)}
        onSave={(item) => {
          if (!dialog) return
          setItems(
            'edit' in dialog ? replaceItem(draft.items, dialog.edit, item) : addItem(draft.items, dialog.addTo, item),
          )
          setDialog(null)
        }}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {menu.title}?</DialogTitle>
            <DialogDescription>
              Storefronts asking for <code className="font-mono">{menu.handle}</code> won&apos;t find it anymore.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate()}>
              Delete menu
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ItemTree({
  items,
  all,
  parent,
  onChange,
  onEdit,
  onAddChild,
}: {
  items: StoredMenuItem[]
  /** The whole tree (edits apply to it) */
  all: StoredMenuItem[]
  parent: Path
  onChange: (items: StoredMenuItem[]) => void
  onEdit: (path: Path) => void
  onAddChild: (path: Path) => void
}) {
  return (
    <ul className={parent.length ? 'mt-2 space-y-2 border-l pl-4' : 'space-y-2'}>
      {items.map((item, i) => {
        const path = [...parent, i]
        const action = (label: string, icon: React.ReactNode, onClick: () => void, disabled = false) => (
          <Button variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={disabled} onClick={onClick}>
            {icon}
          </Button>
        )
        return (
          <li key={item.id}>
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onEdit(path)}>
                <span className="block truncate text-sm font-medium">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  <LinkLabel item={item} />
                </span>
              </button>
              <div className="flex shrink-0 items-center">
                {action('Move up', <ArrowUpIcon />, () => onChange(moveItem(all, path, -1)), i === 0)}
                {action('Move down', <ArrowDownIcon />, () => onChange(moveItem(all, path, 1)), i === items.length - 1)}
                {action('Move out', <IndentDecreaseIcon />, () => onChange(outdent(all, path)), !canOutdent(path))}
                {action(
                  'Put under the item above',
                  <IndentIncreaseIcon />,
                  () => onChange(indent(all, path)),
                  !canIndent(all, path),
                )}
                {action('Add sub-item', <PlusIcon />, () => onAddChild(path), !canAddChild(path))}
                {action('Edit', <PencilIcon />, () => onEdit(path))}
                {action('Remove', <Trash2Icon />, () => onChange(removeItem(all, path)))}
              </div>
            </div>
            {item.items.length > 0 && (
              <ItemTree
                items={item.items}
                all={all}
                parent={path}
                onChange={onChange}
                onEdit={onEdit}
                onAddChild={onAddChild}
              />
            )}
          </li>
        )
      })}
    </ul>
  )
}
