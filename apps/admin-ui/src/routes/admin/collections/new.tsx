import { createFileRoute } from '@tanstack/react-router'
import { NewCollection } from '@/screens/collections/new-collection'

export const Route = createFileRoute('/admin/collections/new')({ component: NewCollectionPage })
function NewCollectionPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <NewCollection />
    </div>
  )
}
