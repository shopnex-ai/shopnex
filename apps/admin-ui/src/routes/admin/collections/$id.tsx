import { createFileRoute } from '@tanstack/react-router'
import { CollectionDetail } from '@/screens/collections/[id]/collection-detail'

export const Route = createFileRoute('/admin/collections/$id')({ component: CollectionPage })
function CollectionPage() {
  const { id } = Route.useParams()
  return (
    <div className="mx-auto max-w-5xl">
      <CollectionDetail id={id} />
    </div>
  )
}
