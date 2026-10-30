import { createFileRoute } from '@tanstack/react-router'
import { NoAccess } from '@/components/admin/no-access'
import { PageHeader } from '@/components/admin/page-header'
import { getMarketplaceInstanceUrl } from '@/screens/apps/functions'
import { MarketplaceCard } from '@/screens/settings/marketplace-card'

const DEFAULT_MARKETPLACE_URL = import.meta.env.MARKETPLACE_URL ?? 'https://apps.shopnex.com'

export const Route = createFileRoute('/admin/settings/marketplace')({
  loader: () => getMarketplaceInstanceUrl(),
  component: MarketplaceSettingsPage,
})
function MarketplaceSettingsPage() {
  const tenant = Route.useRouteContext().access.tenant
  const instanceUrl = Route.useLoaderData()
  if (!tenant?.superAdmin) return <NoAccess message="Only super admins can manage the marketplace." />
  return (
    <>
      <PageHeader title="Marketplace" description="Connect this install to the Shopnex app marketplace." />
      <MarketplaceCard defaultMarketplaceUrl={DEFAULT_MARKETPLACE_URL} defaultPublicUrl={instanceUrl} />
    </>
  )
}
