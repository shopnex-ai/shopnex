import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { loadStorefront } from '@/screens/online-store/themes/theme-functions'
import { ThemePage } from '@/screens/online-store/themes/theme-page'

export const Route = createFileRoute('/admin/online-store/themes')({
  loader: () => loadStorefront(),
  component: ThemesRoute,
})

function ThemesRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return pathname === '/admin/online-store/themes' ? <ThemePage /> : <Outlet />
}
