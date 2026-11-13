import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { BusinessDetailsCard } from '@/screens/settings/business-details-card'
import { ShopSettingsCard } from '@/screens/settings/shop-settings-card'

export const Route = createFileRoute('/admin/settings/general')({ component: GeneralSettingsPage })
function GeneralSettingsPage() {
  return (
    <>
      <PageHeader title="General" description="Your shop's name, currency and storefront." />
      <ShopSettingsCard />
      <BusinessDetailsCard />
    </>
  )
}
