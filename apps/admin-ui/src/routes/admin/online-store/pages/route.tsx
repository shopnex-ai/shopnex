import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { PageList } from '@/screens/online-store/pages/page-list'
import { Page } from '@/components/admin/page'

export const Route = createFileRoute('/admin/online-store/pages')({ component: PagesRoute })

function PagesRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return pathname === '/admin/online-store/pages' ? (
    <Page>
      <PageList />
    </Page>
  ) : (
    <Outlet />
  )
}
