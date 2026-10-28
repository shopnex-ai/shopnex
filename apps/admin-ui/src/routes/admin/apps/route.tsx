import { createFileRoute, Outlet, useLocation } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { AiAppsCard } from '@/screens/apps/ai-apps-card'
import { AppRegistryCard } from '@/screens/apps/app-registry-card'
import { AppStoreCard } from '@/screens/apps/app-store-card'
import { InstalledAppsCard } from '@/screens/apps/installed-apps-card'
import { MarketplaceCard } from '@/screens/apps/marketplace-card'
import { getMarketplaceInstanceUrl } from '@/screens/apps/functions'

const DEFAULT_MARKETPLACE_URL = import.meta.env.MARKETPLACE_URL ?? 'https://apps.shopnex.com'

export const Route = createFileRoute('/admin/apps')({ loader: () => getMarketplaceInstanceUrl(), component: AppsPage })
function AppsPage() {
  const pathname = useLocation({ select: (location) => location.pathname })
  const tenant = Route.useRouteContext().access.tenant
  const instanceUrl = Route.useLoaderData()
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
          <InstalledAppsCard />
          <AiAppsCard shopId={tenant.shop.id} />
          <AppStoreCard shopId={tenant.shop.id} superAdmin={tenant.superAdmin} />
          {tenant.superAdmin && (
            <>
              <MarketplaceCard defaultMarketplaceUrl={DEFAULT_MARKETPLACE_URL} defaultPublicUrl={instanceUrl} />
              <AppRegistryCard />
            </>
          )}
        </>
      ) : (
        <p className="text-muted-foreground">Only shop owners and admins can manage apps.</p>
      )}
    </div>
  )
}
