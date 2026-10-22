import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { ShippingRatesCard } from '@/screens/settings/shipping-rates-card'

export const Route = createFileRoute('/admin/settings/shipping')({ component: ShippingSettingsPage })
function ShippingSettingsPage() {
  const { access } = Route.useRouteContext()
  if (!access.tenant) return null
  return (
    <>
      <PageHeader title="Shipping" description="Rates customers choose from at checkout." />
      <ShippingRatesCard currency={access.tenant.shop.currency} />
    </>
  )
}
