import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { StorefrontKeysCard } from '@/screens/settings/storefront-keys-card'

export const Route = createFileRoute('/admin/settings/storefront-keys')({ component: StorefrontKeysSettingsPage })
function StorefrontKeysSettingsPage() {
  return (
    <>
      <PageHeader title="Storefront keys" />
      <StorefrontKeysCard />
    </>
  )
}
