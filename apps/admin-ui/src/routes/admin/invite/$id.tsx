import { createFileRoute } from '@tanstack/react-router'
import { loadInvitation } from '@/screens/invite/functions'
import { InvitePage } from '@/screens/invite/invite-page'

export const Route = createFileRoute('/admin/invite/$id')({
  loader: ({ params }) => loadInvitation({ data: params.id }),
  component: InvitePage,
})
