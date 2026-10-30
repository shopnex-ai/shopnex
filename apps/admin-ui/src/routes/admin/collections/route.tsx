import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { CollectionList } from '@/screens/collections/collection-list'

export const Route = createFileRoute('/admin/collections')({ component: CollectionsPage })
function CollectionsPage() {
  const pathname = useLocation({ select: (location) => location.pathname })
  if (pathname !== '/admin/collections') return <Outlet />
  return (
    <div className="mx-auto max-w-5xl">
      <CollectionList />
    </div>
  )
}
