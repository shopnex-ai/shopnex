import { createFileRoute } from '@tanstack/react-router'
import { NoAccess } from '@/components/admin/no-access'
import { PlatformDashboard } from '@/screens/platform/platform-dashboard'
import { Page } from '@/components/admin/page'

export const Route = createFileRoute('/admin/platform')({ component: PlatformPage })

function PlatformPage() {
  const tenant = Route.useRouteContext().access.tenant
  return (
    <Page>
      {tenant?.superAdmin ? <PlatformDashboard /> : <NoAccess message="Only super admins can see the platform." />}
    </Page>
  )
}
