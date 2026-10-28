import { createFileRoute, Outlet, redirect } from '@tanstack/react-router'
import { NoAccess } from '@/components/admin/no-access'

// Each settings page is its own route; the admin layout swaps in the settings sidebar under /admin/settings
export const Route = createFileRoute('/admin/settings')({
  beforeLoad: ({ location }) => {
    if (location.pathname === '/admin/settings') throw redirect({ to: '/admin/settings/general' })
  },
  component: SettingsLayout,
})
function SettingsLayout() {
  const { access } = Route.useRouteContext()
  const tenant = access.tenant
  if (!tenant) return null
  const canManage = tenant.superAdmin || tenant.role === 'owner' || tenant.role === 'admin'
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {canManage ? (
        <Outlet />
      ) : (
        <NoAccess message="Only shop owners and admins can change settings." />
      )}
    </div>
  )
}
