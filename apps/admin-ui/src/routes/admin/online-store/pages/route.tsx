import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { PageList } from '@/screens/online-store/pages/page-list'

export const Route = createFileRoute('/admin/online-store/pages')({ component: PagesRoute })

function PagesRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return pathname === '/admin/online-store/pages' ? (
    <div className="mx-auto max-w-4xl">
      <PageList />
    </div>
  ) : (
    <Outlet />
  )
}
