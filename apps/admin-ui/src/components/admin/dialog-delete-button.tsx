import { Button } from '@/components/ui/button'

// The Delete action in an edit dialog's footer, opposite Save
export function DialogDeleteButton({ onDelete, pending }: { onDelete: () => void; pending: boolean }) {
  return (
    <Button type="button" variant="outline" onClick={onDelete} disabled={pending}>
      Delete
    </Button>
  )
}
