import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { NoAccess } from '@/components/admin/no-access'
import { PageHeader } from '@/components/admin/page-header'
import { Skeleton } from '@/components/ui/skeleton'
import { AppCatalogCard } from '@/screens/apps/app-catalog-card'
import { AppRegistryCard } from '@/screens/apps/app-registry-card'

export const Route = createFileRoute('/admin/apps')({
  // Show the skeleton right away; the router waits 1s by default before showing a pending component
  pendingMs: 0,
  pendingComponent: AppsPending,
  component: AppsPage,
})

function AppsPending() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Apps"
        description="Apps add features to your shop and work with its data through the Admin API."
      />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-56 w-full" />
    </div>
  )
}

function AppsPage() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const tenant = Route.useRouteContext().access.tenant
  if (pathname !== '/admin/apps') return <Outlet />
  if (!tenant) return null
  const canManage = tenant.superAdmin || tenant.role === 'owner' || tenant.role === 'admin'
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        title="Apps"
        description="Apps add features to your shop and work with its data through the Admin API."
      />
      {canManage ? (
        <>
          <AppCatalogCard shopId={tenant.shop.id} superAdmin={tenant.superAdmin} />
          {tenant.superAdmin && <AppRegistryCard />}
        </>
      ) : (
        <NoAccess message="Only shop owners and admins can manage apps." />
      )}
    </div>
  )
}
