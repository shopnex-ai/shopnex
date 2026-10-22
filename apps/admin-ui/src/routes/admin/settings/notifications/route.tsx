import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { NotificationList } from '@/screens/settings/notifications/notification-list'

export const Route = createFileRoute('/admin/settings/notifications')({ component: NotificationsRoute })

function NotificationsRoute() {
  const pathname = useLocation({ select: (location) => location.pathname })
  return pathname === '/admin/settings/notifications' ? (
    <>
      <PageHeader title="Notifications" description="The emails your shop sends when orders change." />
      <NotificationList />
    </>
  ) : (
    <Outlet />
  )
}
