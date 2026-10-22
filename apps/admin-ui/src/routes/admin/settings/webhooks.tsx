import { createFileRoute } from '@tanstack/react-router'
import { PageHeader } from '@/components/admin/page-header'
import { WebhooksCard } from '@/screens/settings/webhooks-card'

export const Route = createFileRoute('/admin/settings/webhooks')({ component: WebhooksSettingsPage })
function WebhooksSettingsPage() {
  return (
    <>
      <PageHeader title="Webhooks" description="Notify other services when things happen in your shop." />
      <WebhooksCard />
    </>
  )
}
