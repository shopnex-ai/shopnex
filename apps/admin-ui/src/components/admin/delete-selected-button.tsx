import { useState } from 'react'
import { Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

export function DeleteSelectedButton({
  ids,
  entity,
  remove,
  onDeleted,
}: {
  ids: string[]
  entity: string
  remove: (ids: string[]) => Promise<unknown>
  onDeleted: () => void | Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState(false)
  async function deleteRows() {
    setBusy(true)
    try {
      for (let start = 0; start < ids.length; start += 100) await remove(ids.slice(start, start + 100))
      toast.success(`Deleted ${ids.length} ${entity}`)
      await onDeleted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not delete selected ${entity}.`)
    } finally {
      setBusy(false)
      setOpen(false)
    }
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!busy) setOpen(next)
      }}
    >
      <DialogTrigger render={<Button size="sm" variant="destructive" disabled={ids.length === 0} />}>
        <Trash2Icon />
        Delete selected
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Delete {ids.length} {entity}?
          </DialogTitle>
          <DialogDescription>This permanently deletes the selected {entity}. This cannot be undone.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button variant="destructive" disabled={busy} onClick={() => void deleteRows()}>
            {busy ? 'Deleting…' : `Delete ${ids.length}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
