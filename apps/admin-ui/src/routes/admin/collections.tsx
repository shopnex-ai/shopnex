import { createFileRoute } from '@tanstack/react-router'
import { CollectionList } from '@/screens/collections/collection-list'

export const Route = createFileRoute('/admin/collections')({ component: CollectionsPage })
function CollectionsPage() {
  return (
    <div className="mx-auto max-w-5xl">
      <CollectionList />
    </div>
  )
}
