import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/online-store')({
  component: () => <Outlet />,
})
