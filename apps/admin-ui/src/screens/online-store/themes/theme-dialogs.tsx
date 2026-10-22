'use client'

// Rename / publish / delete dialogs for the theme pages, one at a time for the theme they were opened on.
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { toast } from 'sonner'
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
import { orpc, type Outputs } from '@/lib/orpc'

export type Theme = Outputs['admin']['themes']['list'][number]

type Kind = 'rename' | 'publish' | 'delete'
// Kept while the dialog animates closed; `n` counts openings, so the rename form starts over each time
type Pending = { kind: Kind; theme: Theme; open: boolean; n: number }

/** `open('rename', theme)`… and the dialogs to render. Done dialogs refresh the theme list. */
export function useThemeDialogs() {
  const queryClient = useQueryClient()
  const [pending, setPending] = useState<Pending | null>(null)
  const open = (kind: Kind, theme: Theme) => setPending((p) => ({ kind, theme, open: true, n: (p?.n ?? 0) + 1 }))
  const onClose = () => setPending((p) => p && { ...p, open: false })
  const onDone = () => queryClient.invalidateQueries({ queryKey: orpc.admin.themes.key() })
  const props = (kind: Kind) => ({
    ...(pending?.kind === kind ? { theme: pending.theme, open: pending.open } : { theme: null, open: false }),
    onClose,
    onDone,
  })
  const dialogs = (
    <>
      <RenameDialog key={pending?.n} {...props('rename')} />
      <PublishDialog {...props('publish')} />
      <DeleteDialog {...props('delete')} />
    </>
  )
  return { open, dialogs }
}

type DialogProps = { theme: Theme | null; open: boolean; onClose: () => void; onDone: () => Promise<unknown> }

function RenameDialog({ theme, open, onClose, onDone }: DialogProps) {
  const [name, setName] = useState(theme?.name ?? '')
  const rename = useMutation(orpc.admin.themes.rename.mutationOptions())

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!theme) return
    try {
      await rename.mutateAsync({ id: theme.id, name })
      await onDone()
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename')
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename theme</DialogTitle>
          <DialogDescription>Only you and your staff see this name.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={100} aria-label="Name" autoFocus />
          <DialogFooter>
            <DialogClose render={<Button variant="outline" type="button" />}>Cancel</DialogClose>
            <Button type="submit" disabled={!name.trim() || rename.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function PublishDialog({ theme, open, onClose, onDone }: DialogProps) {
  const publish = useMutation(
    orpc.admin.themes.publish.mutationOptions({
      onSuccess: async () => {
        toast.success(`${theme?.name} is now your current theme`)
        await onDone()
        onClose()
      },
      onError: (e) => toast.error(e.message),
    }),
  )
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Use {theme?.name}?</DialogTitle>
          <DialogDescription>
            It’s published and replaces your current theme, so buyers see it right away. The theme it replaces stays in
            your themes.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button disabled={publish.isPending} onClick={() => theme && publish.mutate({ id: theme.id })}>
            {publish.isPending ? 'Publishing…' : 'Use theme'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DeleteDialog({ theme, open, onClose, onDone }: DialogProps) {
  const remove = useMutation(
    orpc.admin.themes.delete.mutationOptions({
      onSuccess: async () => {
        await onDone()
        onClose()
      },
      onError: (e) => toast.error(e.message),
    }),
  )
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {theme?.name}?</DialogTitle>
          <DialogDescription>Its customizations are deleted too. This can’t be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep it</DialogClose>
          <Button
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => theme && remove.mutate({ id: theme.id })}
          >
            Delete theme
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
