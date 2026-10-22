import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { MenuList } from '@/screens/online-store/navigation/menu-list'

export const Route = createFileRoute('/admin/online-store/navigation')({ component: NavigationRoute })

function NavigationRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return pathname === '/admin/online-store/navigation' ? (
    <div className="mx-auto max-w-4xl">
      <MenuList />
    </div>
  ) : (
    <Outlet />
  )
}
