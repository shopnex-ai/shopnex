import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { StaffManager } from '@/screens/staff/staff-manager'

export const Route = createFileRoute('/admin/settings/staff')({ component: StaffPage })
function StaffPage() {
  const { access } = Route.useRouteContext()
  const { tenant, session } = access
  if (!tenant || !session) return null
  return (
    <>
      <PageHeader title="Staff" description="People who can sign in to this admin." />
      <StaffManager currentUserId={session.user.id} canManageAdmins={tenant.superAdmin || tenant.role === 'owner'} />
    </>
  )
}
