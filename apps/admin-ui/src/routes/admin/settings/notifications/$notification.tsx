import { createFileRoute, notFound } from '@tanstack/react-router'
import { notificationParam } from '@shopnex/email/contract'
import { NotificationEditor } from '@/screens/settings/notifications/notification-editor'

export const Route = createFileRoute('/admin/settings/notifications/$notification')({
  params: {
    parse: (params) => {
      const parsed = notificationParam.safeParse(params)
      if (!parsed.success) throw notFound()
      return parsed.data
    },
  },
  component: NotificationEditorRoute,
})

function NotificationEditorRoute() {
  const { notification } = Route.useParams()
  return <NotificationEditor key={notification} notification={notification} />
}
