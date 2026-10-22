import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/admin/online-store')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/admin/online-store') throw redirect({ to: '/admin/online-store/themes' })
  },
  component: () => <Outlet />,
})
